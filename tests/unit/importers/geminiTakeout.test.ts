import { describe, it, expect } from 'vitest'
import { stripHtml, parseGeminiTakeout } from '../../../src/importers/geminiTakeout'

describe('stripHtml — tag replacement', () => {
  it('converts <br> to newline', () => {
    expect(stripHtml('line1<br>line2')).toBe('line1\nline2')
  })

  it('converts <br /> to newline', () => {
    expect(stripHtml('line1<br />line2')).toBe('line1\nline2')
  })

  it('converts </p> to newline', () => {
    expect(stripHtml('<p>line1</p><p>line2</p>')).toBe('line1\nline2')
  })

  it('converts <li> to bullet and </li> to newline', () => {
    expect(stripHtml('<li>item</li>')).toBe('• item')
  })

  it('strips remaining HTML tags', () => {
    expect(stripHtml('<strong>bold</strong>')).toBe('bold')
  })

  it('decodes HTML entities', () => {
    expect(stripHtml('&lt;b&gt;&amp;&lt;/b&gt;')).toBe('<b>&</b>')
  })

  it('decodes &quot; and &#39;', () => {
    expect(stripHtml('&quot;hello&quot; &#39;world&#39;')).toBe('"hello" \'world\'')
  })

  it('collapses 3+ consecutive newlines to 2', () => {
    const input = 'a\n\n\n\nb'
    const result = stripHtml(input)
    expect(result).toBe('a\n\nb')
  })

  it('trims leading and trailing whitespace', () => {
    expect(stripHtml('  hello  ')).toBe('hello')
  })
})

describe('parseGeminiTakeout — happy path', () => {
  const timeString = '2024-01-15T12:00:00Z'
  const timeMs = new Date(timeString).getTime()

  const entry = {
    header: 'Gemini Apps',
    title: 'Prompted Tell me about cats',
    time: timeString,
    safeHtmlItem: [{ html: '<p>Cats are curious animals.</p>' }],
  }

  it('produces user and assistant records', () => {
    const records = parseGeminiTakeout([entry])
    expect(records).toHaveLength(2)
  })

  it('user record has correct fields', () => {
    const records = parseGeminiTakeout([entry])
    const user = records.find((r) => r.role === 'user')!
    expect(user).toBeDefined()
    expect(user.id).toBe(`gemini-takeout-user-${timeMs}`)
    expect(user.role).toBe('user')
    expect(user.content).toBe('Tell me about cats')
    expect(user.provider).toBe('google')
    expect(user.sessionId).toBe(`google:takeout-${timeMs}`)
    expect(user.timestamp).toBe(timeMs)
    expect(user.createdAt).toBe(timeMs)
    expect(user.isPartial).toBe(false)
    expect(user.isDeleted).toBe(false)
    expect(user.isSuperseded).toBe(false)
    expect(user.metadata?.source).toBe('google-takeout')
  })

  it('assistant record has correct fields', () => {
    const records = parseGeminiTakeout([entry])
    const assistant = records.find((r) => r.role === 'assistant')!
    expect(assistant).toBeDefined()
    expect(assistant.id).toBe(`gemini-takeout-assistant-${timeMs}`)
    expect(assistant.role).toBe('assistant')
    expect(assistant.timestamp).toBe(timeMs + 1)
    expect(assistant.createdAt).toBe(timeMs)
    expect(assistant.metadata?.source).toBe('google-takeout')
  })

  it('assistant content has HTML stripped and items joined with double newline', () => {
    const multiEntry = {
      ...entry,
      safeHtmlItem: [
        { html: '<p>First response.</p>' },
        { html: '<p>Second response.</p>' },
      ],
    }
    const records = parseGeminiTakeout([multiEntry])
    const assistant = records.find((r) => r.role === 'assistant')!
    expect(assistant.content).toBe('First response.\n\nSecond response.')
  })
})

describe('parseGeminiTakeout — filtering', () => {
  it('skips entries where header !== Gemini Apps', () => {
    const entry = {
      header: 'YouTube',
      title: 'Prompted some query',
      time: '2024-01-15T12:00:00Z',
      safeHtmlItem: [{ html: '<p>response</p>' }],
    }
    const records = parseGeminiTakeout([entry])
    expect(records).toHaveLength(0)
  })

  it('skips entries with invalid time (NaN)', () => {
    const entry = {
      header: 'Gemini Apps',
      title: 'Prompted something',
      time: 'not-a-date',
      safeHtmlItem: [{ html: '<p>response</p>' }],
    }
    const records = parseGeminiTakeout([entry])
    expect(records).toHaveLength(0)
  })

  it('uses title directly when no "Prompted " prefix', () => {
    const entry = {
      header: 'Gemini Apps',
      title: 'What is the speed of light?',
      time: '2024-01-15T12:00:00Z',
      safeHtmlItem: [],
    }
    const records = parseGeminiTakeout([entry])
    const user = records.find((r) => r.role === 'user')!
    expect(user.content).toBe('What is the speed of light?')
  })

  it('skips user record if title is empty', () => {
    const entry = {
      header: 'Gemini Apps',
      title: '',
      time: '2024-01-15T12:00:00Z',
      safeHtmlItem: [{ html: '<p>response</p>' }],
    }
    const records = parseGeminiTakeout([entry])
    expect(records.find((r) => r.role === 'user')).toBeUndefined()
  })
})

describe('parseGeminiTakeout — invalid input', () => {
  it('throws when input is not an array', () => {
    expect(() => parseGeminiTakeout({ header: 'Gemini Apps' })).toThrow()
    expect(() => parseGeminiTakeout('string')).toThrow()
    expect(() => parseGeminiTakeout(null)).toThrow()
  })
})
