/**
 * Offscreen Document — Threadline Embedding Engine
 *
 * This page runs in a hidden browser context (chrome.offscreen.createDocument)
 * that has full DOM APIs, enabling Transformers.js (ONNX/WASM) to load and
 * run text embedding inference — something the MV3 Service Worker cannot do
 * because it lacks URL.createObjectURL and Worker support.
 *
 * Communication: Background SW → (chrome.runtime.sendMessage EMBED_TEXT) → here
 *                Here → (sendResponse) → Background SW callback
 */

import { embed, embedBatch } from '../background/embedding'

// Register listener at module level so it's ready before the first message arrives.
// Returns true to keep the message channel open for the async sendResponse call.
chrome.runtime.onMessage.addListener(
  (
    message: { type: string; payload?: { text?: string; texts?: string[] } },
    _sender,
    sendResponse
  ) => {
    if (message.type === 'EMBED_TEXT' && message.payload?.text) {
      embed(message.payload.text)
        .then((embedding) => {
          // Float32Array must be converted to a plain number[] for JSON serialization
          sendResponse({ success: true, embedding: Array.from(embedding) })
        })
        .catch((err) => {
          sendResponse({ success: false, error: String(err) })
        })
      return true // keep channel open for async response
    }

    if (message.type === 'EMBED_BATCH' && Array.isArray(message.payload?.texts)) {
      embedBatch(message.payload.texts)
        .then((results) => {
          const serialized = results.map((r) =>
            r.success
              ? { success: true as const, embedding: Array.from(r.embedding) }
              : { success: false as const, error: r.error }
          )
          sendResponse({ success: true, results: serialized })
        })
        .catch((err) => {
          sendResponse({ success: false, error: String(err) })
        })
      return true
    }
  }
)

// Plasmo requires a default export for tab pages.
// This page renders nothing — it exists purely as a compute host.
export default function OffscreenPage() {
  return null
}
