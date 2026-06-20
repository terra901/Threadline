/**
 * Gemini Recall Button — Content Script
 *
 * Injects a "Recall" button adjacent to the Gemini composer send button.
 * On click, it:
 *   1. Extracts the current editor text as the query.
 *   2. Sends SEARCH_MEMORIES to the background service worker.
 *   3. Formats top-k results as a RAG prompt.
 *   4. Injects the formatted prompt into Gemini's Quill contenteditable editor.
 */

import type { PlasmoCSConfig } from "plasmo";
import { watchOnboardingStep3 } from "../utils/onboarding-highlight";
import { handleRecallClick as sharedHandleRecallClick } from "../utils/recall-helpers";
import { createRecallButton as sharedCreateRecallButton } from "../utils/recall-button";
import type { DomMessage } from "../types/messages";
import {
  safeRuntimeOnMessage,
  safeRuntimeSendMessage,
} from "../utils/extension-context";

export const config: PlasmoCSConfig = {
  matches: ["https://gemini.google.com/*"],
};

export const render = () => undefined;

const BUTTON_ID = "ai-memory-gemini-recall-btn";
const INPUT_ID = "ai-memory-gemini-recall-topk";
const DEFAULT_TOP_K = 3;

// ─── Text Extraction ──────────────────────────────────────────────────────────
// Gemini uses a Quill-based rich-textarea component with a contenteditable div.

function getInputText(): string {
  // Quill editor inside <rich-textarea>
  const quill = document.querySelector<HTMLElement>(
    'rich-textarea .ql-editor[contenteditable="true"]',
  );
  if (quill) return quill.innerText?.trim() ?? "";

  // Fallback: any visible contenteditable in the input area
  const fallback = document.querySelector<HTMLElement>(
    '.input-area [contenteditable="true"], [data-testid="input-area"] [contenteditable="true"]',
  );
  return fallback?.innerText?.trim() ?? "";
}

function getPanelAnchor(): HTMLElement | null {
  return (
    document.querySelector<HTMLElement>(
      'rich-textarea .ql-editor[contenteditable="true"]',
    ) ??
    document.querySelector<HTMLElement>(
      '.input-area [contenteditable="true"], [data-testid="input-area"] [contenteditable="true"]',
    )
  );
}

// ─── Text Injection ───────────────────────────────────────────────────────────
// Quill intercepts native DOM events. execCommand is the most compatible way
// to inject text while triggering Quill's internal change handlers.

function injectText(text: string): void {
  const quill = document.querySelector<HTMLElement>(
    'rich-textarea .ql-editor[contenteditable="true"]',
  );
  const target =
    quill ??
    document.querySelector<HTMLElement>(
      '.input-area [contenteditable="true"], [data-testid="input-area"] [contenteditable="true"]',
    );

  if (!target) return;

  target.focus();
  // Select all existing content then replace it
  document.execCommand("selectAll", false, undefined);
  document.execCommand("insertText", false, text);

  // If execCommand did not fire Quill's handler, dispatch an input event
  target.dispatchEvent(new Event("input", { bubbles: true }));
}

// ─── Button Creation ──────────────────────────────────────────────────────────

