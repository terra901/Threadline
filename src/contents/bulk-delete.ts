import { getBulkDeleteCopy } from "../utils/bulk-delete-copy";
import { safeRuntimeOnMessage } from "../utils/extension-context";

export const MAX_BULK_DELETE_SELECTION = 7;

export interface BulkDeleteConversationRef {
  provider: "openai" | "anthropic" | "google" | "perplexity" | "xai";
  providerName: string;
  id: string;
  sessionId: string;
}

interface ConversationEntry extends BulkDeleteConversationRef {
  title: string;
  href: string;
  row: HTMLElement;
  menuButton: HTMLElement;
}

interface BulkDeleteState {
  language: string;
  providerName: string;
  selected: Map<string, ConversationEntry>;
  host: HTMLElement;
  observer: MutationObserver;
  phase: "selecting" | "deleting" | "completed";
  deletedCount: number;
  status: string;
}

const ROOT_ID = "threadline-bulk-delete-root";
const CHECKBOX_ATTRIBUTE = "data-threadline-bulk-delete-checkbox";
const CHECKBOX_STYLE_ID = "threadline-bulk-delete-checkbox-styles";
const DELETE_LABEL = /(^|\b)(delete|remove|trash)(\b|$)|删除|移除|削除|消去|삭제|eliminar|borrar|supprimer|löschen|entfernen/iu;

let activeState: BulkDeleteState | null = null;

export function parseProviderConversationRef(rawUrl: string): BulkDeleteConversationRef | null {
  try {
    const url = new URL(rawUrl, "https://threadline.invalid");
    const host = url.hostname;
    const path = url.pathname;
    const matchers: Array<{
      matchesHost: boolean;
      pattern: RegExp;
      provider: BulkDeleteConversationRef["provider"];
      providerName: string;
      prefix: string;
    }> = [
      {
        matchesHost: host === "chatgpt.com" || host === "chat.openai.com",
        pattern: /^\/c\/([^/]+)\/?$/,
        provider: "openai",
        providerName: "ChatGPT",
        prefix: "openai",
      },
      {
        matchesHost: host === "claude.ai",
        pattern: /^\/chat\/([^/]+)\/?$/,
        provider: "anthropic",
        providerName: "Claude",
        prefix: "anthropic",
      },
      {
        matchesHost: host === "gemini.google.com",
        pattern: /^\/app\/([^/]+)\/?$/,
        provider: "google",
        providerName: "Gemini",
        prefix: "google",
      },
      {
        matchesHost: host === "www.perplexity.ai",
        pattern: /^\/search\/([^/]+)\/?$/,
        provider: "perplexity",
        providerName: "Perplexity",
        prefix: "perplexity",
      },
      {
        matchesHost: host === "grok.com",
        pattern: /^\/(?:c|chat)\/([^/]+)\/?$/,
        provider: "xai",
        providerName: "Grok",
        prefix: "xai",
      },
    ];

    for (const matcher of matchers) {
      if (!matcher.matchesHost) continue;
      const id = path.match(matcher.pattern)?.[1];
      if (id) {
        return {
          provider: matcher.provider,
          providerName: matcher.providerName,
          id,
          sessionId: `${matcher.prefix}:${id}`,
        };
      }
    }
  } catch {
    return null;
  }
  return null;
}

function isVisible(element: HTMLElement): boolean {
  const style = getComputedStyle(element);
  const rect = element.getBoundingClientRect();
  return (
    element.isConnected &&
    element.getClientRects().length > 0 &&
    rect.width > 0 &&
    rect.height > 0 &&
    rect.right > 0 &&
    rect.bottom > 0 &&
    rect.left < window.innerWidth &&
    rect.top < window.innerHeight &&
    style.visibility !== "hidden" &&
    style.display !== "none" &&
    style.opacity !== "0"
  );
}

function menuButtonFor(row: HTMLElement): HTMLElement | null {
  const buttons = Array.from(
    row.querySelectorAll<HTMLElement>('button, [role="button"]'),
  );
  return (
    buttons.find((button) => {
      const label = `${button.getAttribute("aria-label") ?? ""} ${button.title} ${button.innerText ?? ""}`;
      return (
        button.getAttribute("aria-haspopup") === "menu" ||
        /more|option|action|menu|更多|选项|操作|その他|オプション|메뉴|옵션|opciones|acciones|weitere|aktionen/i.test(label)
      );
    }) ?? null
  );
}

