import type { AIProvider, MemoryRecord } from '../../types/memory'

export interface IAdapter {
  /** Returns true if this adapter can handle the given request URL */
  canHandle(url: string): boolean

  /**
   * Parses a raw provider payload into an array of normalized MemoryRecords.
   * Returns an empty array if the payload cannot be parsed or represents
   * a non-conversation response.
   */
  parse(rawData: unknown, url: string, timestamp: number): MemoryRecord[]
}

/**
 * Generates a stable session ID from a provider and a raw conversation/thread
 * identifier string. Returns a deterministic string safe for use as an
 * IndexedDB key.
 */
export function generateSessionId(provider: AIProvider, rawId: string): string {
  return `${provider}:${rawId}`
}

/**
 * Generates a random UUID for use as a MemoryRecord primary key.
 */
export function generateRecordId(): string {
  return crypto.randomUUID()
}

/**
 * Strips HTML tags and normalizes whitespace in a content string.
 */
export function normalizeContent(raw: string): string {
  return raw
    .replace(/<[^>]*>/g, '')     // strip HTML tags
    .replace(/\s+/g, ' ')        // collapse whitespace
    .trim()
}

const RECALL_PREFIX = '[System Context: The following are relevant memories'
const USER_QUERY_MARKER = '[User Query]'

/**
 * If content contains a recall-injected template, returns only the actual
 * user query portion (after "[User Query]"). Returns null if the content
 * is entirely template with no real query.
 */
export function stripRecallTemplate(content: string): string | null {
  if (!content.includes(RECALL_PREFIX)) return content
  const markerIdx = content.indexOf(USER_QUERY_MARKER)
  if (markerIdx === -1) return null
  const query = content.slice(markerIdx + USER_QUERY_MARKER.length).trim()
  return query.length > 0 ? query : null
}
