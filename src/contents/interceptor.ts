/**
 * Isolated-world content script: forwards MAIN-world capture messages to background.
 *
 * The MAIN world script (injected via chrome.scripting.executeScript) overrides
 * window.fetch and XHR, then sends window.postMessage({ type: '__ai_memory_capture__', payload }).
 * CustomEvent does not cross the MAIN/ISOLATED boundary, so we use postMessage.
 * This script listens for that message and forwards to background via chrome.runtime.sendMessage.
 *
 * Also monitors page title changes and updates conversation titles in the database.
 */

import type { PlasmoCSConfig } from 'plasmo'

export const config: PlasmoCSConfig = {
  matches: [
    'https://chat.openai.com/*',
    'https://chatgpt.com/*',
    'https://claude.ai/new/',
    'https://claude.ai/chat/*',
    'https://gemini.google.com/*',
    'https://www.perplexity.ai/*',
    'https://grok.com/*',
  ],
}

const POST_TYPE = '__ai_memory_capture__'

/** Returns false if extension context is invalidated (e.g. after reload). */
function isExtensionContextValid(): boolean {
  try {
    void chrome.runtime?.id
    return true
  } catch {
    return false
  }
}

/**
 * Per-provider strategy for extracting a conversationId from rawData.
 * Add a new entry here when adding a new provider.
 */
const SESSION_ID_EXTRACTORS: Record<string, (data: Record<string, unknown>) => string | undefined> = {
  openai:      (data) => (data['conversationId'] ?? data['conversation_id']) as string | undefined,
  anthropic:   (data) => (data['conversationId'] ?? data['id']) as string | undefined,
  google:      (data) => data['conversationId'] as string | undefined,
  perplexity:  (data) => {
    // Live SSE assembled message: has conversationId
    if (typeof data['conversationId'] === 'string') return data['conversationId'] as string
    // Thread history REST response: { status: 'success', entries: [...] }
    // Extract context_uuid from first entry
    if (Array.isArray(data['entries']) && data['entries'].length > 0) {
      const first = data['entries'][0] as Record<string, unknown>
      if (typeof first['context_uuid'] === 'string') return first['context_uuid'] as string
    }
    return undefined
  },
  xai: (data) => {
    // Assembled streaming message: has conversationId
    if (typeof data['conversationId'] === 'string') return data['conversationId'] as string
    // History load-responses: injector injects _conversationId
    if (typeof data['_conversationId'] === 'string') return data['_conversationId'] as string
    return undefined
  },
}

/**
 * Extract sessionId from rawData if available.
 * Format: provider:conversationId
 */
function extractSessionId(payload: {
  provider?: string
  rawData?: unknown
}): string | null {
  if (!payload.provider || !payload.rawData || typeof payload.rawData !== 'object') {
    return null
  }

  const data = payload.rawData as Record<string, unknown>
  const extractor = SESSION_ID_EXTRACTORS[payload.provider]
  if (!extractor) return null

  const conversationId = extractor(data)
  if (conversationId && typeof conversationId === 'string' && conversationId.trim()) {
    return `${payload.provider}:${conversationId.trim()}`
  }

  return null
}

/**
 * Get the best available page title for the current platform.
 * For Gemini, reads from the active conversation item in the sidebar
 * (more reliable than document.title which may include site suffixes).
 */
function getPageTitle(): string {
  if (window.location.hostname === 'gemini.google.com') {
    const el = document.querySelector<HTMLElement>('[aria-current="true"][data-test-id="conversation"] div')
    const geminiTitle = el?.textContent?.trim()
    if (geminiTitle) return geminiTitle
  }
  return document.title?.trim() ?? ''
}

/**
 * Update conversation title from current page title.
 */
