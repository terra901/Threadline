/**
 * Background Service Worker — entry point.
 *
 * Responsibilities:
 *   - Inject MAIN-world interceptor on AI tabs (executeScript)
 *   - Listen for CAPTURE_MESSAGE from content scripts (US1)
 *   - Route to matching platform adapter (US1)
 *   - Persist MemoryRecord to IndexedDB via db.ts (US1)
 *   - Queue embedding generation via embedding.ts (US2)
 *   - Serve memory graph, import/export, settings, and recall messages
 */

import { mainWorldInterceptor } from "./injector";
import { MODEL_NAME } from "../constants/embedding";
import { ChatGPTAdapter } from "./adapters/chatgpt";
import { ClaudeAdapter } from "./adapters/claude";
import { GeminiAdapter } from "./adapters/gemini";
import { PerplexityAdapter } from "./adapters/perplexity";
import { GrokAdapter } from "./adapters/grok";
import type { IAdapter } from "./adapters/base";
import { stripRecallTemplate } from "./adapters/base";
import { db, isCaptureEnabled, isQuotaExceeded, safeAddRecord } from "./db";
import type {
  CaptureMessage,
  CaptureMessageResponse,
  ClearErrorsResponse,
  ClearAllMemoriesResponse,
  StatusUpdate,
  UpdateConversationTitleRequest,
  UpdateConversationTitleResponse,
  GetConversationTitlesRequest,
  GetConversationTitlesResponse,
  QueryMemorySessionsRequest,
  QueryMemorySessionsResponse,
  QuerySessionGraphRequest,
  QuerySessionGraphResponse,
  PersistPendingSessionRequest,
  PersistPendingSessionResponse,
  DeleteMemorySessionRequest,
  DeleteMemorySessionResponse,
  GetCaptureModeResponse,
  SetCaptureModeRequest,
  SetCaptureModeResponse,
  GetAttachmentSaveModeResponse,
  SetAttachmentSaveModeRequest,
  SetAttachmentSaveModeResponse,
  DownloadAttachmentRequest,
  DownloadAttachmentResponse,
  SearchMemoriesRequest,
  ImportMemoriesRequest,
  DomSyncRequest,
  OpenMemoryGraphResponse,
} from "../types/messages";
import { handleSearchMemories, hydrateSearchIndex, miniSearch } from "./search";
import type { MemoryRecord } from "../types/memory";
import {
  FAVORITE_PROMPTS_KEY,
  FOLDERS_STORAGE_KEY,
} from "../constants/prompts";
import { processPendingEmbeddings } from "./syncEmbeddings";
import { chunkText, expandToChunks } from "./chunking";
import {
  embedViaOffscreen,
  embedBatchViaOffscreen,
  queueEmbedding,
} from "./offscreen";
import { handleDomSync } from "./domSync";
import { maybeFetchPerplexityThreadHistory } from "./perplexityBgFetch";
import {
  cachePendingRecords,
  deletePendingSession,
  getCaptureMode,
  getPendingSessionGraph,
  listPendingSessions,
  persistPendingSession,
} from "./pendingSessions";
import { CAPTURE_MODE_STORAGE_KEY, PENDING_MEMORY_SESSIONS_STORAGE_KEY, isCaptureMode } from "../constants/capture";
import { MEMORY_EXPORT_APP_NAME } from "../constants/branding";
import { DEFAULT_ATTACHMENT_SAVE_MODE, normalizeAttachmentSaveMode } from "../constants/attachments";
import { getAttachmentDownload, getAttachmentSaveMode, setAttachmentSaveMode } from "./attachments";

// Re-export for backward compatibility (tests import chunkText/expandToChunks from this module)
export { chunkText, expandToChunks } from "./chunking";
export { embedViaOffscreen, embedBatchViaOffscreen } from "./offscreen";

// ─── Adapter Registry ─────────────────────────────────────────────────────────

const adapters: IAdapter[] = [
  new ChatGPTAdapter(),
  new ClaudeAdapter(),
  new GeminiAdapter(),
  new PerplexityAdapter(),
  new GrokAdapter(),
];

function findAdapter(url: string): IAdapter | undefined {
  return adapters.find((a) => a.canHandle(url));
}

