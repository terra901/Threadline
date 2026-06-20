import type { CaptureMode } from '../constants/capture'
import type { AIProvider, ErrorLog, FavoritePrompt, GraphMemoryRecord, IMemoryExportEnvelope, MemoryRecord, MemorySessionSummary, PromptFolder, SerializableMemoryRecord } from './memory'

// ─── CAPTURE_MESSAGE ─────────────────────────────────────────────────────────
// Direction: Content Script → Background Service Worker

export interface CaptureMessage {
  type: 'CAPTURE_MESSAGE'
  payload: {
    provider: AIProvider
    rawData: unknown
    url: string
    timestamp: number
  }
}

export interface CaptureMessageResponse {
  success: boolean
  recordId?: string
  error?: string
}

// ─── EMBED_REQUEST / EMBED_RESPONSE ──────────────────────────────────────────
// Direction: Background → Embedding Engine (internal)

export interface EmbedRequest {
  type: 'EMBED_REQUEST'
  payload: {
    text: string
    recordId: string
  }
}

export interface EmbedResponse {
  type: 'EMBED_RESPONSE'
  payload: {
    recordId: string
    embedding: Float32Array
    model: string
    success: boolean
    error?: string
  }
}

// ─── EMBED_BATCH ──────────────────────────────────────────────────────────────
// Direction: Background Service Worker → Offscreen Document (internal)
// Batches N texts into a single IPC round-trip for bulk import efficiency.

export interface EmbedBatchRequest {
  type: 'EMBED_BATCH'
  payload: { texts: string[] }
}

// ─── STATUS_UPDATE ────────────────────────────────────────────────────────────
// Direction: Background → Popup UI

export interface StatusUpdate {
  type: 'STATUS_UPDATE'
  payload: {
    totalRecords: number
    recentRecords: MemoryRecord[]
    errors: ErrorLog[]
    lastCaptureTime?: number
    quotaExceeded?: boolean
    captureMode?: CaptureMode
  }
}

// ─── CLEAR_ERRORS ─────────────────────────────────────────────────────────────
// Direction: Popup → Background

export interface ClearErrorsRequest {
  type: 'CLEAR_ERRORS'
}

export interface ClearErrorsResponse {
  type: 'CLEAR_ERRORS_RESPONSE'
  payload: {
    success: boolean
  }
}

// ─── UPDATE_CONVERSATION_TITLE ────────────────────────────────────────────────
// Direction: Content Script → Background

export interface UpdateConversationTitleRequest {
  type: 'UPDATE_CONVERSATION_TITLE'
  payload: { sessionId: string; title: string }
}

export interface UpdateConversationTitleResponse {
  type: 'UPDATE_CONVERSATION_TITLE_RESPONSE'
  payload: { success: boolean; error?: string }
}

// ─── GET_CONVERSATION_TITLES ───────────────────────────────────────────────────
// Direction: UI → Background

export interface GetConversationTitlesRequest {
  type: 'GET_CONVERSATION_TITLES'
  payload: { sessionIds: string[] }
}

export interface GetConversationTitlesResponse {
  type: 'GET_CONVERSATION_TITLES_RESPONSE'
  payload: { titles: Map<string, string> | Record<string, string> }
}

// ─── Memory Graph / Database Browser ─────────────────────────────────────────
// Direction: Tab UI → Background

export interface QueryMemorySessionsRequest {
  type: 'QUERY_MEMORY_SESSIONS'
  payload?: {
    provider?: AIProvider
    query?: string
    limit?: number
    offset?: number
  }
}

export interface QueryMemorySessionsResponse {
  type: 'QUERY_MEMORY_SESSIONS_RESPONSE'
  payload: {
    sessions: MemorySessionSummary[]
    total: number
    error?: string
  }
}

export interface QuerySessionGraphRequest {
  type: 'QUERY_SESSION_GRAPH'
  payload: {
    sessionId: string
  }
}

export interface QuerySessionGraphResponse {
  type: 'QUERY_SESSION_GRAPH_RESPONSE'
  payload: {
    session?: MemorySessionSummary
    records: GraphMemoryRecord[]
    error?: string
  }
}

