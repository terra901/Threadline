import type { SerializableMemoryRecord } from '../types/memory'
import type { IConversationImporter } from './base'
import { registerImporter } from './base'

export interface ClaudeConvContentBlock {
  type: string
  text: string
}

export interface ClaudeConvMessage {
  uuid: string
  text: string
  content?: ClaudeConvContentBlock[]
  sender: 'human' | 'assistant'
  created_at: string
  updated_at: string
}

export interface ClaudeConversation {
  uuid: string
  name: string
  chat_messages: ClaudeConvMessage[]
}

export function parseClaudeConversations(raw: unknown): SerializableMemoryRecord[] {
  if (!Array.isArray(raw)) throw new Error('Not an array')
  const records: SerializableMemoryRecord[] = []
  const now = Date.now()

  for (const conv of raw as ClaudeConversation[]) {
    if (!conv.uuid || !Array.isArray(conv.chat_messages)) continue
    const sessionId = `anthropic:${conv.uuid}`

    for (const msg of conv.chat_messages) {
      if (!msg.uuid) continue

      // Extract text: prefer content[] array, fall back to text field
      let text = ''
      if (Array.isArray(msg.content)) {
        for (const block of msg.content) {
          if (block.type === 'text' && typeof block.text === 'string') {
            text += block.text
          }
        }
      }
      if (!text && typeof msg.text === 'string') text = msg.text
      if (!text.trim()) continue

      const tsMs = msg.updated_at
        ? (Date.parse(msg.updated_at) || now)
        : msg.created_at
          ? (Date.parse(msg.created_at) || now)
          : now

      records.push({
        id: msg.uuid,
        role: msg.sender === 'human' ? 'user' : 'assistant',
        content: text.trim(),
        provider: 'anthropic',
        sessionId,
        timestamp: tsMs,
        createdAt: now,
        isPartial: false,
        isDeleted: false,
        isSuperseded: false,
        metadata: { fromHistory: true, source: 'claude-export', conversationTitle: conv.name ?? '' },
      })
    }
  }
  return records
}

class ClaudeConversationImporter implements IConversationImporter {
  readonly id = 'claude'
  readonly displayName = 'Claude (conversations.json)'
  readonly provider = 'anthropic' as const
  canHandle(raw: unknown): boolean { return Array.isArray(raw) }
  parse(raw: unknown): SerializableMemoryRecord[] { return parseClaudeConversations(raw) }
}

registerImporter(new ClaudeConversationImporter())