// ─── Capture Handler ──────────────────────────────────────────────────────────

async function handleCaptureMessage(
  message: CaptureMessage,
): Promise<CaptureMessageResponse> {
  const { provider, rawData, url, timestamp } = message.payload;

  if (!isCaptureEnabled()) {
    console.warn("[Threadline] Capture skipped: QUOTA_EXCEEDED");
    return { success: false, error: "QUOTA_EXCEEDED" };
  }

  const adapter = findAdapter(url);
  if (!adapter) {
    console.warn("[Threadline] No adapter for URL:", url);
    return { success: false, error: `No adapter for URL: ${url}` };
  }

  let records: MemoryRecord[];
  try {
    records = adapter.parse(rawData, url, timestamp);
  } catch (err) {
    console.warn("[Threadline] Adapter parse failed:", url, err);
    await db.logError("ADAPTER_PARSE_FAILED", {
      url,
      provider,
      error: String(err),
    });
    return { success: false, error: "Parse failed" };
  }

  if (!records.length) {
    console.warn("[Threadline] No records extracted from:", url);
    return { success: false, error: "No records extracted" };
  }

  // Strip recall-injected templates from user messages
  records = records.flatMap(record => {
    if (record.role !== 'user') return [record]
    const cleaned = stripRecallTemplate(record.content)
    if (cleaned === null) return []
    if (cleaned === record.content) return [record]
    return [{ ...record, content: cleaned }]
  })
  if (!records.length) {
    return { success: false, error: 'No records after recall template filter' }
  }

  if (await getCaptureMode() === "manual") {
    await cachePendingRecords(records.map((record) => ({
      ...record,
      metadata: {
        ...(record.metadata ?? {}),
        captureMode: "manual",
      },
    })));
    void broadcastStatusUpdate();
    return { success: true, recordId: undefined };
  }

  // Dedup chat history records (fromHistory=true):
  // If the session already has any records (e.g. captured via SSE), skip writing new records
  // to avoid duplicating messages.
  const hasHistoryRecords = records.some(
    (r) => r.metadata?.["fromHistory"] === true,
  );
  if (hasHistoryRecords) {
    const sessionId = records[0].sessionId;
    const sessionExists = await db.hasSessionRecords(sessionId);
    if (sessionExists) {
      return { success: true, recordId: undefined };
    }
    // Session is new — still dedup individual IDs in case of partial prior writes
    const allIds = records.map((r) => r.id);
    const newIds = new Set(await db.filterNewChatMessageUuids(allIds));
    records = records.filter((r) => newIds.has(r.id));
    if (!records.length) {
      return { success: true, recordId: undefined };
    }
  }

  const ids: string[] = [];
  for (const record of records) {
    for (const chunk of expandToChunks(record)) {
      const id = await safeAddRecord(chunk);
      if (id) {
        ids.push(id);
        // Keep MiniSearch in sync with Dexie
        try {
          miniSearch.add(chunk);
        } catch {
          /* duplicate id — already indexed */
        }
        queueEmbedding(chunk);
      }
    }
  }

  lastCaptureTime = Date.now();
  void broadcastStatusUpdate();

  if (ids.length > 0) {
    // Notify onboarding on first-ever memory saved via storage (works across all extension contexts)
    const { onboarding_first_memory_saved, onboarding_step2_active } = await chrome.storage.local.get([
      'onboarding_first_memory_saved',
      'onboarding_step2_active',
    ])
    if (onboarding_step2_active && !onboarding_first_memory_saved) {
      chrome.storage.local.set({ onboarding_first_memory_saved: true })
    }
  }

  return { success: true, recordId: ids[0] };
}

// ─── Status Broadcast ─────────────────────────────────────────────────────────

let lastCaptureTime: number | undefined;

