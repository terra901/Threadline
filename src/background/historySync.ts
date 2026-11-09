/**
 * History backfill persistence.
 *
 * Shared persistence helper used by:
 *   - ChatGPT backend-API history sync (full conversations, markdown source)
 *   - live CAPTURE_MESSAGE path (upsert partial → complete assistant replies)
 *
 * Dedup semantics:
 *   - id unknown            → add (chunked) + index + queue embedding
 *   - id exists, same text  → skip
 *   - id exists, new text   → update in place, replace stale chunks, drop the
 *     old embedding (hasEmbedding = 0) and re-queue embedding
 */

import type { MemoryRecord } from "../types/memory";
import { db, safeAddRecord } from "./db";
import { expandToChunks } from "./chunking";
import { queueEmbedding } from "./offscreen";
import { miniSearch } from "./search";

export type PersistResult = "added" | "updated" | "skipped";

function indexChunk(chunk: MemoryRecord): void {
  try {
    miniSearch.add(chunk);
  } catch {
    /* duplicate id — already indexed */
  }
}

/**
 * Persist one logical record (auto-chunked). Returns whether it was added,
 * updated (existing id, changed content) or skipped (existing id, same text).
 *
 * Long content is stored as chunk records ONLY (ids `<id>-c0`, `<id>-c1` …),
 * so "existing" must be checked against both the direct record and the chunk
 * records — otherwise content updates on long messages would silently fail.
 */
export async function persistRecordWithChunks(
  record: MemoryRecord,
): Promise<PersistResult> {
  const existing = await db.memories.get(record.id);
  const existingChunks = existing
    ? []
    : await db.memories.where("parentId").equals(record.id).toArray();
  const hasExisting = !!existing && !existing.isDeleted;
  const hasChunks = existingChunks.length > 0;

  if (!hasExisting && !hasChunks) {
    for (const chunk of expandToChunks(record)) {
      const id = await safeAddRecord(chunk);
      if (id) {
        indexChunk(chunk);
        queueEmbedding(chunk);
      }
    }
    return "added";
  }

  // Compare against the currently stored logical text.
  const storedLogical = hasExisting
    ? existing.content
    : [...existingChunks]
        .sort((a, b) => (a.chunkIndex ?? 0) - (b.chunkIndex ?? 0))
        .map((c) => c.content)
        .join("");
  if (storedLogical === record.content) return "skipped";

  // ── Content changed → replace in place ───────────────────────────────────
  const chunks = expandToChunks(record);
  const isLong = chunks.length > 1;

  // Drop stale chunk records and (for long content) any direct record, so the
  // graph never shows a duplicate of the merged chunks.
  const staleRecords =
    existingChunks.length > 0
      ? existingChunks
      : await db.memories.where("parentId").equals(record.id).toArray();
  await db.memories.where("parentId").equals(record.id).delete();
  if (isLong && hasExisting) {
    staleRecords.push(existing);
    await db.memories.delete(existing.id);
  }
  for (const stale of staleRecords) {
    try {
      miniSearch.remove(stale);
    } catch {
      /* not indexed */
    }
  }

  if (isLong) {
    // Long content: (re-)add the chunk records.
    for (const chunk of chunks) {
      const id = await safeAddRecord(chunk);
      if (id) {
        indexChunk(chunk);
        queueEmbedding(chunk);
      }
    }
    return "updated";
  }

  // Short content: single record under its own id.
  const patch: Partial<MemoryRecord> = {
    content: record.content,
    timestamp: record.timestamp,
    isPartial: record.isPartial ?? false,
    hasEmbedding: 0,
    embedding: undefined,
  };
  if (record.model) patch.model = record.model;
  if (record.conversationTitle) patch.conversationTitle = record.conversationTitle;
  if (hasExisting) {
    await db.memories.update(record.id, patch);
  } else {
    await db.memories.add({ ...record, hasEmbedding: 0 } as MemoryRecord);
  }
  try {
    miniSearch.remove({ ...record, hasEmbedding: 0 });
  } catch {
    /* not indexed */
  }
  indexChunk({ ...record, hasEmbedding: 0 });
  queueEmbedding({ ...record, hasEmbedding: 0 });
  return "updated";
}

/**
 * Persist a full parsed ChatGPT conversation (records already normalized by
 * parseChatGPTConversationDetail) and update its stored title.
 */
export async function persistChatGPTConversation(
  records: MemoryRecord[],
  title?: string,
): Promise<{ added: number; updated: number; skipped: number }> {
  let added = 0;
  let updated = 0;
  let skipped = 0;
  for (const record of records) {
    const result = await persistRecordWithChunks(record);
    if (result === "added") added += 1;
    else if (result === "updated") updated += 1;
    else skipped += 1;
  }
  const sessionId = records[0]?.sessionId;
  if (sessionId && title?.trim()) {
    void db.upsertConversationTitle(sessionId, title.trim());
  }
  return { added, updated, skipped };
}
