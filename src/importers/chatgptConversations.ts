import type { SerializableMemoryRecord } from '../types/memory'
import type { IConversationImporter } from './base'
import { registerImporter } from './base'

// ── ChatGPT Conversation Parser ────────────────────────────────────────────────

interface ChatGPTMessage {
  id: string
  author: { role: string }
  content: { content_type: string; parts?: unknown[] }
  create_time: number | null
  status: string
}

interface ChatGPTMappingNode {
  id: string
  message: ChatGPTMessage | null
  parent: string | null
  children: string[]
}

interface ChatGPTConversation {
  id: string
  title?: string
  mapping: Record<string, ChatGPTMappingNode>
  create_time?: number
}

export function parseChatGPTConversations(raw: unknown): SerializableMemoryRecord[] {
  if (!Array.isArray(raw)) throw new Error('Not an array')
  const records: SerializableMemoryRecord[] = []
  const now = Date.now()

  for (const conv of raw as ChatGPTConversation[]) {
    if (!conv.id || !conv.mapping || typeof conv.mapping !== 'object') continue
    const sessionId = `openai:chatgpt-${conv.id}`

    for (const node of Object.values(conv.mapping)) {
      const msg = node.message
      if (!msg) continue
      const role = msg.author?.role
      if (role !== 'user' && role !== 'assistant') continue
      if (msg.status !== 'finished_successfully') continue
      if (msg.content?.content_type !== 'text') continue

      const parts = msg.content.parts ?? []
      const text = parts
        .filter((p): p is string => typeof p === 'string')
        .join('\n')
        .trim()
      if (!text) continue

      const tsMs = msg.create_time ? msg.create_time * 1000 : now
      const convCreatedAt = conv.create_time ? conv.create_time * 1000 : now

      records.push({
        id: `chatgpt-import-${msg.id}`,
        role: role as 'user' | 'assistant',
        content: text,
        provider: 'openai',
        sessionId,
        timestamp: tsMs,
        createdAt: convCreatedAt,
        isPartial: false,
        isDeleted: false,
        isSuperseded: false,
        metadata: { source: 'chatgpt-export', conversationTitle: conv.title ?? '' },
      })
    }
  }
  return records
}

class ChatGPTConversationImporter implements IConversationImporter {
  readonly id = 'chatgpt'
  readonly displayName = 'ChatGPT (conversations.json)'
  readonly provider = 'openai' as const
  canHandle(raw: unknown): boolean { return Array.isArray(raw) }
  parse(raw: unknown): SerializableMemoryRecord[] { return parseChatGPTConversations(raw) }
}

registerImporter(new ChatGPTConversationImporter())