function rowForAnchor(
  anchor: HTMLAnchorElement,
  provider: BulkDeleteConversationRef["provider"],
): HTMLElement | null {
  if (provider === "google") {
    const geminiRow = anchor.closest<HTMLElement>(
      'gem-nav-list-item[data-test-id="conversation"]',
    );
    if (geminiRow && menuButtonFor(geminiRow)) return geminiRow;
  }

  let ancestor = anchor.parentElement;
  for (let depth = 0; ancestor && ancestor !== document.body && depth < 8; depth += 1) {
    if (ancestor.querySelectorAll("a[href]").length === 1 && menuButtonFor(ancestor)) {
      return ancestor;
    }
    ancestor = ancestor.parentElement;
  }
  return null;
}

function getConversationEntries(): ConversationEntry[] {
  const entries: ConversationEntry[] = [];
  const seen = new Set<string>();
  for (const anchor of Array.from(document.querySelectorAll<HTMLAnchorElement>("a[href]"))) {
    const ref = parseProviderConversationRef(anchor.href);
    if (!ref || seen.has(ref.id)) continue;
    const row = rowForAnchor(anchor, ref.provider);
    if (!row) continue;
    const menuButton = menuButtonFor(row);
    if (!menuButton) continue;
    const title =
      anchor.getAttribute("aria-label")?.trim() ||
      anchor.innerText?.trim() ||
      anchor.textContent?.trim() ||
      "";
    if (!title) continue;
    seen.add(ref.id);
    entries.push({ ...ref, title, href: anchor.href, row, menuButton });
  }
  return entries;
}

function getCopy() {
  return getBulkDeleteCopy(activeState?.language ?? "en");
}

function makeButton(
  label: string,
  tone: "neutral" | "destructive" | "accent",
  onClick: () => void,
  disabled = false,
): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = label;
  button.disabled = disabled;
  button.dataset.tone = tone;
  button.addEventListener("click", onClick);
  return button;
}

function makeStatusIcon(completed: boolean): SVGSVGElement {
  const icon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  icon.setAttribute("viewBox", "0 0 72 72");
  icon.setAttribute("aria-hidden", "true");
  icon.classList.add("status-icon", completed ? "is-complete" : "is-scanning");
  // Face ID-style framing resolves to a drawn check only after the batch succeeds.
  icon.innerHTML = `
    <g fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
      <circle class="scan-spinner" cx="36" cy="36" r="24" pathLength="1"/>
      <circle class="success-ring" cx="36" cy="36" r="26" pathLength="1"/>
      <path class="success-check" d="m23 36 9 9 18-19" pathLength="1"/>
    </g>`;
  return icon;
}

