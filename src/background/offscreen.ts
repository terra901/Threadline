import { MODEL_NAME, EMBEDDING_VERSION } from "../constants/embedding";
import { db } from "./db";
import type { MemoryRecord } from "../types/memory";

// ─── Offscreen Document Management ───────────────────────────────────────────
// Transformers.js (ONNX/WASM) requires DOM APIs not available in Service Workers.
// We create a hidden offscreen document that has full DOM access, then route
// embedding requests there via chrome.runtime.sendMessage.

export const OFFSCREEN_URL = chrome.runtime.getURL("tabs/offscreen.html");
let _creatingOffscreen = false;

// Texts longer than 2000 chars exceed all-MiniLM-L6-v2's 512-token context window.
// Truncate before embedding (MVP: simple character truncation).
export const MAX_EMBED_CHARS = 2000;

export async function ensureOffscreenDocument(): Promise<void> {
  // chrome.runtime.getContexts is available in Chrome 116+
  if (chrome.runtime.getContexts) {
    const contexts = await chrome.runtime.getContexts({
      contextTypes: ["OFFSCREEN_DOCUMENT" as chrome.runtime.ContextType],
      documentUrls: [OFFSCREEN_URL],
    });
    if (contexts.length > 0) return;
  }

  if (_creatingOffscreen) {
    // Wait for an in-progress creation to finish
    await new Promise<void>((resolve) => {
      const poll = setInterval(() => {
        if (!_creatingOffscreen) {
          clearInterval(poll);
          resolve();
        }
      }, 50);
    });
    return;
  }

  _creatingOffscreen = true;
  try {
    await chrome.offscreen.createDocument({
      url: OFFSCREEN_URL,
      reasons: [
        "BLOBS" as chrome.offscreen.Reason,
        "WORKERS" as chrome.offscreen.Reason,
      ],
      justification: "Run ONNX/WASM text embedding inference for Threadline",
    });
  } finally {
    _creatingOffscreen = false;
  }
}

export async function embedViaOffscreen(text: string): Promise<Float32Array> {
  await ensureOffscreenDocument();
  const truncated =
    text.length > MAX_EMBED_CHARS ? text.slice(0, MAX_EMBED_CHARS) : text;

  return new Promise<Float32Array>((resolve, reject) => {
    chrome.runtime.sendMessage(
      { type: "EMBED_TEXT", payload: { text: truncated } },
      (
        response:
          | { success: boolean; embedding?: number[]; error?: string }
          | undefined,
      ) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        if (response?.success && response.embedding) {
          resolve(new Float32Array(response.embedding));
        } else {
          reject(
            new Error(
              response?.error ?? "Embedding failed in offscreen document",
            ),
          );
        }
      },
    );
  });
}

export async function embedBatchViaOffscreen(
  texts: string[],
): Promise<Array<Float32Array | null>> {
  await ensureOffscreenDocument();
  const truncated = texts.map((t) =>
    t.length > MAX_EMBED_CHARS ? t.slice(0, MAX_EMBED_CHARS) : t,
  );
  return new Promise<Array<Float32Array | null>>((resolve, reject) => {
    chrome.runtime.sendMessage(
      { type: "EMBED_BATCH", payload: { texts: truncated } },
      (
        response:
          | {
              success: boolean;
              results?: Array<{
                success: boolean;
                embedding?: number[];
                error?: string;
              }>;
              error?: string;
            }
          | undefined,
      ) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        if (!response?.success || !response.results) {
          reject(new Error(response?.error ?? "EMBED_BATCH failed"));
          return;
        }
        resolve(
          response.results.map((r) =>
            r.success && r.embedding ? new Float32Array(r.embedding) : null,
          ),
        );
      },
    );
  });
}

// ─── Embedding Queue ──────────────────────────────────────────────────────────

const EMBED_RETRY_DELAYS_MS = [2000, 5000, 15000];

export function queueEmbedding(record: MemoryRecord, attempt = 0): void {
  embedViaOffscreen(record.content)
    .then((embedding) =>
      db.updateEmbedding(record.id, embedding, MODEL_NAME, EMBEDDING_VERSION),
    )
    .catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      const isConnectionError =
        msg.includes("Receiving end does not exist") ||
        msg.includes("Could not establish connection");

      // Retry transient connection errors (offscreen document not ready yet)
      if (isConnectionError && attempt < EMBED_RETRY_DELAYS_MS.length) {
        const delay = EMBED_RETRY_DELAYS_MS[attempt];
        setTimeout(() => queueEmbedding(record, attempt + 1), delay);
        return;
      }

      // Permanent failure — record stays at hasEmbedding: 0 for startup sweep
      console.warn("[Threadline] Embedding failed for record", record.id, err);
      void db.logError("EMBEDDING_FAILED", { recordId: record.id, error: msg });
    });
}