export interface PersistPendingSessionRequest {
  type: 'PERSIST_PENDING_SESSION'
  payload: { sessionId: string }
}

export interface PersistPendingSessionResponse {
  type: 'PERSIST_PENDING_SESSION_RESPONSE'
  payload: { success: boolean; count: number; skipped?: number; error?: string }
}

export interface DeleteMemorySessionRequest {
  type: 'DELETE_MEMORY_SESSION'
  payload: { sessionId: string }
}

export interface DeleteMemorySessionResponse {
  type: 'DELETE_MEMORY_SESSION_RESPONSE'
  payload: { success: boolean; deleted?: number; error?: string }
}

export interface GetCaptureModeRequest {
  type: 'GET_CAPTURE_MODE'
}

export interface GetCaptureModeResponse {
  type: 'GET_CAPTURE_MODE_RESPONSE'
  payload: { mode: CaptureMode }
}

export interface SetCaptureModeRequest {
  type: 'SET_CAPTURE_MODE'
  payload: { mode: CaptureMode }
}

export interface SetCaptureModeResponse {
  type: 'SET_CAPTURE_MODE_RESPONSE'
  payload: { success: boolean; mode: CaptureMode; error?: string }
}

// ─── OPEN_MEMORY_PANEL ───────────────────────────────────────────────────────
// Direction: Background → Content Script

export interface OpenMemoryPanel {
  type: 'OPEN_MEMORY_PANEL'
}

export interface RequestDomSyncNow {
  type: 'REQUEST_DOM_SYNC_NOW'
}

export interface OpenMemoryGraph {
  type: 'OPEN_MEMORY_GRAPH'
  payload?: {
    sessionId?: string
    recordId?: string
  }
}

export interface OpenMemoryGraphResponse {
  type: 'OPEN_MEMORY_GRAPH_RESPONSE'
  payload: { success: boolean; error?: string }
}

// ─── SEARCH_MEMORIES ──────────────────────────────────────────────────────────
// Direction: UI → Background

export interface SearchMemoriesRequest {
  type: 'SEARCH_MEMORIES'
  payload: { query: string; topK?: number }
}

/** A single search result. Embedding is intentionally excluded (not JSON-serializable). */
export interface SearchResult {
  id: string
  role: string
  content: string
  sessionId: string
  provider: string
  timestamp: number
  createdAt: number
  parentId?: string
  chunkIndex?: number
  similarityScore: number
}

export interface SearchMemoriesResponse {
  type: 'SEARCH_MEMORIES_RESPONSE'
  payload: { results: SearchResult[]; query: string; error?: string }
}

// ─── EXPORT_MEMORIES ─────────────────────────────────────────────────────────
// Direction: UI (popup / float panel) → Background
// Background reads the DB, serialises embeddings, and returns a v1.0 envelope.

export interface ExportMemoriesRequest {
  type: 'EXPORT_MEMORIES'
}

export interface ExportMemoriesResponse {
  type: 'EXPORT_MEMORIES_RESPONSE'
  payload: {
    envelope: IMemoryExportEnvelope
    error?: string
  }
}

// ─── IMPORT_MEMORIES ─────────────────────────────────────────────────────────
// Direction: UI (popup / float panel) → Background
// UI parses and validates the file; background restores embeddings and persists.

export interface ImportMemoriesRequest {
  type: 'IMPORT_MEMORIES'
  payload: {
    records: SerializableMemoryRecord[]
    prompts?: FavoritePrompt[]
    folders?: PromptFolder[]
  }
}

export interface ImportMemoriesResponse {
  type: 'IMPORT_MEMORIES_RESPONSE'
  payload: {
    success: boolean
    count: number
    skipped?: number
    error?: string
  }
}

// ─── CLEAR_ALL_MEMORIES ───────────────────────────────────────────────────────
// Direction: Popup → Background

export interface ClearAllMemoriesRequest {
  type: 'CLEAR_ALL_MEMORIES'
}