function updateConversationTitle(sessionId: string): void {
  if (!isExtensionContextValid()) return

  const title = getPageTitle()
  if (!title) return

  try {
    chrome.runtime.sendMessage(
      {
        type: 'UPDATE_CONVERSATION_TITLE',
        payload: { sessionId, title },
      },
      () => {
        try {
          void chrome.runtime.lastError
        } catch {
          // Extension context invalidated; ignore
        }
      }
    )
  } catch {
    // Extension context invalidated or sendMessage failed; ignore
  }
}

// Track last sessionId from captures so we can update its title when the page title changes
// (ChatGPT generates the real title asynchronously after the first exchange)
let lastSessionId: string | null = null
let lastTitle = document.title

/**
 * Extract conversationId segment from the current page URL.
 * Works for ChatGPT (/c/<id>), Claude (/chat/<id>), etc.
 * Returns null if no conversation ID segment is found.
 */
function getConversationIdFromUrl(): string | null {
  const path = window.location.pathname
  // Match the last UUID-like or alphanumeric segment after /c/, /chat/, /conversation/, /search/
  const m = path.match(/\/(?:c|chat|conversation|search)s?\/([^/]+)/)
  return m ? m[1] : null
}

const titleObserver = new MutationObserver(() => {
  const currentTitle = document.title
  if (currentTitle === lastTitle || !lastSessionId) return
  lastTitle = currentTitle

  // Only update if the lastSessionId belongs to the conversation currently open in the tab.
  // This prevents SPA navigation from writing the new page's title over a previous session.
  const urlConvId = getConversationIdFromUrl()
  if (urlConvId && !lastSessionId.endsWith(`:${urlConvId}`)) return

  updateConversationTitle(lastSessionId)
})

// Start observing title changes
if (document.head) {
  titleObserver.observe(document.head, {
    childList: true,
    subtree: true,
    characterData: true,
  })
}

