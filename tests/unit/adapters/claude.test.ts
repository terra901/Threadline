import { describe, it, expect } from 'vitest'
import { ClaudeAdapter } from '../../../src/background/adapters/claude'

const adapter = new ClaudeAdapter()

const URL = 'https://claude.ai/api/organizations/x/chat_conversations/y/completion'
const TIMESTAMP = 1_700_000_000_000

describe('ClaudeAdapter.canHandle', () => {
  it('matches claude.ai API URL', () => {
    expect(adapter.canHandle('https://claude.ai/api/organizations/x/chat_conversations/y/completion')).toBe(true)
  })

  it('matches api.anthropic.com messages URL', () => {
    expect(adapter.canHandle('https://api.anthropic.com/v1/messages')).toBe(true)
  })

  it('does not match ChatGPT URL', () => {
    expect(adapter.canHandle('https://chatgpt.com/backend-api/conversation')).toBe(false)
  })
})

describe('ClaudeAdapter.parse — Anthropic API message format', () => {
  it('parses a message with stop_reason end_turn as non-partial', () => {
    const records = adapter.parse(
      {
        type: 'message',
        content: [{ type: 'text', text: 'Hello' }],
        stop_reason: 'end_turn',
      },
      URL,
      TIMESTAMP
    )

    expect(records).toHaveLength(1)
    expect(records[0].role).toBe('assistant')
    expect(records[0].provider).toBe('anthropic')
    expect(records[0].isPartial).toBe(false)
    expect(records[0].id).toMatch(/^[0-9a-f-]{36}$/)
    expect(records[0].sessionId).toMatch(/^anthropic:/)
  })

  it('sets isPartial: true when stop_reason is not end_turn', () => {
    const records = adapter.parse(
      {
        type: 'message',
        content: [{ type: 'text', text: 'Partial response' }],
      },
      URL,
      TIMESTAMP
    )

    expect(records).toHaveLength(1)
    expect(records[0].isPartial).toBe(true)
  })

  it('joins multiple text blocks with newline', () => {
    const records = adapter.parse(
      {
        type: 'message',
        content: [
          { type: 'text', text: 'First block' },
          { type: 'text', text: 'Second block' },
        ],
        stop_reason: 'end_turn',
      },
      URL,
      TIMESTAMP
    )

    expect(records).toHaveLength(1)
    // normalizeContent collapses whitespace, so the joined newline becomes a space
    expect(records[0].content).toBe('First block Second block')
  })

  it('returns [] for empty content blocks', () => {
    const records = adapter.parse(
      {
        type: 'message',
        content: [],
        stop_reason: 'end_turn',
      },
      URL,
      TIMESTAMP
    )

    expect(records).toHaveLength(0)
  })
})

describe('ClaudeAdapter.parse — assembled SSE format', () => {
  it('parses an assistant assembled message', () => {
    const records = adapter.parse(
      {
        role: 'assistant',
        content: 'Hi there',
        conversationId: 'conv-1',
        model: 'claude-3',
      },
      URL,
      TIMESTAMP
    )

    expect(records).toHaveLength(1)
    expect(records[0].role).toBe('assistant')
    expect(records[0].provider).toBe('anthropic')
    expect(records[0].sessionId).toBe('anthropic:conv-1')
    expect(records[0].model).toBe('claude-3')
    expect(records[0].isPartial).toBe(false)
  })

  it('maps role "human" to "user"', () => {
    const records = adapter.parse(
      { role: 'human', content: 'Hello', conversationId: 'conv-1' },
      URL,
      TIMESTAMP
    )

    expect(records).toHaveLength(1)
    expect(records[0].role).toBe('user')
  })

  it('maps role "user" to "user"', () => {
    const records = adapter.parse(
      { role: 'user', content: 'Hello', conversationId: 'conv-1' },
      URL,
      TIMESTAMP
    )

    expect(records).toHaveLength(1)
    expect(records[0].role).toBe('user')
  })

  it('sets isPartial from data.isPartial', () => {
    const records = adapter.parse(
      {
        role: 'assistant',
        content: 'Partial...',
        conversationId: 'conv-1',
        isPartial: true,
      },
      URL,
      TIMESTAMP
    )

    expect(records).toHaveLength(1)
    expect(records[0].isPartial).toBe(true)
  })
})

