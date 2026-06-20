import Dexie, { type Table } from "dexie";
import type {
  ConversationTitle,
  ErrorLog,
  GraphMemoryRecord,
  MemoryRecord,
  MemorySessionSummary,
} from "../types/memory";
import { normalizeContent } from "./adapters/base";

export class MemoryDatabase extends Dexie {
  memories!: Table<MemoryRecord, string>;
  errors!: Table<ErrorLog, number>;
  conversations!: Table<ConversationTitle, string>;

  constructor() {
    super("AIMemoryDB");

    // v1: adds parentId index to support chunk → parent queries
    this.version(1).stores({
      memories:
        "id, sessionId, provider, timestamp, createdAt, parentId, hasEmbedding, [provider+sessionId], [provider+timestamp]",
      errors: "++id, timestamp",
      conversations: "sessionId, updatedAt",
    });

    this.version(2)
      .stores({
        memories:
          "id, sessionId, provider, role, timestamp, createdAt, parentId, hasEmbedding, turnIndex, source, [provider+sessionId], [provider+timestamp], [sessionId+timestamp]",
        errors: "++id, timestamp",
        conversations: "sessionId, updatedAt",
      })
      .upgrade(async (tx) => {
        const table = tx.table("memories") as Table<MemoryRecord, string>;
        await table.toCollection().modify((record) => {
          const metadata = record.metadata ?? {};
          const turnIndex = metadata["turnIndex"];
          const source = metadata["source"];
          const pageTitle = metadata["pageTitle"];
          const conversationTitle = metadata["conversationTitle"];
          const threadTitle = metadata["threadTitle"];
          const url = metadata["url"];

          if (typeof turnIndex === "number" && record.turnIndex === undefined) {
            record.turnIndex = turnIndex;
          }
          if (typeof source === "string" && !record.source) {
            record.source = source;
          }
          if (typeof url === "string" && !record.sourceUrl) {
            record.sourceUrl = url;
          }
          const title =
            typeof conversationTitle === "string"
              ? conversationTitle
              : typeof threadTitle === "string"
                ? threadTitle
                : typeof pageTitle === "string"
                  ? pageTitle
                  : undefined;
          if (title && !record.conversationTitle) {
            record.conversationTitle = title;
          }
          if (!record.originalMessageId) {
            record.originalMessageId = record.parentId ?? record.id;
          }
        });
      });

    this.version(3)
      .stores({
        memories:
          "id, sessionId, provider, role, timestamp, createdAt, parentId, hasEmbedding, turnIndex, source, roundIndex, branchIndex, branchId, pathId, [provider+sessionId], [provider+timestamp], [sessionId+timestamp], [sessionId+roundIndex], [sessionId+branchId]",
        errors: "++id, timestamp",
        conversations: "sessionId, updatedAt",
      })
      .upgrade(async (tx) => {
        const table = tx.table("memories") as Table<MemoryRecord, string>;
        await table.toCollection().modify((record) => {
          const metadata = record.metadata ?? {};
          const roundIndex = metadata["roundIndex"];
          const branchIndex = metadata["branchIndex"];
          const branchId = metadata["branchId"];
          const pathId = metadata["pathId"];
          const parentMessageId = metadata["parentMessageId"];

          if (record.roundIndex === undefined) {
            if (typeof roundIndex === "number") {
              record.roundIndex = roundIndex;
            }
          }
          if (record.branchIndex === undefined) {
            if (typeof branchIndex === "number") {
              record.branchIndex = branchIndex;
            }
          }
          const resolvedBranchIndex = record.branchIndex;
          const resolvedRoundIndex = record.roundIndex;
          if (typeof branchId === "string" && !record.branchId) {
            record.branchId = branchId;
          } else if (
            !record.branchId &&
            resolvedRoundIndex !== undefined &&
            resolvedBranchIndex !== undefined
          ) {
            record.branchId = `${record.sessionId}:r${resolvedRoundIndex}:b${resolvedBranchIndex}`;
          }
          if (typeof pathId === "string" && !record.pathId) {
            record.pathId = pathId;
          } else if (
            !record.pathId &&
            resolvedRoundIndex !== undefined &&
            resolvedBranchIndex !== undefined
          ) {
            record.pathId =
              resolvedBranchIndex === 0
                ? `${record.sessionId}:main`
                : `${record.sessionId}:r${resolvedRoundIndex}:b${resolvedBranchIndex}`;
          }
          if (typeof parentMessageId === "string" && !record.parentMessageId) {
            record.parentMessageId = parentMessageId;
          }
        });
      });
  }

