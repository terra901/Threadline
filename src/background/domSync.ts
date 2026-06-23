import type { DomMessage, DomSyncRequest, DomSyncResponse } from "../types/messages";
import type { MemoryRecord } from "../types/memory";
import { expandToChunks } from "./chunking";
import { queueEmbedding } from "./offscreen";
import { safeAddRecord, isCaptureEnabled, db } from "./db";
import { miniSearch } from "./search";
import { normalizeContent } from "./adapters/base";
import { isTransientAssistantMessage } from "../utils/transient-assistant";
import { getAttachmentSaveMode, saveDomAttachments } from "./attachments";

// ─── DOM Sync Handler ─────────────────────────────────────────────────────────
// Processes historical messages discovered by the DOM scanner in chatgpt-injector.
//
// Safety rules:
//   1. Deduplicate first — never write a record whose id already exists in Dexie.
//   2. Process one record at a time through the embedding queue (avoids WASM OOM).
//   3. Return immediately to the content script with queued/skipped counts so the
//      UI can show a "syncing…" indicator if desired — the actual embedding work
//      continues asynchronously in the background.

/** Serial sync queue — processes DOM-sourced records one-by-one. */
const _syncQueue: (() => Promise<void>)[] = [];
let _syncRunning = false;

function drainSyncQueue(): void {
  if (_syncRunning || _syncQueue.length === 0) return;
  _syncRunning = true;

  const next = _syncQueue.shift()!;
  next()
    .catch((err) => {
      console.warn("[Threadline] DOM sync queue error:", err);
    })
    .finally(() => {
      _syncRunning = false;
      drainSyncQueue(); // process next item
    });
}

export function enqueueSyncRecord(record: MemoryRecord): void {
  _syncQueue.push(async () => {
    for (const chunk of expandToChunks(record)) {
      const id = await safeAddRecord(chunk);
      if (id) {
        try {
          miniSearch.add(chunk);
        } catch {
          /* duplicate id — already indexed */
        }
        queueEmbedding(chunk);
      }
    }
  });
  drainSyncQueue();
}

type ResolvedDomMessage = DomMessage & {
  roundIndex: number;
  branchIndex: number;
  branchId: string;
  pathId: string;
};

function toFiniteIndex(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? Math.floor(value)
    : undefined;
}

function inferRoundIndex(msg: DomMessage, provider: DomSyncRequest["payload"]["provider"]): number {
  const explicit = toFiniteIndex(msg.roundIndex);
  if (explicit !== undefined) return explicit;
  const turnIndex = toFiniteIndex(msg.turnIndex);
  if (turnIndex === undefined) return 0;
  if (provider === "openai") return Math.max(0, Math.floor((turnIndex - 1) / 2));
  return Math.max(0, Math.floor(turnIndex / 2));
}

function getRecordRoundIndex(record: MemoryRecord): number | undefined {
  const turnIndex = toFiniteIndex(record.turnIndex);
  return (
    toFiniteIndex(record.roundIndex) ??
    toFiniteIndex(record.metadata?.["roundIndex"]) ??
    (turnIndex !== undefined
      ? record.provider === "openai"
        ? Math.max(0, Math.floor((turnIndex - 1) / 2))
        : Math.max(0, Math.floor(turnIndex / 2))
      : undefined)
  );
}

function getRecordBranchIndex(record: MemoryRecord): number | undefined {
  const explicit = toFiniteIndex(record.branchIndex) ?? toFiniteIndex(record.metadata?.["branchIndex"]);
  if (explicit !== undefined) return explicit;
  const source = record.source ?? record.metadata?.["source"];
  if (source === "dom_scan" && getRecordRoundIndex(record) !== undefined) {
    return 0;
  }
  return undefined;
}

function getRecordPathId(record: MemoryRecord): string | undefined {
  const metadataPathId = record.metadata?.["pathId"];
  if (record.pathId) return record.pathId;
  return typeof metadataPathId === "string" && metadataPathId ? metadataPathId : undefined;
}

