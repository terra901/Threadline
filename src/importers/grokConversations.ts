import type { SerializableMemoryRecord } from '../types/memory'
import type { IConversationImporter } from './base'
import { registerImporter } from './base'

// ── Grok Conversation Parser ────────────────────────────────────────────────

interface GrokResponse {
  _id: string
  conversation_id: string
  message: string
  sender: 'human' | 'assistant'
  create_time: { $date: { $numberLong: string } } | string | number
  parent_response_id?: string
  model?: string
}

interface GrokConversationEntry {
  conversation: {
    id: string
    title?: string
  }
  responses: Array<{ response: GrokResponse }>
}

interface GrokExport {
  conversations: GrokConversationEntry[]
}

export function parseCreateTime(raw: GrokResponse['create_time']): number {
  if (typeof raw === 'number') return raw
  if (typeof raw === 'string') return Date.parse(raw) || Date.now()
  if (raw && typeof raw === 'object' && '$date' in raw) {
    return Number(raw.$date.$numberLong)
  }
  return Date.now()
}

export function parseGrokConversations(raw: unknown): SerializableMemoryRecord[] {
  if (!raw || typeof raw !== 'object' || !Array.isArray((raw as GrokExport).conversations)) {
    throw new Error('Not a valid Grok export (expected { conversations: [...] })')
  }

  const { conversations } = raw as GrokExport
  const records: SerializableMemoryRecord[] = []
  const now = Date.now()

  for (const entry of conversations) {
    const conv = entry.conversation
    if (!conv?.id || !Array.isArray(entry.responses)) continue

    const sessionId = `xai:grok-${conv.id}`
    const title = conv.title ?? ''

    for (const { response } of entry.responses) {
      if (!response?._id || !response.message?.trim()) continue
      const role = response.sender === 'human' ? 'user' : 'assistant'
      const tsMs = parseCreateTime(response.create_time) || now

      records.push({
        id: `grok-import-${response._id}`,
        role,
        content: response.message.trim(),
        provider: 'xai',
        sessionId,
        timestamp: tsMs,
        createdAt: tsMs,
        isPartial: false,
        isDeleted: false,
        isSuperseded: false,
        metadata: {
          source: 'grok-export',
          conversationTitle: title,
          ...(response.model && { model: response.model }),
          ...(response.parent_response_id && { parentId: response.parent_response_id }),
        },
      })
    }
  }

  return records
}

class GrokConversationImporter implements IConversationImporter {
  readonly id = 'grok'
  readonly displayName = 'Grok (prod-grok-backend.json)'
  readonly provider = 'xai' as const
  canHandle(raw: unknown): boolean {
    return !!raw && typeof raw === 'object' && Array.isArray((raw as GrokExport).conversations)
  }
  parse(raw: unknown): SerializableMemoryRecord[] { return parseGrokConversations(raw) }
}

registerImporter(new GrokConversationImporter())
