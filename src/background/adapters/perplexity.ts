import type { MemoryRecord } from '../../types/memory'
import {
  generateRecordId,
  generateSessionId,
  normalizeContent,
  type IAdapter,
} from './base'

/**
 * PerplexityAdapter handles Perplexity.ai network payloads.
 *
 * Two capture paths:
 *   1. Live SSE: POST https://www.perplexity.ai/rest/sse/perplexity_ask
 *      — injector assembles chunks and sends { role, content, conversationId, ... }
 *   2. History: GET https://www.perplexity.ai/rest/thread/<slug>
 *      — JSON response: { status: 'success', entries: [...] }
 */
export class PerplexityAdapter implements IAdapter {
  private static readonly HANDLED_PATTERNS = [
    'perplexity.ai/rest/sse/perplexity_ask',
    'perplexity.ai/rest/thread/',
  ]

  canHandle(url: string): boolean {
    return PerplexityAdapter.HANDLED_PATTERNS.some((p) => url.includes(p))
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

    // Assembled SSE message from injector: { role, content, conversationId, ... }
    if (data['role'] && data['content']) {
      return this.parseAssembledMessage(data, timestamp)
    }

    // Thread history REST response: { status: 'success', entries: [...] }
    if (data['status'] === 'success' && Array.isArray(data['entries'])) {
      return this.parseThreadHistory(data, timestamp)
    }

    return []
  }

  private parseAssembledMessage(data: Record<string, unknown>, timestamp: number): MemoryRecord[] {
    const role = data['role'] as string
    const content = data['content'] as string
    const conversationId = (data['conversationId'] as string) ?? String(timestamp)
    const isPartial = Boolean(data['isPartial'])
    const messageId = data['messageId'] as string | undefined
    const threadTitle = data['threadTitle'] as string | undefined

    const record: MemoryRecord = {
      id: messageId ? `perplexity-${messageId}` : generateRecordId(),
      role: role === 'user' ? 'user' : 'assistant',
      content: normalizeContent(content),
      provider: 'perplexity',
      sessionId: generateSessionId('perplexity', conversationId),
      originalMessageId: messageId,
      source: 'network_capture',
      conversationTitle: threadTitle,
      model: data['model'] as string | undefined,
      timestamp,
      createdAt: Date.now(),
      isPartial,
      isDeleted: false,
      isSuperseded: false,
      metadata: threadTitle ? { threadTitle } : undefined,
    }
    return [record]
  }

  private parseThreadHistory(data: Record<string, unknown>, timestamp: number): MemoryRecord[] {
    const entries = data['entries'] as Array<Record<string, unknown>>
    if (!entries.length) return []

    const records: MemoryRecord[] = []

    // entries[] is already in conversation order (oldest first). Use the array index to
    // generate strictly-ordered timestamps so display sorting is always correct even when
    // multiple entries share the same updated_datetime (or when timestamps are very close).
    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i]
      const conversationId = entry['context_uuid'] as string | undefined
      if (!conversationId) continue

      const sessionId = generateSessionId('perplexity', conversationId)
      const threadTitle = entry['thread_title'] as string | undefined
      const queryStr = entry['query_str'] as string | undefined
      const frontendUuid = entry['frontend_uuid'] as string | undefined
      const backendUuid = entry['backend_uuid'] as string | undefined
      const model = entry['display_model'] as string | undefined
      const updatedAt = entry['updated_datetime'] as string | undefined
      // updated_datetime from Perplexity is UTC but may lack a timezone designator
      // (e.g. "2026-03-01T18:31:23.518700"). Without 'Z'/'+HH:MM', Date.parse treats
      // date-time strings as local time — append 'Z' to force UTC interpretation.
      const updatedAtNorm = updatedAt && !/Z$|[+-]\d{2}:\d{2}$/.test(updatedAt)
        ? updatedAt + 'Z'
        : updatedAt
      const baseTimestamp = updatedAtNorm ? (Date.parse(updatedAtNorm) || timestamp) : timestamp
      // Use index × 2 as an offset (ms) so each turn is strictly ordered even if the
      // server returns identical timestamps. User message gets i*2, assistant gets i*2+1.
      const userTimestamp = baseTimestamp + i * 2
      const assistantTimestamp = baseTimestamp + i * 2 + 1

      if (queryStr?.trim()) {
        records.push({
          id: frontendUuid ? `perplexity-${frontendUuid}` : generateRecordId(),
          role: 'user',
          content: normalizeContent(queryStr),
          provider: 'perplexity',
          sessionId,
          model,
          timestamp: userTimestamp,
          createdAt: Date.now(),
          isPartial: false,
          isDeleted: false,
          isSuperseded: false,
          metadata: { fromHistory: true, conversationTitle: threadTitle },
        })
      }

      const assistantText = this.extractAssistantTextFromEntry(entry)
      if (assistantText) {
        records.push({
          id: backendUuid ? `perplexity-${backendUuid}` : generateRecordId(),
          role: 'assistant',
          content: normalizeContent(assistantText),
          provider: 'perplexity',
          sessionId,
          model,
          timestamp: assistantTimestamp,
          createdAt: Date.now(),
          isPartial: false,
          isDeleted: false,
          isSuperseded: false,
          metadata: { fromHistory: true, conversationTitle: threadTitle },
        })
      }
    }

    return records
  }

  private extractAssistantTextFromEntry(entry: Record<string, unknown>): string {
    // Thread history entries use intended_usage === 'ask_text' (not 'ask_text_0_markdown'
    // which is the live-stream variant). Check both to be safe.
    const blocks = entry['blocks'] as Array<Record<string, unknown>> | undefined
    if (Array.isArray(blocks)) {
      for (const usage of ['ask_text', 'ask_text_0_markdown']) {
        for (const block of blocks) {
          if (block['intended_usage'] !== usage) continue
          const mb = block['markdown_block'] as Record<string, unknown> | undefined
          if (typeof mb?.['answer'] === 'string' && mb['answer']) return mb['answer']
        }
      }
    }

    // Fallback: parse the nested `text` JSON field (same format as final SSE message)
    if (typeof entry['text'] === 'string') {
      try {
        const steps = JSON.parse(entry['text']) as Array<Record<string, unknown>>
        for (const step of steps) {
          if (step['step_type'] === 'FINAL') {
            const content = step['content'] as Record<string, unknown> | undefined
            const answerStr = content?.['answer'] as string | undefined
            if (answerStr) {
              const answerObj = JSON.parse(answerStr) as Record<string, unknown>
              const answer = answerObj['answer'] as string | undefined
              if (answer) return answer
            }
          }
        }
      } catch { /* ignore */ }
    }

    return ''
  }
}
