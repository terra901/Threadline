import {
  RECALL_BUTTON_STYLE,
  RECALL_INPUT_STYLE,
  RECALL_WRAPPER_STYLE,
} from "../contents/recall-styles";

const STORAGE_KEY = "recallTopK";

export interface RecallButtonOptions {
  buttonId: string;
  inputId: string;
  defaultTopK?: number;
  extraWrapperStyles?: Partial<CSSStyleDeclaration>;
  extraButtonStyles?: Partial<CSSStyleDeclaration>;
  onButtonClick: (btn: HTMLButtonElement, e: MouseEvent) => void;
  extraButtonListeners?: (btn: HTMLButtonElement) => void;
}

export function createRecallButton(opts: RecallButtonOptions): HTMLElement {
  const defaultTopK = opts.defaultTopK ?? 3;

  const wrapper = document.createElement("span");
  Object.assign(wrapper.style, RECALL_WRAPPER_STYLE, opts.extraWrapperStyles ?? {});

  const input = document.createElement("input");
  input.id = opts.inputId;
  input.type = "number";
  input.min = "1";
  input.max = "20";
  input.title = "Number of memories to recall";
  Object.assign(input.style, RECALL_INPUT_STYLE);

  // Hide number input spinners consistently across all sites.
  // Inline styles can't target pseudo-elements, so inject a <style> tag.
  const spinnerStyleId = `${opts.inputId}-spinner-style`;
  if (!document.getElementById(spinnerStyleId)) {
    const style = document.createElement("style");
    style.id = spinnerStyleId;
    style.textContent = `
      #${opts.inputId}::-webkit-inner-spin-button,
      #${opts.inputId}::-webkit-outer-spin-button { -webkit-appearance: none; margin: 0; }
      #${opts.inputId} { -moz-appearance: textfield; appearance: textfield; }
    `;
    document.head.appendChild(style);
  }

  chrome.storage.local.get([STORAGE_KEY], (res) => {
    input.value = String(res[STORAGE_KEY] ?? defaultTopK);
  });

  input.addEventListener("change", () => {
    const v = Math.max(
      1,
      Math.min(20, parseInt(input.value, 10) || defaultTopK),
    );
    input.value = String(v);
    chrome.storage.local.set({ [STORAGE_KEY]: v });
  });

  input.addEventListener("keydown", (e) => e.stopPropagation());
  input.addEventListener("mousedown", (e) => e.stopPropagation());
  input.addEventListener("click", (e) => {
    e.stopPropagation();
    input.focus();
  });

  const btn = document.createElement("button");
  btn.id = opts.buttonId;
  btn.textContent = "Recall";
  btn.title = "Recall past memories and inject as context";
  btn.type = "button";
  Object.assign(btn.style, RECALL_BUTTON_STYLE, opts.extraButtonStyles ?? {});

  btn.addEventListener("pointerenter", () => {
    if (!btn.disabled) btn.style.opacity = "1";
  });
  btn.addEventListener("pointerleave", () => {
    btn.style.opacity = "0.96";
  });

  btn.addEventListener("click", (e) => opts.onButtonClick(btn, e));

  opts.extraButtonListeners?.(btn);

  wrapper.appendChild(input);
  wrapper.appendChild(btn);
  return wrapper;
}
