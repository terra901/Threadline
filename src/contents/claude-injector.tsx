/**
 * Claude Recall Button — Content Script
 *
 * Injects a "Recall" button adjacent to the Claude composer send button.
 * On click, it:
 *   1. Extracts the current composer text as the query.
 *   2. Sends SEARCH_MEMORIES to the background service worker.
 *   3. Formats top-k results as a RAG prompt.
 *   4. Injects the formatted prompt into Claude's ProseMirror contenteditable editor.
 */

import type { PlasmoCSConfig } from "plasmo";
import { watchOnboardingStep3 } from "../utils/onboarding-highlight";
import { handleRecallClick as sharedHandleRecallClick } from "../utils/recall-helpers";
import { createRecallButton as sharedCreateRecallButton } from "../utils/recall-button";

export const config: PlasmoCSConfig = {
  matches: ["https://claude.ai/*"],
};

export const render = () => undefined;

const BUTTON_ID = "ai-memory-claude-recall-btn";
const INPUT_ID = "ai-memory-claude-recall-topk";
const DEFAULT_TOP_K = 3;

// ─── Text Extraction ──────────────────────────────────────────────────────────
// Claude uses a ProseMirror contenteditable div as its composer.

function getInputText(): string {
  // Primary: ProseMirror editor inside the composer
  const pm = document.querySelector<HTMLElement>(
    '[contenteditable="true"].ProseMirror, div[contenteditable="true"][data-testid="chat-input"]',
  );
  if (pm) return pm.innerText?.trim() ?? "";

  // Fallback: any visible contenteditable in the input row
  const fallback = document.querySelector<HTMLElement>(
    'fieldset [contenteditable="true"], .composer [contenteditable="true"]',
  );
  return fallback?.innerText?.trim() ?? "";
}

function getPanelAnchor(): HTMLElement | null {
  return (
    document.querySelector<HTMLElement>(
      '[contenteditable="true"].ProseMirror, div[contenteditable="true"][data-testid="chat-input"]',
    ) ??
    document.querySelector<HTMLElement>(
      'fieldset [contenteditable="true"], .composer [contenteditable="true"]',
    )
  );
}

// ─── Text Injection ───────────────────────────────────────────────────────────
// ProseMirror intercepts native DOM events. execCommand is the most compatible
// way to inject text while triggering ProseMirror's internal change handlers.

function injectText(text: string): void {
  const target =
    document.querySelector<HTMLElement>(
      '[contenteditable="true"].ProseMirror, div[contenteditable="true"][data-testid="chat-input"]',
    ) ??
    document.querySelector<HTMLElement>(
      'fieldset [contenteditable="true"], .composer [contenteditable="true"]',
    );

  if (!target) return;

  target.focus();
  document.execCommand("selectAll", false, undefined);
  document.execCommand("insertText", false, text);
  target.dispatchEvent(new Event("input", { bubbles: true }));
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
// Claude's bottom toolbar (as of 2026) looks like:
//
//   div.shrink-0.flex.items-center.w-8.z-10.justify-end   ← outer right panel
//     div.flex.items-center.gap-1.shrink-0                ← the flex row we target
//       div.flex.items-center.rounded-lg.transition-colors ← model selector
//       button.h-8.rounded-lg[data-state]                 ← audio / mic button
//
// We want to inject Recall between the model selector div and the audio button,
// i.e. insertBefore(recallEl, audioButton) inside that gap-1 container.
//
// Strategy order:
//   1. Find the audio button by data-state="closed" inside the gap-1 container,
//      then insert our button before it.
//   2. Fallback: find any button inside a "gap-1 shrink-0" flex row and insert
//      before the first button in that row.
//   3. Last resort: walk up from the ProseMirror editor.

function findInsertionPoint(): {
  container: HTMLElement;
  before: HTMLElement | null;
} | null {
  // Primary: find the audio button (the one after the model selector).
  // Insert Recall immediately before it → order: [model selector] [Recall] [audio]
  //
  // The audio button has class "h-8 rounded-lg overflow-hidden ... font-base-bold ...".
  // The model selector is data-testid="model-selector-dropdown".
  // Both share the same parent flex row — we locate the audio button and insertBefore it.

  const modelBtn = document.querySelector<HTMLElement>(
    '[data-testid="model-selector-dropdown"]',
  );
  if (modelBtn?.parentElement) {
    const parent = modelBtn.parentElement as HTMLElement;
    // The audio button is the next sibling of the model selector inside the same row
    const audioBtn = parent.querySelector<HTMLElement>(
      "button.h-8.rounded-lg.overflow-hidden",
    );
    if (audioBtn) {
      return { container: parent, before: audioBtn };
    }
    // Fallback: insert after the model selector (before next sibling)
    return {
      container: parent,
      before: modelBtn.nextElementSibling as HTMLElement | null,
    };
  }

  return null;
}

// ─── DOM Injection ────────────────────────────────────────────────────────────

function tryInjectButton(): void {
  if (document.getElementById(BUTTON_ID)) return;

  const point = findInsertionPoint();
  if (!point) return;

  const btn = createRecallButton();
  point.container.insertBefore(btn, point.before);
}

// ─── SPA Navigation Observer ──────────────────────────────────────────────────
// Claude is a React SPA; navigating between conversations replaces DOM nodes.
// We use a MutationObserver + rAF debounce to re-inject after each render.

let rafPending = false;

function scheduleInjection(): void {
  if (rafPending) return;
  rafPending = true;
  requestAnimationFrame(() => {
    rafPending = false;
    tryInjectButton();
  });
}

const observer = new MutationObserver(scheduleInjection);

function start(): void {
  tryInjectButton();
  observer.observe(document.body, { childList: true, subtree: true });

  // Onboarding Step 3: highlight Recall button if active
  watchOnboardingStep3(BUTTON_ID);
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", start);
} else {
  start();
}
