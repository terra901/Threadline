/**
 * EmbeddingEngine
 *
 * Lazy-loads Xenova/all-MiniLM-L6-v2 via Transformers.js as a singleton.
 * All embedding requests are processed through a serialized task queue
 * to prevent concurrent WASM memory overflow in the Service Worker context.
 *
 * Returns a 384-dimensional Float32Array for each input text.
 */

import { pipeline, env, type FeatureExtractionPipeline } from '@xenova/transformers'

// Allow remote model download from Hugging Face CDN.
// Model files are fetched on first use and cached by the browser.
env.allowLocalModels = false
env.allowRemoteModels = true

// Force single-threaded WASM inference.
// Multi-threaded ONNX creates workers via blob: URLs, which Chrome extension
// CSP blocks ("script-src 'self' 'wasm-unsafe-eval'" does not allow blob:).
// numThreads=1 makes ONNX use the non-threaded wasm file with no workers.
env.backends.onnx.wasm.numThreads = 1

const MODEL_NAME = 'Xenova/paraphrase-multilingual-MiniLM-L12-v2'
const EMBEDDING_VERSION = '1.0.0'

// ─── Singleton Model ──────────────────────────────────────────────────────────

let _pipe: FeatureExtractionPipeline | null = null
let _loadPromise: Promise<FeatureExtractionPipeline> | null = null
let _modelFailed = false

async function getOrLoadPipeline(): Promise<FeatureExtractionPipeline> {
  if (_pipe) return _pipe
  if (_modelFailed) throw new Error('Model failed to load previously')

  if (!_loadPromise) {
    _loadPromise = pipeline('feature-extraction', MODEL_NAME, {
      quantized: true,
    }) as Promise<FeatureExtractionPipeline>
  }

  try {
    _pipe = await _loadPromise
    return _pipe
  } catch (err) {
    _modelFailed = true
    _loadPromise = null
    throw err
  }
}

// ─── Task Queue ───────────────────────────────────────────────────────────────

type EmbedTask = {
  text: string
  resolve: (embedding: Float32Array) => void
  reject: (err: unknown) => void
}

const _queue: EmbedTask[] = []
let _processing = false

async function processQueue(): Promise<void> {
  if (_processing || _queue.length === 0) return
  _processing = true

  while (_queue.length > 0) {
    const task = _queue.shift()!
    try {
      const pipe = await getOrLoadPipeline()
      const output = await pipe(task.text, { pooling: 'mean', normalize: true })
      const embedding = new Float32Array(output.data as ArrayBuffer | number[])
      task.resolve(embedding)
    } catch (err) {
      task.reject(err)
    }
  }

  _processing = false
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Enqueues a text embedding request. Returns a Promise that resolves with
 * a 384-dimensional Float32Array, or rejects if the model is unavailable.
 */
export function embed(text: string): Promise<Float32Array> {
  return new Promise<Float32Array>((resolve, reject) => {
    _queue.push({ text, resolve, reject })
    processQueue().catch(console.error)
  })
}

/**
 * Embeds multiple texts sequentially through the existing task queue.
 * Returns per-item results so callers can handle partial failures.
 * Runs one ONNX inference at a time (numThreads=1 constraint).
 */
export async function embedBatch(
  texts: string[]
): Promise<Array<{ success: true; embedding: Float32Array } | { success: false; error: string }>> {
  const results: Array<{ success: true; embedding: Float32Array } | { success: false; error: string }> = []
  for (const text of texts) {
    try {
      const embedding = await embed(text)
      results.push({ success: true, embedding })
    } catch (err) {
      results.push({ success: false, error: String(err) })
    }
  }
  return results
}

export { MODEL_NAME, EMBEDDING_VERSION }
