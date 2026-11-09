/**
 * ChatGPT Recall Button — Content Script
 *
 * Injects a "🧠 Recall" button adjacent to the ChatGPT composer send button.
 * On click, it:
 *   1. Extracts the current textarea text as the query.
 *   2. Sends SEARCH_MEMORIES to the background service worker.
 *   3. Formats top-k results as a RAG prompt.
 *   4. Overwrites the textarea using React's native value setter hack so the
 *      send button becomes active.
 */

import type { PlasmoCSConfig } from "plasmo";
import TurndownService from "turndown";
import type {
  DomMessage,
  DomSyncResponse,
} from "../types/messages";
import { watchOnboardingStep3 } from "../utils/onboarding-highlight";
import { handleRecallClick as sharedHandleRecallClick } from "../utils/recall-helpers";
import { createRecallButton as sharedCreateRecallButton } from "../utils/recall-button";
import { isRecallButtonEnabled, initRecallVisibility } from "../utils/recall-visibility";
import {
  safeRuntimeOnMessage,
  safeRuntimeSendMessage,
} from "../utils/extension-context";
import { isTransientAssistantMessage } from "../utils/transient-assistant";
import { scanDomAttachments } from "../utils/attachment-scanner";
import {
  consumePendingUploadAttachments,
  startUploadAttachmentCapture,
} from "../utils/upload-attachment-capture";
import {
  parseChatGPTConversationDetail,
  type ChatGPTConversationDetail,
} from "../utils/chatgpt-history";
import type { MemoryRecord } from "../types/memory";

export const config: PlasmoCSConfig = {
  matches: ["https://chatgpt.com/*"],
};

export const render = () => undefined;

const BUTTON_ID = "ai-memory-recall-btn";
const INPUT_ID = "ai-memory-recall-topk";
const DEFAULT_TOP_K = 3;

// ─── React Textarea Sync Hack ─────────────────────────────────────────────────
// React tracks input value through a synthetic event system. Setting
// element.value directly skips this and leaves the send button disabled.
// This hack uses the prototype's native setter (before React wraps it) so
// React's onChange fires correctly.

function setNativeValue(element: HTMLTextAreaElement, value: string): void {
  const valueSetter = Object.getOwnPropertyDescriptor(element, "value")?.set;
  const prototype = Object.getPrototypeOf(element);
  const prototypeValueSetter = Object.getOwnPropertyDescriptor(
    prototype,
    "value",
  )?.set;

  if (valueSetter && valueSetter !== prototypeValueSetter) {
    prototypeValueSetter?.call(element, value);
  } else {
    valueSetter?.call(element, value);
  }

  element.dispatchEvent(new Event("input", { bubbles: true }));
}

// ─── Text Extraction & Injection ──────────────────────────────────────────────
// ChatGPT's composer has used both <textarea> (older) and
// <div contenteditable> (current). We handle both.

function getInputText(): string {
  const el = document.getElementById("prompt-textarea");
  if (!el) return "";
  if (el instanceof HTMLTextAreaElement) return el.value;
  // Contenteditable div — innerText preserves line breaks
  return (el as HTMLElement).innerText ?? el.textContent ?? "";
}

function getPanelAnchor(): HTMLElement | null {
  return document.getElementById("prompt-textarea");
}

function injectText(text: string): void {
  const el = document.getElementById("prompt-textarea");
  if (!el) return;

  if (el instanceof HTMLTextAreaElement) {
    setNativeValue(el, text);
    el.focus();
    el.setSelectionRange(text.length, text.length);
  } else if ((el as HTMLElement).isContentEditable) {
    // execCommand fires native DOM events that React's synthetic layer captures,
    // correctly activating the send button. It also handles undo history.
    el.focus();
    document.execCommand("selectAll", false, undefined);
    document.execCommand("insertText", false, text);
  }
}

// ─── Button Creation ──────────────────────────────────────────────────────────