function getLogicalRecordIds(record: MemoryRecord): string[] {
  const ids = new Set<string>();
  if (record.originalMessageId) ids.add(record.originalMessageId);
  if (record.parentId) ids.add(record.parentId);
  ids.add(record.id.replace(/-c\d+$/, ""));
  return [...ids];
}

function getLogicalRecordId(record: MemoryRecord): string {
  return record.originalMessageId ?? record.parentId ?? record.id.replace(/-c\d+$/, "");
}

function branchKey(roundIndex: number, role: MemoryRecord["role"]): string {
  return `${roundIndex}:${role}`;
}

function branchNodeKey(
  roundIndex: number,
  role: MemoryRecord["role"],
  branchIndex: number,
): string {
  return `${roundIndex}:${role}:${branchIndex}`;
}

function reserveBranch(
  used: Map<string, Set<number>>,
  roundIndex: number,
  role: MemoryRecord["role"],
  branchIndex: number,
): void {
  const key = branchKey(roundIndex, role);
  const set = used.get(key) ?? new Set<number>();
  set.add(branchIndex);
  used.set(key, set);
}

function hasBranch(
  used: Map<string, Set<number>>,
  roundIndex: number,
  role: MemoryRecord["role"],
  branchIndex: number,
): boolean {
  return used.get(branchKey(roundIndex, role))?.has(branchIndex) ?? false;
}

function nextBranch(
  used: Map<string, Set<number>>,
  roundIndex: number,
  role: MemoryRecord["role"],
): number {
  let index = 0;
  while (hasBranch(used, roundIndex, role, index)) index += 1;
  reserveBranch(used, roundIndex, role, index);
  return index;
}

function makeBranchId(sessionId: string, roundIndex: number, branchIndex: number): string {
  return `${sessionId}:r${roundIndex}:b${branchIndex}`;
}

function makePathId(sessionId: string, roundIndex: number, branchIndex: number): string {
  return branchIndex === 0 ? `${sessionId}:main` : `${sessionId}:r${roundIndex}:b${branchIndex}`;
}

function inferParentMessageId(
  msg: ResolvedDomMessage,
  resolved: ResolvedDomMessage[],
  existingUsersByBranch: Map<string, string>,
  existingAssistantsByBranch: Map<string, string>,
): string | undefined {
  if (msg.role === "assistant") {
    const sameBranchUser = resolved.find(
      (candidate) =>
        candidate.role === "user" &&
        candidate.roundIndex === msg.roundIndex &&
        candidate.branchIndex === msg.branchIndex,
    );
    const mainUser = resolved.find(
      (candidate) =>
        candidate.role === "user" &&
        candidate.roundIndex === msg.roundIndex &&
        candidate.branchIndex === 0,
    );
    return (
      sameBranchUser?.messageId ??
      mainUser?.messageId ??
      existingUsersByBranch.get(branchNodeKey(msg.roundIndex, "user", msg.branchIndex)) ??
      existingUsersByBranch.get(branchNodeKey(msg.roundIndex, "user", 0))
    );
  }

  const previousAssistants = resolved
    .filter(
      (candidate) =>
        candidate.role === "assistant" && candidate.roundIndex < msg.roundIndex,
    )
    .sort((a, b) => b.roundIndex - a.roundIndex || b.branchIndex - a.branchIndex);
  const previousRound = msg.roundIndex - 1;
  return (
    previousAssistants.find((candidate) => candidate.branchIndex === msg.branchIndex)?.messageId ??
    previousAssistants.find((candidate) => candidate.branchIndex === 0)?.messageId ??
    previousAssistants[0]?.messageId ??
    (previousRound >= 0
      ? existingAssistantsByBranch.get(branchNodeKey(previousRound, "assistant", msg.branchIndex)) ??
        existingAssistantsByBranch.get(branchNodeKey(previousRound, "assistant", 0))
      : undefined)
  );
}

