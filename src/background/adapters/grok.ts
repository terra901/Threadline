import type { MemoryRecord } from '../../types/memory'
import {
  generateRecordId,
  generateSessionId,
  normalizeContent,
  type IAdapter,
} from './base'

/**
 * GrokAdapter handles grok.com network payloads.
 *
 * Two capture paths:
 *   1. Live streaming: POST /rest/app-chat/conversations/new
 *                      POST /rest/app-chat/conversations/<id>/responses
 *      — injector parses concatenated JSON objects and sends assembled
 *        { role, content, conversationId, messageId?, parentMessageId?, model?, isPartial? }
 *   2. History: POST /rest/app-chat/conversations/<id>/load-responses
 *      — JSON response: { responses: [...], _conversationId: string }
 */
export class GrokAdapter implements IAdapter {
  private static readonly HANDLED_PATTERNS = [
    'grok.com/rest/app-chat/conversations/new',
    'grok.com/rest/app-chat/conversations/',
  ]

  canHandle(url: string): boolean {
    return GrokAdapter.HANDLED_PATTERNS.some((p) => url.includes(p))
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

    // Assembled streaming message from injector: { role, content, conversationId, ... }
    if (data['role'] && data['content']) {
      return this.parseAssembledMessage(data, timestamp)
    }

    // History load-responses: { responses: [...], _conversationId: string }
    if (Array.isArray(data['responses'])) {
      return this.parseLoadResponses(data, timestamp)
    }

    return []
  }

  private parseAssembledMessage(data: Record<string, unknown>, timestamp: number): MemoryRecord[] {
    const role = data['role'] as string
    const content = data['content'] as string
    const conversationId = (data['conversationId'] as string) ?? String(timestamp)
    const isPartial = Boolean(data['isPartial'])
    const messageId = data['messageId'] as string | undefined
    const parentMessageId = data['parentMessageId'] as string | undefined

    const record: MemoryRecord = {
      id: messageId ? `grok-${messageId}` : generateRecordId(),
      role: role === 'user' ? 'user' : 'assistant',
      content: normalizeContent(content),
      provider: 'xai',
      sessionId: generateSessionId('xai', conversationId),
      originalMessageId: messageId,
      source: 'network_capture',
      parentMessageId,
      model: data['model'] as string | undefined,
      timestamp,
      createdAt: Date.now(),
      isPartial,
      isDeleted: false,
      isSuperseded: false,
    }
    return [record]
  }

  private parseLoadResponses(data: Record<string, unknown>, timestamp: number): MemoryRecord[] {
    const responses = data['responses'] as Array<Record<string, unknown>>
    const conversationId = data['_conversationId'] as string | undefined
    if (!conversationId || !responses.length) return []

    const records: MemoryRecord[] = []
    const sessionId = generateSessionId('xai', conversationId)

    for (let i = 0; i < responses.length; i++) {
      const r = responses[i]
      if (r['isControl']) continue

      const sender = (r['sender'] as string | undefined ?? '').toLowerCase()
      if (sender !== 'human' && sender !== 'assistant') continue

      const message = r['message'] as string | undefined
      if (!message?.trim()) continue

      const responseId = r['responseId'] as string | undefined
      const parentResponseId = r['parentResponseId'] as string | undefined
      const model = r['model'] as string | undefined
      const createTime = r['createTime'] as string | undefined

      // Append 'Z' if missing timezone designator (same approach as Perplexity adapter)
      const createTimeNorm =
        createTime && !/Z$|[+-]\d{2}:\d{2}$/.test(createTime)
          ? createTime + 'Z'
          : createTime
      const msgTimestamp = createTimeNorm
        ? (Date.parse(createTimeNorm) || timestamp + i)
        : timestamp + i

      records.push({
        id: responseId ? `grok-${responseId}` : generateRecordId(),
        role: sender === 'human' ? 'user' : 'assistant',
        content: normalizeContent(message),
        provider: 'xai',
        sessionId,
        originalMessageId: responseId,
        source: 'history',
        parentMessageId: parentResponseId ? `grok-${parentResponseId}` : undefined,
        model,
        timestamp: msgTimestamp,
        createdAt: Date.now(),
        isPartial: false,
        isDeleted: false,
        isSuperseded: false,
        metadata: { fromHistory: true },
      })
    }

    return records
  }
}