  // ─── Memory Record DAO ──────────────────────────────────────────────────────

  async addRecord(record: MemoryRecord): Promise<string> {
    const recordToSave = {
      ...record,
      hasEmbedding: record.embedding && record.embedding.length > 0 ? 1 : 0,
    };
    return (await this.memories.add(recordToSave as MemoryRecord)) as string;
  }

  async updateEmbedding(
    id: string,
    embedding: Float32Array,
    model: string,
    version: string,
  ): Promise<void> {
    await this.memories.update(id, {
      embedding,
      embeddingModel: model,
      embeddingVersion: version,
      hasEmbedding: 1,
    });
  }

  async getPendingEmbeddings(limit = 50): Promise<MemoryRecord[]> {
    return this.memories
      .where("hasEmbedding")
      .equals(0)
      .filter((r) => !r.isDeleted)
      .limit(limit)
      .toArray();
  }

  /** Hard-delete all memory records and conversation titles from the DB. */
  async clearAllMemories(): Promise<void> {
    await this.memories.clear();
    await this.conversations.clear();
  }

  /** Soft-delete all records for a single session and remove its title. */
  async deleteSession(sessionId: string): Promise<number> {
    const records = await this.memories.where("sessionId").equals(sessionId).toArray();
    const ids = records.map((record) => record.id);
    if (ids.length > 0) {
      await Promise.all(ids.map((id) => this.memories.update(id, { isDeleted: true })));
    }
    await this.conversations.delete(sessionId);
    return ids.length;
  }

  /** Returns the most recent non-deleted records by createdAt (desc). */
  async getRecent(limit = 10): Promise<MemoryRecord[]> {
    return this.memories
      .orderBy("createdAt")
      .reverse()
      .limit(Math.max(limit * 3, 50))
      .toArray()
      .then((records) => records.filter((r) => !r.isDeleted).slice(0, limit));
  }

  async countTotal(): Promise<number> {
    return this.memories.filter((r) => !r.isDeleted).count();
  }

  async querySessions(filters?: {
    provider?: MemoryRecord["provider"];
    query?: string;
    limit?: number;
    offset?: number;
  }): Promise<{ sessions: MemorySessionSummary[]; total: number }> {
    const records = await this.getGraphBaseRecords(filters?.provider);
    const summaries = this.buildSessionSummaries(records);
    const titles = await this.getConversationTitles(summaries.map((s) => s.sessionId));
    const q = filters?.query?.trim().toLowerCase();

    const filtered = summaries
      .map((summary) => ({
        ...summary,
        title: titles.get(summary.sessionId) ?? summary.title,
      }))
      .filter((summary) => {
        if (!q) return true;
        return (
          summary.sessionId.toLowerCase().includes(q) ||
          summary.provider.toLowerCase().includes(q) ||
          (summary.title ?? "").toLowerCase().includes(q) ||
          summary.sources.some((s) => s.toLowerCase().includes(q)) ||
          summary.models.some((m) => m.toLowerCase().includes(q))
        );
      })
      .sort((a, b) => b.lastTimestamp - a.lastTimestamp);

    const offset = filters?.offset ?? 0;
    const limit = filters?.limit ?? 200;
    return {
      sessions: filtered.slice(offset, offset + limit),
      total: filtered.length,
    };
  }

  async getSessionGraph(
    sessionId: string,
  ): Promise<{ session?: MemorySessionSummary; records: GraphMemoryRecord[] }> {
    const raw = await this.memories
      .where("sessionId")
      .equals(sessionId)
      .filter((r) => !r.isDeleted)
      .toArray();
    const records = this.mergeGraphChunks(raw).sort(sortMemoryRecords);
    const titles = await this.getConversationTitles([sessionId]);
    const session = this.buildSessionSummaries(raw)[0];
    if (session) session.title = titles.get(session.sessionId) ?? session.title;
    return { session, records };
  }

  // ─── Error Log DAO ──────────────────────────────────────────────────────────