export interface ClearAllMemoriesResponse {
  type: 'CLEAR_ALL_MEMORIES_RESPONSE'
  payload: { success: boolean; error?: string }
}

// ─── DOM_SYNC ─────────────────────────────────────────────────────────────────
// Direction: Content Script → Background Service Worker
// Triggered on page-load / SPA-navigation / settled DOM changes to sync
// historical messages that predate the network interceptor, plus visible branch
// variants that appear after the user switches an existing conversation branch.
//
// Each DomMessage represents one logical rendered message discovered via DOM
// scan. The background deduplicates against IndexedDB before queuing embeddings
// and backfills graph metadata on records that already exist.

export interface DomMessage {
  /** data-message-id attribute from the DOM bubble */
  messageId: string
  /** 'user' or 'assistant' inferred from turn structure */
  role: 'user' | 'assistant'
  /** Visible text content of the bubble */
  content: string
  /** conversation-turn index (data-testid="conversation-turn-N") */
  turnIndex: number
  /** Logical conversation round. Branch siblings share the same round. */
  roundIndex?: number
  /** Branch number within the round. 0 is the main/first observed branch. */
  branchIndex?: number
  /** Stable branch key used by the graph view. */
  branchId?: string
  /** Stable path key used by the graph view. */
  pathId?: string
  /** Best-effort parent message id inferred from the visible DOM path. */
  parentMessageId?: string
  /** ChatGPT conversation ID extracted from window.location or DOM */
  sessionId: string
  /** Page <title> at scan time — used as conversation label */
  pageTitle: string
  /** Unix ms timestamp when the scan ran */
  scannedAt: number
}

export interface DomSyncRequest {
  type: 'DOM_SYNC'
  payload: {
    messages: DomMessage[]
    provider: 'openai' | 'google'
    url: string
    manual?: boolean
  }
}

export interface DomSyncResponse {
  type: 'DOM_SYNC_RESPONSE'
  payload: {
    /** Number of genuinely new messages queued for embedding */
    queued: number
    /** Number of messages already in DB (skipped) */
    skipped: number
    error?: string
  }
}

// ─── Union Types ──────────────────────────────────────────────────────────────

export type ExtensionMessage =
  | CaptureMessage
  | EmbedRequest
  | EmbedResponse
  | EmbedBatchRequest
  | StatusUpdate
  | ClearErrorsRequest
  | ClearErrorsResponse
  | ClearAllMemoriesRequest
  | ClearAllMemoriesResponse
  | UpdateConversationTitleRequest
  | UpdateConversationTitleResponse
  | GetConversationTitlesRequest
  | GetConversationTitlesResponse
  | QueryMemorySessionsRequest
  | QueryMemorySessionsResponse
  | QuerySessionGraphRequest
  | QuerySessionGraphResponse
  | PersistPendingSessionRequest
  | PersistPendingSessionResponse
  | DeleteMemorySessionRequest
  | DeleteMemorySessionResponse
  | GetCaptureModeRequest
  | GetCaptureModeResponse
  | SetCaptureModeRequest
  | SetCaptureModeResponse
  | OpenMemoryPanel
  | RequestDomSyncNow
  | OpenMemoryGraph
  | OpenMemoryGraphResponse
  | SearchMemoriesRequest
  | SearchMemoriesResponse
  | ExportMemoriesRequest
  | ExportMemoriesResponse
  | ImportMemoriesRequest
  | ImportMemoriesResponse
  | DomSyncRequest
  | DomSyncResponse

export type ExtensionMessageResponse =
  | CaptureMessageResponse
  | EmbedResponse
  | ClearErrorsResponse
  | ClearAllMemoriesResponse
  | UpdateConversationTitleResponse
  | GetConversationTitlesResponse
  | QueryMemorySessionsResponse
  | QuerySessionGraphResponse
  | PersistPendingSessionResponse
  | DeleteMemorySessionResponse
  | GetCaptureModeResponse
  | SetCaptureModeResponse
  | OpenMemoryGraphResponse
  | SearchMemoriesResponse
  | ExportMemoriesResponse
  | ImportMemoriesResponse
  | DomSyncResponse
