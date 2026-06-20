import { describe, it, expect } from 'vitest'
import { parseClaudeConversations } from '../../../src/importers/claudeConversations'

const CONV_UUID = 'f88687d6-b4be-42ed-babe-38ee2ba78b52'
const MSG_UUID_1 = '019ca07d-f0b7-78ce-bebb-4dfbc9308140'
const MSG_UUID_2 = '019ca07d-f0b7-7832-8852-a0d7d27d9776'

const baseConversation = {
  uuid: CONV_UUID,
  name: 'Greeting',
  created_at: '2026-02-27T19:05:33.386345Z',
  updated_at: '2026-02-27T19:53:09.726345Z',
  chat_messages: [
    {
      uuid: MSG_UUID_1,
      text: 'hihi',
      content: [{ type: 'text', text: 'hihi', citations: [] }],
      sender: 'human',
      created_at: '2026-02-27T19:05:34.480990Z',
      updated_at: '2026-02-27T19:05:34.480990Z',
    },
    {
      uuid: MSG_UUID_2,
      text: "Hey! How's it going?",
      content: [{ type: 'text', text: "Hey! How's it going?", citations: [] }],
      sender: 'assistant',
      created_at: '2026-02-27T19:05:35.231672Z',
      updated_at: '2026-02-27T19:05:35.231672Z',
    },
  ],
}

describe('parseClaudeConversations — happy path', () => {
  it('parses a standard conversations.json array', () => {
    const records = parseClaudeConversations([baseConversation])

    expect(records).toHaveLength(2)

    const [user, assistant] = records
    expect(user.id).toBe(MSG_UUID_1)
    expect(user.role).toBe('user')
    expect(user.content).toBe('hihi')
    expect(user.provider).toBe('anthropic')
    expect(user.sessionId).toBe(`anthropic:${CONV_UUID}`)
    expect(user.isPartial).toBe(false)
    expect(user.isDeleted).toBe(false)
    expect(user.isSuperseded).toBe(false)
    expect(user.metadata?.fromHistory).toBe(true)
    expect(user.metadata?.source).toBe('claude-export')
    expect(user.metadata?.conversationTitle).toBe('Greeting')

    expect(assistant.id).toBe(MSG_UUID_2)
    expect(assistant.role).toBe('assistant')
  })

  it('timestamp matches updated_at field', () => {
    const records = parseClaudeConversations([baseConversation])
    const expected = Date.parse('2026-02-27T19:05:34.480990Z')
    expect(records[0].timestamp).toBe(expected)
  })
})

describe('parseClaudeConversations — content extraction', () => {
  it('prefers content[] array over text field', () => {
    const conv = {
      ...baseConversation,
      chat_messages: [
        {
          uuid: MSG_UUID_1,
          text: 'fallback text',
          content: [{ type: 'text', text: 'preferred content' }],
          sender: 'human',
          created_at: '2026-02-27T19:05:34.480990Z',
          updated_at: '2026-02-27T19:05:34.480990Z',
        },
      ],
    }
    const records = parseClaudeConversations([conv])
    expect(records[0].content).toBe('preferred content')
  })

  it('falls back to text field when content array is absent', () => {
    const conv = {
      ...baseConversation,
      chat_messages: [
        {
          uuid: MSG_UUID_1,
          text: 'only text field',
          sender: 'human',
          created_at: '2026-02-27T19:05:34.480990Z',
          updated_at: '2026-02-27T19:05:34.480990Z',
        },
      ],
    }
    const records = parseClaudeConversations([conv])
    expect(records[0].content).toBe('only text field')
  })

  it('falls back to text field when content array is empty', () => {
    const conv = {
      ...baseConversation,
      chat_messages: [
        {
          uuid: MSG_UUID_1,
          text: 'text fallback when content empty',
          content: [],
          sender: 'human',
          created_at: '2026-02-27T19:05:34.480990Z',
          updated_at: '2026-02-27T19:05:34.480990Z',
        },
      ],
    }
    const records = parseClaudeConversations([conv])
    expect(records[0].content).toBe('text fallback when content empty')
  })
})