async function broadcastStatusUpdate(): Promise<void> {
  try {
    const [totalRecords, recentRecords, errors, captureMode] = await Promise.all([
      db.countTotal(),
      db.getRecent(10),
      db.getRecentErrors(5),
      getCaptureMode(),
    ]);

    const payload: StatusUpdate = {
      type: "STATUS_UPDATE",
      payload: {
        totalRecords,
        recentRecords,
        errors,
        lastCaptureTime,
        quotaExceeded: isQuotaExceeded(),
        captureMode,
      },
    };

    // Notify popup (extension page) — may be closed, ignore errors
    chrome.runtime.sendMessage(payload).catch(() => void 0);

    // Notify content scripts (FloatingMemoryPanel) on all AI tabs
    chrome.tabs.query({ url: AI_ORIGINS.map((o) => `${o}/*`) }, (tabs) => {
      for (const tab of tabs) {
        if (tab.id) {
          chrome.tabs.sendMessage(tab.id, payload).catch(() => void 0);
        }
      }
    });
  } catch {
    // Status broadcast is best-effort
  }
}

async function handleQueryMemorySessions(
  message: QueryMemorySessionsRequest,
): Promise<QueryMemorySessionsResponse> {
  try {
    const { sessions: persistedSessions } = await db.querySessions(message.payload);
    const pendingSessions = await listPendingSessions(message.payload);
    const merged = [...pendingSessions, ...persistedSessions]
      .sort((a, b) => b.lastTimestamp - a.lastTimestamp)
      .slice(message.payload?.offset ?? 0, (message.payload?.offset ?? 0) + (message.payload?.limit ?? 200));
    return {
      type: "QUERY_MEMORY_SESSIONS_RESPONSE",
      payload: { sessions: merged, total: pendingSessions.length + persistedSessions.length },
    };
  } catch (err) {
    return {
      type: "QUERY_MEMORY_SESSIONS_RESPONSE",
      payload: { sessions: [], total: 0, error: String(err) },
    };
  }
}

async function handleQuerySessionGraph(
  message: QuerySessionGraphRequest,
): Promise<QuerySessionGraphResponse> {
  try {
    const pending = await getPendingSessionGraph(message.payload.sessionId);
    const { session, records } = pending.session
      ? pending
      : await db.getSessionGraph(message.payload.sessionId);
    return {
      type: "QUERY_SESSION_GRAPH_RESPONSE",
      payload: { session, records },
    };
  } catch (err) {
    return {
      type: "QUERY_SESSION_GRAPH_RESPONSE",
      payload: { records: [], error: String(err) },
    };
  }
}

async function handlePersistPendingSession(
  message: PersistPendingSessionRequest,
): Promise<PersistPendingSessionResponse> {
  try {
    const result = await persistPendingSession(message.payload.sessionId);
    void hydrateSearchIndex();
    void broadcastStatusUpdate();
    return {
      type: "PERSIST_PENDING_SESSION_RESPONSE",
      payload: { success: true, count: result.count, skipped: result.skipped },
    };
  } catch (err) {
    return {
      type: "PERSIST_PENDING_SESSION_RESPONSE",
      payload: { success: false, count: 0, error: String(err) },
    };
  }
}

async function handleDeleteMemorySession(
  message: DeleteMemorySessionRequest,
): Promise<DeleteMemorySessionResponse> {
  try {
    const sessionId = message.payload.sessionId;
    const pendingDeleted = await deletePendingSession(sessionId);
    const dbDeleted = await db.deleteSession(sessionId);
    if (dbDeleted > 0) {
      await hydrateSearchIndex();
    }
    void broadcastStatusUpdate();
    return {
      type: "DELETE_MEMORY_SESSION_RESPONSE",
      payload: { success: true, deleted: dbDeleted + (pendingDeleted ? 1 : 0) },
    };
  } catch (err) {
    return {
      type: "DELETE_MEMORY_SESSION_RESPONSE",
      payload: { success: false, error: String(err) },
    };
  }
}

async function handleGetCaptureMode(): Promise<GetCaptureModeResponse> {
  return {
    type: "GET_CAPTURE_MODE_RESPONSE",
    payload: { mode: await getCaptureMode() },
  };
}

async function handleSetCaptureMode(
  message: SetCaptureModeRequest,
): Promise<SetCaptureModeResponse> {
  const mode = isCaptureMode(message.payload?.mode) ? message.payload.mode : "auto";
  await chrome.storage.local.set({ [CAPTURE_MODE_STORAGE_KEY]: mode });
  void broadcastStatusUpdate();
  return {
    type: "SET_CAPTURE_MODE_RESPONSE",
    payload: { success: true, mode },
  };
}

