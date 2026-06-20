import React from "react";
import { createRoot } from "react-dom/client";
import type { PlasmoCSConfig } from "plasmo";
import {
  FloatingMemoryPanel,
  openMemoryPanelExternally,
} from "../popup/components/FloatingMemoryPanel";
import { safeRuntimeOnMessage } from "../utils/extension-context";

export const config: PlasmoCSConfig = {
  matches: [
    "https://chat.openai.com/*",
    "https://chatgpt.com/*",
    "https://claude.ai/*",
    "https://gemini.google.com/*",
    "https://www.perplexity.ai/*",
    "https://grok.com/*",
  ],
};

export const render = () => undefined;

const ROOT_ID = "ai-memory-float-root";

function mountFloatUI() {
  if (document.getElementById(ROOT_ID)) return;
  const el = document.createElement("div");
  el.id = ROOT_ID;
  document.body.appendChild(el);
  createRoot(el).render(<FloatingMemoryPanel />);
}

// ChatGPT's React hydration can replace document.body children.
// Watch for our root div being removed and re-mount immediately.
const bodyObserver = new MutationObserver(() => {
  if (!document.getElementById(ROOT_ID)) {
    mountFloatUI();
  }
});

safeRuntimeOnMessage(
  (msg: { type?: string }, _sender, sendResponse) => {
    if (msg?.type === "OPEN_MEMORY_PANEL") {
      mountFloatUI();
      openMemoryPanelExternally();
      sendResponse();
      return true;
    }
    return false;
  },
);

function start() {
  mountFloatUI();
  bodyObserver.observe(document.body, { childList: true });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", start);
} else {
  start();
}
