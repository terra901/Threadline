import type { MemoryRecord } from '../../types/memory'
import {
  generateRecordId,
  generateSessionId,
  normalizeContent,
  type IAdapter,
} from './base'

/**
 * ChatGPTAdapter handles OpenAI ChatGPT network payloads.
 *
 * OpenAI sends chat completions via:
 *   POST https://api.openai.com/v1/chat/completions   (non-streaming)
 *   POST https://chatgpt.com/backend-api/conversation (ChatGPT web UI SSE)
 *
 * The web UI sends a full conversation body; we extract the last user message
 * and the assistant reply from the response.
 */
export class ChatGPTAdapter implements IAdapter {
  private static readonly HANDLED_PATTERNS = [
    'api.openai.com/v1/chat/completions',
    'chatgpt.com/backend-api/conversation',
    'chat.openai.com/backend-api/conversation',
  ]

  canHandle(url: string): boolean {
    return ChatGPTAdapter.HANDLED_PATTERNS.some((p) => url.includes(p))
  }

  parse(rawData: unknown, _url: string, timestamp: number): MemoryRecord[] {
    try {
      return this.parseWebConversation(rawData, timestamp)
    } catch {
      return []
    }
  }

  private parseWebConversation(
    rawData: unknown,
    timestamp: number
  ): MemoryRecord[] {
    if (!rawData || typeof rawData !== 'object') return []

    const data = rawData as Record<string, unknown>

    // Handle streaming SSE: data may be an array of delta chunks collected
    // by the interceptor and assembled into a final message object.
    // We expect the interceptor to assemble chunks and send us a final payload.

    // Standard OpenAI chat completions response:
    // { choices: [{ message: { role, content }, finish_reason }], ... }
    if (Array.isArray(data['choices'])) {
      return this.parseCompletionsResponse(data, timestamp)
    }

    // ChatGPT web UI conversation response:
    // { conversation_id, message: { author: { role }, content: { parts } } }
    if (data['conversation_id'] && data['message']) {
      return this.parseChatGPTWebResponse(data, timestamp)
    }

    // Assembled SSE chunks format from interceptor:
    // { role, content, conversationId, model?, isPartial? }
    if (data['role'] && data['content']) {
      return this.parseAssembledMessage(data, timestamp)
    }

    return []
  }

  private parseCompletionsResponse(
    data: Record<string, unknown>,
    timestamp: number
  ): MemoryRecord[] {
    const choices = data['choices'] as Array<Record<string, unknown>>
    if (!choices.length) return []

    const choice = choices[0] as Record<string, unknown>
    const message = choice['message'] as Record<string, unknown> | undefined
    if (!message) return []

    const role = message['role'] as string
    const content = message['content'] as string | undefined
    if (!content) return []

    const sessionId = generateSessionId('openai', (data['id'] as string) ?? String(timestamp))
    const model = data['model'] as string | undefined
    const isPartial = choice['finish_reason'] !== 'stop'

    const record: MemoryRecord = {
      id: generateRecordId(),
      role: role === 'user' ? 'user' : 'assistant',
      content: normalizeContent(content),
      provider: 'openai',
      sessionId,
      model,
      timestamp,
      createdAt: Date.now(),
      isPartial,
      isDeleted: false,
      isSuperseded: false,
    }

    return [record]
  }

  private parseChatGPTWebResponse(
    data: Record<string, unknown>,
    timestamp: number
  ): MemoryRecord[] {
    const message = data['message'] as Record<string, unknown>
    const author = message['author'] as Record<string, unknown> | undefined
    const content = message['content'] as Record<string, unknown> | undefined
    const parts = content?.['parts'] as unknown[] | undefined
    const textParts = parts?.filter((p) => typeof p === 'string') as string[] | undefined

    if (!author || !textParts?.length) return []

    const rawRole = author['role'] as string
    const role = rawRole === 'user' ? 'user' : 'assistant'
    const text = textParts.join('\n')
    const conversationId = data['conversation_id'] as string

    const record: MemoryRecord = {
      id: generateRecordId(),
      role,
      content: normalizeContent(text),
      provider: 'openai',
      sessionId: generateSessionId('openai', conversationId),
      timestamp,
      createdAt: Date.now(),
      isPartial: false,
      isDeleted: false,
      isSuperseded: false,
      // Mark as history snapshot so handleCaptureMessage can deduplicate
      // against live SSE captures for the same session.
      metadata: { fromHistory: true },
    }

    return [record]
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
    const messageId = data['messageId'] as string | undefined

    const record: MemoryRecord = {
      id: typeof messageId === 'string' && messageId.trim() ? messageId.trim() : generateRecordId(),
      role: role === 'user' ? 'user' : 'assistant',
      content: normalizeContent(content),
      provider: 'openai',
      sessionId: generateSessionId('openai', conversationId),
      originalMessageId: typeof messageId === 'string' && messageId.trim() ? messageId.trim() : undefined,
      source: 'network_capture',
      model: data['model'] as string | undefined,
      timestamp,
      createdAt: Date.now(),
      isPartial,
      isDeleted: false,
      isSuperseded: false,
    }

    return [record]
  }
}