async function resolveDomGraphMessages(
  messages: DomMessage[],
  provider: DomSyncRequest["payload"]["provider"],
): Promise<ResolvedDomMessage[]> {
  const result: ResolvedDomMessage[] = [];
  const bySession = new Map<string, DomMessage[]>();

  for (const msg of messages) {
    const list = bySession.get(msg.sessionId) ?? [];
    list.push(msg);
    bySession.set(msg.sessionId, list);
  }

  for (const [sessionId, sessionMessages] of bySession.entries()) {
    const existing = await db.memories
      .where("sessionId")
      .equals(sessionId)
      .filter((record) => !record.isDeleted)
      .toArray();
    const known = new Map<string, { branchIndex: number; pathId?: string }>();
    const used = new Map<string, Set<number>>();
    const existingUsersByBranch = new Map<string, string>();
    const existingAssistantsByBranch = new Map<string, string>();

    for (const record of existing) {
      const roundIndex = getRecordRoundIndex(record);
      const branchIndex = getRecordBranchIndex(record);
      if (roundIndex === undefined || branchIndex === undefined) continue;
      reserveBranch(used, roundIndex, record.role, branchIndex);
      const existingBranchKey = branchNodeKey(roundIndex, record.role, branchIndex);
      if (record.role === "user" && !existingUsersByBranch.has(existingBranchKey)) {
        existingUsersByBranch.set(existingBranchKey, getLogicalRecordId(record));
      }
      if (record.role === "assistant" && !existingAssistantsByBranch.has(existingBranchKey)) {
        existingAssistantsByBranch.set(existingBranchKey, getLogicalRecordId(record));
      }
      const pathId = getRecordPathId(record);
      for (const id of getLogicalRecordIds(record)) {
        known.set(id, { branchIndex, pathId });
      }
    }

    const normalized = sessionMessages
      .map((msg, sourceOrder) => ({
        ...msg,
        roundIndex: inferRoundIndex(msg, provider),
        sourceOrder,
      }))
      .sort((a, b) => a.roundIndex - b.roundIndex || a.turnIndex - b.turnIndex || a.sourceOrder - b.sourceOrder);

    const byRound = new Map<number, typeof normalized>();
    for (const msg of normalized) {
      const list = byRound.get(msg.roundIndex) ?? [];
      list.push(msg);
      byRound.set(msg.roundIndex, list);
    }

    const resolvedForSession: ResolvedDomMessage[] = [];

    for (const [roundIndex, roundMessages] of [...byRound.entries()].sort((a, b) => a[0] - b[0])) {
      const users = roundMessages.filter((msg) => msg.role === "user");
      const assistants = roundMessages.filter((msg) => msg.role === "assistant");
      const userBranches = new Map<string, number>();

      users.forEach((msg) => {
        const explicit = toFiniteIndex(msg.branchIndex);
        const knownBranch = known.get(msg.messageId)?.branchIndex;
        const branchIndex =
          explicit ??
          knownBranch ??
          nextBranch(used, roundIndex, "user");
        userBranches.set(msg.messageId, branchIndex);
      });

      const assignMessage = (msg: typeof normalized[number], branchIndex: number): ResolvedDomMessage => {
        const knownPathId = known.get(msg.messageId)?.pathId;
        const resolved: ResolvedDomMessage = {
          ...msg,
          roundIndex,
          branchIndex,
          branchId: msg.branchId || makeBranchId(sessionId, roundIndex, branchIndex),
          pathId: msg.pathId || knownPathId || makePathId(sessionId, roundIndex, branchIndex),
        };
        known.set(msg.messageId, {
          branchIndex,
          pathId: resolved.pathId,
        });
        return resolved;
      };

      for (const msg of users) {
        const branchIndex = userBranches.get(msg.messageId) ?? 0;
        resolvedForSession.push(assignMessage(msg, branchIndex));
      }

      const unusedUserBranches = new Set(userBranches.values());

      assistants.forEach((msg, index) => {
        const explicit = toFiniteIndex(msg.branchIndex);
        const knownBranch = known.get(msg.messageId)?.branchIndex;
        let branchIndex = explicit ?? knownBranch;

        if (branchIndex === undefined) {
          const pairedUser =
            users[index] ??
            (users.length === 1
              ? users[0]
              : users.find((candidate) => {
                const candidateBranch = userBranches.get(candidate.messageId);
                return candidateBranch !== undefined && unusedUserBranches.has(candidateBranch);
              }));
          const pairedUserBranch = pairedUser ? userBranches.get(pairedUser.messageId) : undefined;
          if (
            pairedUserBranch !== undefined &&
            (!hasBranch(used, roundIndex, "assistant", pairedUserBranch) ||
              unusedUserBranches.has(pairedUserBranch))
          ) {
            branchIndex = pairedUserBranch;
            reserveBranch(used, roundIndex, "assistant", branchIndex);
          } else {
            branchIndex = nextBranch(used, roundIndex, "assistant");
          }
        } else {
          reserveBranch(used, roundIndex, "assistant", branchIndex);
        }

        unusedUserBranches.delete(branchIndex);
        resolvedForSession.push(assignMessage(msg, branchIndex));
      });
    }

    for (const msg of resolvedForSession) {
      msg.parentMessageId =
        msg.parentMessageId ??
        inferParentMessageId(
          msg,
          resolvedForSession,
          existingUsersByBranch,
          existingAssistantsByBranch,
        );
      result.push(msg);
    }
  }

  return result.sort((a, b) => a.roundIndex - b.roundIndex || a.turnIndex - b.turnIndex);
}