function createRecallButton(): HTMLElement {
  return sharedCreateRecallButton({
    buttonId: BUTTON_ID,
    inputId: INPUT_ID,
    defaultTopK: DEFAULT_TOP_K,
    extraWrapperStyles: { width: "fit-content" },
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
// Gemini's toolbar (from DOM inspection, 2026):
//
//   <parent-toolbar>
//     <div class="model-picker-container">      ← mode picker, always present
//       <bard-mode-switcher>…</bard-mode-switcher>
//     </div>
//     <!-- Recall button goes here -->
//     <div class="input-buttons-wrapper-bottom"> ← contains mic OR send
//       <div class="mic-button-container [hidden]">
//         <speech-dictation-mic-button aria-label="Microphone">…</speech-dictation-mic-button>
//       </div>
//       <div class="send-button-container [visible]">
//         <button aria-label="Send message">…</button>
//       </div>
//     </div>
//   </parent-toolbar>
//
// Anchoring to mic/send buttons is fragile because mic-button-container gets
// class="hidden" when the user types, making any Recall button inserted inside it
// also disappear, and disturbing the flex layout of input-buttons-wrapper-bottom.
// Instead we anchor to .model-picker-container which is always present and stable.

/**
 * Returns { container, before } for insertBefore placement.
 *
 * Primary: Insert Recall as a sibling of .model-picker-container and
 * .input-buttons-wrapper-bottom, positioned between them.
 * This is stable across the mic↔send swap that happens as the user types.
 */
function findInsertionPoint(): {
  container: HTMLElement;
  before: HTMLElement | null;
} | null {
  // Strategy 1: anchor to model-picker-container (always in DOM)
  const modelPicker = document.querySelector<HTMLElement>(
    ".model-picker-container",
  );
  if (modelPicker?.parentElement) {
    const parent = modelPicker.parentElement as HTMLElement;
    // Insert before the buttons wrapper so Recall sits between picker and buttons
    const buttonsWrapper = parent.querySelector<HTMLElement>(
      ".input-buttons-wrapper-bottom",
    );
    return { container: parent, before: buttonsWrapper };
  }

  // Strategy 2: send button — fallback if model-picker selector changes
  const send = document.querySelector<HTMLElement>(
    'button[aria-label="Send message"]',
  );
  if (send?.parentElement) {
    return { container: send.parentElement as HTMLElement, before: send };
  }

  // Strategy 3: walk up from editor, find ancestor with ≥2 buttons
  const editor = document.querySelector<HTMLElement>(
    'rich-textarea .ql-editor, .input-area [contenteditable="true"]',
  );
  if (!editor) return null;

  let el: HTMLElement | null = editor.parentElement as HTMLElement | null;
  while (el && el !== document.body) {
    const buttons = Array.from(
      el.querySelectorAll<HTMLButtonElement>(":scope button"),
    );
    if (buttons.length >= 2) {
      const lastBtn = buttons[buttons.length - 1];
      const container = (lastBtn.parentElement as HTMLElement) ?? el;
      return { container, before: lastBtn };
    }
    el = el.parentElement as HTMLElement | null;
  }

  return null;
}

// ─── DOM Injection ────────────────────────────────────────────────────────────
// Gemini swaps between mic and send button in the same container as user types.
// When that swap happens, our wrapper stays but its sibling reference changes.
// We always anchor by finding the current mic or send button and re-inserting if
// the wrapper is already detached or in the wrong position.

function tryInjectButton(): void {
  const existing = document.getElementById(BUTTON_ID);

  const point = findInsertionPoint();
  if (!point) return;

  // If button exists and is already a child of the correct container, keep it.
  if (existing && existing.parentElement?.parentElement === point.container)
    return;
  if (existing && existing.parentElement === point.container) return;

  // Remove stale wrapper if detached from target container
  existing?.parentElement?.remove();

  const btn = createRecallButton();
  point.container.insertBefore(btn, point.before);
}

// ─── DOM Conversation Scraper ─────────────────────────────────────────────────
// Captures messages rendered in the Gemini DOM and sends them via DOM_SYNC to
// the background service worker.
//
// Gemini DOM structure (as of 2026):
//
//   <infinite-scroller data-test-id="chat-history-container">
//     <div id="{numericContainerId}">                        ← one per turn pair
//       <user-query>
//         <p class="query-text-line">User text</p>
//       </user-query>
//       <model-response>
//         <message-content id="message-content-id-r_{numericContainerId}">
//           <div id="model-response-message-contentr_{numericContainerId}">
//             <p data-path-to-node="0">…</p>
//           </div>
//         </message-content>
//       </model-response>
//     </div>
//   </infinite-scroller>

/** Extract the Gemini conversation ID from the current URL.
 *  URL pattern: https://gemini.google.com/app/<conversationId>
 */
function extractGeminiConversationId(): string | null {
  const m = window.location.pathname.match(/\/app\/([^/?#]+)/);
  return m ? m[1] : null;
}

/** Selectors for the new Gemini DOM structure */
const CHAT_CONTAINER_SELECTOR =
  'infinite-scroller[data-test-id="chat-history-container"]';
const USER_TEXT_SELECTOR = "p.query-text-line";
const RESPONSE_DIV_SELECTOR = 'div[id^="model-response-message-contentr_"]';

interface GeminiMessage {
  messageId: string;
  role: "user" | "assistant";
  content: string;
  turnIndex: number;
  containerId: string;
}

/**
 * Extract all messages from a single turn container div.
 * Returns [] if container is not yet fully rendered.
 */
function extractContainerMessages(
  container: Element,
  turnIndex: number,
): GeminiMessage[] {
  const containerId = container.id;
  if (!containerId) return [];

  let resolvedTurnIndex = turnIndex;
  if (resolvedTurnIndex < 0 && container.parentElement) {
    const siblings = Array.from(container.parentElement.children).filter(
      (el) => el instanceof HTMLElement && el.id,
    );
    const siblingIndex = siblings.indexOf(container);
    if (siblingIndex >= 0) resolvedTurnIndex = siblingIndex;
  }
  if (resolvedTurnIndex < 0) resolvedTurnIndex = 0;

  const messages: GeminiMessage[] = [];

  // User message
  const userLines = container.querySelectorAll<HTMLElement>(USER_TEXT_SELECTOR);
  if (userLines.length > 0) {
    const content = Array.from(userLines)
      .map((p) => p.innerText?.trim() ?? "")
      .filter(Boolean)
      .join("\n");
    if (content) {
      messages.push({
        messageId: `${containerId}-u`,
        role: "user",
        content,
        turnIndex: resolvedTurnIndex * 2,
        containerId,
      });
    }
  }

  // Assistant message
  const responseDiv =
    container.querySelector<HTMLElement>(RESPONSE_DIV_SELECTOR);
  if (responseDiv) {
    const content = responseDiv.innerText?.trim() ?? "";
    if (content) {
      messages.push({
        messageId: responseDiv.id || `${containerId}-a`,
        role: "assistant",
        content,
        turnIndex: resolvedTurnIndex * 2 + 1,
        containerId,
      });
    }
  }

  return messages;
}

function getPageTitle(): string {
  const el = document.querySelector<HTMLElement>(
    '[aria-current="true"][data-test-id="conversation"] div',
  );
  return el?.textContent?.trim() ?? document.title?.trim() ?? "";
}

function sendGeminiDomSync(domMessages: DomMessage[]): void {
  if (!domMessages.length) return;
  safeRuntimeSendMessage(
    {
      type: "DOM_SYNC",
      payload: {
        messages: domMessages,
        provider: "google",
        url: window.location.href,
        manual: true,
      },
    },
  );
}

// Tracks which conversations already have an active observer (prevents duplicate observers).
const _scannedConversations = new Set<string>();
let _activeContainerObserver: MutationObserver | null = null;
let _activeSyncCleanup: (() => void) | null = null;

function runDomSync(conversationId: string): void {
  const scroller = document.querySelector(CHAT_CONTAINER_SELECTOR);
  if (!scroller) return;

  const sessionId = `google:${conversationId}`;
  const pageTitle = getPageTitle();
  const scannedAt = Date.now();

  const containers = Array.from(scroller.children).filter(
    (el) => el instanceof HTMLElement && el.id,
  ) as HTMLElement[];

  const domMessages: DomMessage[] = [];

  for (let i = 0; i < containers.length; i++) {
    const extracted = extractContainerMessages(containers[i], i);
    for (const msg of extracted) {
      domMessages.push({
        messageId: msg.messageId,
        role: msg.role,
        content: msg.content,
        turnIndex: msg.turnIndex,
        roundIndex: Math.max(0, Math.floor(msg.turnIndex / 2)),
        branchIndex: 0,
        sessionId,
        pageTitle,
        scannedAt,
      });
    }
  }

  sendGeminiDomSync(domMessages);
}

/**
 * Wait until the conversation DOM has fully settled, then scrape.
 *
 * Gemini renders messages newest-first, then fills in older ones.
 * We use an idle-debounce approach: every time new nodes appear we
 * reset a short timer. Only when the DOM has been quiet for SETTLE_MS
 * do we consider the full conversation loaded and run the scan.
 * A hard 15s ceiling prevents the observer from leaking forever.
 */
function waitForDomAndSync(conversationId: string): () => void {
  const SETTLE_MS = 600;
  const MAX_WAIT_MS = 15_000;

  // Mark as being watched immediately to prevent duplicate observers from maybeSyncConversation
  _scannedConversations.add(conversationId);

  let settleTimer: ReturnType<typeof setTimeout> | null = null;

  // Hard timeout: disconnect observer and do a final scrape after MAX_WAIT_MS
  const hardTimeout = setTimeout(() => {
    syncObserver.disconnect();
    if (settleTimer) clearTimeout(settleTimer);
    runDomSync(conversationId);
  }, MAX_WAIT_MS);

  function onSettle(): void {
    clearTimeout(hardTimeout); // prevent redundant re-fire
    // Scrape on each settle (content dedup in sendCapturedTurn prevents re-sending).
    // Keep the observer alive so lazy-loaded older messages (e.g. scrolling up) are also captured.
    runDomSync(conversationId);
  }

  function resetSettle(): void {
    if (settleTimer) clearTimeout(settleTimer);
    settleTimer = setTimeout(onSettle, SETTLE_MS);
  }

  const syncObserver = new MutationObserver(resetSettle);
  syncObserver.observe(document.body, { childList: true, subtree: true });

  // If conversation elements are already present, start the settle timer immediately
  if (document.querySelector(CHAT_CONTAINER_SELECTOR)) {
    resetSettle();
  }

  // Return cleanup so maybeSyncConversation can cancel this observer on navigation
  return () => {
    syncObserver.disconnect();
    if (settleTimer) clearTimeout(settleTimer);
    clearTimeout(hardTimeout);
  };
}

/** Tracks containerIds already captured in this page session to avoid re-sending. */
const _capturedContainerIds = new Set<string>();

/**
 * Watch the infinite-scroller for newly appended turn containers.
 * Fires for real-time captures (user sends a new message).
 * Uses a per-container settle debounce to wait for response completion.
 */
function watchForNewContainers(conversationId: string): MutationObserver | null {
  const scroller = document.querySelector(CHAT_CONTAINER_SELECTOR);
  if (!scroller) return null;

  const sessionId = `google:${conversationId}`;
  const containerTimers = new Map<string, ReturnType<typeof setTimeout>>();

  function tryCaptureSingleContainer(container: HTMLElement): void {
    const containerId = container.id;
    if (!containerId || _capturedContainerIds.has(containerId)) return;

    // Clear any pending timer for this container
    const existing = containerTimers.get(containerId);
    if (existing) clearTimeout(existing);

    const SETTLE_MS = 1200; // wait for streaming to complete
    containerTimers.set(
      containerId,
      setTimeout(() => {
        containerTimers.delete(containerId);
        if (_capturedContainerIds.has(containerId)) return;

        const extracted = extractContainerMessages(container, -1);
        // Only capture if we have both user AND assistant message
        const hasUser = extracted.some((m) => m.role === "user");
        const hasAssistant = extracted.some((m) => m.role === "assistant");
        if (!hasUser || !hasAssistant) {
          // Response not yet complete — reschedule
          tryCaptureSingleContainer(container);
          return;
        }

        _capturedContainerIds.add(containerId);
        const pageTitle = getPageTitle();
        const scannedAt = Date.now();
        const domMessages: DomMessage[] = extracted.map((m) => ({
          messageId: m.messageId,
          role: m.role,
          content: m.content,
          turnIndex: m.turnIndex,
          roundIndex: Math.max(0, Math.floor(m.turnIndex / 2)),
          branchIndex: 0,
          sessionId,
          pageTitle,
          scannedAt,
        }));
        sendGeminiDomSync(domMessages);
      }, SETTLE_MS),
    );
  }

  const liveObserver = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (
          node instanceof HTMLElement &&
          node.id &&
          node.parentElement === scroller
        ) {
          // New top-level container div added to the scroller
          tryCaptureSingleContainer(node);
        }
      }
      // Also watch for content changes inside existing containers (streaming in progress)
      if (mutation.target instanceof HTMLElement) {
        const container = mutation.target.closest<HTMLElement>(
          `${CHAT_CONTAINER_SELECTOR} > [id]`,
        );
        if (container && !_capturedContainerIds.has(container.id)) {
          tryCaptureSingleContainer(container);
        }
      }
    }
  });

  liveObserver.observe(scroller, { childList: true, subtree: true });
  return liveObserver;
}

function maybeSyncConversation(): void {
  const conversationId = extractGeminiConversationId();
  if (!conversationId) return;
  if (_scannedConversations.has(conversationId)) return;
  // Disconnect old observers before starting new ones (SPA navigation cleanup)
  _activeContainerObserver?.disconnect();
  _activeContainerObserver = null;
  _activeSyncCleanup?.();
  _activeSyncCleanup = null;
  _activeSyncCleanup = waitForDomAndSync(conversationId);
  _activeContainerObserver = watchForNewContainers(conversationId);
}

safeRuntimeOnMessage((message, _sender, sendResponse) => {
  if (message?.type !== "REQUEST_DOM_SYNC_NOW") return false;
  const conversationId = extractGeminiConversationId();
  if (conversationId) runDomSync(conversationId);
  sendResponse({ success: true });
  return false;
});

// ─── SPA Navigation Observer ──────────────────────────────────────────────────

let rafPending = false;
let _lastObservedUrl = window.location.href;

function scheduleInjection(): void {
  if (rafPending) return;
  rafPending = true;
  requestAnimationFrame(() => {
    rafPending = false;
    tryInjectButton();

    // Detect SPA navigation and trigger DOM sync for the new conversation
    const currentUrl = window.location.href;
    if (currentUrl !== _lastObservedUrl) {
      _lastObservedUrl = currentUrl;
      maybeSyncConversation();
    }
  });
}

const observer = new MutationObserver(scheduleInjection);

function start(): void {
  tryInjectButton();
  observer.observe(document.body, { childList: true, subtree: true });

  // Sync on initial page load
  maybeSyncConversation();

  // Onboarding Step 3: highlight Recall button if active
  watchOnboardingStep3(BUTTON_ID);
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", start);
} else {
  start();
}
