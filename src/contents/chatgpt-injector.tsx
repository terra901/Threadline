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
import type {
  DomMessage,
  DomSyncResponse,
} from "../types/messages";
import { watchOnboardingStep3 } from "../utils/onboarding-highlight";
import { handleRecallClick as sharedHandleRecallClick } from "../utils/recall-helpers";
import { createRecallButton as sharedCreateRecallButton } from "../utils/recall-button";
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
  return (
    (clone as HTMLElement).innerText?.trim() ?? clone.textContent?.trim() ?? ""
  );
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
 */
function maybeScanCurrentConversation(): void {
  const sessionId = extractSessionId();
  if (!sessionId) return; // Not on a /c/<uuid> page

  waitForMessageNodesAndScan(sessionId);
}

safeRuntimeOnMessage((message, _sender, sendResponse) => {
  if (message?.type !== "REQUEST_DOM_SYNC_NOW") return false;
  const sessionId = extractSessionId();
  if (sessionId) {
    void scanDomMessages(sessionId).then(sendDomSync);
  }
  sendResponse({ success: true });
  return false;
});

// ─── DOM Injection ────────────────────────────────────────────────────────────

function tryInjectButton(): void {
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

function start(): void {
  startUploadAttachmentCapture();
  tryInjectButton();
  observer.observe(document.body, { childList: true, subtree: true });

  // Scan on initial page load (covers hard refresh and direct link navigation)
  maybeScanCurrentConversation();

  // Onboarding Step 3: highlight Recall button if active
  watchOnboardingStep3(BUTTON_ID);
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", start);
} else {
  start();
}