describe('ClaudeAdapter.parse — chat_messages format', () => {
  it('parses a conversation with one human message', () => {
    const records = adapter.parse(
      {
        uuid: 'conv-uuid',
        chat_messages: [
          {
            uuid: 'msg-1',
            content: [{ type: 'text', text: 'hi' }],
            sender: 'human',
            updated_at: '2026-01-01T00:00:00Z',
          },
        ],
      },
      URL,
      TIMESTAMP
    )

    expect(records).toHaveLength(1)
    expect(records[0].id).toBe('msg-1')
    expect(records[0].role).toBe('user')
    expect(records[0].sessionId).toBe('anthropic:conv-uuid')
    expect(records[0].metadata).toMatchObject({ fromHistory: true })
  })

  it('prefers content[] array over text field', () => {
    const records = adapter.parse(
      {
        uuid: 'conv-uuid',
        chat_messages: [
          {
            uuid: 'msg-2',
            content: [{ type: 'text', text: 'from content array' }],
            text: 'from text field',
            sender: 'human',
          },
        ],
      },
      URL,
      TIMESTAMP
    )

    expect(records).toHaveLength(1)
    expect(records[0].content).toBe('from content array')
  })

  it('falls back to text field when content is absent', () => {
    const records = adapter.parse(
      {
        uuid: 'conv-uuid',
        chat_messages: [
          {
            uuid: 'msg-3',
            text: 'fallback text',
            sender: 'human',
          },
        ],
      },
      URL,
      TIMESTAMP
    )

    expect(records).toHaveLength(1)
    expect(records[0].content).toBe('fallback text')
  })

  it('skips messages without uuid', () => {
    const records = adapter.parse(
      {
        uuid: 'conv-uuid',
        chat_messages: [
          {
            content: [{ type: 'text', text: 'no uuid here' }],
            sender: 'human',
          },
        ],
      },
      URL,
      TIMESTAMP
    )

    expect(records).toHaveLength(0)
  })

  it('skips messages with empty text', () => {
    const records = adapter.parse(
      {
        uuid: 'conv-uuid',
        chat_messages: [
          {
            uuid: 'msg-empty',
            content: [{ type: 'text', text: '' }],
            sender: 'human',
          },
        ],
      },
      URL,
      TIMESTAMP
    )

    expect(records).toHaveLength(0)
  })

  it('maps sender "assistant" to role "assistant"', () => {
    const records = adapter.parse(
      {
        uuid: 'conv-uuid',
        chat_messages: [
          {
            uuid: 'msg-a',
            content: [{ type: 'text', text: 'I am the assistant' }],
            sender: 'assistant',
          },
        ],
      },
      URL,
      TIMESTAMP
    )

    expect(records).toHaveLength(1)
    expect(records[0].role).toBe('assistant')
  })

  it('uses updated_at for timestamp when present', () => {
    const records = adapter.parse(
      {
        uuid: 'conv-uuid',
        chat_messages: [
          {
            uuid: 'msg-ts',
            content: [{ type: 'text', text: 'timestamped' }],
            sender: 'human',
            updated_at: '2026-01-01T00:00:00Z',
            created_at: '2025-12-31T00:00:00Z',
          },
        ],
      },
      URL,
      TIMESTAMP
    )

    expect(records).toHaveLength(1)
    expect(records[0].timestamp).toBe(Date.parse('2026-01-01T00:00:00Z'))
  })

  it('falls back to created_at when updated_at is absent', () => {
    const records = adapter.parse(
      {
        uuid: 'conv-uuid',
        chat_messages: [
          {
            uuid: 'msg-ts2',
            content: [{ type: 'text', text: 'created at fallback' }],
            sender: 'human',
            created_at: '2025-12-31T00:00:00Z',
          },
        ],
      },
      URL,
      TIMESTAMP
    )

    expect(records).toHaveLength(1)
    expect(records[0].timestamp).toBe(Date.parse('2025-12-31T00:00:00Z'))
  })
})

describe('ClaudeAdapter.parse — invalid inputs', () => {
  it('returns [] for null', () => {
    expect(adapter.parse(null, URL, TIMESTAMP)).toHaveLength(0)
  })

  it('returns [] for string input', () => {
    expect(adapter.parse('some string', URL, TIMESTAMP)).toHaveLength(0)
  })

  it('returns [] for empty object', () => {
    expect(adapter.parse({}, URL, TIMESTAMP)).toHaveLength(0)
  })
})
