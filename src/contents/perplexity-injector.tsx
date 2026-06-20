/**
 * Perplexity Recall Button — Content Script
 *
 * Injects a "Recall" button into Perplexity's composer toolbar, between
 * the "Choose a model" button and the "Dictation" button.
 *
 * On click, it:
 *   1. Extracts the current composer text as the query.
 *   2. Sends SEARCH_MEMORIES to the background service worker.
 *   3. Formats top-k results as a RAG prompt.
 *   4. Injects the formatted prompt into Perplexity's contenteditable editor.
 */

import type { PlasmoCSConfig } from "plasmo";
import { watchOnboardingStep3 } from "../utils/onboarding-highlight";
import { handleRecallClick as sharedHandleRecallClick } from "../utils/recall-helpers";
import { createRecallButton as sharedCreateRecallButton } from "../utils/recall-button";

export const config: PlasmoCSConfig = {
  matches: ["https://www.perplexity.ai/*"],
};

export const render = () => undefined;

const BUTTON_ID = "ai-memory-perplexity-recall-btn";
const INPUT_ID = "ai-memory-perplexity-recall-topk";
const DEFAULT_TOP_K = 3;

// ─── Text Extraction ──────────────────────────────────────────────────────────
// Perplexity uses a contenteditable div as its composer.

function getInputText(): string {
  const editor = document.querySelector<HTMLElement>(
    'div[contenteditable="true"][data-lexical-editor], div[contenteditable="true"][aria-placeholder]',
  );
  return editor?.innerText?.trim() ?? "";
}

function getPanelAnchor(): HTMLElement | null {
  return document.querySelector<HTMLElement>(
    'div[contenteditable="true"][data-lexical-editor], div[contenteditable="true"][aria-placeholder]',
  );
}

// ─── Text Injection ───────────────────────────────────────────────────────────
// Perplexity uses a Lexical-based contenteditable editor.
// execCommand('insertText') is deprecated and unreliable in Lexical.
// Most reliable approach: simulate a clipboard paste event, which Lexical intercepts
// and uses to set its internal state correctly.

// Build a minimal Lexical editor-state JSON for plain multi-line text.
// Each "\n"-separated line becomes its own paragraph node.
function buildLexicalEditorState(text: string): string {
  const paragraphs = text.split("\n").map((line) => ({
    children: line
      ? [
          {
            detail: 0,
            format: 0,
            mode: "normal",
            style: "",
            text: line,
            type: "text",
            version: 1,
          },
        ]
      : [],
    direction: line ? "ltr" : null,
    format: "",
    indent: 0,
    type: "paragraph",
    version: 1,
  }));

  return JSON.stringify({
    root: {
      children: paragraphs,
      direction: "ltr",
      format: "",
      indent: 0,
      type: "root",
      version: 1,
    },
  });
}

function injectText(text: string): void {
  const editorEl = document.querySelector<HTMLElement>(
    'div[contenteditable="true"][data-lexical-editor], div[contenteditable="true"][aria-placeholder]',
  );
  if (!editorEl) {
    console.warn("[Threadline] Could not find Lexical editor element");
    return;
  }

  // Primary: access Lexical's internal editor instance (stored as __lexicalEditor
  // on the root element) and set its state directly. This is the only reliable
  // way to replace content without keyboard/execCommand hacks, since Lexical's
  // paste handler inserts at internal cursor position rather than the DOM selection.
  type LexicalEditorLike = {
    parseEditorState: (json: string) => unknown;
    setEditorState: (state: unknown) => void;
  };
  const lexicalEditor = (editorEl as unknown as Record<string, unknown>)[
    "__lexicalEditor"
  ] as LexicalEditorLike | undefined;

  if (lexicalEditor?.parseEditorState && lexicalEditor?.setEditorState) {
    try {
      const newState = lexicalEditor.parseEditorState(
        buildLexicalEditorState(text),
      );
      lexicalEditor.setEditorState(newState);
      // Fire an input event so Perplexity's React layer picks up the change
      // and activates the submit button.
      editorEl.dispatchEvent(new Event("input", { bubbles: true }));
      return;
    } catch {
      // fall through to paste fallback
    }
  }

  // Fallback: sync DOM selection into Lexical's internal selection via
  // selectionchange, then paste — Lexical replaces the selection.
  editorEl.focus();
  const sel = window.getSelection();
  if (sel) {
    const range = document.createRange();
    range.selectNodeContents(editorEl);
    sel.removeAllRanges();
    sel.addRange(range);
  }
  document.dispatchEvent(new Event("selectionchange"));

  const dt = new DataTransfer();
  dt.setData("text/plain", text);
  const pasteEvent = new ClipboardEvent("paste", {
    bubbles: true,
    cancelable: true,
    clipboardData: dt,
  });
  editorEl.dispatchEvent(pasteEvent);
}