async function handleGetAttachmentSaveMode(): Promise<GetAttachmentSaveModeResponse> {
  return {
    type: "GET_ATTACHMENT_SAVE_MODE_RESPONSE",
    payload: { mode: await getAttachmentSaveMode() },
  };
}

async function handleSetAttachmentSaveMode(
  message: SetAttachmentSaveModeRequest,
): Promise<SetAttachmentSaveModeResponse> {
  const mode = normalizeAttachmentSaveMode(message.payload?.mode);
  await setAttachmentSaveMode(mode);
  return {
    type: "SET_ATTACHMENT_SAVE_MODE_RESPONSE",
    payload: { success: true, mode },
  };
}

async function handleDownloadAttachment(
  message: DownloadAttachmentRequest,
): Promise<DownloadAttachmentResponse> {
  try {
    const download = await getAttachmentDownload(message.payload?.attachmentId);
    return {
      type: "DOWNLOAD_ATTACHMENT_RESPONSE",
      payload: { success: true, ...download },
    };
  } catch (err) {
    return {
      type: "DOWNLOAD_ATTACHMENT_RESPONSE",
      payload: { success: false, error: String(err) },
    };
  }
}

async function handleOpenMemoryGraph(
  sessionId?: string,
  recordId?: string,
): Promise<OpenMemoryGraphResponse> {
  try {
    const params = new URLSearchParams();
    if (sessionId) params.set("sessionId", sessionId);
    if (recordId) params.set("recordId", recordId);
    const url = chrome.runtime.getURL(
      `tabs/memory-graph.html${params.toString() ? `?${params}` : ""}`,
    );
    await chrome.tabs.create({ url, active: true });
    return {
      type: "OPEN_MEMORY_GRAPH_RESPONSE",
      payload: { success: true },
    };
  } catch (err) {
    return {
      type: "OPEN_MEMORY_GRAPH_RESPONSE",
      payload: { success: false, error: String(err) },
    };
  }
}

// ─── CLEAR_ERRORS Handler ─────────────────────────────────────────────────────

async function handleClearErrors(): Promise<ClearErrorsResponse> {
  await db.clearErrors();
  return { type: "CLEAR_ERRORS_RESPONSE", payload: { success: true } };
}

// ─── CLEAR_ALL_MEMORIES Handler ───────────────────────────────────────────────

async function handleClearAllMemories(): Promise<ClearAllMemoriesResponse> {
  try {
    await db.clearAllMemories();
    await chrome.storage.local.remove(PENDING_MEMORY_SESSIONS_STORAGE_KEY);
    // Also reset the in-memory MiniSearch index
    miniSearch.removeAll();
    lastCaptureTime = undefined;
    void broadcastStatusUpdate();
    return { type: "CLEAR_ALL_MEMORIES_RESPONSE", payload: { success: true } };
  } catch (err) {
    return {
      type: "CLEAR_ALL_MEMORIES_RESPONSE",
      payload: { success: false, error: String(err) },
    };
  }
}

async function handleUpdateConversationTitle(
  message: UpdateConversationTitleRequest,
): Promise<UpdateConversationTitleResponse> {
  try {
    await db.upsertConversationTitle(
      message.payload.sessionId,
      message.payload.title,
    );
    return {
      type: "UPDATE_CONVERSATION_TITLE_RESPONSE",
      payload: { success: true },
    };
  } catch (err) {
    return {
      type: "UPDATE_CONVERSATION_TITLE_RESPONSE",
      payload: { success: false, error: String(err) },
    };
  }
}

async function handleGetConversationTitles(
  message: GetConversationTitlesRequest,
): Promise<GetConversationTitlesResponse> {
  try {
    const titlesMap = await db.getConversationTitles(
      message.payload.sessionIds,
    );
    // Convert Map to Record for JSON serialization
    const titlesRecord: Record<string, string> = {};
    titlesMap.forEach((title, sessionId) => {
      titlesRecord[sessionId] = title;
    });
    return {
      type: "GET_CONVERSATION_TITLES_RESPONSE",
      payload: { titles: titlesRecord },
    };
  } catch (err) {
    return {
      type: "GET_CONVERSATION_TITLES_RESPONSE",
      payload: { titles: {} },
    };
  }
}

