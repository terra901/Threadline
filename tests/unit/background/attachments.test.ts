import { beforeEach, describe, expect, it } from 'vitest'
import 'fake-indexeddb/auto'
import { Blob as NodeBlob } from 'node:buffer'
import { db } from '../../../src/background/db'
import { getAttachmentDownload } from '../../../src/background/attachments'

describe('attachment downloads', () => {
  beforeEach(async () => {
    await db.delete()
    await db.open()
  })

  it('returns a downloadable data URL for a saved attachment blob', async () => {
    await db.attachments.put({
      id: 'att-1',
      messageId: 'message-1',
      sessionId: 'openai:conversation-1',
      provider: 'openai',
      kind: 'image',
      source: 'dom_scan',
      name: 'generated.png',
      mimeType: 'image/png',
      size: 8,
      status: 'saved',
      createdAt: 1,
      updatedAt: 1,
    })
    await db.attachmentBlobs.put({
      id: 'att-1:blob',
      attachmentId: 'att-1',
      blob: new NodeBlob([new Uint8Array([137, 80, 78, 71, 26, 10, 0, 0])], { type: 'image/png' }) as unknown as Blob,
      size: 8,
      mimeType: 'image/png',
      createdAt: 1,
    })

    const download = await getAttachmentDownload('att-1')

    expect(download).toMatchObject({
      filename: 'generated.png',
      mimeType: 'image/png',
      dataUrl: 'data:image/png;base64,iVBORxoKAAA=',
    })
  })
})
