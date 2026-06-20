import type { ExtensionMessage, ExtensionMessageResponse } from '../types/messages'
import { safeRuntimeSendMessage } from './extension-context'

/**
 * Type-safe wrapper around chrome.runtime.sendMessage.
 * Rejects if chrome.runtime.lastError is set after the call.
 */
export function sendMessage<R extends ExtensionMessageResponse>(
  message: ExtensionMessage
): Promise<R> {
  return new Promise((resolve, reject) => {
    const sent = safeRuntimeSendMessage<R>(message, (response, error) => {
      if (error) {
        reject(new Error(error))
        return
      }
      if (!response) {
        reject(new Error('No response from background script'))
        return
      }
      resolve(response)
    })
    if (!sent) reject(new Error('Extension context is unavailable'))
  })
}

/**
 * Send a message without waiting for a response.
 * Swallows any chrome.runtime.lastError silently (fire-and-forget).
 */
export function sendMessageFireAndForget(message: ExtensionMessage): void {
  safeRuntimeSendMessage(message)
}