function renderToolbar(): void {
  if (!activeState) return;
  const shadow = activeState.host.shadowRoot;
  if (!shadow) return;
  const copy = getCopy();
  const { phase } = activeState;
  // Progress updates must not restart the scanning animation for every chat.
  if (phase === "deleting" && activeState.host.dataset.phase === phase) {
    const status = shadow.querySelector<HTMLElement>(".status");
    if (status) status.textContent = activeState.status;
    return;
  }
  activeState.host.dataset.phase = phase;
  shadow.replaceChildren();

  const style = document.createElement("style");
  style.textContent = `
    :host { all: initial; }
    * { box-sizing: border-box; }
    section { --text:#202124; --muted:#63666b; --surface:rgba(255,255,255,.96); --border:rgba(60,60,67,.18); --button:rgba(60,60,67,.07); --accent:#007aff; --success:#168844; width:320px; max-width:calc(100vw - 24px); color:var(--text); background:var(--surface); border:1px solid var(--border); border-radius:16px; box-shadow:0 8px 32px rgba(0,0,0,.16); padding:16px; font:13px/1.45 system-ui,sans-serif; backdrop-filter:blur(20px); }
    h2 { margin:0; font:650 14px/1.35 system-ui,sans-serif; letter-spacing:-.01em; }
    p { margin:6px 0 0; color:var(--muted); }
    .status { margin-top:10px; color:var(--muted); overflow-wrap:anywhere; }
    .status:empty { display:none; }
    .actions { display:flex; gap:8px; margin-top:16px; }
    button { appearance:none; flex:1; min-width:0; min-height:36px; padding:8px 10px; border:1px solid var(--border); border-radius:9px; background:var(--button); color:var(--text); font:600 12px/1.3 system-ui,sans-serif; cursor:pointer; transition:background-color 120ms,transform 120ms,opacity 120ms; }
    button[data-tone="destructive"] { background:#b42318; border-color:transparent; color:#fff; }
    button[data-tone="accent"] { background:var(--accent); border-color:transparent; color:#fff; }
    button:disabled { opacity:.45; cursor:not-allowed; }
    button:active:not(:disabled) { transform:scale(.97); }
    button:focus-visible { outline:2px solid var(--accent); outline-offset:3px; }
    section[data-phase="deleting"],section[data-phase="completed"] { text-align:center; padding-top:20px; }
    section[data-phase="completed"] h2 { font-size:18px; }
    .status-icon { display:block; width:72px; height:72px; margin:0 auto 12px; color:var(--accent); }
    .status-icon .scan-spinner { fill:none; stroke-dasharray:.22 .78; transform-origin:36px 36px; animation:spin 900ms linear infinite; }
    .status-icon .success-ring,.status-icon .success-check { opacity:0; }
    .is-scanning .scan-spinner { opacity:.9; }
    .is-complete { animation:success-color 600ms ease-out both; }
    .is-complete .scan-spinner { animation:spinner-out 220ms ease-out both; }
    .is-complete .success-ring { animation:ring-in 350ms 120ms ease-out both; }
    .is-complete .success-check { stroke-dasharray:1; animation:check-in 350ms 260ms cubic-bezier(.22,1,.36,1) both; }
    @keyframes spin { to { transform:rotate(360deg); } }
    @keyframes success-color { from { color:var(--accent); } to { color:var(--success); } }
    @keyframes spinner-out { from { opacity:.9; } to { opacity:0; } }
    @keyframes ring-in { from { opacity:0; } to { opacity:1; } }
    @keyframes check-in { from { opacity:1; stroke-dashoffset:1; } to { opacity:1; stroke-dashoffset:0; } }
    @media (prefers-color-scheme:dark) { section { --text:#f2f2f7; --muted:#b3b3ba; --surface:rgba(32,33,36,.97); --border:rgba(255,255,255,.16); --button:rgba(255,255,255,.08); --accent:#0a84ff; --success:#32d583; } }
    @media (prefers-reduced-motion:reduce) { *,*::before,*::after { animation:none !important; transition:none !important; } .is-complete { color:var(--success); } .is-complete .scan-spinner { opacity:0; } .is-complete .success-ring,.is-complete .success-check { opacity:1; stroke-dashoffset:0; } }
    @media (prefers-reduced-transparency:reduce) { section { backdrop-filter:none; background:var(--surface); } }
    @media (prefers-contrast:more) { section { --border:currentColor; --muted:var(--text); } button:disabled { opacity:.65; } }
  `;
  shadow.append(style);

  const section = document.createElement("section");
  section.setAttribute("role", "region");
  section.setAttribute("aria-label", copy.toolbarTitle(activeState.providerName));
  section.dataset.phase = phase;
  if (phase !== "selecting") section.append(makeStatusIcon(phase === "completed"));
  const heading = document.createElement("h2");
  heading.textContent = phase === "completed"
    ? copy.completedTitle
    : phase === "deleting" ? copy.deletingTitle : copy.toolbarTitle(activeState.providerName);
  section.append(heading);

  if (phase !== "deleting") {
    const detail = document.createElement("p");
    detail.textContent = phase === "completed"
      ? copy.success(activeState.deletedCount)
      : copy.selectionCount(activeState.selected.size, MAX_BULK_DELETE_SELECTION);
    if (phase === "completed") {
      detail.setAttribute("role", "status");
      detail.setAttribute("aria-live", "polite");
    }
    section.append(detail);
  }

  const status = document.createElement("div");
  status.className = "status";
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  status.textContent = activeState.status;
  section.append(status);

  const actions = document.createElement("div");
  actions.className = "actions";
  if (phase === "completed") {
    actions.append(
      makeButton(copy.continueDeleting, "neutral", continueBulkDeleteMode),
      makeButton(copy.done, "accent", stopBulkDeleteMode),
    );
  } else if (phase === "selecting") {
    actions.append(
      makeButton(copy.exit, "neutral", stopBulkDeleteMode),
      makeButton(copy.deleteSelected(activeState.selected.size), "destructive",
        () => void deleteSelectedConversations(), activeState.selected.size === 0),
    );
  }
  if (actions.childElementCount) section.append(actions);
  shadow.append(section);
}