async function handleExportMemories() {
  try {
    const all = await db.memories.toArray();
    const { [FAVORITE_PROMPTS_KEY]: prompts, [FOLDERS_STORAGE_KEY]: folders } =
      await chrome.storage.local.get([
        FAVORITE_PROMPTS_KEY,
        FOLDERS_STORAGE_KEY,
      ]);
    const hasPrompts = Array.isArray(prompts) && prompts.length > 0;
    const hasFolders = Array.isArray(folders) && folders.length > 0;
    const version = hasFolders ? "1.2" : hasPrompts ? "1.1" : "1.0";
    const envelope = {
      metadata: {
        app: MEMORY_EXPORT_APP_NAME,
        version: version as "1.0" | "1.1" | "1.2",
        exportedAt: new Date().toISOString(),
        recordCount: all.length,
        embeddingModel: all[0]?.embeddingModel ?? MODEL_NAME,
      },
      payload: all.map((r) => ({
        ...r,
        embedding: r.embedding ? Array.from(r.embedding) : undefined,
      })),
      ...(hasPrompts && { prompts }),
      ...(hasFolders && { folders }),
    };
    return { type: "EXPORT_MEMORIES_RESPONSE" as const, payload: { envelope } };
  } catch (err) {
    return {
      type: "EXPORT_MEMORIES_RESPONSE" as const,
      payload: {
        envelope: { metadata: {} as never, payload: [] },
        error: String(err),
      },
    };
  }
}

async function handleImportMemories(message: ImportMemoriesRequest) {
  try {
    const records: MemoryRecord[] = message.payload.records.map((r) => ({
      ...r,
      embedding: Array.isArray(r.embedding)
        ? new Float32Array(r.embedding)
        : undefined,
      hasEmbedding:
        Array.isArray(r.embedding) && r.embedding!.length > 0 ? 1 : 0,
    }));

    // Skip records already in the DB (idempotent re-import support)
    const allIds = records.map((r) => r.id);
    const newIds = new Set(await db.filterNewChatMessageUuids(allIds));
    const newRecords = records.filter((r) => newIds.has(r.id));
    const skippedCount = records.length - newRecords.length;

    if (newRecords.length === 0) {
      // Nothing new — return early, no DB writes or status broadcast needed
      return {
        type: "IMPORT_MEMORIES_RESPONSE" as const,
        payload: { success: true, count: 0, skipped: skippedCount },
      };
    }

    await db.memories.bulkPut(newRecords);

    // Persist conversation titles extracted from import metadata (e.g. ChatGPT)
    const titleUpdates = new Map<string, string>();
    for (const r of newRecords) {
      const title = (r.metadata as Record<string, string> | undefined)
        ?.conversationTitle;
      if (title && r.sessionId && !titleUpdates.has(r.sessionId)) {
        titleUpdates.set(r.sessionId, title);
      }
    }
    for (const [sessionId, title] of titleUpdates) {
      void db.upsertConversationTitle(sessionId, title);
    }

    const prompts = message.payload.prompts;
    if (Array.isArray(prompts) && prompts.length > 0) {
      await chrome.storage.local.set({ [FAVORITE_PROMPTS_KEY]: prompts });
    }
    const folders = message.payload.folders;
    if (Array.isArray(folders) && folders.length > 0) {
      await chrome.storage.local.set({ [FOLDERS_STORAGE_KEY]: folders });
    }
    // Rebuild keyword index so imported records are immediately searchable
    void hydrateSearchIndex();

    // Process pending embeddings in the background (does not block display)
    void processPendingEmbeddings();

    // Notify extension UIs so graph/search state can refresh after import.
    void broadcastStatusUpdate();

    return {
      type: "IMPORT_MEMORIES_RESPONSE" as const,
      payload: { success: true, count: newRecords.length, skipped: skippedCount },
    };
  } catch (err) {
    return {
      type: "IMPORT_MEMORIES_RESPONSE" as const,
      payload: { success: false, count: 0, error: String(err) },
    };
  }
}

