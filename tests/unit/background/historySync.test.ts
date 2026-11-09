import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import 'fake-indexeddb/auto'
import { MemoryDatabase } from '../../../src/background/db'
import type { MemoryRecord } from '../../../src/types/memory'
import {
  persistChatGPTConversation,
  persistRecordWithChunks,
} from '../../../src/background/historySync'

function makeRecord(overrides: Partial<MemoryRecord> = {}): MemoryRecord {
  return {
    id: 'msg-1',
    role: 'assistant',
    content: 'short reply',
    provider: 'openai',
    sessionId: 'openai:conv-1',
    timestamp: 1000,
    createdAt: 1000,
    isPartial: false,
    isDeleted: false,
    isSuperseded: false,
    ...overrides,
  }
}

describe('persistRecordWithChunks — swallowed-answer regression', () => {
  let db: MemoryDatabase

  beforeEach(async () => {
    db = new MemoryDatabase()
    await db.open()
  })

  afterEach(async () => {
    await db.delete()
  })

  it('adds a brand-new record', async () => {
    const result = await persistRecordWithChunks(makeRecord())
    expect(result).toBe('added')
    const stored = await db.memories.get('msg-1')
    expect(stored?.content).toBe('short reply')
    expect(stored?.isPartial).toBe(false)
  })

  it('upserts a partial record when the complete stream arrives (previously dropped)', async () => {
    // Simulate the old bug scenario: a cut-off stream stored a partial reply,
    // then a complete stream for the SAME message id arrives.
    await persistRecordWithChunks(makeRecord({ content: 'short', isPartial: true }))
    const result = await persistRecordWithChunks(
      makeRecord({ content: 'short but complete reply', isPartial: false }),
    )
    expect(result).toBe('updated')
    const stored = await db.memories.get('msg-1')
    expect(stored?.content).toBe('short but complete reply')
    expect(stored?.isPartial).toBe(false)
    // Embedding must be regenerated for the new text
    expect(stored?.hasEmbedding).toBe(0)
  })

  it('skips duplicates with identical content', async () => {
    await persistRecordWithChunks(makeRecord())
    const result = await persistRecordWithChunks(makeRecord())
    expect(result).toBe('skipped')
    expect(await db.memories.get('msg-1')).toBeTruthy()
  })

  it('replaces chunk records when long content changes', async () => {
    const longA = 'A'.repeat(600)
    const longB = 'B'.repeat(700)
    await persistRecordWithChunks(makeRecord({ content: longA }))
    const before = await db.memories.where('parentId').equals('msg-1').toArray()
    expect(before.length).toBeGreaterThan(1)

    const result = await persistRecordWithChunks(makeRecord({ content: longB }))
    expect(result).toBe('updated')
    const after = await db.memories.where('parentId').equals('msg-1').toArray()
    expect(after.length).toBeGreaterThan(1)
    // All chunks now carry the new content (no stale fragments)
    expect(after.every((c) => String(c.content).includes('B'))).toBe(true)
    expect(after.some((c) => String(c.content).includes('A'))).toBe(false)
  })

  it('keeps a direct record consistent when long content shrinks to short', async () => {
    await persistRecordWithChunks(makeRecord({ content: 'A'.repeat(600) }))
    await persistRecordWithChunks(makeRecord({ content: 'tiny' }))
    const chunks = await db.memories.where('parentId').equals('msg-1').toArray()
    expect(chunks).toHaveLength(0)
    const stored = await db.memories.get('msg-1')
    expect(stored?.content).toBe('tiny')
  })
})

describe('persistChatGPTConversation', () => {
  let db: MemoryDatabase

  beforeEach(async () => {
    db = new MemoryDatabase()
    await db.open()
  })

  afterEach(async () => {
    await db.delete()
  })

  it('persists records and upserts the conversation title', async () => {
    const records = [
      makeRecord({ id: 'm1', role: 'user', content: 'Q' }),
      makeRecord({ id: 'm2', role: 'assistant', content: 'A' }),
    ]
    const result = await persistChatGPTConversation(records, '我的对话')
    expect(result.added).toBe(2)
    expect(result.skipped).toBe(0)
    const title = await db.getConversationTitle('openai:conv-1')
    expect(title).toBe('我的对话')
  })
})
