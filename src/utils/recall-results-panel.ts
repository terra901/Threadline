import type { SearchResult } from "../types/messages";

const ROOT_ID = "ai-memory-recall-results-root";

export interface RecallResultsPanelOptions {
  query: string;
  results: SearchResult[];
  anchor: HTMLElement | null;
  onConfirm: (selectedResults: SearchResult[]) => void;
  onOpenOriginal: (result: SearchResult) => void;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function formatProvider(provider: string): string {
  if (provider === "openai") return "ChatGPT";
  if (provider === "anthropic") return "Claude";
  if (provider === "google") return "Gemini";
  if (provider === "perplexity") return "Perplexity";
  if (provider === "xai") return "Grok";
  return provider || "Unknown";
}

function formatDate(ms?: number): string {
  if (!ms) return "";
  return new Date(ms).toLocaleString(undefined, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function truncate(text: string, max = 220): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  return normalized.length > max ? `${normalized.slice(0, max)}...` : normalized;
}

function createText<K extends keyof HTMLElementTagNameMap>(
  tagName: K,
  className: string,
  text: string,
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tagName);
  el.className = className;
  el.textContent = text;
  return el;
}

function panelStyles(): string {
  return `
    :host {
      color-scheme: dark;
      font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", sans-serif;
    }
    * { box-sizing: border-box; }
    button { font: inherit; }
    .panel {
      width: 100%;
      max-height: min(520px, calc(100vh - 28px));
      display: flex;
      flex-direction: column;
      overflow: hidden;
      border: 1px solid rgba(255,255,255,0.12);
      border-radius: 16px;
      background: rgba(44,44,46,0.96);
      color: #fff;
      box-shadow: 0 18px 54px rgba(0,0,0,0.48), 0 0 0 1px rgba(10,132,255,0.10);
      backdrop-filter: blur(18px);
    }
    .header {
      min-height: 46px;
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 9px 10px 9px 12px;
      border-bottom: 1px solid rgba(255,255,255,0.08);
    }
    .title {
      font-size: 13px;
      font-weight: 700;
      letter-spacing: -0.01em;
    }
    .count,
    .selected-count,
    .meta,
    .score {
      color: rgba(235,235,245,0.60);
      font-size: 12px;
      letter-spacing: -0.01em;
    }
    .spacer {
      flex: 1;
      min-width: 0;
    }
    .confirm,
    .close,
    .open {
      min-height: 30px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      border: 1px solid rgba(255,255,255,0.12);
      border-radius: 10px;
      background: rgba(58,58,60,0.92);
      color: #fff;
      padding: 0 10px;
      cursor: pointer;
      transition: background-color 0.14s ease, border-color 0.14s ease, color 0.14s ease, opacity 0.14s ease;
    }
    .confirm {
      border-color: #0A84FF;
      background: #0A84FF;
      font-size: 12px;
      font-weight: 650;
    }
    .confirm:hover:not(:disabled) {
      background: #3395FF;
      border-color: #3395FF;
    }
    .confirm:disabled {
      opacity: 0.44;
      cursor: not-allowed;
    }
    .close {
      width: 30px;
      padding: 0;
      color: rgba(235,235,245,0.70);
      font-size: 16px;
      line-height: 1;
    }
    .close:hover,
    .open:hover {
      background: rgba(72,72,74,0.92);
      border-color: rgba(10,132,255,0.72);
      color: #fff;
    }
    .list {
      min-height: 0;
      overflow: visible;
      padding: 8px;
    }
    .list.scrollable {
      max-height: min(390px, calc(100vh - 160px));
      overflow-y: auto;
      scrollbar-gutter: stable;
    }
    .list.scrollable::-webkit-scrollbar {
      width: 8px;
    }
    .list.scrollable::-webkit-scrollbar-track {
      background: rgba(255,255,255,0.04);
      border-radius: 999px;
    }
    .list.scrollable::-webkit-scrollbar-thumb {
      background: rgba(235,235,245,0.28);
      border-radius: 999px;
    }
    .list.scrollable::-webkit-scrollbar-thumb:hover {
      background: rgba(10,132,255,0.72);
    }
    .item {
      width: 100%;
      display: flex;
      flex-direction: column;
      gap: 8px;
      border: 1px solid rgba(255,255,255,0.10);
      border-radius: 14px;
      background: rgba(58,58,60,0.56);
      color: inherit;
      padding: 11px 12px;
      text-align: left;
      cursor: pointer;
    }
    .item + .item {
      margin-top: 8px;
    }
    .item:hover {
      border-color: rgba(10,132,255,0.46);
      background: rgba(72,72,74,0.72);
    }
    .item.selected {
      border-color: #0A84FF;
      background: color-mix(in srgb, #0A84FF 13%, rgba(58,58,60,0.92));
      box-shadow: 0 0 0 1px rgba(10,132,255,0.32), 0 0 22px rgba(10,132,255,0.18);
    }
    .row {
      display: flex;
      align-items: center;
      gap: 8px;
      min-width: 0;
    }
    .check {
      width: 16px;
      height: 16px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      flex: 0 0 auto;
      border: 1px solid rgba(235,235,245,0.36);
      border-radius: 5px;
      color: transparent;
      font-size: 11px;
      font-weight: 800;
    }
    .item.selected .check {
      border-color: #0A84FF;
      background: #0A84FF;
    }
    .item.selected .check::after {
      content: "";
      width: 6px;
      height: 6px;
      border-radius: 999px;
      background: #fff;
    }
    .provider {
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      font-size: 13px;
      font-weight: 650;
      letter-spacing: -0.01em;
    }
    .role {
      flex: 0 0 auto;
      border: 1px solid rgba(255,255,255,0.10);
      border-radius: 999px;
      background: rgba(28,28,30,0.56);
      color: rgba(235,235,245,0.78);
      padding: 2px 7px;
      font-size: 11px;
      font-weight: 650;
    }
    .content {
      color: rgba(255,255,255,0.94);
      font-size: 13px;
      line-height: 1.48;
      overflow-wrap: anywhere;
    }
    .actions {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
    }
    .open {
      min-height: 28px;
      color: rgba(235,235,245,0.82);
      font-size: 12px;
      font-weight: 600;
    }
    .empty {
      padding: 18px;
      color: rgba(235,235,245,0.60);
      font-size: 13px;
    }
  `;
}

function removeExistingPanel(): void {
  document.getElementById(ROOT_ID)?.remove();
}

export function showRecallResultsPanel(options: RecallResultsPanelOptions): void {
  removeExistingPanel();

  const selectedKeys = new Set<string>();
  const root = document.createElement("div");
  root.id = ROOT_ID;
  root.style.position = "fixed";
  root.style.zIndex = "2147483647";
  root.style.left = "12px";
  root.style.top = "12px";
  root.style.width = "min(620px, calc(100vw - 24px))";
  root.style.maxWidth = "calc(100vw - 24px)";
  root.addEventListener("mousedown", (event) => event.stopPropagation());
  root.addEventListener("click", (event) => event.stopPropagation());

  const shadow = root.attachShadow({ mode: "open" });
  const style = document.createElement("style");
  style.textContent = panelStyles();

  const panel = document.createElement("section");
  panel.className = "panel";

  const header = document.createElement("div");
  header.className = "header";
  header.append(
    createText("div", "title", "Recall Result"),
    createText("div", "count", `${options.results.length} found`),
    createText("div", "spacer", ""),
  );

  const confirmTop = document.createElement("button");
  confirmTop.type = "button";
  confirmTop.className = "confirm";
  confirmTop.textContent = "确定";
  confirmTop.disabled = true;

  const close = document.createElement("button");
  close.type = "button";
  close.className = "close";
  close.title = "关闭";
  close.setAttribute("aria-label", "关闭 Recall Result 面板");
  close.textContent = "×";
  header.append(confirmTop, close);

  const list = document.createElement("div");
  list.className = "list";
  if (options.results.length > 3) {
    list.classList.add("scrollable");
  }

  const selectedCount = createText("div", "selected-count", "Selected 0");
  header.insertBefore(selectedCount, confirmTop);

  const keys = options.results.map((result, index) => `${result.id}:${index}`);

  function updateSelectionState(): void {
    const count = selectedKeys.size;
    selectedCount.textContent = `Selected ${count}`;
    confirmTop.disabled = count === 0;
    keys.forEach((key) => {
      const item = shadow.querySelector<HTMLElement>(`[data-key="${CSS.escape(key)}"]`);
      item?.classList.toggle("selected", selectedKeys.has(key));
    });
  }

  if (options.results.length === 0) {
    list.append(createText("div", "empty", "No recall results."));
  } else {
    options.results.forEach((result, index) => {
      const key = keys[index];
      const item = document.createElement("button");
      item.type = "button";
      item.className = "item";
      item.dataset.key = key;

      const top = document.createElement("div");
      top.className = "row";
      top.append(
        createText("span", "check", ""),
        createText("span", "provider", formatProvider(result.provider)),
        createText("span", "role", result.role),
        createText("span", "meta", formatDate(result.timestamp)),
      );

      const content = createText("div", "content", truncate(result.content));
      const actions = document.createElement("div");
      actions.className = "actions";
      actions.append(
        createText("span", "score", `Score ${result.similarityScore.toFixed(3)}`),
      );

      const open = document.createElement("button");
      open.type = "button";
      open.className = "open";
      open.textContent = "查看原文";
      open.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        options.onOpenOriginal(result);
      });
      actions.append(open);

      item.append(top, content, actions);
      item.addEventListener("click", () => {
        if (selectedKeys.has(key)) {
          selectedKeys.delete(key);
        } else {
          selectedKeys.add(key);
        }
        updateSelectionState();
      });
      list.append(item);
    });
  }

  function confirmSelection(): void {
    const selectedResults = options.results.filter((_, index) =>
      selectedKeys.has(keys[index]),
    );
    if (selectedResults.length === 0) return;
    options.onConfirm(selectedResults);
    root.remove();
  }

  confirmTop.addEventListener("click", confirmSelection);
  close.addEventListener("click", () => root.remove());

  panel.append(header, list);
  shadow.append(style, panel);
  document.documentElement.appendChild(root);

  function positionPanel(): void {
    const rect = options.anchor?.isConnected
      ? options.anchor.getBoundingClientRect()
      : null;
    const maxWidth = Math.max(280, window.innerWidth - 24);
    const desiredWidth = rect
      ? clamp(Math.max(rect.width, 460), 320, Math.min(720, maxWidth))
      : Math.min(620, maxWidth);
    root.style.width = `${desiredWidth}px`;

    const panelRect = root.getBoundingClientRect();
    const left = rect
      ? clamp(rect.left + rect.width / 2 - desiredWidth / 2, 12, window.innerWidth - desiredWidth - 12)
      : clamp(window.innerWidth - desiredWidth - 20, 12, window.innerWidth - desiredWidth - 12);
    const aboveTop = rect ? rect.top - panelRect.height - 12 : window.innerHeight - panelRect.height - 20;
    const top = clamp(aboveTop, 12, Math.max(12, window.innerHeight - panelRect.height - 12));

    root.style.left = `${left}px`;
    root.style.top = `${top}px`;
  }

  requestAnimationFrame(positionPanel);
  window.addEventListener("resize", positionPanel, { passive: true });
  window.addEventListener("scroll", positionPanel, { passive: true, capture: true });
  root.addEventListener("remove", () => {
    window.removeEventListener("resize", positionPanel);
    window.removeEventListener("scroll", positionPanel, true);
  });

  const observer = new MutationObserver(() => {
    if (!document.documentElement.contains(root)) {
      observer.disconnect();
      window.removeEventListener("resize", positionPanel);
      window.removeEventListener("scroll", positionPanel, true);
    }
  });
  observer.observe(document.documentElement, { childList: true });

  updateSelectionState();
}
