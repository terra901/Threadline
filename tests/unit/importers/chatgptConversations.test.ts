import { describe, it, expect } from 'vitest'
import { parseChatGPTConversations } from '../../../src/importers/chatgptConversations'

const baseConv = {
  id: 'conv-1',
  title: 'My Chat',
  create_time: 1700000, // seconds → createdAt: 1700000000
  mapping: {
    'node-1': {
      id: 'node-1',
      message: {
        id: 'msg-1',
        author: { role: 'user' },
        content: { content_type: 'text', parts: ['Hello, world!'] },
        create_time: 1700001, // seconds → timestamp: 1700001000
        status: 'finished_successfully',
      },
      parent: null,
      children: ['node-2'],
    },
    'node-2': {
      id: 'node-2',
      message: {
        id: 'msg-2',
        author: { role: 'assistant' },
        content: { content_type: 'text', parts: ['Hi there!'] },
        create_time: 1700002,
        status: 'finished_successfully',
      },
      parent: 'node-1',
      children: [],
    },
  },
}

describe('parseChatGPTConversations — happy path', () => {
  it('parses both user and assistant messages', () => {
    const records = parseChatGPTConversations([baseConv])
    expect(records).toHaveLength(2)
  })

  it('produces correct fields for user record', () => {
    const records = parseChatGPTConversations([baseConv])
    const user = records.find((r) => r.role === 'user')!
    expect(user).toBeDefined()
    expect(user.id).toBe('chatgpt-import-msg-1')
    expect(user.role).toBe('user')
    expect(user.content).toBe('Hello, world!')
    expect(user.provider).toBe('openai')
    expect(user.sessionId).toBe('openai:chatgpt-conv-1')
    expect(user.timestamp).toBe(1700001000)
    expect(user.createdAt).toBe(1700000000)
    expect(user.isPartial).toBe(false)
    expect(user.isDeleted).toBe(false)
    expect(user.isSuperseded).toBe(false)
    expect(user.metadata?.source).toBe('chatgpt-export')
    expect(user.metadata?.conversationTitle).toBe('My Chat')
  })

  it('produces correct role for assistant record', () => {
    const records = parseChatGPTConversations([baseConv])
    const assistant = records.find((r) => r.role === 'assistant')!
    expect(assistant).toBeDefined()
    expect(assistant.role).toBe('assistant')
    expect(assistant.content).toBe('Hi there!')
  })
})

describe('parseChatGPTConversations — filtering', () => {
  it('skips messages with status !== finished_successfully', () => {
    const conv = {
      ...baseConv,
      mapping: {
        'node-1': {
          id: 'node-1',
          message: {
            id: 'msg-1',
            author: { role: 'user' },
            content: { content_type: 'text', parts: ['Hello'] },
            create_time: 1700001,
            status: 'in_progress',
          },
          parent: null,
          children: [],
        },
      },
    }
    const records = parseChatGPTConversations([conv])
    expect(records).toHaveLength(0)
  })

  it('skips messages with content_type !== text', () => {
    const conv = {
      ...baseConv,
      mapping: {
        'node-1': {
          id: 'node-1',
          message: {
            id: 'msg-1',
            author: { role: 'user' },
            content: { content_type: 'tether_quote', parts: ['Hello'] },
            create_time: 1700001,
            status: 'finished_successfully',
          },
          parent: null,
          children: [],
        },
      },
    }
    const records = parseChatGPTConversations([conv])
    expect(records).toHaveLength(0)
  })

  it('skips messages with role === system', () => {
    const conv = {
      ...baseConv,
      mapping: {
        'node-1': {
          id: 'node-1',
          message: {
            id: 'msg-1',
            author: { role: 'system' },
            content: { content_type: 'text', parts: ['System prompt'] },
            create_time: 1700001,
            status: 'finished_successfully',
          },
          parent: null,
          children: [],
        },
      },
    }
    const records = parseChatGPTConversations([conv])
    expect(records).toHaveLength(0)
  })

  it('skips messages where parts produce blank text after join and trim', () => {
    const conv = {
      ...baseConv,
      mapping: {
        'node-1': {
          id: 'node-1',
          message: {
            id: 'msg-1',
            author: { role: 'user' },
            content: { content_type: 'text', parts: ['   ', ''] },
            create_time: 1700001,
            status: 'finished_successfully',
          },
          parent: null,
          children: [],
        },
      },
    }
    const records = parseChatGPTConversations([conv])
    expect(records).toHaveLength(0)
  })
})

describe('parseChatGPTConversations — multi-part joining', () => {
  it('joins multiple string parts with newline', () => {
    const conv = {
      ...baseConv,
      mapping: {
        'node-1': {
          id: 'node-1',
          message: {
            id: 'msg-1',
            author: { role: 'user' },
            content: { content_type: 'text', parts: ['First', 'Second'] },
            create_time: 1700001,
            status: 'finished_successfully',
          },
          parent: null,
          children: [],
        },
      },
    }
    const records = parseChatGPTConversations([conv])
    expect(records[0].content).toBe('First\nSecond')
  })
})

describe('parseChatGPTConversations — null create_time', () => {
  it('falls back to a numeric timestamp when create_time is null', () => {
    const conv = {
      ...baseConv,
      mapping: {
        'node-1': {
          id: 'node-1',
          message: {
            id: 'msg-1',
            author: { role: 'user' },
            content: { content_type: 'text', parts: ['Hello'] },
            create_time: null,
            status: 'finished_successfully',
          },
          parent: null,
          children: [],
        },
      },
    }
    const records = parseChatGPTConversations([conv])
    expect(records).toHaveLength(1)
    expect(typeof records[0].timestamp).toBe('number')
    expect(records[0].timestamp).toBeGreaterThan(0)
  })
})

describe('parseChatGPTConversations — invalid input', () => {
  it('throws when input is not an array', () => {
    expect(() => parseChatGPTConversations({ id: 'x' })).toThrow()
    expect(() => parseChatGPTConversations('string')).toThrow()
  })

  it('throws when input is null', () => {
    expect(() => parseChatGPTConversations(null)).toThrow()
  })
})

describe('parseChatGPTConversations — stable IDs for dedup', () => {
  it('produces identical record IDs on repeated parses of the same input', () => {
    const records1 = parseChatGPTConversations([baseConv])
    const records2 = parseChatGPTConversations([baseConv])
    const ids1 = records1.map(r => r.id).sort()
    const ids2 = records2.map(r => r.id).sort()
    expect(ids1).toEqual(ids2)
  })

  it('record IDs use the chatgpt-import prefix with the message UUID', () => {
    const records = parseChatGPTConversations([baseConv])
    for (const r of records) {
      expect(r.id).toMatch(/^chatgpt-import-/)
    }
  })
})
