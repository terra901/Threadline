import type { MemoryRecord } from "../types/memory";

// paraphrase-multilingual-MiniLM-L12-v2 has a ~128-token context window.
// We split long content into overlapping character windows so each chunk fits
// comfortably. Overlap preserves cross-boundary context for better retrieval.

export const CHUNK_SIZE_CHARS = 500; // ~100-125 tokens for mixed Chinese/English
export const CHUNK_OVERLAP_CHARS = 75; // ~15% overlap to avoid cutting mid-sentence

export function chunkText(text: string): string[] {
  if (text.length <= CHUNK_SIZE_CHARS) return [text];

  const chunks: string[] = [];
  let i = 0;
  while (i < text.length) {
    chunks.push(text.slice(i, i + CHUNK_SIZE_CHARS));
    i += CHUNK_SIZE_CHARS - CHUNK_OVERLAP_CHARS;
  }
  return chunks;
}

/**
 * Expands a single MemoryRecord into one or more chunk records.
 * Short content (≤ CHUNK_SIZE_CHARS) is returned as-is (no extra fields).
 * Long content is split; each chunk gets a unique id, chunkIndex, and parentId.
 */
export function expandToChunks(record: MemoryRecord): MemoryRecord[] {
  const chunks = chunkText(record.content);
  if (chunks.length === 1) return [record];

  return chunks.map((content, i) => ({
    ...record,
    id: `${record.id}-c${i}`,
    content,
    chunkIndex: i,
    parentId: record.id,
  }));
}