function createRecallButton(): HTMLElement {
  return sharedCreateRecallButton({
    buttonId: BUTTON_ID,
    inputId: INPUT_ID,
    defaultTopK: DEFAULT_TOP_K,
    onButtonClick: (btn) =>
      void sharedHandleRecallClick(btn, {
        buttonId: BUTTON_ID,
        inputId: INPUT_ID,
        defaultTopK: DEFAULT_TOP_K,
        getInputText,
        injectText,
        getPanelAnchor,
      }),
  });
}

// ─── Insertion Point Resolution ───────────────────────────────────────────────
// ChatGPT wraps each toolbar button in several layers of divs/spans for
// tooltip positioning (e.g. button → div.relative → div → span → flex-row).
// Using button.parentElement directly lands inside the tooltip wrapper.
// We must walk UP to the first ancestor with ≥2 direct children (the flex row),
// then insert our button as a sibling at that level.

// "Start Voice" sits to the right of Dictate; Recall goes between them.
// Fallbacks handle other locales and older UI versions.
const BEFORE_BUTTON_SELECTORS = [
  'button[aria-label="Start Voice"]',
  '[data-testid="send-button"]',
  'button[aria-label="Send message"]',
  'button[aria-label="Send prompt"]',
  'button[aria-label="傳送訊息"]',
  'button[aria-label="送信"]',
];

// Dictate button — used as anchor to insert before (recall goes left of dictation).
const MIC_BUTTON_SELECTORS = [
  'button[aria-label^="Dictation"]',        // "Dictation (^D)" and variants
  'button[aria-label="Dictate button"]',
  '[data-testid="composer-speech-button"]',
  '[data-testid="voice-input-button"]',
];

/**
 * Walk up from a button until reaching the first ancestor that has ≥2 direct
 * element children (the flex toolbar row). Returns that ancestor and the direct
 * child of it that contains the original button (the "slot" element).
 */
function findFlexSibling(
  startBtn: HTMLElement,
): { container: HTMLElement; slotEl: HTMLElement } | null {
  let el: HTMLElement = startBtn;
  while (el.parentElement && el.parentElement !== document.body) {
    const parent = el.parentElement as HTMLElement;
    if (parent.children.length >= 2) {
      return { container: parent, slotEl: el };
    }
    el = parent;
  }
  return null;
}

/**
 * Returns { container, before } so we can call container.insertBefore(btn, before).
 * `before` being null means append to end of container.
 *
 * Priority:
 *   1. "Start Voice" / send button → walk to flex row → insert before its slot
 *   2. Dictate / mic button → walk to flex row → insert after its slot
 *   3. Logged-out speech button container → walk to flex row → insert before its slot
 *   4. Walk up from #prompt-textarea, find ancestor with ≥2 direct children
 *      → insert before the last child
 */
function findInsertionPoint(): {
  container: HTMLElement;
  before: HTMLElement | null;
} | null {
  // Strategy 1 (logged-out grid layout): insert inside the flex row that contains
  // composer-speech-button-container, just before the container itself.
  // This must run before the selector-based strategies because "Start Voice" also
  // exists in the logged-out DOM but findFlexSibling walks to the wrong ancestor.
  const speechContainer = document.querySelector<HTMLElement>(
    '[data-testid="composer-speech-button-container"]',
  );
  if (speechContainer?.parentElement) {
    return {
      container: speechContainer.parentElement as HTMLElement,
      before: speechContainer,
    };
  }

  // Strategy 2: insert before "Start Voice" slot in the flex row
  for (const sel of BEFORE_BUTTON_SELECTORS) {
    const btn = document.querySelector<HTMLElement>(sel);
    if (btn) {
      const result = findFlexSibling(btn);
      if (result) return { container: result.container, before: result.slotEl };
    }
  }

  // Strategy 3: insert before the Dictate button's slot in the flex row
  // (recall button goes to the LEFT of the dictation button)
  for (const sel of MIC_BUTTON_SELECTORS) {
    const mic = document.querySelector<HTMLElement>(sel);
    if (mic) {
      const result = findFlexSibling(mic);
      if (result) {
        return {
          container: result.container,
          before: result.slotEl,
        };
      }
    }
  }

  // Strategy 4: walk up from #prompt-textarea, find ancestor with ≥2 direct children
  const textarea = document.getElementById("prompt-textarea");
  if (!textarea) return null;

  let el: HTMLElement | null = textarea.parentElement as HTMLElement | null;
  while (el && el !== document.body) {
    if (el.children.length >= 2) {
      const lastChild = el.children[el.children.length - 1] as HTMLElement;
      return { container: el, before: lastChild };
    }
    el = el.parentElement as HTMLElement | null;
  }

  return null;
}

