import { describe, it, expect } from 'vitest'
import { GrokAdapter } from '../../../src/background/adapters/grok'

const adapter = new GrokAdapter()

const URL = 'https://grok.com/rest/app-chat/conversations/new'
const TIMESTAMP = 1_700_000_000_000

describe('GrokAdapter.canHandle', () => {
  it('matches conversations/new URL', () => {
    expect(adapter.canHandle('https://grok.com/rest/app-chat/conversations/new')).toBe(true)
  })

  it('matches conversations/<id>/responses URL', () => {
    expect(adapter.canHandle('https://grok.com/rest/app-chat/conversations/abc123/responses')).toBe(true)
  })

  it('does not match claude.ai URL', () => {
    expect(adapter.canHandle('https://claude.ai')).toBe(false)
  })
})

describe('GrokAdapter.parse — assembled SSE', () => {
  it('parses a user message with messageId and parentMessageId', () => {
    const records = adapter.parse(
      {
        role: 'user',
        content: 'Hello',
        conversationId: 'conv-1',
        messageId: 'msg-99',
        parentMessageId: 'parent-1',
      },
      URL,
      TIMESTAMP
    )

    expect(records).toHaveLength(1)
    expect(records[0].id).toBe('grok-msg-99')
    expect(records[0].provider).toBe('xai')
    expect(records[0].sessionId).toBe('xai:conv-1')
    expect(records[0].parentMessageId).toBe('parent-1')
    expect(records[0].isPartial).toBe(false)
  })

  it('sets isPartial: true and generates UUID id when messageId absent', () => {
    const records = adapter.parse(
      {
        role: 'assistant',
        content: 'Hi',
        conversationId: 'conv-1',
        isPartial: true,
      },
      URL,
      TIMESTAMP
    )

    expect(records).toHaveLength(1)
    expect(records[0].isPartial).toBe(true)
    expect(records[0].id).toMatch(/^[0-9a-f-]{36}$/)
  })
})

describe('GrokAdapter.parse — load-responses', () => {
  const loadResponsesPayload = {
    _conversationId: 'conv-1',
    responses: [
      { sender: 'human', message: 'Hello', responseId: 'r1' },
      { sender: 'assistant', message: 'Hi', responseId: 'r2', parentResponseId: 'r1' },
    ],
  }

  it('parses two responses into user and assistant records', () => {
    const records = adapter.parse(loadResponsesPayload, URL, TIMESTAMP)

    expect(records).toHaveLength(2)

    const user = records.find((r) => r.role === 'user')
    const assistant = records.find((r) => r.role === 'assistant')

    expect(user).toBeDefined()
    expect(user!.id).toBe('grok-r1')
    expect(user!.metadata).toMatchObject({ fromHistory: true })

    expect(assistant).toBeDefined()
    expect(assistant!.id).toBe('grok-r2')
    expect(assistant!.parentMessageId).toBe('grok-r1')
    expect(assistant!.metadata).toMatchObject({ fromHistory: true })
  })

  it('skips isControl: true entries', () => {
    const records = adapter.parse(
      {
        _conversationId: 'conv-1',
        responses: [
          { sender: 'assistant', message: 'Control message', responseId: 'rc1', isControl: true },
          { sender: 'assistant', message: 'Real message', responseId: 'rc2' },
        ],
      },
      URL,
      TIMESTAMP
    )

    expect(records).toHaveLength(1)
    expect(records[0].id).toBe('grok-rc2')
  })

  it('skips entries with sender that is not human or assistant', () => {
    const records = adapter.parse(
      {
        _conversationId: 'conv-1',
        responses: [
          { sender: 'system', message: 'System message', responseId: 'rs1' },
          { sender: 'human', message: 'User message', responseId: 'rs2' },
        ],
      },
      URL,
      TIMESTAMP
    )

    expect(records).toHaveLength(1)
    expect(records[0].id).toBe('grok-rs2')
  })

  it('skips entries with empty messages', () => {
    const records = adapter.parse(
      {
        _conversationId: 'conv-1',
        responses: [
          { sender: 'human', message: '', responseId: 're1' },
          { sender: 'human', message: '   ', responseId: 're2' },
          { sender: 'assistant', message: 'Non-empty', responseId: 're3' },
        ],
      },
      URL,
      TIMESTAMP
    )

    expect(records).toHaveLength(1)
    expect(records[0].id).toBe('grok-re3')
  })

  it('appends Z to createTime without timezone for UTC parsing', () => {
    const createTimeLocal = '2026-01-01T12:00:00'
    const records = adapter.parse(
      {
        _conversationId: 'conv-1',
        responses: [
          { sender: 'human', message: 'Hello', responseId: 'rct1', createTime: createTimeLocal },
        ],
      },
      URL,
      TIMESTAMP
    )

    expect(records).toHaveLength(1)
    expect(records[0].timestamp).toBe(Date.parse(createTimeLocal + 'Z'))
  })

  it('returns [] when _conversationId is missing', () => {
    const records = adapter.parse(
      {
        responses: [{ sender: 'human', message: 'Hello', responseId: 'rx1' }],
      },
      URL,
      TIMESTAMP
    )

    expect(records).toHaveLength(0)
  })

  it('returns [] when responses is empty', () => {
    const records = adapter.parse(
      {
        _conversationId: 'conv-1',
        responses: [],
      },
      URL,
      TIMESTAMP
    )

    expect(records).toHaveLength(0)
  })

  it('handles uppercase ASSISTANT sender from real Grok API', () => {
    const records = adapter.parse(
      {
        _conversationId: 'conv-1',
        responses: [
          { sender: 'human', message: 'Hello', responseId: 'r1' },
          { sender: 'ASSISTANT', message: 'Hi there', responseId: 'r2', parentResponseId: 'r1' },
        ],
      },
      URL,
      TIMESTAMP
    )

    expect(records).toHaveLength(2)
    const assistant = records.find((r) => r.role === 'assistant')
    expect(assistant).toBeDefined()
    expect(assistant!.id).toBe('grok-r2')
    expect(assistant!.role).toBe('assistant')
  })

  it('handles mixed-case sender values', () => {
    const records = adapter.parse(
      {
        _conversationId: 'conv-1',
        responses: [
          { sender: 'Human', message: 'Hello', responseId: 'r1' },
          { sender: 'Assistant', message: 'Hi', responseId: 'r2' },
        ],
      },
      URL,
      TIMESTAMP
    )

    expect(records).toHaveLength(2)
    expect(records.find((r) => r.role === 'user')).toBeDefined()
    expect(records.find((r) => r.role === 'assistant')).toBeDefined()
  })
})

describe('GrokAdapter.parse — invalid inputs', () => {
  it('returns [] for null', () => {
    expect(adapter.parse(null, URL, TIMESTAMP)).toHaveLength(0)
  })

  it('returns [] for empty object', () => {
    expect(adapter.parse({}, URL, TIMESTAMP)).toHaveLength(0)
  })
})
