import { describe, it, expect } from 'vitest'
import {
  generateSessionId,
  generateRecordId,
  normalizeContent,
  stripRecallTemplate,
} from '../../../src/background/adapters/base'

describe('generateSessionId', () => {
  it('returns provider:rawId format', () => {
    expect(generateSessionId('openai', 'conv-123')).toBe('openai:conv-123')
  })
})

describe('generateRecordId', () => {
  it('returns UUID v4 format', () => {
    const id = generateRecordId()
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
  })

  it('returns different values on two calls', () => {
    const id1 = generateRecordId()
    const id2 = generateRecordId()
    expect(id1).not.toBe(id2)
  })
})

describe('normalizeContent', () => {
  it('strips HTML tags', () => {
    expect(normalizeContent('<b>hello</b>')).toBe('hello')
  })

  it('collapses whitespace', () => {
    expect(normalizeContent('hello   world')).toBe('hello world')
  })

  it('trims leading and trailing whitespace', () => {
    expect(normalizeContent('  hello  ')).toBe('hello')
  })

  it('returns empty string for empty input', () => {
    expect(normalizeContent('')).toBe('')
  })

  it('handles mixed HTML tags and multiple whitespace', () => {
    expect(normalizeContent('<p>  hello   <b>world</b>  </p>')).toBe('hello world')
  })
})

describe('stripRecallTemplate', () => {
  it('returns content unchanged when no recall prefix present', () => {
    const content = 'Just a normal message'
    expect(stripRecallTemplate(content)).toBe(content)
  })

  it('returns just the query when recall prefix and [User Query] marker are present', () => {
    const content =
      '[System Context: The following are relevant memories\n...some memories...\n[User Query] What is TypeScript?'
    expect(stripRecallTemplate(content)).toBe('What is TypeScript?')
  })

  it('returns null when recall prefix is present but [User Query] marker is missing', () => {
    const content = '[System Context: The following are relevant memories\n...some memories...'
    expect(stripRecallTemplate(content)).toBeNull()
  })

  it('returns null when recall prefix and [User Query] marker are present but query is empty', () => {
    const content = '[System Context: The following are relevant memories\n[User Query]'
    expect(stripRecallTemplate(content)).toBeNull()
  })

  it('returns null when query after marker is whitespace only', () => {
    const content = '[System Context: The following are relevant memories\n[User Query]   '
    expect(stripRecallTemplate(content)).toBeNull()
  })
})