// ─── Smart Sync Engine — DOM Scanner ─────────────────────────────────────────
// Captures historical messages already rendered in the page, then repeats after
// settled DOM changes so lazy-loaded messages and visible branch variants are
// also synced. The background deduplicates by message id and assigns branch
// numbers against the existing IndexedDB state.
//
// Algorithm:
//   1. Extract sessionId from URL (/c/<uuid>).
//   2. Scan all [data-testid^="conversation-turn-"] blocks.
//   3. Inside each turn, collect every [data-message-id] bubble.
//   4. Send the array to the background via DOM_SYNC.
//   5. Background deduplicates against IndexedDB and queues new items.

/** Extract the ChatGPT conversation UUID from the current URL. */
function extractSessionId(): string | null {
  const m = window.location.pathname.match(/\/c\/([0-9a-f-]{36})/i);
  return m ? `openai:${m[1]}` : null;
}

/**
 * Infer role from a conversation-turn block.
 * ChatGPT uses alternating turns: odd = user, even = assistant (0-indexed).
 * We rely on the data-testid suffix number rather than CSS classes since classes
 * are obfuscated and change with deployments.
 */
function inferRoleFromTurn(turnEl: Element): "user" | "assistant" {
  const testId = turnEl.getAttribute("data-testid") ?? "";
  const match = testId.match(/conversation-turn-(\d+)/);
  if (!match) return "user";
  // Turn numbers start at 1; odd = user (1,3,5…), even = assistant (2,4,6…)
  return parseInt(match[1], 10) % 2 === 1 ? "user" : "assistant";
}

/** Extract visible text from a message bubble, stripping code-block labels etc. */
function extractBubbleText(bubbleEl: Element): string {
  // ChatGPT wraps code blocks with a header bar (language label + copy button).
  // We strip only headers that sit inside <pre> ancestors to avoid accidentally
  // removing flex toolbars that are part of the actual message content.
  const clone = bubbleEl.cloneNode(true) as Element;
  clone
    .querySelectorAll('pre [class*="flex items-center"]')
    .forEach((el) => el.remove());
  // Some locales/versions render the code header without the flex class —
  // remove any <pre>-child div that holds a button but no code.
  clone.querySelectorAll("pre > div").forEach((div) => {
    if (div.querySelector("button") && !div.querySelector("code")) div.remove();
  });

  // Prefer converting the rendered HTML back to Markdown so headings, lists,
  // emphasis, code fences and tables keep their structure in the memory graph.
  // Falls back to innerText when conversion yields nothing usable.
  const markdown = (() => {
    try {
      const html = clone.innerHTML;
      if (!html) return "";
      return getTurndownService().turndown(html).trim();
    } catch {
      return "";
    }
  })();
  if (markdown) return markdown;

  return (
    (clone as HTMLElement).innerText?.trim() ?? clone.textContent?.trim() ?? ""
  );
}

// ─── HTML → Markdown (Turndown) ────────────────────────────────────────────────

let _turndownService: TurndownService | null = null;