window.addEventListener('message', (e: MessageEvent) => {
  if (e.source !== window) return
  if (e.data?.type === '__ai_memory_injector_ready__') {
    const stage = e.data?.payload?.stage ?? 'unknown'
    return
  }
  if (e.data?.type === '__ai_memory_injector_error__') {
    console.warn('[Threadline] Injector error:', e.data?.payload ?? e.data)
    return
  }
  if (e.data?.type !== POST_TYPE || !e.data?.payload) return
  const p = e.data.payload
  if (typeof p?.provider !== 'string' || typeof p?.url !== 'string' || typeof p?.timestamp !== 'number') return
  if (!isExtensionContextValid()) return

  try {
    // Handle Claude session_create: register the new conversation sessionId in DB
    if (
      p.provider === 'anthropic' &&
      p.rawData &&
      typeof p.rawData === 'object' &&
      (p.rawData as Record<string, unknown>)['type'] === 'session_create'
    ) {
      const conversationId = (p.rawData as Record<string, unknown>)['conversationId'] as string | undefined
      if (conversationId) {
        const sessionId = `anthropic:${conversationId}`
        lastSessionId = sessionId
        chrome.runtime.sendMessage(
          { type: 'UPDATE_CONVERSATION_TITLE', payload: { sessionId, title: '' } },
          () => {
            try {
              void chrome.runtime.lastError
            } catch {
              // ignore
            }
          }
        )
      }
      return
    }

    // Handle Claude title_update: route directly to UPDATE_CONVERSATION_TITLE
    if (
      p.provider === 'anthropic' &&
      p.rawData &&
      typeof p.rawData === 'object' &&
      (p.rawData as Record<string, unknown>)['type'] === 'title_update'
    ) {
      const rawData = p.rawData as Record<string, unknown>
      const conversationId = rawData['conversationId'] as string | undefined
      const title = rawData['title'] as string | undefined
      if (conversationId && title) {
        const sessionId = `anthropic:${conversationId}`
        lastSessionId = sessionId
        chrome.runtime.sendMessage(
          { type: 'UPDATE_CONVERSATION_TITLE', payload: { sessionId, title } },
          () => {
            try {
              void chrome.runtime.lastError
            } catch {
              // Extension context invalidated; ignore
            }
          }
        )
      }
      return
    }

    // Handle Grok title_update: route directly to UPDATE_CONVERSATION_TITLE
    if (
      p.provider === 'xai' &&
      p.rawData &&
      typeof p.rawData === 'object' &&
      (p.rawData as Record<string, unknown>)['type'] === 'title_update'
    ) {
      const rawData = p.rawData as Record<string, unknown>
      const conversationId = rawData['conversationId'] as string | undefined
      const title = rawData['title'] as string | undefined
      if (conversationId && title) {
        const sessionId = `xai:${conversationId}`
        lastSessionId = sessionId
        chrome.runtime.sendMessage(
          { type: 'UPDATE_CONVERSATION_TITLE', payload: { sessionId, title } },
          () => {
            try {
              void chrome.runtime.lastError
            } catch {
              // Extension context invalidated; ignore
            }
          }
        )
      }
      return
    }

    // Handle Perplexity title_update: route directly to UPDATE_CONVERSATION_TITLE
    if (
      p.provider === 'perplexity' &&
      p.rawData &&
      typeof p.rawData === 'object' &&
      (p.rawData as Record<string, unknown>)['type'] === 'title_update'
    ) {
      const rawData = p.rawData as Record<string, unknown>
      const conversationId = rawData['conversationId'] as string | undefined
      const title = rawData['title'] as string | undefined
      if (conversationId && title) {
        const sessionId = `perplexity:${conversationId}`
        lastSessionId = sessionId
        chrome.runtime.sendMessage(
          { type: 'UPDATE_CONVERSATION_TITLE', payload: { sessionId, title } },
          () => {
            try {
              void chrome.runtime.lastError
            } catch {
              // Extension context invalidated; ignore
            }
          }
        )
      }
      return
    }

    chrome.runtime.sendMessage(
      {
        type: 'CAPTURE_MESSAGE',
        payload: { provider: p.provider, rawData: p.rawData, url: p.url, timestamp: p.timestamp },
      },
      () => {
        try {
          void chrome.runtime.lastError
        } catch {
          // Extension context invalidated in callback; ignore
        }
      }
    )

    // Extract sessionId and update title if available.
    // Skip document.title-based update for Claude history payloads: the injector
    // already sent a title_update event with the clean API title (no " - Claude" suffix).
    const sessionId = extractSessionId({ provider: p.provider, rawData: p.rawData })
    if (sessionId) {
      lastSessionId = sessionId
      const isClaudeHistory =
        p.provider === 'anthropic' &&
        p.rawData &&
        typeof p.rawData === 'object' &&
        Array.isArray((p.rawData as Record<string, unknown>)['chat_messages'])
      const isGrokHistory =
        p.provider === 'xai' &&
        p.rawData &&
        typeof p.rawData === 'object' &&
        Array.isArray((p.rawData as Record<string, unknown>)['responses'])
      const isPerplexityThreadHistory =
        p.provider === 'perplexity' &&
        p.rawData &&
        typeof p.rawData === 'object' &&
        Array.isArray((p.rawData as Record<string, unknown>)['entries'])
      if (isGrokHistory) {
        // Grok history has no inline title — fall back to document.title
        updateConversationTitle(sessionId)
      } else if (isPerplexityThreadHistory) {
        // Use thread_title from the first entry for clean title (API title without browser suffix)
        const entries = (p.rawData as Record<string, unknown>)['entries'] as Array<Record<string, unknown>>
        const threadTitle = entries[0]?.['thread_title'] as string | undefined
        if (threadTitle?.trim()) {
          chrome.runtime.sendMessage(
            { type: 'UPDATE_CONVERSATION_TITLE', payload: { sessionId, title: threadTitle.trim() } },
            () => { try { void chrome.runtime.lastError } catch { /* ignore */ } }
          )
        } else {
          updateConversationTitle(sessionId)
        }
      } else if (!isClaudeHistory) {
        updateConversationTitle(sessionId)
      }
    }
  } catch {
    // Extension context invalidated or sendMessage failed; ignore
  }
})