// ─── Message Router ───────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  switch (message.type) {
    case "CAPTURE_MESSAGE":
      handleCaptureMessage(message as CaptureMessage)
        .then(sendResponse)
        .catch((err) => {
          console.error("[Threadline] Capture handler error:", err);
          sendResponse({ success: false, error: String(err) });
        });
      return true; // keep channel open for async response

    case "QUERY_MEMORY_SESSIONS":
      handleQueryMemorySessions(message as QueryMemorySessionsRequest)
        .then(sendResponse)
        .catch((err) =>
          sendResponse({
            type: "QUERY_MEMORY_SESSIONS_RESPONSE",
            payload: { sessions: [], total: 0, error: String(err) },
          }),
        );
      return true;

    case "QUERY_SESSION_GRAPH":
      handleQuerySessionGraph(message as QuerySessionGraphRequest)
        .then(sendResponse)
        .catch((err) =>
          sendResponse({
            type: "QUERY_SESSION_GRAPH_RESPONSE",
            payload: { records: [], error: String(err) },
          }),
        );
      return true;

    case "PERSIST_PENDING_SESSION":
      handlePersistPendingSession(message as PersistPendingSessionRequest)
        .then(sendResponse)
        .catch((err) =>
          sendResponse({
            type: "PERSIST_PENDING_SESSION_RESPONSE",
            payload: { success: false, count: 0, error: String(err) },
          }),
        );
      return true;

    case "DELETE_MEMORY_SESSION":
      handleDeleteMemorySession(message as DeleteMemorySessionRequest)
        .then(sendResponse)
        .catch((err) =>
          sendResponse({
            type: "DELETE_MEMORY_SESSION_RESPONSE",
            payload: { success: false, error: String(err) },
          }),
        );
      return true;

    case "GET_CAPTURE_MODE":
      handleGetCaptureMode()
        .then(sendResponse)
        .catch(() =>
          sendResponse({
            type: "GET_CAPTURE_MODE_RESPONSE",
            payload: { mode: "auto" },
          }),
        );
      return true;

    case "SET_CAPTURE_MODE":
      handleSetCaptureMode(message as SetCaptureModeRequest)
        .then(sendResponse)
        .catch((err) =>
          sendResponse({
            type: "SET_CAPTURE_MODE_RESPONSE",
            payload: { success: false, mode: "auto", error: String(err) },
          }),
        );
      return true;

    case "GET_ATTACHMENT_SAVE_MODE":
      handleGetAttachmentSaveMode()
        .then(sendResponse)
        .catch(() =>
          sendResponse({
            type: "GET_ATTACHMENT_SAVE_MODE_RESPONSE",
            payload: { mode: DEFAULT_ATTACHMENT_SAVE_MODE },
          }),
        );
      return true;

    case "SET_ATTACHMENT_SAVE_MODE":
      handleSetAttachmentSaveMode(message as SetAttachmentSaveModeRequest)
        .then(sendResponse)
        .catch((err) =>
          sendResponse({
            type: "SET_ATTACHMENT_SAVE_MODE_RESPONSE",
            payload: {
              success: false,
              mode: DEFAULT_ATTACHMENT_SAVE_MODE,
              error: String(err),
            },
          }),
        );
      return true;

    case "DOWNLOAD_ATTACHMENT":
      handleDownloadAttachment(message as DownloadAttachmentRequest)
        .then(sendResponse)
        .catch((err) =>
          sendResponse({
            type: "DOWNLOAD_ATTACHMENT_RESPONSE",
            payload: { success: false, error: String(err) },
          }),
        );
      return true;

    case "OPEN_MEMORY_GRAPH":
      handleOpenMemoryGraph(
        (message.payload as { sessionId?: string } | undefined)?.sessionId,
        (message.payload as { recordId?: string } | undefined)?.recordId,
      )
        .then(sendResponse)
        .catch((err) =>
          sendResponse({
            type: "OPEN_MEMORY_GRAPH_RESPONSE",
            payload: { success: false, error: String(err) },
          }),
        );
      return true;

    case "CLEAR_ERRORS":
      handleClearErrors()
        .then(sendResponse)
        .catch(() =>
          sendResponse({
            type: "CLEAR_ERRORS_RESPONSE",
            payload: { success: false },
          }),
        );
      return true;

    case "CLEAR_ALL_MEMORIES":
      handleClearAllMemories()
        .then(sendResponse)
        .catch((err) =>
          sendResponse({
            type: "CLEAR_ALL_MEMORIES_RESPONSE",
            payload: { success: false, error: String(err) },
          }),
        );
      return true;

    case "UPDATE_CONVERSATION_TITLE":
      handleUpdateConversationTitle(message as UpdateConversationTitleRequest)
        .then(sendResponse)
        .catch((err) =>
          sendResponse({
            type: "UPDATE_CONVERSATION_TITLE_RESPONSE",
            payload: { success: false, error: String(err) },
          }),
        );
      return true;

    case "GET_CONVERSATION_TITLES":
      handleGetConversationTitles(message as GetConversationTitlesRequest)
        .then(sendResponse)
        .catch(() =>
          sendResponse({
            type: "GET_CONVERSATION_TITLES_RESPONSE",
            payload: { titles: {} },
          }),
        );
      return true;

    case "SEARCH_MEMORIES": {
      const query = (message.payload as { query?: string })?.query ?? "";
      const timeoutMs = 90_000; // 90s for first-time model load
      let responded = false;
      const safeSend = (resp: unknown) => {
        if (responded) return;
        responded = true;
        sendResponse(resp);
      };
      const timeoutId = setTimeout(
        () =>
          safeSend({
            type: "SEARCH_MEMORIES_RESPONSE",
            payload: {
              results: [],
              query,
              error: "Search timed out (embedding may still be loading)",
            },
          }),
        timeoutMs,
      );
      handleSearchMemories(message as SearchMemoriesRequest, embedViaOffscreen)
        .then((resp) => {
          clearTimeout(timeoutId);
          safeSend(resp);
        })
        .catch((err) => {
          clearTimeout(timeoutId);
          console.warn("[Threadline] Search failed:", err);
          safeSend({
            type: "SEARCH_MEMORIES_RESPONSE",
            payload: { results: [], query, error: String(err) },
          });
        });
      return true;
    }

    case "EXPORT_MEMORIES":
      handleExportMemories()
        .then(sendResponse)
        .catch((err) =>
          sendResponse({
            type: "EXPORT_MEMORIES_RESPONSE",
            payload: {
              envelope: { metadata: {} as never, payload: [] },
              error: String(err),
            },
          }),
        );
      return true;

    case "IMPORT_MEMORIES":
      handleImportMemories(message as ImportMemoriesRequest)
        .then(sendResponse)
        .catch((err) =>
          sendResponse({
            type: "IMPORT_MEMORIES_RESPONSE",
            payload: { success: false, count: 0, error: String(err) },
          }),
        );
      return true;

    case "DOM_SYNC":
      handleDomSync(message as DomSyncRequest, () => {
        lastCaptureTime = Date.now();
        void broadcastStatusUpdate();
      }, {
        shouldPersist: async () => await getCaptureMode() === "auto",
        cachePendingRecords,
      })
        .then(sendResponse)
        .catch((err) =>
          sendResponse({
            type: "DOM_SYNC_RESPONSE",
            payload: { queued: 0, skipped: 0, error: String(err) },
          }),
        );
      return true;

    case "FIRST_RECALL_USED":
      // Forward to onboarding via storage so all extension contexts can react
      chrome.storage.local.set({ onboarding_first_recall_used: true })
      sendResponse({ success: true })
      return false

    default:
      break;
  }
});

