import type { SearchMemoriesResponse } from "../types/messages";
import { getRecallMessagesForContentScript } from "../i18n/recall-messages";
import { stopOnboardingHighlight } from "./onboarding-highlight";
import { formatRAGPrompt } from "./rag";
import { showRecallResultsPanel } from "./recall-results-panel";
import { safeRuntimeSendMessage } from "./extension-context";

export function getTopK(inputId: string, defaultTopK = 3): number {
  const input = document.getElementById(inputId) as HTMLInputElement | null;
  if (input) {
    const v = parseInt(input.value, 10);
    if (!isNaN(v) && v >= 1) return Math.min(v, 20);
  }
  return defaultTopK;
}

export function searchMemories(
  query: string,
  topK: number,
): Promise<SearchMemoriesResponse> {
  return new Promise((resolve, reject) => {
    const sent = safeRuntimeSendMessage<SearchMemoriesResponse>(
      {
        type: "SEARCH_MEMORIES",
        payload: { query: query || "general context", topK },
      },
      (resp, error) => {
        if (error) {
          reject(new Error(error));
          return;
        }
        if (!resp) {
          reject(new Error("No response from background script"));
          return;
        }
        resolve(resp);
      },
    );
    if (!sent) reject(new Error("Extension context is unavailable"));
  });
}

export interface RecallHandlerOptions {
  buttonId: string;
  inputId: string;
  defaultTopK?: number;
  getInputText: () => string;
  injectText: (text: string) => void;
  getPanelAnchor?: () => HTMLElement | null;
}

export async function handleRecallClick(
  btn: HTMLButtonElement,
  opts: RecallHandlerOptions,
): Promise<void> {
  const { promptEmpty, alreadyRecalled } = getRecallMessagesForContentScript();
  const query = opts.getInputText().trim();
  if (!query) {
    alert(promptEmpty);
    return;
  }
  if (query.includes("[System Context: The following are relevant memories")) {
    alert(alreadyRecalled);
    return;
  }

  btn.textContent = "Searching...";
  btn.disabled = true;

  try {
    const topK = getTopK(opts.inputId, opts.defaultTopK ?? 3);
    const response = await searchMemories(query, topK);
    const results = response.payload.results ?? [];

    if (results.length === 0) {
      alert("[Threadline] No relevant memories found for your query.");
      return;
    }

    showRecallResultsPanel({
      query,
      results,
      anchor: opts.getPanelAnchor?.() ?? document.getElementById(opts.buttonId),
      onConfirm: (selectedResults) => {
        opts.injectText(formatRAGPrompt(query, selectedResults));
        safeRuntimeSendMessage({ type: "FIRST_RECALL_USED" });
        stopOnboardingHighlight(opts.buttonId);
      },
      onOpenOriginal: (result) => {
        safeRuntimeSendMessage({
          type: "OPEN_MEMORY_GRAPH",
          payload: { sessionId: result.sessionId, recordId: result.id },
        });
      },
    });
  } catch (err) {
    console.error("[Threadline] Recall failed:", err);
    alert(`[Threadline] Search failed: ${String(err)}`);
  } finally {
    btn.textContent = "Recall";
    btn.disabled = false;
  }
}
