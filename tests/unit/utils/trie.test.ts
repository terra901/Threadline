import { describe, it, expect } from 'vitest'
import { PromptTrie } from '../../../src/utils/trie'

describe('PromptTrie.insert / suggest', () => {
  it('returns matching suggestions by prefix', () => {
    const trie = new PromptTrie()
    trie.insert('hello world')
    trie.insert('hello there')
    trie.insert('goodbye')
    const results = trie.suggest('hello')
    expect(results).toContain('hello world')
    expect(results).toContain('hello there')
    expect(results).not.toContain('goodbye')
  })

  it('returns empty array for empty prefix', () => {
    const trie = new PromptTrie()
    trie.insert('hello')
    expect(trie.suggest('')).toEqual([])
  })

  it('returns empty array for whitespace-only prefix', () => {
    const trie = new PromptTrie()
    trie.insert('hello')
    expect(trie.suggest('   ')).toEqual([])
  })

  it('respects the default limit of 5', () => {
    const trie = new PromptTrie()
    for (let i = 0; i < 10; i++) trie.insert(`hello ${i}`)
    const results = trie.suggest('hello')
    expect(results.length).toBeLessThanOrEqual(5)
  })

  it('respects a custom limit parameter', () => {
    const trie = new PromptTrie()
    for (let i = 0; i < 10; i++) trie.insert(`hello ${i}`)
    const results = trie.suggest('hello', 3)
    expect(results.length).toBeLessThanOrEqual(3)
  })

  it('deduplicates identical inserts', () => {
    const trie = new PromptTrie()
    trie.insert('hello')
    trie.insert('hello')
    const results = trie.suggest('hello', 10)
    expect(results.filter((r) => r === 'hello')).toHaveLength(1)
  })

  it('returns all matches when limit is large enough', () => {
    const trie = new PromptTrie()
    trie.insert('abc')
    trie.insert('abcd')
    trie.insert('abcde')
    const results = trie.suggest('abc', 100)
    expect(results).toContain('abc')
    expect(results).toContain('abcd')
    expect(results).toContain('abcde')
  })
})

describe('PromptTrie.remove', () => {
  it('removes an inserted word so it no longer appears in suggest', () => {
    const trie = new PromptTrie()
    trie.insert('hello')
    trie.remove('hello')
    expect(trie.suggest('hello')).not.toContain('hello')
  })

  it('does not affect other entries sharing the same prefix', () => {
    const trie = new PromptTrie()
    trie.insert('hello world')
    trie.insert('hello there')
    trie.remove('hello world')
    const results = trie.suggest('hello')
    expect(results).not.toContain('hello world')
    expect(results).toContain('hello there')
  })

  it('is a no-op when removing a non-existent word', () => {
    const trie = new PromptTrie()
    trie.insert('hello')
    expect(() => trie.remove('nonexistent')).not.toThrow()
    expect(trie.suggest('hello')).toContain('hello')
  })
})

describe('PromptTrie.rebuild', () => {
  it('clears old entries and rebuilds from new list', () => {
    const trie = new PromptTrie()
    trie.insert('old entry')
    trie.rebuild(['new entry', 'another new'])
    expect(trie.suggest('old')).toEqual([])
    expect(trie.suggest('new')).toContain('new entry')
    expect(trie.suggest('another')).toContain('another new')
  })

  it('makes old entries unfindable after rebuild', () => {
    const trie = new PromptTrie()
    trie.insert('before')
    trie.rebuild(['after'])
    expect(trie.suggest('before')).toEqual([])
    expect(trie.suggest('after')).toContain('after')
  })
})
