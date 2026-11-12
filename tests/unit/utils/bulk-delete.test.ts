import { describe, expect, it } from 'vitest'
import {
  parseProviderConversationRef,
  conversationStillExists,
  dispatchPointerClick,
} from '../../../src/contents/bulk-delete'
import { getBulkDeleteCopy } from '../../../src/utils/bulk-delete-copy'
import {
  BULK_DELETE_SELECTION_KEY,
  DEFAULT_BULK_DELETE_SELECTION,
  MAX_BULK_DELETE_SELECTION,
  normalizeBulkDeleteSelection,
} from '../../../src/utils/bulk-delete-settings'

describe('bulk delete conversation references', () => {
  it('uses ten chats by default and caps the setting at 999', () => {
    expect(DEFAULT_BULK_DELETE_SELECTION).toBe(10)
    expect(MAX_BULK_DELETE_SELECTION).toBe(999)
    expect(BULK_DELETE_SELECTION_KEY).toBe('bulkDeleteSelection')
    expect(normalizeBulkDeleteSelection(undefined)).toBe(10)
    expect(normalizeBulkDeleteSelection(0)).toBe(1)
    expect(normalizeBulkDeleteSelection(1000)).toBe(999)
    expect(normalizeBulkDeleteSelection(12.8)).toBe(12)
  })

  it.each([
    ['https://chatgpt.com/c/chat-123', 'openai', 'openai:chat-123'],
    ['https://claude.ai/chat/chat-456', 'anthropic', 'anthropic:chat-456'],
    ['https://gemini.google.com/app/chat-789', 'google', 'google:chat-789'],
    ['https://www.perplexity.ai/search/topic-abc', 'perplexity', 'perplexity:topic-abc'],
    ['https://grok.com/c/chat-def', 'xai', 'xai:chat-def'],
  ] as const)('maps %s to a local session reference', (url, provider, sessionId) => {
    expect(parseProviderConversationRef(url)).toMatchObject({ provider, sessionId })
  })

  it('ignores non-conversation and unrelated links', () => {
    expect(parseProviderConversationRef('https://gemini.google.com/app')).toBeNull()
    expect(parseProviderConversationRef('https://example.com/app/chat-789')).toBeNull()
  })
})

describe('bulk delete copy', () => {
  it('labels the direct delete action with the selected count', () => {
    expect(getBulkDeleteCopy('zh-CN').deleteSelected(4)).toBe('删除所选 4 条')
    expect(getBulkDeleteCopy('en').deleteSelected(4)).toBe('Delete 4 selected')
  })

  it('provides completion actions for the post-delete state', () => {
    const copy = getBulkDeleteCopy('zh-CN')
    expect(copy.completedTitle).toBe('删除完成')
    expect(copy.continueDeleting).toBe('继续删除')
    expect(copy.done).toBe('完成')
  })
})

describe('bulk delete removal detection', () => {
  it('ignores a hidden stale sidebar link after the site removes a chat', () => {
    document.body.innerHTML = `
      <a href="https://chatgpt.com/c/stale" style="display:none">stale</a>
      <a href="https://chatgpt.com/c/live">live</a>
    `

    expect(conversationStillExists('stale')).toBe(false)
    expect(conversationStillExists('live')).toBe(true)
  })

  it('dispatches the pointer sequence required by ChatGPT menu buttons', () => {
    const button = document.createElement('button')
    const events: string[] = []
    for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) {
      button.addEventListener(type, () => events.push(type))
    }

    dispatchPointerClick(button)

    expect(events).toEqual(['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'])
  })
})