  async logError(
    message: string,
    context?: Record<string, unknown>,
  ): Promise<void> {
    try {
      await this.errors.add({ timestamp: Date.now(), message, context });
    } catch {
      // Never throw from error logging
      console.warn("[Threadline] Failed to log error to DB:", message);
    }
  }

  async getRecentErrors(limit = 20): Promise<ErrorLog[]> {
    return this.errors.orderBy("timestamp").reverse().limit(limit).toArray();
  }

  async clearErrors(): Promise<void> {
    await this.errors.clear();
  }

  // ─── Conversation Title DAO ────────────────────────────────────────────────────

  /** Upsert a conversation title (create or update). */
  async upsertConversationTitle(
    sessionId: string,
    title: string,
  ): Promise<void> {
    await this.conversations.put({
      sessionId,
      title: title.trim(),
      updatedAt: Date.now(),
    });
  }

  /** Get title for a specific sessionId. */
  async getConversationTitle(sessionId: string): Promise<string | undefined> {
    const conv = await this.conversations.get(sessionId);
    return conv?.title;
  }

  /** Get titles for multiple sessionIds. Returns a Map<sessionId, title>. */
  async getConversationTitles(
    sessionIds: string[],
  ): Promise<Map<string, string>> {
    const map = new Map<string, string>();
    if (sessionIds.length === 0) return map;

    const convs = await this.conversations.bulkGet(sessionIds);
    for (const conv of convs) {
      if (conv) {
        map.set(conv.sessionId, conv.title);
      }
    }
    return map;
  }

  /** Delete a conversation title. */
  async deleteConversationTitle(sessionId: string): Promise<void> {
    await this.conversations.delete(sessionId);
  }

  // ─── Chat History Deduplication ─────────────────────────────────────────────

  /** Returns true if any non-deleted record exists for the given sessionId. */
  async hasSessionRecords(sessionId: string): Promise<boolean> {
    const count = await this.memories
      .where("sessionId")
      .equals(sessionId)
      .filter((r) => !r.isDeleted)
      .count();
    return count > 0;
  }

  /**
   * Bulk existence check for chat_message UUIDs (from Claude conversation history).
   * Returns only the UUIDs NOT yet stored in the DB.
   */
  async filterNewChatMessageUuids(uuids: string[]): Promise<string[]> {
    if (uuids.length === 0) return [];
    const existing = await this.memories.bulkGet(uuids);
    const found = new Set<string>();
    existing.forEach((r, i) => {
      if (r) found.add(uuids[i]);
    });
    return uuids.filter((id) => !found.has(id));
  }

  // ─── DOM Sync Deduplication ─────────────────────────────────────────────────

  /**
   * Checks whether a DOM-sourced message (identified by its ChatGPT messageId)
   * is already stored in IndexedDB.
   *
   * We store DOM messages with id = `dom:${messageId}` so they are distinct
   * from network-captured records (which use UUIDs or provider IDs).
   * Chunk records use `dom:${messageId}-c0` etc., so we only check the parent key.
   */
  async hasMessageId(messageId: string): Promise<boolean> {
    const key = `dom:${messageId}`;
    // A single chunk also means the parent was stored — check both.
    const direct = await this.memories.get(key);
    if (direct) return true;
    const firstChunk = await this.memories.get(`${key}-c0`);
    return !!firstChunk;
  }

  /**
   * Bulk existence check — returns the subset of messageIds NOT yet in the DB.
   * More efficient than calling hasMessageId() in a loop when dealing with
   * potentially dozens of DOM messages on first page load.
   */
  async filterNewMessageIds(messageIds: string[]): Promise<string[]> {
    if (messageIds.length === 0) return [];
    const keys = messageIds.flatMap((mid) => [mid, `${mid}-c0`]);
    const existing = await this.memories.bulkGet(keys);
    const foundSet = new Set<string>();
    for (let i = 0; i < messageIds.length; i++) {
      // each messageId maps to indices [i*2, i*2+1] in the bulkGet result
      if (existing[i * 2] || existing[i * 2 + 1]) {
        foundSet.add(messageIds[i]);
      }
    }
    return messageIds.filter((mid) => !foundSet.has(mid));
  }