// ─── Button Creation ──────────────────────────────────────────────────────────

function createRecallButton(): HTMLElement {
  return sharedCreateRecallButton({
    buttonId: BUTTON_ID,
    inputId: INPUT_ID,
    defaultTopK: DEFAULT_TOP_K,
    extraWrapperStyles: {
      pointerEvents: "auto",
      position: "relative",
      zIndex: "9999",
      width: "fit-content",
    },
    extraButtonStyles: { pointerEvents: "auto" },
    onButtonClick: (btn, e) => {
      e.preventDefault();
      e.stopPropagation();
      void sharedHandleRecallClick(btn, {
        buttonId: BUTTON_ID,
        inputId: INPUT_ID,
        defaultTopK: DEFAULT_TOP_K,
        getInputText,
        injectText,
        getPanelAnchor,
      });
    },
    extraButtonListeners: (btn) => {
      // Fallback: some host-page event handlers swallow click; use mousedown as backup
      btn.addEventListener("mousedown", (e) => {
        e.stopPropagation();
      });
    },
  });
}

// ─── Insertion Point Resolution ───────────────────────────────────────────────
// Perplexity's composer toolbar layout (as of 2026):
//
//   [button aria-label="Choose a model"]
//   <-- inject Recall here -->
//   [div.relative]              ← wrapper around Dictation button
//     [button aria-label="Dictation"]
//   [button aria-label="Submit"]
//
// Strategy:
//   1. Find model button → insert immediately after it.
//   2. Fallback: find "Dictation" button wrapper → insert before it.
//   3. Last resort: find "Submit" button → insert before it.

function findInsertionPoint(): {
  container: HTMLElement;
  before: HTMLElement | null;
} | null {
  // Primary: insert immediately after the "Choose a model" button
  const modelBtn = document.querySelector<HTMLElement>(
    'button[aria-label="Choose a model"]',
  );
  if (modelBtn?.parentElement) {
    return {
      container: modelBtn.parentElement as HTMLElement,
      before: modelBtn.nextElementSibling as HTMLElement | null,
    };
  }

  // Fallback: find the div.relative wrapping the Dictation button, insert before it
  const dictationBtn = document.querySelector<HTMLElement>(
    'button[aria-label="Dictation"]',
  );
  if (dictationBtn) {
    let el: HTMLElement | null = dictationBtn.parentElement;
    while (el && !(el.tagName === "DIV" && el.classList.contains("relative"))) {
      el = el.parentElement;
    }
    const dictationWrapper = el;
    if (dictationWrapper?.parentElement) {
      return {
        container: dictationWrapper.parentElement as HTMLElement,
        before: dictationWrapper,
      };
    }
    if (dictationBtn.parentElement) {
      return {
        container: dictationBtn.parentElement as HTMLElement,
        before: dictationBtn,
      };
    }
  }

  // Last resort: insert before the Submit button
  const submitBtn = document.querySelector<HTMLElement>(
    'button[aria-label="Submit"]',
  );
  if (submitBtn?.parentElement) {
    return {
      container: submitBtn.parentElement as HTMLElement,
      before: submitBtn,
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
// Perplexity is a React SPA; navigating between threads replaces DOM nodes.
// Use MutationObserver + rAF debounce to re-inject after each render.

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
