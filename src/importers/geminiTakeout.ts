import type { SerializableMemoryRecord } from '../types/memory'
import type { IConversationImporter } from './base'
import { registerImporter } from './base'

// ── Gemini Takeout Parser ──────────────────────────────────────────────────────

interface GeminiTakeoutEntry {
  header?: string
  title?: string
  time?: string
  products?: string[]
  safeHtmlItem?: Array<{ html?: string }>
}

export function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<\/li>/gi, '\n')
    .replace(/<li>/gi, '• ')
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

export function parseGeminiTakeout(raw: unknown): SerializableMemoryRecord[] {
  if (!Array.isArray(raw)) {
    throw new Error('Not an array')
  }
  const records: SerializableMemoryRecord[] = []
  const now = Date.now()
  for (const entry of raw as GeminiTakeoutEntry[]) {
    if (entry.header !== 'Gemini Apps') continue
    const timeMs = entry.time ? new Date(entry.time).getTime() : now
    if (isNaN(timeMs)) continue
    const sessionId = `google:takeout-${timeMs}`
    const rawTitle = entry.title ?? ''
    const userText = rawTitle.startsWith('Prompted ') ? rawTitle.slice('Prompted '.length).trim() : rawTitle.trim()
    if (userText) {
      records.push({
        id: `gemini-takeout-user-${timeMs}`,
        role: 'user',
        content: userText,
        provider: 'google',
        sessionId,
        timestamp: timeMs,
        createdAt: timeMs,
        isPartial: false,
        isDeleted: false,
        isSuperseded: false,
        metadata: { source: 'google-takeout' },
      })
    }
    const htmlParts = (entry.safeHtmlItem ?? []).map((item) => stripHtml(item.html ?? '')).filter(Boolean)
    const assistantText = htmlParts.join('\n\n')
    if (assistantText) {
      records.push({
        id: `gemini-takeout-assistant-${timeMs}`,
        role: 'assistant',
        content: assistantText,
        provider: 'google',
        sessionId,
        timestamp: timeMs + 1,
        createdAt: timeMs,
        isPartial: false,
        isDeleted: false,
        isSuperseded: false,
        metadata: { source: 'google-takeout' },
      })
    }
  }
  return records
}

class GeminiTakeoutImporter implements IConversationImporter {
  readonly id = 'gemini'
  readonly displayName = 'Gemini (Google Takeout JSON)'
  readonly provider = 'google' as const
  canHandle(raw: unknown): boolean {
    return (
      Array.isArray(raw) &&
      (raw as Array<{ header?: string }>).some((e) => e.header === 'Gemini Apps')
    )
  }
  parse(raw: unknown): SerializableMemoryRecord[] { return parseGeminiTakeout(raw) }
}

registerImporter(new GeminiTakeoutImporter())
