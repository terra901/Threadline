import { db } from './db'
import { MODEL_NAME, EMBEDDING_VERSION } from './embedding'
import { embedBatchViaOffscreen } from './index'

let _isProcessing = false

// Increased from 50: fewer DB round-trips and fewer IPC messages per run.
// 100 records → 1 EMBED_BATCH call (was 50 records → 50 EMBED_TEXT calls).
const BATCH_SIZE = 100

export async function processPendingEmbeddings() {
  if (_isProcessing) return
  _isProcessing = true

  try {
    while (true) {
      const pendingRecords = await db.getPendingEmbeddings(BATCH_SIZE)
      if (pendingRecords.length === 0) break

      // Send all texts in one IPC call to the offscreen document.
      // The offscreen processes them serially (numThreads=1 constraint),
      // but we only pay one chrome.runtime.sendMessage round-trip per batch.
      let embeddings: Array<Float32Array | null>
      try {
        embeddings = await embedBatchViaOffscreen(pendingRecords.map((r) => r.content))
      } catch (err) {
        console.error('[Threadline] EMBED_BATCH failed for batch:', err)
        // Mark all records in this batch as failed to avoid infinite loop
        for (const record of pendingRecords) {
          await db.memories.update(record.id, { hasEmbedding: -1 })
        }
        continue
      }

      for (let i = 0; i < pendingRecords.length; i++) {
        const record = pendingRecords[i]
        const embedding = embeddings[i]
        if (embedding !== null) {
          try {
            await db.updateEmbedding(record.id, embedding, MODEL_NAME, EMBEDDING_VERSION)
          } catch (err) {
            console.error(`[Threadline] DB update failed (ID: ${record.id}):`, err)
            await db.memories.update(record.id, { hasEmbedding: -1 })
          }
        } else {
          console.error(`[Threadline] Embedding failed in offscreen (ID: ${record.id})`)
          await db.memories.update(record.id, { hasEmbedding: -1 })
        }
      }
      // No inter-batch delay: await points above already yield the event loop
    }
  } finally {
    _isProcessing = false
  }
}