function getTurndownService(): TurndownService {
  if (_turndownService) return _turndownService;
  const td = new TurndownService({
    codeBlockStyle: "fenced",
    headingStyle: "atx",
    bulletListMarker: "-",
    emDelimiter: "*",
    strongDelimiter: "**",
    hr: "---",
  });
  // Turndown flattens tables to plain text; emit GFM tables instead so the
  // markdown renderer can reproduce them exactly like the ChatGPT page.
  td.addRule("gfmTable", {
    filter: "table",
    replacement: (_content, node) =>
      tableToMarkdown(node as HTMLTableElement),
  });
  _turndownService = td;
  return td;
}

function tableCellText(cell: Element): string {
  return (
    (cell as HTMLElement).innerText?.replace(/\|/g, "\\|").replace(/\s*\n\s*/g, " ").trim() ??
    ""
  );
}

function tableToMarkdown(table: HTMLTableElement): string {
  const rows = Array.from(table.querySelectorAll("tr"));
  if (rows.length === 0) return "";
  const headerCells = Array.from(rows[0].querySelectorAll("th, td")).map(tableCellText);
  const bodyRows = rows.slice(1).map((row) =>
    Array.from(row.querySelectorAll("td, th")).map(tableCellText),
  );
  const colCount = Math.max(headerCells.length, ...bodyRows.map((r) => r.length));
  const pad = (cells: string[]): string[] => {
    const out = [...cells];
    while (out.length < colCount) out.push("");
    return out;
  };
  const lines: string[] = [];
  lines.push(`| ${pad(headerCells).join(" | ")} |`);
  lines.push(`| ${pad(headerCells.map(() => "---")).join(" | ")} |`);
  for (const row of bodyRows) lines.push(`| ${pad(row).join(" | ")} |`);
  return lines.join("\n");
}

function roundIndexFromTurn(turnIndex: number): number {
  return Math.max(0, Math.floor((turnIndex - 1) / 2));
}

function createDomSyncSignature(messages: DomMessage[]): string {
  return messages
    .map((msg) => [
      msg.messageId,
      msg.role,
      msg.turnIndex,
      msg.roundIndex ?? "",
      msg.branchIndex ?? "",
      msg.content.length,
      msg.attachments?.map((attachment) => attachment.id).sort().join(",") ?? "",
    ].join(":"))
    .join("|");
}

/** Scan the current DOM and return all discovered DomMessage objects. */
async function scanDomMessages(sessionId: string): Promise<DomMessage[]> {
  const results: DomMessage[] = [];
  const pageTitle = document.title ?? "";
  const scannedAt = Date.now();

  // Each top-level conversation block
  const turnEls = document.querySelectorAll(
    '[data-testid^="conversation-turn-"]',
  );

  for (const turnEl of turnEls) {
    const testId = turnEl.getAttribute("data-testid") ?? "";
    const turnMatch = testId.match(/conversation-turn-(\d+)/);
    if (!turnMatch) continue;
    const turnIndex = parseInt(turnMatch[1], 10);
    const roundIndex = roundIndexFromTurn(turnIndex);
    const roleFromTurn = inferRoleFromTurn(turnEl);

    // Within each turn there may be multiple message bubbles (e.g. multi-part responses)
    const bubbles = turnEl.querySelectorAll("[data-message-id]");

    for (const bubble of bubbles) {
      const messageId = bubble.getAttribute("data-message-id");
      if (!messageId) continue;

      const content = extractBubbleText(bubble);
      if (!content) continue; // skip empty / image-only bubbles

      // The bubble's own role attribute overrides the turn-level inference when present
      const roleAttr = bubble.getAttribute("data-message-author-role");
      const role: "user" | "assistant" =
        roleAttr === "user" || roleAttr === "assistant"
          ? roleAttr
          : roleFromTurn;

      if (isTransientAssistantMessage(role, content)) continue;

      const attachments = await scanDomAttachments({
        messageId,
        root: bubble,
        includeImages: true,
        includeFiles: true,
      });
      if (role === "user") {
        attachments.push(...await consumePendingUploadAttachments(messageId));
      }

      results.push({
        messageId,
        role,
        content,
        turnIndex,
        roundIndex,
        sessionId,
        pageTitle,
        scannedAt,
        ...(attachments.length > 0 && { attachments }),
      });
    }
  }

  return results;
}

