/**
 * Hybrid search over stored memory records.
 *
 * Algorithm:
 *   Route A — Vector search with Time-Decay:
 *     1. Embed the query via the offscreen document (ONNX/WASM).
 *     2. Load all non-deleted records that have a stored embedding.
 *     3. Score each record by dot product (cosine sim for L2-normalised vectors).
 *     4. Apply exponential time-decay: score *= exp(-λ * daysOld).
 *     5. Group by logical message (chunks share parentId), keep max score per group.
 *
 *   Route B — Keyword search (MiniSearch / BM25):
 *     6. Search in-memory MiniSearch index (rebuilt from Dexie on SW startup).
 *
 *   Fusion — Reciprocal Rank Fusion (RRF):
 *     7. Convert both ranked lists to RRF scores (1 / (k + rank)), sum per group.
 *     8. Take top K groups, merge chunks, return SearchResults.
 *
 *   Hydration:
 *     Call hydrateSearchIndex() on Service Worker startup and after import.
 *     Call miniSearch.add(record) whenever a new record is saved to Dexie.
 */

import MiniSearch from 'minisearch'
import type { MemoryRecord } from '../types/memory'
import { db } from './db'
import type { SearchMemoriesRequest, SearchMemoriesResponse, SearchResult } from '../types/messages'

// ─── MiniSearch Setup ─────────────────────────────────────────────────────────

export const miniSearch = new MiniSearch<MemoryRecord>({
  idField: 'id',
  fields: ['content'],          // fields to index for full-text search
  storeFields: ['id', 'createdAt'], // fields to return in results
})

/**
 * Rebuild the MiniSearch keyword index from Dexie.
 * Must be called on Service Worker startup (SW memory is wiped on sleep/wake).
 * Also call after a bulk import so the index reflects imported records.
 */