// Periodic status broadcast — disabled for now, re-enable if needed
// setInterval(() => void broadcastStatusUpdate(), 30_000)

// ─── MAIN world injection for fetch/XHR interception ───────────────────────────

const AI_ORIGINS = [
  "https://chat.openai.com",
  "https://chatgpt.com",
  "https://claude.ai",
  "https://gemini.google.com",
  "https://www.perplexity.ai",
  "https://grok.com",
];

function injectMainWorld(tabId: number): void {
  chrome.scripting
    .executeScript({
      target: { tabId },
      world: "MAIN",
      func: mainWorldInterceptor,
    })
    .then(() => {})
    .catch((err) => {
      console.warn("[Threadline] Injection failed for tab", tabId, err);
    });
}

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  const status = changeInfo.status;
  const url = tab.url ?? "";
  if (!url || !AI_ORIGINS.some((o) => url.startsWith(o))) return;
  // Inject on 'loading' so our fetch wrapper is in place before the page's scripts run (critical for Gemini).
  // Also inject on 'complete' to catch SPAs that may have replaced fetch after initial load.
  if (status === "loading" || status === "complete") {
    injectMainWorld(tabId);
  }
  // Fallback: proactively fetch Perplexity thread history from the background SW
  // in case the page's JS fails to run (e.g. Cloudflare Access blocking static files).
  if (status === "complete" && url.includes("www.perplexity.ai/search/")) {
    void maybeFetchPerplexityThreadHistory(url, handleCaptureMessage);
  }
});

