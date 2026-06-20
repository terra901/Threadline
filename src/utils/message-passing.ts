import type { ExtensionMessage, ExtensionMessageResponse } from '../types/messages'

/**
 * Type-safe wrapper around chrome.runtime.sendMessage.
 * Rejects if chrome.runtime.lastError is set after the call.
 */
export function sendMessage<R extends ExtensionMessageResponse>(
  message: ExtensionMessage
): Promise<R> {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response: R) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message ?? 'Unknown runtime error'))
        return
      }
      resolve(response)
    })
  })
}

/**
 * Send a message without waiting for a response.
 * Swallows any chrome.runtime.lastError silently (fire-and-forget).
 */
export function sendMessageFireAndForget(message: ExtensionMessage): void {
  chrome.runtime.sendMessage(message, () => {
    // Consume lastError to prevent unhandled error logging
    void chrome.runtime.lastError
  })
}
