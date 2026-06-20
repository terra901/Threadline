import { beforeEach, describe, expect, it, vi } from 'vitest'
import 'fake-indexeddb/auto'
import type { DomSyncRequest } from '../../../src/types/messages'
import { db } from '../../../src/background/db'

vi.mock('../../../src/background/offscreen', () => ({
  queueEmbedding: vi.fn(),
}))

vi.mock('../../../src/background/search', () => ({
  miniSearch: {
    add: vi.fn(),
  },
}))

describe('handleDomSync branch graph metadata', () => {
  beforeEach(async () => {
    await db.delete()
    await db.open()
  })

  it('stores a newly visible existing-conversation variant as a branch in the same round', async () => {
    const { handleDomSync } = await import('../../../src/background/domSync')

    await db.addRecord({
      id: 'user-main',
      role: 'user',
      content: '今天广州天气怎么样',
      provider: 'openai',
      sessionId: 'openai:conversation-1',
      originalMessageId: 'user-main',
      source: 'dom_scan',
      timestamp: 1_000,
      createdAt: 1_000,
      turnIndex: 1,
      roundIndex: 0,
      branchIndex: 0,
      branchId: 'openai:conversation-1:r0:b0',
      pathId: 'openai:conversation-1:main',
      isPartial: false,
      isDeleted: false,
      isSuperseded: false,
    })
    await db.addRecord({
      id: 'assistant-main',
      role: 'assistant',
      content: '广州今天多云。',
      provider: 'openai',
      sessionId: 'openai:conversation-1',
      originalMessageId: 'assistant-main',
      source: 'dom_scan',
      timestamp: 2_000,
      createdAt: 2_000,
      turnIndex: 2,
      roundIndex: 0,
      branchIndex: 0,
      branchId: 'openai:conversation-1:r0:b0',
      pathId: 'openai:conversation-1:main',
      parentMessageId: 'user-main',
      isPartial: false,
      isDeleted: false,
      isSuperseded: false,
    })

    const request: DomSyncRequest = {
      type: 'DOM_SYNC',
      payload: {
        provider: 'openai',
        url: 'https://chatgpt.com/c/conversation-1',
        messages: [
          {
            messageId: 'assistant-branch',
            role: 'assistant',
            content: '广州今天有雨，建议带伞。',
            turnIndex: 2,
            roundIndex: 0,
            sessionId: 'openai:conversation-1',
            pageTitle: 'Weather chat',
            scannedAt: 3_000,
          },
        ],
      },
    }

    const response = await handleDomSync(request)
    await new Promise((resolve) => setTimeout(resolve, 0))

    const saved = await db.memories.get('assistant-branch')

    expect(response.payload).toMatchObject({ queued: 1, skipped: 0 })
    expect(saved).toMatchObject({
      id: 'assistant-branch',
      roundIndex: 0,
      branchIndex: 1,
      branchId: 'openai:conversation-1:r0:b1',
      pathId: 'openai:conversation-1:r0:b1',
      parentMessageId: 'user-main',
      source: 'dom_scan',
    })
  })
})