  /**
   * Backfills graph fields on DOM-sourced messages that were already saved.
   * This lets repeated DOM scans enrich older records after the user switches
   * ChatGPT/Gemini branch variants without duplicating message content.
   */
  async updateDomMessageGraphFields(
    messageId: string,
    fields: {
      turnIndex?: number;
      roundIndex?: number;
      branchIndex?: number;
      branchId?: string;
      pathId?: string;
      parentMessageId?: string;
      sourceUrl?: string;
      conversationTitle?: string;
      metadata?: Record<string, unknown>;
    },
  ): Promise<void> {
    const patch: Partial<MemoryRecord> = {};
    if (fields.turnIndex !== undefined) patch.turnIndex = fields.turnIndex;
    if (fields.roundIndex !== undefined) patch.roundIndex = fields.roundIndex;
    if (fields.branchIndex !== undefined) patch.branchIndex = fields.branchIndex;
    if (fields.branchId !== undefined) patch.branchId = fields.branchId;
    if (fields.pathId !== undefined) patch.pathId = fields.pathId;
    if (fields.parentMessageId !== undefined) patch.parentMessageId = fields.parentMessageId;
    if (fields.sourceUrl !== undefined) patch.sourceUrl = fields.sourceUrl;
    if (fields.conversationTitle !== undefined) patch.conversationTitle = fields.conversationTitle;

    const metadata = fields.metadata ?? {};
    const hasMetadata = Object.keys(metadata).length > 0;
    const hasPatch = Object.keys(patch).length > 0;
    if (!hasPatch && !hasMetadata) return;

    const direct = await this.memories.get(messageId);
    if (direct) {
      await this.memories.update(messageId, {
        ...patch,
        ...(hasMetadata ? { metadata: { ...(direct.metadata ?? {}), ...metadata } } : {}),
      });
    }

    await this.memories
      .where("parentId")
      .equals(messageId)
      .modify((record) => {
        Object.assign(record, patch);
        if (hasMetadata) record.metadata = { ...(record.metadata ?? {}), ...metadata };
      });
  }

  /**
   * Returns the set of content strings for all non-deleted records in a session.
   * Used by DOM sync to detect migration duplicates (XHR records have random UUIDs
   * that ID-based dedup cannot match against new DOM-derived stable IDs).
   */
  async getSessionContentSet(sessionId: string): Promise<Set<string>> {
    const records = await this.memories
      .where('sessionId')
      .equals(sessionId)
      .filter((r) => !r.isDeleted)
      .toArray()
    return new Set(records.map((r) => normalizeContent(r.content)))
  }

  private async getGraphBaseRecords(
    provider?: MemoryRecord["provider"],
  ): Promise<MemoryRecord[]> {
    const collection = provider
      ? this.memories.where("provider").equals(provider)
      : this.memories.toCollection();
    return collection.filter((r) => !r.isDeleted).toArray();
  }

  buildSessionSummaries(records: MemoryRecord[]): MemorySessionSummary[] {
    const groups = new Map<string, MemoryRecord[]>();
    for (const record of records) {
      const list = groups.get(record.sessionId) ?? [];
      list.push(record);
      groups.set(record.sessionId, list);
    }

    const summaries: MemorySessionSummary[] = [];
    for (const [sessionId, list] of groups.entries()) {
      const logical = this.mergeGraphChunks(list);
      if (logical.length === 0) continue;
      logical.sort(sortMemoryRecords);
      const first = logical[0];
      const timestamps = logical.map((r) => r.timestamp);
      const sources = new Set<string>();
      const models = new Set<string>();
      let hasEmbeddingCount = 0;
      let userCount = 0;
      let assistantCount = 0;

      for (const record of logical) {
        if (record.role === "user") userCount += 1;
        if (record.role === "assistant") assistantCount += 1;
        if (record.hasEmbedding || record.embeddingLength) hasEmbeddingCount += 1;
        const source = extractRecordSource(record);
        if (source) sources.add(source);
        if (record.model) models.add(record.model);
      }

      summaries.push({
        sessionId,
        provider: first.provider,
        title: logical.map((record) => extractRecordTitle(record)).find(Boolean),
        messageCount: logical.length,
        userCount,
        assistantCount,
        firstTimestamp: Math.min(...timestamps),
        lastTimestamp: Math.max(...timestamps),
        hasEmbeddingCount,
        sources: Array.from(sources).sort(),
        models: Array.from(models).sort(),
      });
    }
    return summaries;
  }

