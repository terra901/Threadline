import { describe, it, expect } from 'vitest'
import { parseCreateTime, parseGrokConversations } from '../../../src/importers/grokConversations'

describe('parseCreateTime', () => {
  it('returns a number as-is', () => {
    expect(parseCreateTime(1700000000000)).toBe(1700000000000)
  })

  it('parses a date string via Date.parse', () => {
    const dateStr = '2024-01-15T12:00:00Z'
    expect(parseCreateTime(dateStr)).toBe(Date.parse(dateStr))
  })

  it('parses MongoDB $date $numberLong format', () => {
    expect(parseCreateTime({ $date: { $numberLong: '1700000000000' } })).toBe(1700000000000)
  })

  it('returns a number for null (falls back to Date.now())', () => {
    const result = parseCreateTime(null as unknown as number)
    expect(typeof result).toBe('number')
    expect(result).toBeGreaterThan(0)
  })
})

describe('parseGrokConversations — happy path', () => {
  const data = {
    conversations: [
      {
        conversation: { id: 'conv-1', title: 'My Grok Chat' },
        responses: [
          {
            response: {
              _id: 'r1',
              message: 'Hello',
              sender: 'human',
              create_time: 1700000000000,
              model: 'grok-2',
            },
          },
          {
            response: {
              _id: 'r2',
              message: 'Hi!',
              sender: 'assistant',
              create_time: 1700000001000,
              parent_response_id: 'r1',
            },
          },
        ],
      },
    ],
  }

  it('parses 2 records from the conversation', () => {
    const records = parseGrokConversations(data)
    expect(records).toHaveLength(2)
  })

  it('user record has correct fields', () => {
    const records = parseGrokConversations(data)
    const user = records.find((r) => r.role === 'user')!
    expect(user).toBeDefined()
    expect(user.id).toBe('grok-import-r1')
    expect(user.role).toBe('user')
    expect(user.content).toBe('Hello')
    expect(user.provider).toBe('xai')
    expect(user.sessionId).toBe('xai:grok-conv-1')
    expect(user.timestamp).toBe(1700000000000)
    expect(user.createdAt).toBe(1700000000000)
    expect(user.isPartial).toBe(false)
    expect(user.isDeleted).toBe(false)
    expect(user.isSuperseded).toBe(false)
    expect(user.metadata?.source).toBe('grok-export')
    expect(user.metadata?.conversationTitle).toBe('My Grok Chat')
    expect(user.metadata?.model).toBe('grok-2')
  })

  it('assistant record has correct fields including parentId', () => {
    const records = parseGrokConversations(data)
    const assistant = records.find((r) => r.role === 'assistant')!
    expect(assistant).toBeDefined()
    expect(assistant.id).toBe('grok-import-r2')
    expect(assistant.role).toBe('assistant')
    expect(assistant.metadata?.parentId).toBe('r1')
    expect(assistant.metadata?.model).toBeUndefined()
  })
})

describe('parseGrokConversations — filtering', () => {
  it('skips responses with blank message', () => {
    const data = {
      conversations: [
        {
          conversation: { id: 'conv-1' },
          responses: [
            {
              response: {
                _id: 'r1',
                message: '   ',
                sender: 'human',
                create_time: 1700000000000,
              },
            },
          ],
        },
      ],
    }
    const records = parseGrokConversations(data)
    expect(records).toHaveLength(0)
  })

  it('skips responses without _id', () => {
    const data = {
      conversations: [
        {
          conversation: { id: 'conv-1' },
          responses: [
            {
              response: {
                _id: '',
                message: 'Hello',
                sender: 'human',
                create_time: 1700000000000,
              },
            },
          ],
        },
      ],
    }
    const records = parseGrokConversations(data)
    expect(records).toHaveLength(0)
  })
})

describe('parseGrokConversations — invalid input', () => {
  it('throws on empty object', () => {
    expect(() => parseGrokConversations({})).toThrow()
  })

  it('throws on null', () => {
    expect(() => parseGrokConversations(null)).toThrow()
  })

  it('throws when conversations is not an array', () => {
    expect(() => parseGrokConversations({ conversations: 'not-array' })).toThrow()
  })
})