// Open onboarding tab on first install
chrome.runtime.onInstalled.addListener(async (details) => {
  if (details.reason === 'install') {
    const { onboarding_completed } = await chrome.storage.local.get('onboarding_completed')
    if (!onboarding_completed) {
      chrome.tabs.create({ url: chrome.runtime.getURL('tabs/onboarding.html') })
    }
  }
})

// Inject into already-open AI tabs when extension loads (e.g. user had ChatGPT
// open before installing or reloading the extension).
if (typeof chrome.runtime.onStartup !== "undefined") {
  chrome.runtime.onStartup.addListener(() => {
    injectIntoAITabs();
  });
}

// Inject into already-open AI tabs when this script loads (e.g. after install/reload).
injectIntoAITabs();

function injectIntoAITabs(): void {
  chrome.tabs.query({ url: AI_ORIGINS.map((o) => `${o}/*`) }, (tabs) => {
    try {
      for (const tab of tabs) {
        if (tab.id) injectMainWorld(tab.id);
      }
    } catch {
      // Extension context invalidated (e.g. extension was reloaded before callback ran)
    }
  });
}

chrome.action.onClicked.addListener((tab) => {
  if (!tab.id) return;
  const tabId = tab.id;
  const tabUrl = tab.url ?? "";

  const isAISite = AI_ORIGINS.some((o) => tabUrl.startsWith(o));

  if (isAISite) {
    // AI site: content script already injected, just open the panel
    chrome.tabs.sendMessage(tabId, { type: "OPEN_MEMORY_PANEL" }).catch(() => void 0);
  } else {
    // Non-AI site: find the hashed memory-float-ui filename from manifest, inject it
    const manifest = chrome.runtime.getManifest();
    const floatScript = (manifest.content_scripts ?? [])
      .flatMap((cs) => cs.js ?? [])
      .find((f) => f.includes("memory-float-ui"));

    if (!floatScript) return;

    chrome.scripting
      .executeScript({
        target: { tabId },
        files: [floatScript],
      })
      .then(() => {
        // Small delay to allow React to mount before opening panel
        setTimeout(() => {
          chrome.tabs.sendMessage(tabId, { type: "OPEN_MEMORY_PANEL" }).catch(() => void 0);
        }, 300);
      })
      .catch(() => void 0);
  }
});

// Rebuild MiniSearch keyword index from Dexie on every Service Worker startup.
// The SW can be suspended and revived at any time; in-memory state is wiped on each wake.
void hydrateSearchIndex();

// Retry any records that failed to embed during a previous session (e.g. offscreen
// document wasn't ready when the capture came in). Delay slightly so the offscreen
// document has time to spin up before we hit it with a batch.
setTimeout(() => {
  void processPendingEmbeddings();
}, 8000);

// ─── Dev Helper: test SEARCH_MEMORIES from Background console ─────────────────
// Run testSearch('關鍵字', 5) in Service Worker console.
// Uses direct handler call to avoid "Receiving end does not exist" when
// sendMessage is used from SW to itself. First run may take 20–30s (model load).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).testSearch = async (q = "test", k = 5) => {
  try {
    const resp = await handleSearchMemories(
      {
        type: "SEARCH_MEMORIES",
        payload: { query: q, topK: k },
      } as SearchMemoriesRequest,
      embedViaOffscreen,
    );
  } catch (err) {
    console.error("[Threadline] Search error:", err);
  }
};