/** Send scanned messages to the background for deduplication + queuing. */
function sendDomSync(messages: DomMessage[]): void {
  if (!messages.length) return;

  safeRuntimeSendMessage<DomSyncResponse>(
    {
      type: "DOM_SYNC",
      payload: {
        messages,
        provider: "openai",
        url: window.location.href,
        manual: true,
      },
    },
    (resp, error) => {
      if (error) {
        console.warn("[Threadline] DOM_SYNC error:", error);
        return;
      }
      const { queued = 0, skipped = 0 } = resp?.payload ?? {};
    },
  );
}

// ─── ChatGPT backend-API history sync ─────────────────────────────────────────
// DOM scans can only see what the page currently renders, and ChatGPT
// virtualizes long threads (early rounds are simply not in the DOM until you
// scroll up). The authoritative source is the backend API:
//   GET /backend-api/conversation/<id>  → full message mapping
//   GET /backend-api/conversations      → sidebar conversation list
// We fetch those from the page context (session cookies are attached) and
// stream parsed records to the background, which dedups + persists them.

const HISTORY_LIST_LIMIT = 100;
const HISTORY_CONCURRENCY_CAP = 400; // safety cap per full-sync run
const HISTORY_CURRENT_THROTTLE_MS = 60_000;

let _historySyncActive = false;
const _lastCurrentSyncBySession = new Map<string, number>();

interface ChatGPTHistorySyncOptions {
  scope: "current" | "all";
  forcePersist?: boolean;
  sessionId?: string;
}

// ChatGPT's backend API now requires an `Authorization: Bearer <jwt>` header.
// The frontend obtains the JWT from the NextAuth session endpoint; we do the
// same (page context → session cookies attached) and cache it briefly.
let _accessTokenCache: { token: string; expiresAt: number } | null = null;

async function getChatGPTAccessToken(): Promise<string> {
  const cached = _accessTokenCache;
  if (cached && Date.now() < cached.expiresAt) return cached.token;
  const response = await fetch(`${window.location.origin}/api/auth/session`, {
    credentials: "include",
    headers: { accept: "application/json" },
  });
  if (!response.ok) {
    throw new Error(`ChatGPT auth ${response.status}`);
  }
  const session = (await response.json()) as { accessToken?: string };
  if (typeof session.accessToken !== "string" || !session.accessToken) {
    throw new Error("NO_ACCESS_TOKEN");
  }
  // Cache for 8 minutes (JWT lifetime is ~1 day; refresh eagerly is fine)
  _accessTokenCache = { token: session.accessToken, expiresAt: Date.now() + 8 * 60_000 };
  return session.accessToken;
}

async function historyFetchJson<T>(path: string): Promise<T> {
  const token = await getChatGPTAccessToken();
  const response = await fetch(`${window.location.origin}${path}`, {
    credentials: "include",
    headers: {
      accept: "application/json",
      authorization: `Bearer ${token}`,
    },
  });
  if (!response.ok) {
    throw new Error(`ChatGPT API ${response.status}`);
  }
  return (await response.json()) as T;
}

function conversationIdFromUrlOrSession(sessionId?: string): string | null {
  if (sessionId && sessionId.startsWith("openai:")) {
    const id = sessionId.slice("openai:".length).trim();
    if (id) return id;
  }
  const m = window.location.pathname.match(/\/c\/([0-9a-f-]{36})/i);
  return m ? m[1] : null;
}

async function fetchConversationDetail(
  conversationId: string,
): Promise<{ records: MemoryRecord[]; title?: string; sessionId: string } | null> {
  const conv = await historyFetchJson<ChatGPTConversationDetail>(
    `/backend-api/conversation/${conversationId}`,
  );
  const records = parseChatGPTConversationDetail(
    conv,
    window.location.href,
    conversationId,
  );
  if (!records.length) return null;
  return {
    records,
    title:
      typeof conv.title === "string" && conv.title.trim()
        ? conv.title.trim()
        : undefined,
    sessionId: `openai:${conversationId}`,
  };
}