  mergeGraphChunks(records: MemoryRecord[]): GraphMemoryRecord[] {
    const parentGroups = new Map<string, MemoryRecord[]>();
    const standalones: MemoryRecord[] = [];

    for (const record of records) {
      if (record.parentId) {
        const list = parentGroups.get(record.parentId) ?? [];
        list.push(record);
        parentGroups.set(record.parentId, list);
      } else {
        standalones.push(record);
      }
    }

    const result: GraphMemoryRecord[] = [];
    for (const record of standalones) {
      result.push(toGraphRecord(record, [record.id]));
    }

    for (const [parentId, chunks] of parentGroups.entries()) {
      chunks.sort((a, b) => (a.chunkIndex ?? 0) - (b.chunkIndex ?? 0));
      const first = chunks[0];
      const timestamp = minTimelineValue(chunks.map((chunk) => chunk.timestamp));
      const createdAt = minTimelineValue(chunks.map((chunk) => chunk.createdAt));
      result.push(
        toGraphRecord(
          {
            ...first,
            id: parentId,
            content: chunks.map((chunk) => chunk.content).join(""),
            timestamp,
            createdAt,
            parentId: undefined,
            chunkIndex: undefined,
            hasEmbedding: chunks.some((chunk) => chunk.hasEmbedding) ? 1 : 0,
          },
          chunks.map((chunk) => chunk.id),
        ),
      );
    }

    return result;
  }
}

function extractRecordSource(record: MemoryRecord | GraphMemoryRecord): string | undefined {
  const metadataSource = record.metadata?.["source"];
  if (typeof record.source === "string" && record.source) return record.source;
  if (typeof metadataSource === "string" && metadataSource) return metadataSource;
  if (record.metadata?.["fromHistory"] === true) return "history";
  return undefined;
}

function extractRecordTitle(record: MemoryRecord | GraphMemoryRecord): string | undefined {
  const metadata = record.metadata ?? {};
  const title =
    record.conversationTitle ??
    metadata["conversationTitle"] ??
    metadata["threadTitle"] ??
    metadata["pageTitle"];
  return typeof title === "string" && title.trim() ? title.trim() : undefined;
}

function extractTurnIndex(record: MemoryRecord | GraphMemoryRecord): number {
  const metadataTurnIndex = record.metadata?.["turnIndex"];
  if (typeof record.turnIndex === "number") return record.turnIndex;
  if (typeof metadataTurnIndex === "number") return metadataTurnIndex;
  return Number.POSITIVE_INFINITY;
}

function extractRoundIndex(record: MemoryRecord | GraphMemoryRecord): number {
  const metadataRoundIndex = record.metadata?.["roundIndex"];
  if (typeof record.roundIndex === "number") return record.roundIndex;
  if (typeof metadataRoundIndex === "number") return metadataRoundIndex;
  return Number.POSITIVE_INFINITY;
}

function extractBranchIndex(record: MemoryRecord | GraphMemoryRecord): number {
  const metadataBranchIndex = record.metadata?.["branchIndex"];
  if (typeof record.branchIndex === "number") return record.branchIndex;
  if (typeof metadataBranchIndex === "number") return metadataBranchIndex;
  return Number.POSITIVE_INFINITY;
}

function isUsableTurnIndex(value: number): boolean {
  return Number.isFinite(value) && value >= 0;
}

function toTimelineMillis(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) return numeric;
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  if (value instanceof Date) {
    const time = value.getTime();
    if (Number.isFinite(time)) return time;
  }
  return Number.POSITIVE_INFINITY;
}

function minTimelineValue(values: unknown[]): number {
  const finite = values
    .map((value) => toTimelineMillis(value))
    .filter((value) => Number.isFinite(value));
  return finite.length > 0 ? Math.min(...finite) : Date.now();
}

function compareIfBothFinite(a: number, b: number): number {
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
  return a - b;
}

