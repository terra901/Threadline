import type { MemoryRecord } from '../../types/memory'
import {
  generateRecordId,
  generateSessionId,
  normalizeContent,
  type IAdapter,
} from './base'

/**
 * Fast deterministic hash for stable record IDs (DOM history dedup).
 * Using random IDs (generateRecordId) means page-reload re-captures the same
 * messages because filterNewChatMessageUuids can never find a match.
 */
function stableHash(s: string): string {
  let h = 5381
  for (let i = 0; i < s.length; i++) {
    h = (((h << 5) + h) ^ s.charCodeAt(i)) | 0
  }
  return (h >>> 0).toString(36)
}

/**
 * GeminiAdapter handles Google Gemini network payloads.
 *
 * Gemini web uses:
 *   POST https://gemini.google.com/_/BardChatUi/data/assistant.lamda.BardFrontendService/StreamGenerate
 *
 * Also supports the Gemini API:
 *   POST https://generativelanguage.googleapis.com/v1beta/models/.../generateContent
 *   POST https://generativelanguage.googleapis.com/v1beta/models/.../streamGenerateContent
 */
export class GeminiAdapter implements IAdapter {
  private static readonly HANDLED_PATTERNS = [
    'generativelanguage.googleapis.com',
    'gemini.google.com/_/BardChatUi',
  ]

  canHandle(url: string): boolean {
    return GeminiAdapter.HANDLED_PATTERNS.some((p) => url.includes(p))
  }

  parse(rawData: unknown, _url: string, timestamp: number): MemoryRecord[] {
    try {
      return this.parsePayload(rawData, timestamp)
    } catch {
      return []
    }
  }

  private parsePayload(rawData: unknown, timestamp: number): MemoryRecord[] {
    if (!rawData || typeof rawData !== 'object') return []
    const data = rawData as Record<string, unknown>

    // DOM history batch format (from gemini-injector):
    // { turns: [{role, content, timestamp}], conversationId, fromHistory: true }
    if (Array.isArray(data['turns'])) {
      return this.parseTurnsBatch(data, timestamp)
    }

    // Gemini API generateContent response:
    // { candidates: [{ content: { role, parts: [{text}] }, finishReason }], ... }
    if (Array.isArray(data['candidates'])) {
      return this.parseApiResponse(data, timestamp)
    }

    // Assembled SSE/streaming format from interceptor:
    // { role, content, conversationId, isPartial? }
    if (data['role'] && data['content']) {
      return this.parseAssembledMessage(data, timestamp)
    }

    return []
  }

  private parseTurnsBatch(
    data: Record<string, unknown>,
    _timestamp: number
  ): MemoryRecord[] {
    const turns = data['turns'] as Array<Record<string, unknown>>
    const conversationId =
      typeof data['conversationId'] === 'string' && data['conversationId'].trim()
        ? (data['conversationId'] as string).trim()
        : 'unknown'
    const sessionId = generateSessionId('google', conversationId)
    const records: MemoryRecord[] = []

    for (const turn of turns) {
      const role = turn['role'] as string
      const content = turn['content'] as string
      const ts = typeof turn['timestamp'] === 'number' ? turn['timestamp'] : Date.now()
      if (!role || !content) continue

      // Stable ID so filterNewChatMessageUuids deduplicates correctly on page reload
      const id =
        conversationId !== 'unknown'
          ? `google:${conversationId}:${role === 'user' ? 'u' : 'a'}:${stableHash(content)}`
          : generateRecordId()

      records.push({
        id,
        role: role === 'user' ? 'user' : 'assistant',
        content: normalizeContent(content),
        provider: 'google',
        sessionId,
        timestamp: ts,
        createdAt: Date.now(),
        isPartial: false,
        isDeleted: false,
        isSuperseded: false,
        metadata: { fromHistory: true },
      })
    }

    return records
  }

  private parseApiResponse(
    data: Record<string, unknown>,
    timestamp: number
  ): MemoryRecord[] {
    const candidates = data['candidates'] as Array<Record<string, unknown>>
    if (!candidates.length) return []

    const records: MemoryRecord[] = []

    for (const candidate of candidates) {
      const content = candidate['content'] as Record<string, unknown> | undefined
      if (!content) continue

      const parts = content['parts'] as Array<Record<string, unknown>> | undefined
      if (!parts) continue

      const text = parts
        .filter((p) => typeof p['text'] === 'string')
        .map((p) => p['text'] as string)
        .join('\n')

      if (!text) continue

      const finishReason = candidate['finishReason'] as string | undefined
      const sessionId = generateSessionId(
        'google',
        (data['sessionId'] as string) ?? String(timestamp)
      )

      records.push({
        id: generateRecordId(),
        role: 'assistant',
        content: normalizeContent(text),
        provider: 'google',
        sessionId,
        timestamp,
        createdAt: Date.now(),
        isPartial: finishReason !== 'STOP',
        isDeleted: false,
        isSuperseded: false,
      })
    }

    return records
  }

  private parseAssembledMessage(
    data: Record<string, unknown>,
    timestamp: number
  ): MemoryRecord[] {
    const role = data['role'] as string
    const content = data['content'] as string
    const raw = (data['conversationId'] as string) ?? ''
    const conversationId =
      typeof raw === 'string' && raw.trim() ? raw.trim() : 'unknown'
    const isPartial = Boolean(data['isPartial'])
    const metadata = data['metadata'] as Record<string, unknown> | undefined
    const fromHistory = metadata?.['fromHistory'] === true

    // Use a stable deterministic ID for DOM history records so that
    // filterNewChatMessageUuids can deduplicate across page reloads.
    // Random IDs (generateRecordId) would re-capture the same messages every reload.
    const id =
      fromHistory && conversationId !== 'unknown'
        ? `google:${conversationId}:${role === 'user' ? 'u' : 'a'}:${stableHash(content)}`
        : generateRecordId()

    const record: MemoryRecord = {
      id,
      role: role === 'user' ? 'user' : 'assistant',
      content: normalizeContent(content),
      provider: 'google',
      sessionId: generateSessionId('google', conversationId),
      timestamp,
      createdAt: Date.now(),
      isPartial,
      isDeleted: false,
      isSuperseded: false,
      ...(metadata && { metadata }),
    }

    return [record]
  }
}
