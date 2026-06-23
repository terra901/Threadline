import { beforeEach, describe, expect, it, vi } from 'vitest'
import 'fake-indexeddb/auto'
import { db } from '../../../src/background/db'
import { handleSearchMemories, hydrateSearchIndex, miniSearch } from '../../../src/background/search'
import { makeRecord } from '../../__fixtures__/records'

describe('handleSearchMemories', () => {
  beforeEach(async () => {
    await db.delete()
    await db.open()
    miniSearch.removeAll()
  })

  it('returns immediately without embedding when the memory DB is empty', async () => {
    const embedViaOffscreen = vi.fn(async () => new Float32Array([1, 0]))

    const response = await handleSearchMemories(
      { type: 'SEARCH_MEMORIES', payload: { query: 'weather', topK: 3 } },
      embedViaOffscreen,
    )

    expect(embedViaOffscreen).not.toHaveBeenCalled()
    expect(response).toEqual({
      type: 'SEARCH_MEMORIES_RESPONSE',
      payload: {
        results: [],
        query: 'weather',
        reason: 'EMPTY_MEMORY_DB',
      },
    })
  })

  it('uses keyword search without embedding when records are saved but embeddings are pending', async () => {
    await db.addRecord(makeRecord({
      id: 'pending-keyword',
      content: 'TypeScript generic constraints and inference notes',
      sessionId: 'openai:keyword-session',
      hasEmbedding: 0,
    }))
    await hydrateSearchIndex()
    const embedViaOffscreen = vi.fn(async () => new Float32Array([1, 0]))

    const response = await handleSearchMemories(
      { type: 'SEARCH_MEMORIES', payload: { query: 'TypeScript', topK: 3 } },
      embedViaOffscreen,
    )

    expect(embedViaOffscreen).not.toHaveBeenCalled()
    expect(response.payload.results).toHaveLength(1)
    expect(response.payload.results[0]).toMatchObject({
      id: 'pending-keyword',
      content: 'TypeScript generic constraints and inference notes',
      sessionId: 'openai:keyword-session',
    })
  })
})