describe('parseClaudeConversations — timestamp priority', () => {
  it('prefers updated_at over created_at', () => {
    const conv = {
      ...baseConversation,
      chat_messages: [
        {
          uuid: MSG_UUID_1,
          text: 'hi',
          sender: 'human',
          created_at: '2026-02-27T10:00:00.000Z',
          updated_at: '2026-02-27T20:00:00.000Z',
        },
      ],
    }
    const records = parseClaudeConversations([conv])
    expect(records[0].timestamp).toBe(Date.parse('2026-02-27T20:00:00.000Z'))
  })

  it('falls back to created_at when updated_at is absent', () => {
    const conv = {
      ...baseConversation,
      chat_messages: [
        {
          uuid: MSG_UUID_1,
          text: 'hi',
          sender: 'human',
          created_at: '2026-02-27T10:00:00.000Z',
          updated_at: '',
        },
      ],
    }
    const records = parseClaudeConversations([conv])
    expect(records[0].timestamp).toBe(Date.parse('2026-02-27T10:00:00.000Z'))
  })
})

describe('parseClaudeConversations — filtering', () => {
  it('skips messages with empty text', () => {
    const conv = {
      ...baseConversation,
      chat_messages: [
        {
          uuid: MSG_UUID_1,
          text: '',
          content: [{ type: 'text', text: '   ' }],
          sender: 'human',
          created_at: '2026-02-27T19:05:34.480990Z',
          updated_at: '2026-02-27T19:05:34.480990Z',
        },
      ],
    }
    const records = parseClaudeConversations([conv])
    expect(records).toHaveLength(0)
  })

  it('skips messages without uuid', () => {
    const conv = {
      ...baseConversation,
      chat_messages: [
        {
          uuid: '',
          text: 'some text',
          sender: 'human',
          created_at: '2026-02-27T19:05:34.480990Z',
          updated_at: '2026-02-27T19:05:34.480990Z',
        },
      ],
    }
    const records = parseClaudeConversations([conv])
    expect(records).toHaveLength(0)
  })
})

describe('parseClaudeConversations — multiple conversations', () => {
  it('produces separate sessionIds for each conversation', () => {
    const conv2 = {
      uuid: 'aaaaaaaa-0000-0000-0000-000000000001',
      name: 'Second Chat',
      chat_messages: [
        {
          uuid: 'bbbbbbbb-0000-0000-0000-000000000001',
          text: 'hello',
          sender: 'human',
          created_at: '2026-02-27T20:00:00.000Z',
          updated_at: '2026-02-27T20:00:00.000Z',
        },
      ],
    }
    const records = parseClaudeConversations([baseConversation, conv2])
    const sessionIds = new Set(records.map((r) => r.sessionId))
    expect(sessionIds.size).toBe(2)
    expect(sessionIds.has(`anthropic:${CONV_UUID}`)).toBe(true)
    expect(sessionIds.has('anthropic:aaaaaaaa-0000-0000-0000-000000000001')).toBe(true)
  })
})

describe('parseClaudeConversations — invalid input', () => {
  it('throws on non-array input', () => {
    expect(() => parseClaudeConversations({ uuid: 'x', chat_messages: [] })).toThrow()
    expect(() => parseClaudeConversations('string')).toThrow()
    expect(() => parseClaudeConversations(null)).toThrow()
  })

  it('skips conversations missing uuid', () => {
    const conv = { name: 'No UUID', chat_messages: [{ uuid: MSG_UUID_1, text: 'hi', sender: 'human', created_at: '', updated_at: '' }] }
    const records = parseClaudeConversations([conv])
    expect(records).toHaveLength(0)
  })

  it('skips conversations where chat_messages is not an array', () => {
    const conv = { uuid: CONV_UUID, name: 'Bad', chat_messages: null }
    const records = parseClaudeConversations([conv])
    expect(records).toHaveLength(0)
  })
})

describe('parseClaudeConversations — dedup key', () => {
  it('uses raw msg.uuid as record id (no prefix)', () => {
    const records = parseClaudeConversations([baseConversation])
    expect(records[0].id).toBe(MSG_UUID_1)
    expect(records[0].id).not.toContain('claude-import-')
  })
})
