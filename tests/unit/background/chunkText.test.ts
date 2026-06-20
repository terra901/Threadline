import { describe, it, expect } from 'vitest'
import { chunkText, expandToChunks } from '../../../src/background/index'
import { makeRecord } from '../../__fixtures__/records'

const CHUNK_SIZE = 500
const CHUNK_OVERLAP = 75
const STEP = CHUNK_SIZE - CHUNK_OVERLAP // 425

describe('chunkText', () => {
  it('returns a single-element array for short text (< 500 chars)', () => {
    const text = 'hello world'
    const result = chunkText(text)
    expect(result).toHaveLength(1)
    expect(result[0]).toBe(text)
  })

  it('returns a single-element array for text exactly 500 chars', () => {
    const text = 'a'.repeat(500)
    const result = chunkText(text)
    expect(result).toHaveLength(1)
    expect(result[0]).toBe(text)
  })

  it('returns 2 chunks for 501-char text', () => {
    const text = 'a'.repeat(501)
    const result = chunkText(text)
    expect(result).toHaveLength(2)
    expect(result[0]).toHaveLength(500)
    // second chunk starts at offset 425, length = 501 - 425 = 76
    expect(result[1]).toHaveLength(76)
  })

  it('returns correct chunks for 1000-char text', () => {
    const text = 'abcdefghij'.repeat(100) // 1000 chars
    const result = chunkText(text)

    // chunk 0: [0, 500)
    expect(result[0]).toBe(text.slice(0, 500))
    // chunk 1: [425, 925)
    expect(result[1]).toBe(text.slice(425, 925))
    // chunk 2: [850, 1000)  (tail)
    expect(result[2]).toBe(text.slice(850))
  })

  it('every chunk is at most 500 chars', () => {
    const text = 'x'.repeat(2000)
    const result = chunkText(text)
    for (const chunk of result) {
      expect(chunk.length).toBeLessThanOrEqual(500)
    }
  })

  it('adjacent chunks have a 75-char overlap', () => {
    const text = 'z'.repeat(1000)
    const result = chunkText(text)
    // The tail of chunk[0] and the head of chunk[1] should match
    const tailOf0 = result[0].slice(-CHUNK_OVERLAP)
    const headOf1 = result[1].slice(0, CHUNK_OVERLAP)
    expect(tailOf0).toBe(headOf1)
  })

  it('returns empty string as single-element array', () => {
    const result = chunkText('')
    expect(result).toHaveLength(1)
    expect(result[0]).toBe('')
  })
})

describe('expandToChunks', () => {
  it('returns [record] unchanged for short content (≤500 chars)', () => {
    const record = makeRecord({ content: 'short content' })
    const result = expandToChunks(record)
    expect(result).toHaveLength(1)
    expect(result[0]).toBe(record) // same reference — no copy made
  })

  it('returns multiple records for content longer than 500 chars', () => {
    const record = makeRecord({ id: 'rec-1', content: 'a'.repeat(600) })
    const result = expandToChunks(record)
    expect(result.length).toBeGreaterThan(1)
  })

  it('each expanded record has id with chunk index suffix', () => {
    const record = makeRecord({ id: 'rec-1', content: 'b'.repeat(600) })
    const result = expandToChunks(record)
    result.forEach((chunk, i) => {
      expect(chunk.id).toBe(`rec-1-c${i}`)
    })
  })

  it('each expanded record has chunkIndex set correctly', () => {
    const record = makeRecord({ id: 'rec-1', content: 'c'.repeat(600) })
    const result = expandToChunks(record)
    result.forEach((chunk, i) => {
      expect(chunk.chunkIndex).toBe(i)
    })
  })

  it('each expanded record has parentId set to original record id', () => {
    const record = makeRecord({ id: 'rec-1', content: 'd'.repeat(600) })
    const result = expandToChunks(record)
    for (const chunk of result) {
      expect(chunk.parentId).toBe('rec-1')
    }
  })

  it('preserves other record fields across chunks', () => {
    const record = makeRecord({
      id: 'rec-2',
      provider: 'openai',
      role: 'user',
      content: 'e'.repeat(1000),
    })
    const result = expandToChunks(record)
    for (const chunk of result) {
      expect(chunk.provider).toBe('openai')
      expect(chunk.role).toBe('user')
    }
  })

  it('chunk content matches chunkText output', () => {
    const content = 'f'.repeat(1000)
    const record = makeRecord({ content })
    const result = expandToChunks(record)
    const expectedChunks = chunkText(content)
    expect(result).toHaveLength(expectedChunks.length)
    result.forEach((chunk, i) => {
      expect(chunk.content).toBe(expectedChunks[i])
    })
  })
})
