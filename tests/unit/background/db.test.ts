import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import 'fake-indexeddb/auto'
import { MemoryDatabase } from '../../../src/background/db'
import type { MemoryRecord } from '../../../src/types/memory'

function makeRecord(i: number): MemoryRecord {
  return {
    id: `r${i}`,
    role: 'user',
    content: `content ${i}`,
    provider: 'openai',
    sessionId: 'test-session',
    timestamp: (i + 1) * 1000,
    createdAt: (i + 1) * 1000,
    isPartial: false,
    isDeleted: false,
    isSuperseded: false,
  }
}

describe('MemoryDatabase graph queries', () => {
  let db: MemoryDatabase

  beforeEach(async () => {
    db = new MemoryDatabase()
    await db.open()
  })

  afterEach(async () => {
    await db.delete()
  })

  it('summarizes sessions and applies stored titles', async () => {
    await db.addRecord({
      ...makeRecord(0),
      id: 's1-u1',
      role: 'user',
      sessionId: 'openai:s1',
      provider: 'openai',
      source: 'dom_scan',
      turnIndex: 1,
    })
    await db.addRecord({
      ...makeRecord(1),
      id: 's1-a1',
      role: 'assistant',
      sessionId: 'openai:s1',
      provider: 'openai',
      model: 'gpt-test',
      source: 'network_capture',
      turnIndex: 2,
    })
    await db.upsertConversationTitle('openai:s1', 'Graph Session')

    const { sessions, total } = await db.querySessions()

    expect(total).toBe(1)
    expect(sessions[0]).toMatchObject({
      sessionId: 'openai:s1',
      title: 'Graph Session',
      messageCount: 2,
      userCount: 1,
      assistantCount: 1,
      hasEmbeddingCount: 0,
      sources: ['dom_scan', 'network_capture'],
      models: ['gpt-test'],
    })
  })

  it('merges chunk records for graph display', async () => {
    await db.addRecord({
      ...makeRecord(0),
      id: 'long-c0',
      role: 'assistant',
      sessionId: 'openai:s2',
      parentId: 'long',
      chunkIndex: 0,
      content: 'hello ',
    })
    await db.addRecord({
      ...makeRecord(1),
      id: 'long-c1',
      role: 'assistant',
      sessionId: 'openai:s2',
      parentId: 'long',
      chunkIndex: 1,
      content: 'world',
    })

    const { records } = await db.getSessionGraph('openai:s2')

    expect(records).toHaveLength(1)
    expect(records[0]).toMatchObject({
      id: 'long',
      content: 'hello world',
      isChunked: true,
      chunkCount: 2,
      chunkIds: ['long-c0', 'long-c1'],
    })
    expect('embedding' in records[0]).toBe(false)
  })

  it('orders graph records by captured time before turn index', async () => {
    await db.addRecord({
      ...makeRecord(0),
      id: 'assistant-late',
      role: 'assistant',
      content: 'assistant reply',
      sessionId: 'google:s3',
      provider: 'google',
      timestamp: 3_000,
      turnIndex: -1,
    })
    await db.addRecord({
      ...makeRecord(1),
      id: 'user-first',
      role: 'user',
      content: 'user question',
      sessionId: 'google:s3',
      provider: 'google',
      timestamp: 1_000,
      turnIndex: 10,
    })

    const { records } = await db.getSessionGraph('google:s3')

    expect(records.map((record) => record.id)).toEqual(['user-first', 'assistant-late'])
  })

  it('uses non-negative turn indexes when timestamps are tied', async () => {
    await db.addRecord({
      ...makeRecord(0),
      id: 'assistant-second',
      role: 'assistant',
      content: 'assistant reply',
      sessionId: 'google:s4',
      provider: 'google',
      timestamp: 5_000,
      turnIndex: 1,
    })
    await db.addRecord({
      ...makeRecord(1),
      id: 'user-first-tied',
      role: 'user',
      content: 'user question',
      sessionId: 'google:s4',
      provider: 'google',
      timestamp: 5_000,
      turnIndex: 0,
    })

    const { records } = await db.getSessionGraph('google:s4')

    expect(records.map((record) => record.id)).toEqual(['user-first-tied', 'assistant-second'])
  })

  it('keeps chunked later messages after earlier messages in timeline order', async () => {
    await db.addRecord({
      ...makeRecord(0),
      id: 'weather-c0',
      role: 'assistant',
      content: 'Friday weather ',
      sessionId: 'google:s5',
      provider: 'google',
      timestamp: Date.parse('2026-06-19T23:40:21+08:00'),
      createdAt: Date.parse('2026-06-19T23:40:21+08:00'),
      parentId: 'weather',
      chunkIndex: 0,
      turnIndex: 0,
    })
    await db.addRecord({
      ...makeRecord(1),
      id: 'weather-c1',
      role: 'assistant',
      content: 'forecast',
      sessionId: 'google:s5',
      provider: 'google',
      timestamp: Date.parse('2026-06-19T23:40:22+08:00'),
      createdAt: Date.parse('2026-06-19T23:40:22+08:00'),
      parentId: 'weather',
      chunkIndex: 1,
      turnIndex: 0,
    })
    await db.addRecord({
      ...makeRecord(2),
      id: 'hello-user',
      role: 'user',
      content: '你好',
      sessionId: 'google:s5',
      provider: 'google',
      timestamp: Date.parse('2026-06-19T23:38:08+08:00'),
      createdAt: Date.parse('2026-06-19T23:38:08+08:00'),
      turnIndex: 2,
    })
    await db.addRecord({
      ...makeRecord(3),
      id: 'hello-assistant',
      role: 'assistant',
      content: '你好！今天有什么可以帮你的吗？',
      sessionId: 'google:s5',
      provider: 'google',
      timestamp: Date.parse('2026-06-19T23:38:10+08:00'),
      createdAt: Date.parse('2026-06-19T23:38:10+08:00'),
      turnIndex: 3,
    })

    const { records } = await db.getSessionGraph('google:s5')

    expect(records.map((record) => record.id)).toEqual(['hello-user', 'hello-assistant', 'weather'])
    expect(records[2]).toMatchObject({
      id: 'weather',
      content: 'Friday weather forecast',
      timestamp: Date.parse('2026-06-19T23:40:21+08:00'),
      isChunked: true,
    })
  })
})