function domGraphMetadata(
  msg: ResolvedDomMessage,
  url: string,
): Record<string, unknown> {
  return {
    source: "dom_scan",
    turnIndex: msg.turnIndex,
    roundIndex: msg.roundIndex,
    branchIndex: msg.branchIndex,
    branchId: msg.branchId,
    pathId: msg.pathId,
    parentMessageId: msg.parentMessageId,
    pageTitle: msg.pageTitle,
    url,
  };
}

export async function handleDomSync(
  message: DomSyncRequest,
  onNewMessages?: () => void,
  options?: {
    shouldPersist?: () => Promise<boolean>;
    cachePendingRecords?: (records: MemoryRecord[]) => Promise<void>;
  },
): Promise<DomSyncResponse> {
  const { messages: rawMessages, url, provider } = message.payload;
  const captureMessages = rawMessages.filter(
    (msg) => !isTransientAssistantMessage(msg.role, msg.content),
  );

  if (!isCaptureEnabled()) {
    return {
      type: "DOM_SYNC_RESPONSE",
      payload: { queued: 0, skipped: rawMessages.length, error: "QUOTA_EXCEEDED" },
    };
  }

  if (!rawMessages.length) {
    return { type: "DOM_SYNC_RESPONSE", payload: { queued: 0, skipped: 0 } };
  }

  if (!captureMessages.length) {
    return { type: "DOM_SYNC_RESPONSE", payload: { queued: 0, skipped: rawMessages.length } };
  }

  const messages = await resolveDomGraphMessages(captureMessages, provider);
  const attachmentMode = await getAttachmentSaveMode();

  // Bulk deduplication — one DB round-trip for all message IDs
  const allIds = messages.map((m) => m.messageId);
  const newIds = new Set(await db.filterNewMessageIds(allIds));

  // Repeated DOM scans are useful: branch variants can become visible after the
  // first scan. Existing records are enriched with graph fields instead of being
  // duplicated or re-embedded.
  await Promise.all(
    messages.map((msg) =>
      db.updateDomMessageGraphFields(msg.messageId, {
        turnIndex: msg.turnIndex,
        roundIndex: msg.roundIndex,
        branchIndex: msg.branchIndex,
        branchId: msg.branchId,
        pathId: msg.pathId,
        parentMessageId: msg.parentMessageId,
        sourceUrl: url,
        conversationTitle: msg.pageTitle,
        metadata: domGraphMetadata(msg, url),
      }),
    ),
  );

  const newMessages = messages.filter((m) => newIds.has(m.messageId));

  // Gemini migration dedup: existing records may have random XHR-captured UUIDs
  // that ID-based dedup cannot match. Filter by content to prevent duplicates.
  let filteredMessages = newMessages;
  if (provider === 'google' && newMessages.length > 0) {
    const sessionId = newMessages[0].sessionId;
    const existingContent = await db.getSessionContentSet(sessionId);
    if (existingContent.size > 0) {
      filteredMessages = newMessages.filter((m) => !existingContent.has(normalizeContent(m.content)));
    }
  }
  const skipped = rawMessages.length - filteredMessages.length;

  const now = Date.now();
  const recordsToSave: MemoryRecord[] = [];
  for (const msg of filteredMessages) {
    const record: MemoryRecord = {
      id: msg.messageId,
      role: msg.role,
      content: msg.content,
      provider,
      sessionId: msg.sessionId,
      originalMessageId: msg.messageId,
      parentMessageId: msg.parentMessageId,
      source: "dom_scan",
      sourceUrl: url,
      conversationTitle: msg.pageTitle,
      timestamp: msg.scannedAt, // best approximation — no network timestamp
      createdAt: now,
      turnIndex: msg.turnIndex,
      roundIndex: msg.roundIndex,
      branchIndex: msg.branchIndex,
      branchId: msg.branchId,
      pathId: msg.pathId,
      isPartial: false,
      isDeleted: false,
      isSuperseded: false,
      metadata: domGraphMetadata(msg, url),
    };
    recordsToSave.push(record);
  }

  const shouldPersist = options?.shouldPersist
    ? await options.shouldPersist()
    : true;

  if (shouldPersist) {
    for (const record of recordsToSave) {
      enqueueSyncRecord(record);
    }
    const attachmentsBySession = new Map<string, ResolvedDomMessage["attachments"]>();
    for (const msg of messages) {
      if (!msg.attachments?.length) continue;
      const current = attachmentsBySession.get(msg.sessionId) ?? [];
      current.push(...msg.attachments);
      attachmentsBySession.set(msg.sessionId, current);
    }
    for (const [sessionId, candidates] of attachmentsBySession.entries()) {
      if (!candidates?.length) continue;
      void saveDomAttachments({
        provider,
        sessionId,
        candidates,
        mode: attachmentMode,
      }).catch((err) => {
        console.warn("[Threadline] Attachment save failed:", err);
      });
    }
  } else {
    await options?.cachePendingRecords?.(recordsToSave);
  }

  // Update the conversation title while we're here (non-blocking)
  if (recordsToSave.length > 0) {
    const first = filteredMessages[0];
    if (first.pageTitle && first.sessionId) {
      void db.upsertConversationTitle(first.sessionId, first.pageTitle);
    }
    if (shouldPersist) onNewMessages?.();

    // Notify onboarding step 2 on first memory saved — DOM sync can beat
    // the network CAPTURE_MESSAGE, so we check here too.
    if (shouldPersist) {
      void chrome.storage.local
        .get(["onboarding_step2_active", "onboarding_first_memory_saved"])
        .then(({ onboarding_step2_active, onboarding_first_memory_saved }) => {
          if (onboarding_step2_active && !onboarding_first_memory_saved) {
            chrome.storage.local.set({ onboarding_first_memory_saved: true });
          }
        });
    }
  }

  return {
    type: "DOM_SYNC_RESPONSE",
    payload: { queued: filteredMessages.length, skipped },
  };
}
