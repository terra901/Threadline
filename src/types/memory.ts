import type { MemoryExportAppName } from '../constants/branding'

export type MessageRole = 'user' | 'assistant'

export type AIProvider = 'openai' | 'anthropic' | 'google' | 'xai' | 'perplexity'

export interface MemoryRecord {
  // Primary Key
  id: string

  // Message Content
  role: MessageRole
  content: string

  // Provider & Context
  provider: AIProvider
  sessionId: string
  /** Optional parent message/thread id (e.g. ChatGPT parent_message_id) */
  parentMessageId?: string
  model?: string
  /** Original provider message id when it differs from the local primary key. */
  originalMessageId?: string
  /** Capture/import source, promoted from metadata for indexed browsing. */
  source?: string
  /** Source page URL when available. */
  sourceUrl?: string
  /** Conversation title at capture/import time when available. */
  conversationTitle?: string

  // Temporal Metadata
  timestamp: number
  createdAt: number
  /** Provider/DOM turn order when available. */
  turnIndex?: number
  /** Conversation round used by the graph view. Multiple branches can share a round. */
  roundIndex?: number
  /** Branch number within a round. 0 is the main/first observed branch. */
  branchIndex?: number
  /** Stable branch key, usually scoped to session + round + branch. */
  branchId?: string
  /** Stable path key for graph/tree grouping. */
  pathId?: string

  // Chunking (for long content split into overlapping segments)
  /** 0-based position of this chunk within its logical message. Absent on single-chunk records. */
  chunkIndex?: number
  /** ID of the original logical message this chunk belongs to. Absent on single-chunk records. */
  parentId?: string

  // Semantic Vector
  embedding?: Float32Array

  // Embedding Metadata
  embeddingModel?: string
  embeddingVersion?: string
  hasEmbedding?: number

  // Status Flags
  isPartial: boolean
  isDeleted: boolean
  /** True if this record has been superseded by a newer edit of the same parentMessageId */
  isSuperseded: boolean

  // Optional Metadata
  metadata?: Record<string, unknown>
}

export type AttachmentKind = 'image' | 'file'

export type AttachmentCaptureSource =
  | 'dom_scan'
  | 'upload'
  | 'paste'
  | 'drop'
  | 'remote'

export type AttachmentSaveStatus =
  | 'saved'
  | 'too_large'
  | 'fetch_failed'
  | 'unsupported'

export interface AttachmentRecord {
  id: string
  messageId: string
  sessionId: string
  provider: AIProvider
  kind: AttachmentKind
  source: AttachmentCaptureSource
  url?: string
  name?: string
  mimeType?: string
  size?: number
  hash?: string
  status: AttachmentSaveStatus
  createdAt: number
  updatedAt: number
  error?: string
}

export interface AttachmentBlobRecord {
  id: string
  attachmentId: string
  blob: Blob
  size: number
  mimeType?: string
  createdAt: number
}

export interface DomAttachmentCandidate {
  id: string
  messageId: string
  kind: AttachmentKind
  source: AttachmentCaptureSource
  url?: string
  name?: string
  mimeType?: string
  size?: number
  dataUrl?: string
  error?: string
}

// ─── Memory Export Protocol v1.0 / v1.1 ───────────────────────────────────────

/** Serialised record: embedding is number[] instead of Float32Array for JSON. */
export type SerializableMemoryRecord = Omit<MemoryRecord, 'embedding'> & {
  embedding?: number[]
}

/** A saved favourite prompt (persisted in chrome.storage.local). */
export interface FavoritePrompt {
  id: string
  text: string
  createdAt: number
}

/** A folder that organizes prompts. A prompt can be in multiple folders. */
export interface PromptFolder {
  id: string
  name: string
  promptIds: string[]
  createdAt: number
}

export interface MemoryExportMetadata {
  app: MemoryExportAppName
  version: '1.0' | '1.1' | '1.2'
  exportedAt: string   // ISO 8601
  recordCount: number
  embeddingModel: string
}

export interface IMemoryExportEnvelope {
  metadata: MemoryExportMetadata
  payload: SerializableMemoryRecord[]
  /** v1.1+: favourite prompts from chrome.storage.local */
  prompts?: FavoritePrompt[]
  /** v1.2+: prompt folders from chrome.storage.local */
  folders?: PromptFolder[]
}

export interface ErrorLog {
  id?: number
  timestamp: number
  message: string
  context?: Record<string, unknown>
}

export interface ConversationTitle {
  /** Primary key: sessionId (format: provider:conversationId) */
  sessionId: string
  /** Title extracted from page <title> element */
  title: string
  /** When the title was captured/updated */
  updatedAt: number
}

export interface MemorySessionSummary {
  sessionId: string
  provider: AIProvider
  title?: string
  messageCount: number
  userCount: number
  assistantCount: number
  firstTimestamp: number
  lastTimestamp: number
  hasEmbeddingCount: number
  sources: string[]
  models: string[]
  /** false means captured in manual mode but not yet persisted into IndexedDB */
  persisted?: boolean
}

export type GraphMemoryRecord = Omit<MemoryRecord, 'embedding'> & {
  chunkIds: string[]
  chunkCount: number
  isChunked: boolean
  embeddingLength?: number
  attachments?: AttachmentRecord[]
  /** false means shown from the manual-mode pending session cache */
  persisted?: boolean
}

export interface PendingMemorySession {
  session: MemorySessionSummary & { persisted: false }
  records: GraphMemoryRecord[]
  updatedAt: number
}