function sortMemoryRecords(a: MemoryRecord | GraphMemoryRecord, b: MemoryRecord | GraphMemoryRecord): number {
  const roundA = extractRoundIndex(a);
  const roundB = extractRoundIndex(b);
  const bothHaveRound = Number.isFinite(roundA) && Number.isFinite(roundB);
  const roundDelta = compareIfBothFinite(roundA, roundB);
  if (roundDelta !== 0) return roundDelta;

  const turnA = extractTurnIndex(a);
  const turnB = extractTurnIndex(b);
  const hasTurnA = isUsableTurnIndex(turnA);
  const hasTurnB = isUsableTurnIndex(turnB);

  if (bothHaveRound && (hasTurnA || hasTurnB)) {
    const dt = turnA - turnB;
    if (dt !== 0) return dt;
  }

  const branchDelta = compareIfBothFinite(extractBranchIndex(a), extractBranchIndex(b));
  if (branchDelta !== 0) return branchDelta;

  const timestampDelta = toTimelineMillis(a.timestamp) - toTimelineMillis(b.timestamp);
  if (timestampDelta !== 0) return timestampDelta;

  if (!bothHaveRound && (hasTurnA || hasTurnB)) {
    const dt = turnA - turnB;
    if (dt !== 0) return dt;
  }

  if (a.role !== b.role) return a.role === "user" ? -1 : 1;

  const createdAtDelta = a.createdAt - b.createdAt;
  if (createdAtDelta !== 0) return createdAtDelta;
  return a.id.localeCompare(b.id);
}

function toGraphRecord(record: MemoryRecord, chunkIds: string[]): GraphMemoryRecord {
  const { embedding, ...rest } = record;
  const metadata = rest.metadata ?? {};
  const turnIndex = rest.turnIndex ?? extractTurnIndex(record);
  const roundIndex = rest.roundIndex ?? extractRoundIndex(record);
  const branchIndex = rest.branchIndex ?? extractBranchIndex(record);
  return {
    ...rest,
    timestamp: toTimelineMillis(rest.timestamp),
    createdAt: toTimelineMillis(rest.createdAt),
    originalMessageId: rest.originalMessageId ?? record.parentId ?? record.id,
    source: rest.source ?? extractRecordSource(record),
    sourceUrl:
      rest.sourceUrl ??
      (typeof metadata["url"] === "string" ? metadata["url"] : undefined),
    conversationTitle: rest.conversationTitle ?? extractRecordTitle(record),
    turnIndex: isUsableTurnIndex(turnIndex) ? turnIndex : undefined,
    roundIndex: isUsableTurnIndex(roundIndex) ? roundIndex : undefined,
    branchIndex: isUsableTurnIndex(branchIndex) ? branchIndex : undefined,
    branchId:
      rest.branchId ??
      (typeof metadata["branchId"] === "string" ? metadata["branchId"] : undefined),
    pathId:
      rest.pathId ??
      (typeof metadata["pathId"] === "string" ? metadata["pathId"] : undefined),
    parentMessageId:
      rest.parentMessageId ??
      (typeof metadata["parentMessageId"] === "string"
        ? metadata["parentMessageId"]
        : undefined),
    chunkIds,
    chunkCount: chunkIds.length,
    isChunked: chunkIds.length > 1,
    embeddingLength: embedding?.length,
  };
}

// Singleton instance shared across background service worker
export const db = new MemoryDatabase();

// ─── Storage Quota Handling ───────────────────────────────────────────────────

let _captureEnabled = true;
let _quotaExceeded = false;

export function isCaptureEnabled(): boolean {
  return _captureEnabled;
}

export function isQuotaExceeded(): boolean {
  return _quotaExceeded;
}

/**
 * Wraps db.addRecord with quota exceeded detection.
 * On QuotaExceededError, disables capture and logs the event.
 */
export async function safeAddRecord(
  record: MemoryRecord,
): Promise<string | null> {
  if (!_captureEnabled) return null;

  try {
    return await db.addRecord(record);
  } catch (err) {
    const isQuota =
      err instanceof DOMException &&
      (err.name === "QuotaExceededError" ||
        err.name === "NS_ERROR_DOM_QUOTA_REACHED");

    if (isQuota) {
      _captureEnabled = false;
      _quotaExceeded = true;
      await db.logError("QUOTA_EXCEEDED", { recordId: record.id });
      console.warn("[Threadline] IndexedDB quota exceeded — capture disabled");
    } else {
      await db.logError("ADD_RECORD_FAILED", {
        recordId: record.id,
        error: String(err),
      });
    }
    return null;
  }
}

export const memoryDB = new MemoryDatabase();

// 只有在開發環境下，把 db 掛載到 globalThis (Service Worker 的全域)
if (process.env.NODE_ENV === "development") {
  (globalThis as any).aiDB = db;
}
