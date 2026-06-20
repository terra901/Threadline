import { describe, it, expect } from 'vitest'
import { GeminiAdapter } from '../../../src/background/adapters/gemini'

const adapter = new GeminiAdapter()

const URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent'
const TIMESTAMP = 1_700_000_000_000

describe('GeminiAdapter.canHandle', () => {
  it('matches generativelanguage.googleapis.com URL', () => {
    expect(
      adapter.canHandle('https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent')
    ).toBe(true)
  })

  it('matches gemini.google.com/_/BardChatUi URL', () => {
    expect(
      adapter.canHandle('https://gemini.google.com/_/BardChatUi/data/StreamGenerate')
    ).toBe(true)
  })

  it('does not match gemini.google.com/dom-sync URL (route removed; injector now uses DOM_SYNC directly)', () => {
    expect(adapter.canHandle('https://gemini.google.com/dom-sync')).toBe(false)
  })

  it('does not match claude.ai URL', () => {
    expect(adapter.canHandle('https://claude.ai')).toBe(false)
  })
})

describe('GeminiAdapter.parse — turns batch (DOM history)', () => {
  it('parses two turns into two records', () => {
    const records = adapter.parse(
      {
        turns: [
          { role: 'user', content: 'Hello', timestamp: 1700000000000 },
          { role: 'model', content: 'Hi', timestamp: 1700000001000 },
        ],
        conversationId: 'conv-abc',
      },
      URL,
      TIMESTAMP
    )

    expect(records).toHaveLength(2)
  })

  it('user turn has correct provider, sessionId, fromHistory, and stable id prefix', () => {
    const records = adapter.parse(
      {
        turns: [
          { role: 'user', content: 'Hello', timestamp: 1700000000000 },
          { role: 'model', content: 'Hi', timestamp: 1700000001000 },
        ],
        conversationId: 'conv-abc',
      },
      URL,
      TIMESTAMP
    )

    const user = records[0]
    expect(user.provider).toBe('google')
    expect(user.sessionId).toBe('google:conv-abc')
    expect(user.metadata).toMatchObject({ fromHistory: true })
    expect(user.id).toMatch(/^google:conv-abc:u:/)
  })

  it('model turn has role assistant and stable id prefix with :a:', () => {
    const records = adapter.parse(
      {
        turns: [
          { role: 'user', content: 'Hello', timestamp: 1700000000000 },
          { role: 'model', content: 'Hi', timestamp: 1700000001000 },
        ],
        conversationId: 'conv-abc',
      },
      URL,
      TIMESTAMP
    )

    const model = records[1]
    expect(model.role).toBe('assistant')
    expect(model.id).toMatch(/^google:conv-abc:a:/)
  })

  it('produces same stable id on repeated calls with same input', () => {
    const input = {
      turns: [{ role: 'user', content: 'Hello', timestamp: 1700000000000 }],
      conversationId: 'conv-abc',
    }

    const first = adapter.parse(input, URL, TIMESTAMP)
    const second = adapter.parse(input, URL, TIMESTAMP)

    expect(first[0].id).toBe(second[0].id)
  })

  it('uses UUID id when conversationId is missing', () => {
    const records = adapter.parse(
      {
        turns: [{ role: 'user', content: 'Hello', timestamp: 1700000000000 }],
      },
      URL,
      TIMESTAMP
    )

    expect(records).toHaveLength(1)
    expect(records[0].id).toMatch(/^[0-9a-f-]{36}$/)
  })

  it('uses UUID id when conversationId is empty string', () => {
    const records = adapter.parse(
      {
        turns: [{ role: 'user', content: 'Hello', timestamp: 1700000000000 }],
        conversationId: '',
      },
      URL,
      TIMESTAMP
    )

    expect(records).toHaveLength(1)
    expect(records[0].id).toMatch(/^[0-9a-f-]{36}$/)
  })

  it('skips turns with missing role', () => {
    const records = adapter.parse(
      {
        turns: [
          { content: 'No role here', timestamp: 1700000000000 },
          { role: 'user', content: 'Valid', timestamp: 1700000001000 },
        ],
        conversationId: 'conv-abc',
      },
      URL,
      TIMESTAMP
    )

    expect(records).toHaveLength(1)
    expect(records[0].content).toBe('Valid')
  })

  it('skips turns with missing content', () => {
    const records = adapter.parse(
      {
        turns: [
          { role: 'user', timestamp: 1700000000000 },
          { role: 'model', content: 'Present', timestamp: 1700000001000 },
        ],
        conversationId: 'conv-abc',
      },
      URL,
      TIMESTAMP
    )

    expect(records).toHaveLength(1)
    expect(records[0].content).toBe('Present')
  })
})

