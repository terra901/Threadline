import {
  CAPTURE_MODE_STORAGE_KEY,
  DEFAULT_CAPTURE_MODE,
  PENDING_MEMORY_SESSIONS_STORAGE_KEY,
  type CaptureMode,
} from "../constants/capture";
import type {
  AIProvider,
  GraphMemoryRecord,
  MemoryRecord,
  MemorySessionSummary,
  PendingMemorySession,
} from "../types/memory";
import { db, safeAddRecord } from "./db";
import { expandToChunks } from "./chunking";
import { miniSearch } from "./search";
import { queueEmbedding } from "./offscreen";
import { isTransientAssistantMessage } from "../utils/transient-assistant";

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function isPendingSession(value: unknown): value is PendingMemorySession {
  if (!isRecord(value)) return false;
  const session = value["session"];
  const records = value["records"];
  return (
    isRecord(session) &&
    typeof session["sessionId"] === "string" &&
    Array.isArray(records)
  );
}

async function readPendingMap(): Promise<Record<string, PendingMemorySession>> {
  const stored = await chrome.storage.local.get([PENDING_MEMORY_SESSIONS_STORAGE_KEY]);
  const raw = stored[PENDING_MEMORY_SESSIONS_STORAGE_KEY];
  if (!isRecord(raw)) return {};
  const next: Record<string, PendingMemorySession> = {};
  for (const [sessionId, value] of Object.entries(raw)) {
    if (isPendingSession(value)) {
      next[sessionId] = value;
    }
  }
  return next;
}

async function writePendingMap(map: Record<string, PendingMemorySession>): Promise<void> {
  await chrome.storage.local.set({ [PENDING_MEMORY_SESSIONS_STORAGE_KEY]: map });
}

function toMemoryRecord(record: GraphMemoryRecord): MemoryRecord {
  const {
    chunkIds: _chunkIds,
    chunkCount: _chunkCount,
    isChunked: _isChunked,
    embeddingLength: _embeddingLength,
    persisted: _persisted,
    ...rest
  } = record;
  return {
    ...rest,
    isPartial: rest.isPartial ?? false,
    isDeleted: false,
    isSuperseded: rest.isSuperseded ?? false,
    metadata: {
      ...(rest.metadata ?? {}),
      captureMode: "manual",
      savedByUser: true,
    },
  };
}

function markPendingRecord(record: GraphMemoryRecord): GraphMemoryRecord {
  return {
    ...record,
    persisted: false,
    hasEmbedding: 0,
    embeddingLength: undefined,
  };
}

function normalizePendingSession(session: MemorySessionSummary): MemorySessionSummary & { persisted: false } {
  return {
    ...session,
    persisted: false,
    hasEmbeddingCount: 0,
  };
}

function isVisibleRecord(record: MemoryRecord | GraphMemoryRecord): boolean {
  return !isTransientAssistantMessage(record.role, record.content);
}

function normalizePendingItem(item: PendingMemorySession): PendingMemorySession {
  const records = item.records.filter(isVisibleRecord).map(markPendingRecord);
  const session = normalizePendingSession(
    db.buildSessionSummaries(records.map(toMemoryRecord))[0] ?? item.session,
  );
  return {
    ...item,
    session,
    records,
  };
}

export async function getCaptureMode(): Promise<CaptureMode> {
  const stored = await chrome.storage.local.get([CAPTURE_MODE_STORAGE_KEY]);
  return stored[CAPTURE_MODE_STORAGE_KEY] === "manual" ? "manual" : DEFAULT_CAPTURE_MODE;
}

export async function cachePendingRecords(records: MemoryRecord[]): Promise<void> {
  const captureRecords = records.filter(
    (record) => !isTransientAssistantMessage(record.role, record.content),
  );
  if (captureRecords.length === 0) return;
  const graphRecords = db.mergeGraphChunks(captureRecords).map(markPendingRecord);
  const summaries = db.buildSessionSummaries(captureRecords);
  if (summaries.length === 0) return;

  const pending = await readPendingMap();
  for (const summary of summaries) {
    const sessionId = summary.sessionId;
    const incoming = graphRecords.filter((record) => record.sessionId === sessionId);
    if (incoming.length === 0) continue;
    const existing = pending[sessionId];
    const byId = new Map<string, GraphMemoryRecord>();
    for (const record of existing?.records ?? []) byId.set(record.id, record);
    for (const record of incoming) byId.set(record.id, record);
    const recordsForSession = Array.from(byId.values()).sort((a, b) => {
      const round = (a.roundIndex ?? 0) - (b.roundIndex ?? 0);
      if (round !== 0) return round;
      const turn = (a.turnIndex ?? 0) - (b.turnIndex ?? 0);
      if (turn !== 0) return turn;
      return a.timestamp - b.timestamp;
    });
    const session = normalizePendingSession(
      db.buildSessionSummaries(recordsForSession.map(toMemoryRecord))[0] ?? summary,
    );
    pending[sessionId] = {
      session,
      records: recordsForSession,
      updatedAt: Date.now(),
    };
  }
  await writePendingMap(pending);
}

export async function listPendingSessions(filters?: {
  provider?: AIProvider;
  query?: string;
}): Promise<MemorySessionSummary[]> {
  const pending = await readPendingMap();
  const q = filters?.query?.trim().toLowerCase();
  return Object.values(pending)
    .map((item) => normalizePendingItem(item).session)
    .filter((session) => {
      if (filters?.provider && session.provider !== filters.provider) return false;
      if (!q) return true;
      return (
        session.sessionId.toLowerCase().includes(q) ||
        session.provider.toLowerCase().includes(q) ||
        (session.title ?? "").toLowerCase().includes(q) ||
        session.sources.some((source) => source.toLowerCase().includes(q)) ||
        session.models.some((model) => model.toLowerCase().includes(q))
      );
    })
    .sort((a, b) => b.lastTimestamp - a.lastTimestamp);
}

export async function getPendingSessionGraph(
  sessionId: string,
): Promise<{ session?: MemorySessionSummary; records: GraphMemoryRecord[] }> {
  const pending = await readPendingMap();
  const item = pending[sessionId];
  if (!item) return { records: [] };
  const normalized = normalizePendingItem(item);
  return {
    session: normalized.session,
    records: normalized.records,
  };
}

export async function persistPendingSession(
  sessionId: string,
): Promise<{ count: number; skipped: number }> {
  const pending = await readPendingMap();
  const item = pending[sessionId];
  if (!item) return { count: 0, skipped: 0 };
  const records = item.records.filter(isVisibleRecord).map(toMemoryRecord);
  const ids = records.map((record) => record.id);
  const newIds = new Set(await db.filterNewChatMessageUuids(ids));
  let count = 0;
  for (const record of records) {
    if (!newIds.has(record.id)) continue;
    for (const chunk of expandToChunks(record)) {
      const id = await safeAddRecord(chunk);
      if (!id) continue;
      count += 1;
      try {
        miniSearch.add(chunk);
      } catch {
        /* duplicate id */
      }
      queueEmbedding(chunk);
    }
  }
  if (item.session.title) {
    void db.upsertConversationTitle(sessionId, item.session.title);
  }
  delete pending[sessionId];
  await writePendingMap(pending);
  return { count, skipped: records.length - newIds.size };
}

export async function deletePendingSession(sessionId: string): Promise<boolean> {
  const pending = await readPendingMap();
  const existed = !!pending[sessionId];
  delete pending[sessionId];
  await writePendingMap(pending);
  return existed;
}
