import { safeStorageLocalGet, safeStorageOnChanged } from "./extension-context";

export const RECALL_BUTTON_ENABLED_KEY = "recallButtonEnabled";

let _enabled = true;

export function isRecallButtonEnabled(): boolean {
  return _enabled;
}

export function initRecallVisibility(onChange?: (enabled: boolean) => void): void {
  safeStorageLocalGet([RECALL_BUTTON_ENABLED_KEY], (res) => {
    _enabled = res[RECALL_BUTTON_ENABLED_KEY] !== false;
    onChange?.(_enabled);
  });
  safeStorageOnChanged((changes) => {
    if (RECALL_BUTTON_ENABLED_KEY in changes) {
      _enabled = changes[RECALL_BUTTON_ENABLED_KEY].newValue !== false;
      onChange?.(_enabled);
    }
  });
}