export async function hydrateSearchIndex(): Promise<void> {
  try {
    const all = await db.memories.filter((r) => !r.isDeleted).toArray()
    miniSearch.removeAll()
    if (all.length > 0) {
      miniSearch.addAll(all)
    }
  } catch (err) {
    console.warn('[Threadline] MiniSearch hydration failed:', err)
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function dotProduct(a: Float32Array, b: Float32Array): number {
  let sum = 0
  for (let i = 0; i < a.length; i++) sum += a[i] * b[i]
  return sum
}

/** Group key: standalone record = record.id, chunk = record.parentId */
function groupKey(r: MemoryRecord): string {
  return r.parentId ?? r.id
}

/** Build one SearchResult from a logical message (single record or merged chunks). */
function toSearchResult(records: MemoryRecord[], similarityScore: number): SearchResult {
  const first = records[0]!
  if (records.length === 1) {
    return {
      id: first.id,
      role: first.role,
      content: first.content,
      sessionId: first.sessionId,
      provider: first.provider,
      timestamp: first.timestamp,
      createdAt: first.createdAt,
      similarityScore,
    }
  }
  // Merge chunks in chunkIndex order
  const sorted = [...records].sort((a, b) => (a.chunkIndex ?? 0) - (b.chunkIndex ?? 0))
  return {
    id: first.parentId ?? first.id,
    role: first.role,
    content: sorted.map((r) => r.content).join(''),
    sessionId: first.sessionId,
    provider: first.provider,
    timestamp: first.timestamp,
    createdAt: first.createdAt,
    parentId: first.parentId,
    chunkIndex: undefined,
    similarityScore,
  }
}

// ─── Core Handler ─────────────────────────────────────────────────────────────

// Time-decay constant: λ = 0.01 → half-life ≈ 69 days
const LAMBDA = 0.01
const MS_PER_DAY = 1000 * 60 * 60 * 24

// RRF smoothing constant (standard value)
const RRF_K = 60

// Minimum threshold for vector search (scores below this are treated as irrelevant noise)
const VECTOR_THRESHOLD = 0.25 

// Limit the number of candidates entering RRF fusion from each route to avoid noise dilution
const POOL_SIZE = 50

export async function handleSearchMemories(
  message: SearchMemoriesRequest,
  embedViaOffscreen: (text: string) => Promise<Float32Array>
): Promise<SearchMemoriesResponse> {
  const { query, topK = 5 } = message.payload

  // ── Load all candidate records once ────────────────────────────────────────
  const all = await db.memories.filter((r) => !r.isDeleted).toArray()

  if (all.length === 0) {
    return {
      type: 'SEARCH_MEMORIES_RESPONSE',
      payload: { results: [], query, reason: 'EMPTY_MEMORY_DB' },
    }
  }

  // Build lookup maps used by both routes and the merge step
  const groupRecords = new Map<string, MemoryRecord[]>()
  for (const r of all) {
    const key = groupKey(r)
    const list = groupRecords.get(key) ?? []
    list.push(r)
    groupRecords.set(key, list)
  }

  // ── Route A: Vector + Time-Decay ───────────────────────────────────────────
  const vectorGroupScores = new Map<string, number>()
  const vectorRecords = all.filter((r) => !!r.embedding)

  let queryEmbedding: Float32Array | null = null
  if (vectorRecords.length > 0) {
    try {
      queryEmbedding = await embedViaOffscreen(query)
    } catch (err) {
      console.warn('[Threadline] Search: failed to embed query', err)
    }
  }

  if (queryEmbedding) {
    const now = Date.now()
    for (const r of vectorRecords) {
      const baseScore = dotProduct(queryEmbedding, r.embedding as Float32Array)
      
      // Reject low scores to prevent the negative score decay paradox
      if (baseScore < VECTOR_THRESHOLD) continue;
      
      const daysOld = (now - r.createdAt) / MS_PER_DAY
      const decayedScore = baseScore * Math.exp(-LAMBDA * daysOld)
      const key = groupKey(r)
      const best = vectorGroupScores.get(key)
      if (best === undefined || decayedScore > best) {
        vectorGroupScores.set(key, decayedScore)
      }
    }
  }

  // Sort vector results descending by decayed score
  const vectorRanked = [...vectorGroupScores.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, POOL_SIZE)
    .map(([key]) => key)


  // ── Route B: Keyword search (MiniSearch / BM25) ────────────────────────────
  // Removed prefix matching, added slight fuzziness, and enforce AND logic
  const kwHits = miniSearch.search(query, { 
    fuzzy: 0.2,
    combineWith: 'AND' 
  })

  // MiniSearch returns results already sorted by BM25 score desc.
  // Map to group keys (chunk records share parentId).
  const kwGroupSeen = new Set<string>()
  const kwRanked: string[] = []
  for (const hit of kwHits) {
    // hit.id is the record id; resolve to group key via the record lookup
    const records = groupRecords.get(hit.id as string)
    // hit.id may be a chunk id — find the group it belongs to
    const key = records
      ? hit.id as string
      : [...groupRecords.keys()].find((k) =>
          groupRecords.get(k)!.some((r) => r.id === (hit.id as string))
        )
    if (key && !kwGroupSeen.has(key)) {
      kwGroupSeen.add(key)
      kwRanked.push(key)
    }
  }

  // ── RRF Fusion ─────────────────────────────────────────────────────────────
  const rrfScores = new Map<string, number>()

  vectorRanked.forEach((key, idx) => {
    rrfScores.set(key, 1 / (RRF_K + idx + 1))
  })

  kwRanked.forEach((key, idx) => {
    const prev = rrfScores.get(key) ?? 0
    rrfScores.set(key, prev + 1 / (RRF_K + idx + 1))
  })

  // If both routes failed (no embedding AND no keyword hits), fall back gracefully
  if (rrfScores.size === 0) {
    return {
      type: 'SEARCH_MEMORIES_RESPONSE',
      payload: { results: [], query, reason: 'NO_MATCHES' },
    }
  }

  // ── Final ranking ──────────────────────────────────────────────────────────
  const topKeys = [...rrfScores.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, topK)
    .map(([key]) => key)

  const results: SearchResult[] = topKeys
    .filter((key) => groupRecords.has(key))
    .map((key) => toSearchResult(groupRecords.get(key)!, rrfScores.get(key)!))

  return { type: 'SEARCH_MEMORIES_RESPONSE', payload: { results, query } }
}
