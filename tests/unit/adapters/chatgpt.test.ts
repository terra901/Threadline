import { describe, it, expect } from 'vitest'
import { ChatGPTAdapter } from '../../../src/background/adapters/chatgpt'

const adapter = new ChatGPTAdapter()

describe('ChatGPTAdapter.canHandle', () => {
  it('matches chatgpt.com backend URL', () => {
    expect(adapter.canHandle('https://chatgpt.com/backend-api/conversation')).toBe(true)
  })

  it('matches openai API URL', () => {
    expect(adapter.canHandle('https://api.openai.com/v1/chat/completions')).toBe(true)
  })

  it('does not match Claude URL', () => {
    expect(adapter.canHandle('https://claude.ai/api/organizations/x/chat_conversations/y/completion')).toBe(false)
  })
})

describe('ChatGPTAdapter.parse — assembled SSE message', () => {
  const url = 'https://chatgpt.com/backend-api/conversation'
  const timestamp = 1_700_000_000_000

  it('parses assistant assembled message', () => {
    const records = adapter.parse(
      {
        role: 'assistant',
        content: 'Hello! I can help you with that.',
        conversationId: 'conv-abc123',
        model: 'gpt-4o',
        isPartial: false,
      },
      url,
      timestamp
    )

    expect(records).toHaveLength(1)
    expect(records[0].role).toBe('assistant')
    expect(records[0].content).toBe('Hello! I can help you with that.')
    expect(records[0].provider).toBe('openai')
    expect(records[0].sessionId).toBe('openai:conv-abc123')
    expect(records[0].isPartial).toBe(false)
    expect(records[0].isDeleted).toBe(false)
    expect(records[0].id).toMatch(/^[0-9a-f-]{36}$/)
  })

  it('sets isPartial: true when stream was aborted', () => {
    const records = adapter.parse(
      {
        role: 'assistant',
        content: 'This was cut off mid-senten',
        conversationId: 'conv-xyz',
        isPartial: true,
      },
      url,
      timestamp
    )

    expect(records[0].isPartial).toBe(true)
    expect(records[0].content).toBe('This was cut off mid-senten')
  })

  it('parses standard OpenAI completions response', () => {
    const records = adapter.parse(
      {
        id: 'chatcmpl-test',
        object: 'chat.completion',
        model: 'gpt-4o',
        choices: [
          {
            message: { role: 'assistant', content: 'Sure, here is the answer.' },
            finish_reason: 'stop',
            index: 0,
          },
        ],
      },
      'https://api.openai.com/v1/chat/completions',
      timestamp
    )

    expect(records).toHaveLength(1)
    expect(records[0].role).toBe('assistant')
    expect(records[0].content).toBe('Sure, here is the answer.')
    expect(records[0].isPartial).toBe(false)
  })

  it('returns empty array for unrecognised payload', () => {
    expect(adapter.parse({ some: 'random', data: true }, url, timestamp)).toHaveLength(0)
    expect(adapter.parse(null, url, timestamp)).toHaveLength(0)
    expect(adapter.parse('string payload', url, timestamp)).toHaveLength(0)
  })
})