function addCheckbox(entry: ConversationEntry): void {
  if (!activeState || activeState.phase !== "selecting") return;
  const existing = entry.row.querySelector<HTMLInputElement>(`[${CHECKBOX_ATTRIBUTE}] input`);
  if (existing) {
    existing.checked = activeState.selected.has(entry.id);
    existing.disabled = false;
    return;
  }
  const anchor = entry.row.querySelector<HTMLAnchorElement>("a[href]");
  if (anchor) {
    anchor.dataset.threadlineBulkOriginalPaddingLeft = anchor.style.paddingLeft;
    const currentPadding = Number.parseFloat(getComputedStyle(anchor).paddingLeft) || 0;
    anchor.style.paddingLeft = `${currentPadding + 26}px`;
  }
  const rowPosition = getComputedStyle(entry.row).position;
  if (rowPosition === "static") {
    entry.row.dataset.threadlineBulkOriginalPosition = entry.row.style.position;
    entry.row.style.position = "relative";
  }

  const label = document.createElement("label");
  label.setAttribute(CHECKBOX_ATTRIBUTE, "true");
  label.setAttribute("aria-label", `Select ${entry.title}`);
  label.title = `Select ${entry.title}`;
  label.style.cssText = "position:absolute;left:2px;top:50%;z-index:2147483000;display:flex;width:24px;height:24px;align-items:center;justify-content:center;transform:translateY(-50%);cursor:pointer;";
  label.addEventListener("click", (event) => event.stopPropagation());
  label.addEventListener("pointerdown", (event) => event.stopPropagation());

  const input = document.createElement("input");
  input.type = "checkbox";
  input.checked = activeState.selected.has(entry.id);
  input.setAttribute("aria-label", `Select ${entry.title}`);
  input.addEventListener("click", (event) => event.stopPropagation());
  input.addEventListener("change", () => {
    if (!activeState || activeState.phase !== "selecting") return;
    if (input.checked) {
      if (activeState.selected.size >= MAX_BULK_DELETE_SELECTION) {
        input.checked = false;
        activeState.status = getCopy().maxReached(MAX_BULK_DELETE_SELECTION);
      } else {
        activeState.selected.set(entry.id, entry);
        activeState.status = "";
      }
    } else {
      activeState.selected.delete(entry.id);
      activeState.status = "";
    }
    renderToolbar();
  });
  const check = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  check.setAttribute("viewBox", "0 0 16 16");
  check.setAttribute("aria-hidden", "true");
  check.innerHTML = '<path d="m4 8 2.5 2.5L12 5" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>';
  label.append(input, check);
  entry.row.append(label);
}

