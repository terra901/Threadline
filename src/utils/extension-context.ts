type RuntimeMessageListener = (
  message: any,
  sender: chrome.runtime.MessageSender,
  sendResponse: (response?: unknown) => void,
) => boolean | void

type StorageChangeListener = (
  changes: Record<string, chrome.storage.StorageChange>,
  areaName: string,
) => void

type StorageGetKeys = string | string[] | Record<string, unknown> | null

export function isExtensionContextAvailable(): boolean {
  try {
    if (typeof chrome === 'undefined' || !chrome.runtime) return false
    void chrome.runtime.id
    return true
  } catch {
    return false
  }
}

export function safeRuntimeGetURL(path: string): string | null {
  try {
    if (!isExtensionContextAvailable()) return null
    return chrome.runtime.getURL(path)
  } catch {
    return null
  }
}

export function safeRuntimeSendMessage<T = unknown>(
  message: unknown,
  callback?: (response: T | undefined, error?: string) => void,
): boolean {
  try {
    if (!isExtensionContextAvailable()) return false
    chrome.runtime.sendMessage(message, (response: T | undefined) => {
      let error: string | undefined
      try {
        const lastError = chrome.runtime.lastError
        error = lastError
          ? lastError.message ?? 'Unknown runtime error'
          : undefined
      } catch {
        error = 'Extension context invalidated'
      }
      callback?.(response, error)
    })
    return true
  } catch {
    return false
  }
}

export function safeRuntimeOnMessage(
  listener: RuntimeMessageListener,
): () => void {
  try {
    if (!isExtensionContextAvailable()) return () => undefined
    chrome.runtime.onMessage.addListener(listener)
    return () => {
      try {
        chrome.runtime.onMessage.removeListener(listener)
      } catch {
        // Context was invalidated while this content script was alive.
      }
    }
  } catch {
    return () => undefined
  }
}

export function safeStorageLocalGet(
  keys: StorageGetKeys,
  callback: (items: Record<string, unknown>) => void,
): boolean {
  try {
    if (!isExtensionContextAvailable() || !chrome.storage?.local) return false
    chrome.storage.local.get(keys as never, (items) => {
      callback((items ?? {}) as Record<string, unknown>)
    })
    return true
  } catch {
    return false
  }
}

export function safeStorageLocalSet(
  items: Record<string, unknown>,
  callback?: () => void,
): boolean {
  try {
    if (!isExtensionContextAvailable() || !chrome.storage?.local) return false
    chrome.storage.local.set(items, () => callback?.())
    return true
  } catch {
    return false
  }
}

export function safeStorageLocalRemove(
  keys: string | string[],
  callback?: () => void,
): boolean {
  try {
    if (!isExtensionContextAvailable() || !chrome.storage?.local) return false
    chrome.storage.local.remove(keys, () => callback?.())
    return true
  } catch {
    return false
  }
}

export function safeStorageOnChanged(
  listener: StorageChangeListener,
): () => void {
  try {
    if (!isExtensionContextAvailable() || !chrome.storage?.onChanged) {
      return () => undefined
    }
    chrome.storage.onChanged.addListener(listener)
    return () => {
      try {
        chrome.storage.onChanged.removeListener(listener)
      } catch {
        // Context was invalidated while this content script was alive.
      }
    }
  } catch {
    return () => undefined
  }
}
