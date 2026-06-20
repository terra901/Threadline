import { describe, it, expect } from 'vitest'
import { PerplexityAdapter } from '../../../src/background/adapters/perplexity'

const adapter = new PerplexityAdapter()

const URL = 'https://www.perplexity.ai/rest/sse/perplexity_ask'
const TIMESTAMP = 1_700_000_000_000

describe('PerplexityAdapter.canHandle', () => {
  it('matches perplexity_ask SSE URL', () => {
    expect(adapter.canHandle('https://www.perplexity.ai/rest/sse/perplexity_ask')).toBe(true)
  })

  it('matches thread REST URL', () => {
    expect(adapter.canHandle('https://www.perplexity.ai/rest/thread/abc123')).toBe(true)
  })

  it('does not match claude.ai URL', () => {
    expect(adapter.canHandle('https://claude.ai')).toBe(false)
  })
})

describe('PerplexityAdapter.parse — assembled SSE', () => {
  it('parses a user message with messageId', () => {
    const records = adapter.parse(
      {
        role: 'user',
        content: 'What is AI?',
        conversationId: 'thread-1',
        messageId: 'msg-42',
      },
      URL,
      TIMESTAMP
    )

    expect(records).toHaveLength(1)
    expect(records[0].id).toBe('perplexity-msg-42')
    expect(records[0].provider).toBe('perplexity')
    expect(records[0].sessionId).toBe('perplexity:thread-1')
    expect(records[0].isPartial).toBe(false)
  })

  it('includes threadTitle in metadata when present', () => {
    const records = adapter.parse(
      {
        role: 'assistant',
        content: 'Answer',
        conversationId: 'thread-1',
        threadTitle: 'AI Discussion',
      },
      URL,
      TIMESTAMP
    )

    expect(records).toHaveLength(1)
    expect(records[0].metadata).toMatchObject({ threadTitle: 'AI Discussion' })
  })

  it('generates a UUID id when messageId is absent', () => {
    const records = adapter.parse(
      {
        role: 'user',
        content: 'Question without messageId',
        conversationId: 'thread-1',
      },
      URL,
      TIMESTAMP
    )

    expect(records).toHaveLength(1)
    expect(records[0].id).toMatch(/^[0-9a-f-]{36}$/)
  })
})

describe('PerplexityAdapter.parse — thread history', () => {
  const threadHistoryPayload = {
    status: 'success',
    entries: [
      {
        context_uuid: 'ctx-1',
        query_str: 'What is AI?',
        frontend_uuid: 'fe-1',
        backend_uuid: 'be-1',
        blocks: [
          {
            intended_usage: 'ask_text',
            markdown_block: { answer: 'AI is...' },
          },
        ],
        updated_datetime: '2026-01-01T12:00:00',
      },
    ],
  }

  it('parses entries into user and assistant records', () => {
    const records = adapter.parse(threadHistoryPayload, URL, TIMESTAMP)

    expect(records).toHaveLength(2)

    const user = records.find((r) => r.role === 'user')
    const assistant = records.find((r) => r.role === 'assistant')

    expect(user).toBeDefined()
    expect(user!.id).toBe('perplexity-fe-1')
    expect(user!.provider).toBe('perplexity')
    expect(user!.metadata).toMatchObject({ fromHistory: true })

    expect(assistant).toBeDefined()
    expect(assistant!.id).toBe('perplexity-be-1')
    expect(assistant!.provider).toBe('perplexity')
    expect(assistant!.metadata).toMatchObject({ fromHistory: true })
  })

  it('appends Z to updated_datetime without timezone for UTC parsing', () => {
    const records = adapter.parse(threadHistoryPayload, URL, TIMESTAMP)
    const expectedBase = Date.parse('2026-01-01T12:00:00Z')

    expect(records).toHaveLength(2)
    // user gets i*2 offset (i=0 → offset 0), assistant gets i*2+1 offset (i=0 → offset 1)
    const user = records.find((r) => r.role === 'user')
    const assistant = records.find((r) => r.role === 'assistant')
    expect(user!.timestamp).toBe(expectedBase + 0)
    expect(assistant!.timestamp).toBe(expectedBase + 1)
  })

  it('skips entry if context_uuid is missing', () => {
    const records = adapter.parse(
      {
        status: 'success',
        entries: [
          {
            query_str: 'No context_uuid here',
            frontend_uuid: 'fe-x',
            backend_uuid: 'be-x',
          },
        ],
      },
      URL,
      TIMESTAMP
    )

    expect(records).toHaveLength(0)
  })

  it('user timestamp is strictly less than assistant timestamp', () => {
    const records = adapter.parse(threadHistoryPayload, URL, TIMESTAMP)
    const user = records.find((r) => r.role === 'user')
    const assistant = records.find((r) => r.role === 'assistant')

    expect(user!.timestamp).toBeLessThan(assistant!.timestamp)
  })
})

describe('PerplexityAdapter.parse — invalid inputs', () => {
  it('returns [] for null', () => {
    expect(adapter.parse(null, URL, TIMESTAMP)).toHaveLength(0)
  })

  it('returns [] for error status object', () => {
    expect(adapter.parse({ status: 'error' }, URL, TIMESTAMP)).toHaveLength(0)
  })
})