function installCheckboxStyles(): void {
  if (document.getElementById(CHECKBOX_STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = CHECKBOX_STYLE_ID;
  const control = `label[${CHECKBOX_ATTRIBUTE}]`;
  style.textContent = `
    ${control} > input { appearance:none; -webkit-appearance:none; box-sizing:border-box; display:block; flex:none; width:16px; height:16px; margin:0; padding:0; border:1px solid #8e8e93; border-radius:4px; background:transparent; box-shadow:none; cursor:pointer; transition:background-color 120ms,border-color 120ms; }
    ${control} > input:checked { background:#007aff; border-color:#007aff; }
    ${control} > input:focus-visible { outline:2px solid #007aff; outline-offset:2px; }
    ${control} > input:disabled { opacity:.5; cursor:wait; }
    ${control} > svg { position:absolute; width:16px; height:16px; color:#fff; opacity:0; pointer-events:none; }
    ${control} > input:checked + svg { opacity:1; }
    ${control} > input:disabled + svg { opacity:.5; }
    @media (prefers-reduced-motion:reduce) { ${control} > input { transition:none; } }
    @media (forced-colors:active) { ${control} > input { appearance:auto; } ${control} > svg { display:none; } }
  `;
  document.head.append(style);
}

function removeCheckbox(checkbox: HTMLElement): void {
  const row = checkbox.parentElement;
  checkbox.remove();
  const anchor = row?.querySelector<HTMLAnchorElement>("a[href]");
  if (anchor?.dataset.threadlineBulkOriginalPaddingLeft !== undefined) {
    anchor.style.paddingLeft = anchor.dataset.threadlineBulkOriginalPaddingLeft;
    delete anchor.dataset.threadlineBulkOriginalPaddingLeft;
  }
  if (row?.dataset.threadlineBulkOriginalPosition !== undefined) {
    row.style.position = row.dataset.threadlineBulkOriginalPosition;
    delete row.dataset.threadlineBulkOriginalPosition;
  }
}

function refreshCheckboxes(): void {
  if (!activeState || activeState.phase !== "selecting") return;
  const entries = getConversationEntries();
  const liveRows = new Set(entries.map((entry) => entry.row));
  for (const checkbox of Array.from(document.querySelectorAll<HTMLElement>(`[${CHECKBOX_ATTRIBUTE}]`))) {
    const row = checkbox.parentElement;
    if (!row || !liveRows.has(row)) removeCheckbox(checkbox);
  }
  entries.forEach(addCheckbox);
}

function startBulkDeleteMode(language: string): { success: boolean; error?: string } {
  if (activeState) {
    activeState.language = language;
    refreshCheckboxes();
    renderToolbar();
    return { success: true };
  }
  const entries = getConversationEntries();
  if (entries.length === 0) return { success: false, error: getBulkDeleteCopy(language).noChats };

  const providerName = entries[0].providerName;
  const host = document.createElement("div");
  host.id = ROOT_ID;
  host.style.cssText = "position:fixed;left:50%;top:16px;transform:translateX(-50%);z-index:2147483647;";
  host.attachShadow({ mode: "open" });
  document.body.append(host);

  const observer = new MutationObserver(() => refreshCheckboxes());
  activeState = {
    language,
    providerName,
    selected: new Map(),
    host,
    observer,
    phase: "selecting",
    deletedCount: 0,
    status: "",
  };
  installCheckboxStyles();
  observer.observe(document.body, { childList: true, subtree: true });
  refreshCheckboxes();
  renderToolbar();
  return { success: true };
}

function continueBulkDeleteMode(): void {
  if (!activeState || activeState.phase !== "completed") return;
  activeState.phase = "selecting";
  activeState.selected.clear();
  activeState.deletedCount = 0;
  activeState.status = getConversationEntries().length ? "" : getCopy().noChats;
  refreshCheckboxes();
  renderToolbar();
}

function removeAllCheckboxes(): void {
  for (const checkbox of Array.from(document.querySelectorAll<HTMLElement>(`[${CHECKBOX_ATTRIBUTE}]`))) {
    removeCheckbox(checkbox);
  }
}

function stopBulkDeleteMode(): void {
  if (!activeState) return;
  if (activeState.phase === "deleting") return;
  activeState.observer.disconnect();
  removeAllCheckboxes();
  document.getElementById(CHECKBOX_STYLE_ID)?.remove();
  activeState.host.remove();
  activeState = null;
}

function getVisibleDeleteAction(container: ParentNode): HTMLElement | null {
  return (
    Array.from(
      container.querySelectorAll<HTMLElement>(
        '[role="menuitem"], button, [role="button"], [mat-menu-item]',
      ),
    ).find((element) => {
      const label = `${element.getAttribute("aria-label") ?? ""} ${element.getAttribute("title") ?? ""} ${element.innerText ?? ""} ${element.textContent ?? ""}`.trim();
      return isVisible(element) && DELETE_LABEL.test(label);
    }) ?? null
  );
}

function findVisibleMenuDeleteAction(): HTMLElement | null {
  const menus = Array.from(
    document.querySelectorAll<HTMLElement>(
      '[role="menu"], [role="listbox"], [data-radix-menu-content], mat-menu-panel',
    ),
  ).filter(isVisible);
  for (const menu of menus) {
    const action = getVisibleDeleteAction(menu);
    if (action) return action;
  }
  return null;
}

function findVisibleDeleteDialog(): HTMLElement | null {
  const dialogs = Array.from(
    document.querySelectorAll<HTMLElement>(
      '[role="dialog"], [role="alertdialog"], mat-dialog-container',
    ),
  );
  return (
    dialogs.find(
      (dialog) =>
        !dialog.closest("#ai-memory-float-root") &&
        isVisible(dialog) &&
        getVisibleDeleteAction(dialog) !== null,
    ) ?? null
  );
}

function waitFor<T>(read: () => T | null, timeoutMs: number): Promise<T | null> {
  return new Promise((resolve) => {
    const startedAt = Date.now();
    const check = () => {
      const value = read();
      if (value !== null) {
        resolve(value);
        return;
      }
      if (Date.now() - startedAt >= timeoutMs) {
        resolve(null);
        return;
      }
      window.setTimeout(check, 80);
    };
    check();
  });
}

function isRenderedInDocument(element: HTMLElement): boolean {
  let current: HTMLElement | null = element;
  while (current) {
    if (current.hidden || current.getAttribute("aria-hidden") === "true") return false;
    const style = getComputedStyle(current);
    if (style.display === "none" || style.visibility === "hidden") return false;
    current = current.parentElement;
  }
  return true;
}

export function conversationStillExists(id: string): boolean {
  return Array.from(document.querySelectorAll<HTMLAnchorElement>("a[href]")).some(
    (anchor) =>
      parseProviderConversationRef(anchor.href)?.id === id &&
      isRenderedInDocument(anchor),
  );
}

async function clearLocalMemory(sessionId: string): Promise<boolean> {
  return new Promise((resolve) => {
    try {
      chrome.runtime.sendMessage(
        { type: "DELETE_MEMORY_SESSION", payload: { sessionId } },
        (response) => {
          resolve(!chrome.runtime.lastError && response?.payload?.success === true);
        },
      );
    } catch {
      resolve(false);
    }
  });
}

async function deleteOneConversation(entry: ConversationEntry): Promise<boolean> {
  entry.menuButton.click();
  const menuAction = await waitFor(findVisibleMenuDeleteAction, 5000);
  if (!menuAction) return false;

  menuAction.click();
  const nextStep = await waitFor(
    () => {
      const dialog = findVisibleDeleteDialog();
      if (dialog) return { kind: "dialog" as const, dialog };
      if (!conversationStillExists(entry.id)) return { kind: "removed" as const };
      return null;
    },
    7000,
  );
  if (!nextStep) return false;
  if (nextStep.kind === "dialog") {
    const confirmButton = getVisibleDeleteAction(nextStep.dialog);
    if (!confirmButton) return false;
    confirmButton.click();
  }

  const removed = await waitFor(
    () => (!conversationStillExists(entry.id) ? true : null),
    15000,
  );
  return removed === true;
}

async function deleteSelectedConversations(): Promise<void> {
  if (!activeState || activeState.phase !== "selecting" || activeState.selected.size === 0) return;
  const selected = Array.from(activeState.selected.values());
  if (selected.length > MAX_BULK_DELETE_SELECTION) return;
  activeState.phase = "deleting";
  activeState.status = "";
  removeAllCheckboxes();
  renderToolbar();

  let deleted = 0;
  const cleanupWarnings: string[] = [];
  for (const [index, entry] of selected.entries()) {
    if (!activeState) return;
    activeState.status = getCopy().progress(index + 1, selected.length, entry.title);
    renderToolbar();
    const currentEntry = getConversationEntries().find((candidate) => candidate.id === entry.id);
    const target = currentEntry ?? entry;
    const removed = await deleteOneConversation(target);
    if (!removed) {
      activeState.phase = "selecting";
      activeState.status = getCopy().failed(entry.title, deleted);
      refreshCheckboxes();
      renderToolbar();
      return;
    }

    deleted += 1;
    activeState.selected.delete(entry.id);
    const localCleared = await clearLocalMemory(entry.sessionId);
    if (!localCleared) cleanupWarnings.push(entry.title);
    activeState.status = "";
    renderToolbar();
  }

  if (activeState) {
    activeState.phase = "completed";
    activeState.deletedCount = deleted;
    activeState.selected.clear();
    activeState.status = cleanupWarnings.length
      ? getCopy().localCleanupFailed(cleanupWarnings.join(", "))
      : "";
    renderToolbar();
  }
}

export function initBulkDeleteModeListener(): void {
  safeRuntimeOnMessage((message, _sender, sendResponse) => {
    if (message?.type !== "BEGIN_BULK_DELETE_MODE") return false;
    const result = startBulkDeleteMode(String(message.payload?.lang ?? "en"));
    sendResponse({
      type: "START_BULK_DELETE_MODE_RESPONSE",
      payload: result,
    });
    return false;
  });
}