describe('GeminiAdapter.parse — API response (generateContent)', () => {
  it('parses a single candidate with finishReason STOP as non-partial', () => {
    const records = adapter.parse(
      {
        candidates: [
          {
            content: { role: 'assistant', parts: [{ text: 'Hello' }] },
            finishReason: 'STOP',
          },
        ],
      },
      URL,
      TIMESTAMP
    )

    expect(records).toHaveLength(1)
    expect(records[0].role).toBe('assistant')
    expect(records[0].provider).toBe('google')
    expect(records[0].isPartial).toBe(false)
    expect(records[0].id).toMatch(/^[0-9a-f-]{36}$/)
  })

  it('sets isPartial true when finishReason is not STOP', () => {
    const records = adapter.parse(
      {
        candidates: [
          {
            content: { role: 'assistant', parts: [{ text: 'Partial...' }] },
            finishReason: 'MAX_TOKENS',
          },
        ],
      },
      URL,
      TIMESTAMP
    )

    expect(records).toHaveLength(1)
    expect(records[0].isPartial).toBe(true)
  })

  it('joins multiple parts with newline then normalizes whitespace', () => {
    const records = adapter.parse(
      {
        candidates: [
          {
            content: {
              role: 'assistant',
              parts: [{ text: 'First part' }, { text: 'Second part' }],
            },
            finishReason: 'STOP',
          },
        ],
      },
      URL,
      TIMESTAMP
    )

    expect(records).toHaveLength(1)
    // normalizeContent collapses the joined newline into a space
    expect(records[0].content).toBe('First part Second part')
  })

  it('returns [] for empty candidates array', () => {
    const records = adapter.parse(
      { candidates: [] },
      URL,
      TIMESTAMP
    )

    expect(records).toHaveLength(0)
  })
})

describe('GeminiAdapter.parse — assembled SSE', () => {
  it('parses a user assembled message with UUID id when no fromHistory', () => {
    const records = adapter.parse(
      {
        role: 'user',
        content: 'Hello',
        conversationId: 'conv-1',
        isPartial: false,
      },
      URL,
      TIMESTAMP
    )

    expect(records).toHaveLength(1)
    expect(records[0].role).toBe('user')
    expect(records[0].provider).toBe('google')
    expect(records[0].sessionId).toBe('google:conv-1')
    expect(records[0].id).toMatch(/^[0-9a-f-]{36}$/)
  })

  it('uses stable id for fromHistory assistant message with known conversationId', () => {
    const records = adapter.parse(
      {
        role: 'assistant',
        content: 'Hi',
        conversationId: 'conv-1',
        metadata: { fromHistory: true },
      },
      URL,
      TIMESTAMP
    )

    expect(records).toHaveLength(1)
    expect(records[0].id).toMatch(/^google:conv-1:a:/)
  })

  it('passes metadata through on assembled message', () => {
    const records = adapter.parse(
      {
        role: 'assistant',
        content: 'Hi',
        conversationId: 'conv-1',
        metadata: { fromHistory: true },
      },
      URL,
      TIMESTAMP
    )

    expect(records[0].metadata).toMatchObject({ fromHistory: true })
  })

  it('sets isPartial true when isPartial is true', () => {
    const records = adapter.parse(
      {
        role: 'assistant',
        content: 'Streaming...',
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

describe('GeminiAdapter.parse — invalid inputs', () => {
  it('returns [] for null', () => {
    expect(adapter.parse(null, URL, TIMESTAMP)).toHaveLength(0)
  })

  it('returns [] for empty object', () => {
    expect(adapter.parse({}, URL, TIMESTAMP)).toHaveLength(0)
  })

  it('returns [] for string input', () => {
    expect(adapter.parse('some string', URL, TIMESTAMP)).toHaveLength(0)
  })
})
