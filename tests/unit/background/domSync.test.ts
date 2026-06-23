import { beforeEach, describe, expect, it, vi } from 'vitest'
import 'fake-indexeddb/auto'
import type { DomSyncRequest } from '../../../src/types/messages'
import { db } from '../../../src/background/db'
import { ATTACHMENT_SAVE_MODE_STORAGE_KEY, normalizeAttachmentSaveMode } from '../../../src/constants/attachments'

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
    vi.mocked(chrome.storage.local.get).mockReset()
    vi.mocked(chrome.storage.local.get).mockImplementation((_keys, callback?: (result: Record<string, unknown>) => void) => {
      if (callback) callback({})
      return Promise.resolve({})
    })
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

  it('ignores transient ChatGPT thinking nodes so the final answer stays on the main branch', async () => {
    const { handleDomSync } = await import('../../../src/background/domSync')

    const request: DomSyncRequest = {
      type: 'DOM_SYNC',
      payload: {
        provider: 'openai',
        url: 'https://chatgpt.com/c/conversation-2',
        messages: [
          {
            messageId: 'user-main',
            role: 'user',
            content: '现在最新的 xbox 手柄是哪个',
            turnIndex: 1,
            roundIndex: 0,
            sessionId: 'openai:conversation-2',
            pageTitle: 'Controller chat',
            scannedAt: 1_000,
          },
          {
            messageId: 'assistant-thinking',
            role: 'assistant',
            content: '正在思考',
            turnIndex: 2,
            roundIndex: 0,
            sessionId: 'openai:conversation-2',
            pageTitle: 'Controller chat',
            scannedAt: 1_100,
          },
          {
            messageId: 'assistant-final',
            role: 'assistant',
            content: '截至现在，最新公开发售的官方 Xbox 手柄是 Xbox Wireless Controller。',
            turnIndex: 2,
            roundIndex: 0,
            sessionId: 'openai:conversation-2',
            pageTitle: 'Controller chat',
            scannedAt: 2_000,
          },
        ],
      },
    }

    const response = await handleDomSync(request)
    await new Promise((resolve) => setTimeout(resolve, 0))

    const thinking = await db.memories.get('assistant-thinking')
    const final = await db.memories.get('assistant-final')

    expect(response.payload).toMatchObject({ queued: 2, skipped: 1 })
    expect(thinking).toBeUndefined()
    expect(final).toMatchObject({
      id: 'assistant-final',
      roundIndex: 0,
      branchIndex: 0,
      branchId: 'openai:conversation-2:r0:b0',
      pathId: 'openai:conversation-2:main',
      parentMessageId: 'user-main',
    })
  })

  it('keeps a Gemini edited user prompt with its branch assistant answer', async () => {
    const { handleDomSync } = await import('../../../src/background/domSync')

    await db.addRecord({
      id: 'gemini-user-main',
      role: 'user',
      content: '今天潮州天气怎么样',
      provider: 'google',
      sessionId: 'google:conversation-3',
      originalMessageId: 'gemini-user-main',
      source: 'dom_scan',
      timestamp: 1_000,
      createdAt: 1_000,
      turnIndex: 10,
      roundIndex: 5,
      branchIndex: 0,
      branchId: 'google:conversation-3:r5:b0',
      pathId: 'google:conversation-3:main',
      isPartial: false,
      isDeleted: false,
      isSuperseded: false,
    })
    await db.addRecord({
      id: 'gemini-assistant-main',
      role: 'assistant',
      content: '潮州今天有强雷雨。',
      provider: 'google',
      sessionId: 'google:conversation-3',
      originalMessageId: 'gemini-assistant-main',
      source: 'dom_scan',
      timestamp: 2_000,
      createdAt: 2_000,
      turnIndex: 11,
      roundIndex: 5,
      branchIndex: 0,
      branchId: 'google:conversation-3:r5:b0',
      pathId: 'google:conversation-3:main',
      parentMessageId: 'gemini-user-main',
      isPartial: false,
      isDeleted: false,
      isSuperseded: false,
    })

    const request: DomSyncRequest = {
      type: 'DOM_SYNC',
      payload: {
        provider: 'google',
        url: 'https://gemini.google.com/app/conversation-3',
        messages: [
          {
            messageId: 'gemini-user-edited',
            role: 'user',
            content: '今天广州天气怎么样',
            turnIndex: 10,
            roundIndex: 5,
            sessionId: 'google:conversation-3',
            pageTitle: 'Weather chat',
            scannedAt: 3_000,
          },
          {
            messageId: 'gemini-assistant-edited',
            role: 'assistant',
            content: '广州今天有强雷雨。',
            turnIndex: 11,
            roundIndex: 5,
            sessionId: 'google:conversation-3',
            pageTitle: 'Weather chat',
            scannedAt: 4_000,
          },
        ],
      },
    }

    const response = await handleDomSync(request)
    await new Promise((resolve) => setTimeout(resolve, 0))

    const editedUser = await db.memories.get('gemini-user-edited')
    const editedAssistant = await db.memories.get('gemini-assistant-edited')

    expect(response.payload).toMatchObject({ queued: 2, skipped: 0 })
    expect(editedUser).toMatchObject({
      id: 'gemini-user-edited',
      roundIndex: 5,
      branchIndex: 1,
      branchId: 'google:conversation-3:r5:b1',
      pathId: 'google:conversation-3:r5:b1',
    })
    expect(editedAssistant).toMatchObject({
      id: 'gemini-assistant-edited',
      roundIndex: 5,
      branchIndex: 1,
      branchId: 'google:conversation-3:r5:b1',
      pathId: 'google:conversation-3:r5:b1',
      parentMessageId: 'gemini-user-edited',
    })
  })

  it('does not save discovered attachments when the save scope is text only', async () => {
    const { handleDomSync } = await import('../../../src/background/domSync')

    const request: DomSyncRequest = {
      type: 'DOM_SYNC',
      payload: {
        provider: 'openai',
        url: 'https://chatgpt.com/c/conversation-4',
        messages: [
          {
            messageId: 'user-with-image',
            role: 'user',
            content: 'Please describe this image',
            turnIndex: 1,
            roundIndex: 0,
            sessionId: 'openai:conversation-4',
            pageTitle: 'Image chat',
            scannedAt: 5_000,
            attachments: [
              {
                id: 'user-with-image:att:image',
                messageId: 'user-with-image',
                kind: 'image',
                source: 'dom_scan',
                dataUrl: 'data:image/png;base64,iVBORw0KGgo=',
                name: 'image.png',
              },
            ],
          },
        ],
      },
    }

    await handleDomSync(request)
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(await db.attachments.count()).toBe(0)
    expect(await db.attachmentBlobs.count()).toBe(0)
  })

  it('saves image attachments when the save scope includes images', async () => {
    vi.mocked(chrome.storage.local.get).mockImplementation((_keys, callback?: (result: Record<string, unknown>) => void) => {
      const result = { [ATTACHMENT_SAVE_MODE_STORAGE_KEY]: 'text_files_and_images' }
      if (callback) callback(result)
      return Promise.resolve(result)
    })
    const { handleDomSync } = await import('../../../src/background/domSync')

    const request: DomSyncRequest = {
      type: 'DOM_SYNC',
      payload: {
        provider: 'openai',
        url: 'https://chatgpt.com/c/conversation-5',
        messages: [
          {
            messageId: 'assistant-with-image',
            role: 'assistant',
            content: 'Here is the generated image.',
            turnIndex: 2,
            roundIndex: 0,
            sessionId: 'openai:conversation-5',
            pageTitle: 'Generated image',
            scannedAt: 6_000,
            attachments: [
              {
                id: 'assistant-with-image:att:image',
                messageId: 'assistant-with-image',
                kind: 'image',
                source: 'dom_scan',
                dataUrl: 'data:image/png;base64,iVBORw0KGgo=',
                name: 'generated.png',
              },
            ],
          },
        ],
      },
    }

    await handleDomSync(request)
    await new Promise((resolve) => setTimeout(resolve, 20))

    const attachment = await db.attachments.get('assistant-with-image:att:image')
    const blob = await db.attachmentBlobs.get('assistant-with-image:att:image:blob')

    expect(attachment).toMatchObject({
      id: 'assistant-with-image:att:image',
      messageId: 'assistant-with-image',
      sessionId: 'openai:conversation-5',
      provider: 'openai',
      kind: 'image',
      status: 'saved',
    })
    expect(blob).toMatchObject({
      attachmentId: 'assistant-with-image:att:image',
      mimeType: 'image/png',
      size: 8,
    })

    const graph = await db.getSessionGraph('openai:conversation-5')
    expect(graph.records[0].attachments).toHaveLength(1)
    expect(graph.records[0].attachments?.[0]).toMatchObject({
      id: 'assistant-with-image:att:image',
      kind: 'image',
      status: 'saved',
    })

  })

  it('does not refetch an attachment that was already recorded', async () => {
    vi.mocked(chrome.storage.local.get).mockImplementation((_keys, callback?: (result: Record<string, unknown>) => void) => {
      const result = { [ATTACHMENT_SAVE_MODE_STORAGE_KEY]: 'text_files_and_images' }
      if (callback) callback(result)
      return Promise.resolve(result)
    })
    const fetchMock = vi.fn(() =>
      Promise.resolve(
        new Response(new Blob(['hello'], { type: 'text/plain' }), {
          status: 200,
          headers: { 'content-length': '5' },
        }),
      ),
    )
    vi.stubGlobal('fetch', fetchMock)
    const { handleDomSync } = await import('../../../src/background/domSync')

    const request: DomSyncRequest = {
      type: 'DOM_SYNC',
      payload: {
        provider: 'openai',
        url: 'https://chatgpt.com/c/conversation-6',
        messages: [
          {
            messageId: 'user-with-file',
            role: 'user',
            content: 'Please read this file',
            turnIndex: 1,
            roundIndex: 0,
            sessionId: 'openai:conversation-6',
            pageTitle: 'File chat',
            scannedAt: 7_000,
            attachments: [
              {
                id: 'user-with-file:att:file',
                messageId: 'user-with-file',
                kind: 'file',
                source: 'remote',
                url: 'https://chatgpt.com/backend-api/files/file-1/download',
                name: 'notes.txt',
              },
            ],
          },
        ],
      },
    }

    await handleDomSync(request)
    await new Promise((resolve) => setTimeout(resolve, 20))
    await handleDomSync(request)
    await new Promise((resolve) => setTimeout(resolve, 20))

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(await db.attachments.count()).toBe(1)
    expect(await db.attachmentBlobs.count()).toBe(1)

    vi.unstubAllGlobals()
  })
})

describe('attachment save mode normalization', () => {
  it('maps removed partial media modes to the full attachment mode', () => {
    expect(normalizeAttachmentSaveMode('text_and_images')).toBe('text_files_and_images')
    expect(normalizeAttachmentSaveMode('text_and_files')).toBe('text_files_and_images')
    expect(normalizeAttachmentSaveMode('text_only')).toBe('text_only')
    expect(normalizeAttachmentSaveMode('unknown')).toBe('text_only')
  })
})