function sendConversationToBackground(
  payload: {
    sessionId: string;
    title?: string;
    records: MemoryRecord[];
    forcePersist?: boolean;
    total?: number;
  },
): void {
  safeRuntimeSendMessage({ type: "CHATGPT_HISTORY_CONVERSATION", payload }, () => {
    /* progress arrives via HISTORY_SYNC_PROGRESS broadcasts */
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function syncCurrentConversationFromApi(
  options: ChatGPTHistorySyncOptions,
): Promise<{ success: boolean; error?: string; total: number }> {
  const conversationId = conversationIdFromUrlOrSession(options.sessionId);
  if (!conversationId) {
    return { success: false, error: "NOT_ON_CONVERSATION_PAGE", total: 0 };
  }
  try {
    const conv = await fetchConversationDetail(conversationId);
    if (conv) {
      sendConversationToBackground({
        sessionId: conv.sessionId,
        title: conv.title,
        records: conv.records,
        forcePersist: options.forcePersist,
        total: 1,
      });
    }
    return { success: true, total: conv ? 1 : 0 };
  } catch (err) {
    console.warn("[Threadline] ChatGPT history sync failed:", err);
    return { success: false, error: String(err), total: 0 };
  }
}

async function syncAllConversationsFromApi(
  options: ChatGPTHistorySyncOptions,
): Promise<{ success: boolean; error?: string; total: number }> {
  try {
    // 1. Walk the conversation list pages.
    const items: Array<{ id: string; title?: string }> = [];
    const seen = new Set<string>();
    let offset = 0;
    while (items.length < HISTORY_CONCURRENCY_CAP) {
      const list = await historyFetchJson<{
        items?: Array<{ id?: string; title?: string | null }>;
        total?: number;
      }>(
        `/backend-api/conversations?offset=${offset}&limit=${HISTORY_LIST_LIMIT}&order=updated&is_archived=false&is_starred=false`,
      );
      const batch = (list.items ?? []).filter(
        (item) => typeof item.id === "string" && item.id && !seen.has(item.id),
      );
      for (const item of batch) {
        seen.add(item.id as string);
        items.push({
          id: item.id as string,
          title: typeof item.title === "string" ? item.title : undefined,
        });
      }
      const total = typeof list.total === "number" ? list.total : items.length;
      if (batch.length === 0 || items.length >= total) break;
      if (batch.length < HISTORY_LIST_LIMIT) break;
      offset += HISTORY_LIST_LIMIT;
    }

    if (items.length === 0) {
      return { success: true, total: 0 };
    }

    // 2. Fetch every conversation (sequentially, politely) and stream each to
    //    the background as soon as it is parsed.
    const failed: string[] = [];
    for (const item of items) {
      try {
        const conv = await fetchConversationDetail(item.id);
        if (conv) {
          sendConversationToBackground({
            sessionId: conv.sessionId,
            title: conv.title ?? item.title,
            records: conv.records,
            forcePersist: options.forcePersist,
            total: items.length,
          });
        }
      } catch (err) {
        failed.push(item.id);
        console.warn("[Threadline] History sync failed for", item.id, err);
      }
      await sleep(120);
    }

    if (failed.length > 0) {
      console.warn(`[Threadline] ${failed.length}/${items.length} conversations failed`);
    }
    return { success: true, total: items.length };
  } catch (err) {
    console.warn("[Threadline] ChatGPT full history sync failed:", err);
    return { success: false, error: String(err), total: 0 };
  }
}

async function handleFetchChatGPTHistory(
  options: ChatGPTHistorySyncOptions,
  sendResponse?: (response: { success: boolean; error?: string }) => void,
): Promise<void> {
  if (_historySyncActive) {
    sendResponse?.({ success: false, error: "ALREADY_SYNCING" });
    return;
  }
  _historySyncActive = true;
  // Ack immediately — the actual work continues asynchronously and reports
  // via CHATGPT_HISTORY_CONVERSATION / CHATGPT_HISTORY_DONE messages.
  sendResponse?.({ success: true });
  let total = 0;
  try {
    if (options.scope === "all") {
      total = (await syncAllConversationsFromApi(options)).total;
    } else {
      total = (await syncCurrentConversationFromApi(options)).total;
    }
  } finally {
    _historySyncActive = false;
    if (options.scope === "current") {
      const conversationId = conversationIdFromUrlOrSession(options.sessionId);
      if (conversationId) {
        _lastCurrentSyncBySession.set(conversationId, Date.now());
      }
    }
    // Tell the background the run finished so progress UI can reset.
    safeRuntimeSendMessage(
      {
        type: "CHATGPT_HISTORY_DONE",
        payload: { scope: options.scope, total },
      },
      () => undefined,
    );
  }
}

/** Throttled auto-sync: on opening a conversation, backfill it from the API. */
function maybeSyncCurrentFromApi(): void {
  const conversationId = conversationIdFromUrlOrSession(undefined);
  if (!conversationId) return;
  const last = _lastCurrentSyncBySession.get(conversationId) ?? 0;
  if (Date.now() - last < HISTORY_CURRENT_THROTTLE_MS) return;
  void handleFetchChatGPTHistory({ scope: "current" });
}

// ─── Sync Trigger Logic ───────────────────────────────────────────────────────
// Re-scans are signature-deduped so DOM changes can safely trigger sync without
// re-inserting the same messages. This is what lets already-open conversations
// and branch switches flow into IndexedDB.

const _scanTimers = new Map<string, ReturnType<typeof setTimeout>>();
const _lastSentSignatures = new Map<string, string>();
let _waitingForMessageNodes = false;

async function scanAndSendIfChanged(sessionId: string): Promise<void> {
  const messages = await scanDomMessages(sessionId);
  if (!messages.length) return;
  const signature = createDomSyncSignature(messages);
  if (_lastSentSignatures.get(sessionId) === signature) return;
  _lastSentSignatures.set(sessionId, signature);
  sendDomSync(messages);
}

function scheduleDomSync(sessionId: string, delay = 900): void {
  const existing = _scanTimers.get(sessionId);
  if (existing) clearTimeout(existing);
  _scanTimers.set(
    sessionId,
    setTimeout(() => {
      _scanTimers.delete(sessionId);
      void scanAndSendIfChanged(sessionId);
    }, delay),
  );
}

/**
 * Wait until at least one [data-message-id] element is present in the DOM,
 * then run the scan. Uses a MutationObserver with a 15s safety timeout.
 *
 * ChatGPT streams messages progressively — the first [data-message-id] node
 * appears well before the full conversation finishes rendering. We add a small
 * extra delay (800 ms) after first detection to let more bubbles render.
 */
function waitForMessageNodesAndScan(sessionId: string): void {
  // If messages are already in the DOM, scan after a short settle delay
  if (document.querySelector("[data-message-id]")) {
    scheduleDomSync(sessionId, 900);
    return;
  }

  if (_waitingForMessageNodes) return;
  _waitingForMessageNodes = true;

  // Otherwise observe the DOM until the first message bubble appears
  let settled = false;
  const timeout = setTimeout(() => {
    // Safety timeout — give up after 15s to avoid leaking the observer
    observer.disconnect();
    _waitingForMessageNodes = false;
  }, 15_000);

  const observer = new MutationObserver(() => {
    if (settled) return;
    if (!document.querySelector("[data-message-id]")) return;
    settled = true;
    observer.disconnect();
    clearTimeout(timeout);
    _waitingForMessageNodes = false;

    // Short extra delay so more bubbles can render before we snapshot
    scheduleDomSync(sessionId, 900);
  });

  observer.observe(document.body, { childList: true, subtree: true });
}

/**
 * Run a DOM scan for the current conversation. Safe to call frequently because
 * scheduleDomSync debounces and scanAndSendIfChanged deduplicates payloads.
 * Also backfills the conversation from the ChatGPT backend API (throttled),
 * which is the only way to obtain rounds the page has virtualized away.
 */
function maybeScanCurrentConversation(): void {
  const sessionId = extractSessionId();
  if (!sessionId) return; // Not on a /c/<uuid> page

  waitForMessageNodesAndScan(sessionId);
  maybeSyncCurrentFromApi();
}

safeRuntimeOnMessage((message, _sender, sendResponse) => {
  if (message?.type !== "REQUEST_DOM_SYNC_NOW") {
    if (message?.type === "FETCH_CHATGPT_HISTORY") {
      const payload = message.payload ?? {};
      void handleFetchChatGPTHistory(
        {
          scope: payload.scope === "all" ? "all" : "current",
          forcePersist: payload.forcePersist === true,
          sessionId: typeof payload.sessionId === "string" ? payload.sessionId : undefined,
        },
        sendResponse,
      );
      return true; // async response
    }
    return false;
  }
  const sessionId = extractSessionId();
  if (sessionId) {
    void scanDomMessages(sessionId).then(sendDomSync);
  }
  sendResponse({ success: true });
  return false;
});

// ─── DOM Injection ────────────────────────────────────────────────────────────

function tryInjectButton(): void {
  if (!isRecallButtonEnabled()) {
    document.getElementById(BUTTON_ID)?.parentElement?.remove();
    return;
  }
  if (document.getElementById(BUTTON_ID)) return;

  const point = findInsertionPoint();
  if (!point) return;

  const btn = createRecallButton();
  point.container.insertBefore(btn, point.before);
}

// ─── SPA Navigation Observer ──────────────────────────────────────────────────
// ChatGPT is a React SPA; navigating between conversations replaces DOM nodes.
// We use a MutationObserver + rAF debounce to re-inject after each render.
// We also hook into SPA URL changes (popstate / replaceState) to trigger DOM
// scans when the user navigates to a new conversation.

let rafPending = false;
let _lastObservedUrl = window.location.href;

function scheduleInjection(): void {
  if (rafPending) return;
  rafPending = true;
  requestAnimationFrame(() => {
    rafPending = false;
    tryInjectButton();

    // Detect SPA navigation (URL changed without a full page reload)
    const currentUrl = window.location.href;
    if (currentUrl !== _lastObservedUrl) {
      _lastObservedUrl = currentUrl;
      maybeScanCurrentConversation();
    } else {
      maybeScanCurrentConversation();
    }
  });
}

const observer = new MutationObserver(scheduleInjection);

// Periodic DOM re-scan safety net. Virtualized conversations render lazily
// (scroll-triggered) and rapid streaming can swallow mutation batches; a
// cheap signature-deduped re-scan every few seconds guarantees newly
// rendered messages eventually reach the background even if an observer
// callback was missed.
let _rescanInterval: number | undefined;
function startPeriodicRescan(): void {
  if (_rescanInterval !== undefined) return;
  _rescanInterval = window.setInterval(() => {
    if (document.visibilityState !== "visible") return;
    const sessionId = extractSessionId();
    if (!sessionId) return;
    void scanAndSendIfChanged(sessionId);
  }, 10_000);
}

function start(): void {
  startUploadAttachmentCapture();
  initRecallVisibility(() => tryInjectButton());
  tryInjectButton();
  observer.observe(document.body, { childList: true, subtree: true });

  // Scan on initial page load (covers hard refresh and direct link navigation)
  maybeScanCurrentConversation();
  startPeriodicRescan();

  // Onboarding Step 3: highlight Recall button if active
  watchOnboardingStep3(BUTTON_ID);
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", start);
} else {
  start();
}
