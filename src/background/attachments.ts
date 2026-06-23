import {
  ATTACHMENT_SAVE_MODE_STORAGE_KEY,
  MAX_ATTACHMENT_BYTES,
  normalizeAttachmentSaveMode,
  shouldSaveFiles,
  shouldSaveImages,
  type AttachmentSaveMode,
} from '../constants/attachments'
import type {
  AIProvider,
  AttachmentBlobRecord,
  AttachmentKind,
  AttachmentRecord,
  AttachmentSaveStatus,
  DomAttachmentCandidate,
} from '../types/memory'
import { db } from './db'

export async function getAttachmentSaveMode(): Promise<AttachmentSaveMode> {
  const stored = await chrome.storage.local.get([ATTACHMENT_SAVE_MODE_STORAGE_KEY])
  const value = stored[ATTACHMENT_SAVE_MODE_STORAGE_KEY]
  return normalizeAttachmentSaveMode(value)
}

export async function setAttachmentSaveMode(mode: AttachmentSaveMode): Promise<AttachmentSaveMode> {
  await chrome.storage.local.set({ [ATTACHMENT_SAVE_MODE_STORAGE_KEY]: mode })
  return mode
}

export function shouldProcessAttachmentKind(mode: AttachmentSaveMode, kind: AttachmentKind): boolean {
  return kind === 'image' ? shouldSaveImages(mode) : shouldSaveFiles(mode)
}

function bytesToBase64(bytes: Uint8Array): string {
  const chunkSize = 0x8000
  let binary = ''
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize))
  }
  return btoa(binary)
}

async function blobToArrayBuffer(blob: Blob): Promise<ArrayBuffer> {
  if (typeof blob.arrayBuffer === 'function') return blob.arrayBuffer()

  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(reader.error ?? new Error('Failed to read attachment blob'))
    reader.onload = () => {
      if (reader.result instanceof ArrayBuffer) {
        resolve(reader.result)
      } else {
        reject(new Error('Attachment blob did not produce an ArrayBuffer'))
      }
    }
    reader.readAsArrayBuffer(blob)
  })
}

function extensionFromMimeType(mimeType?: string): string {
  if (!mimeType) return ''
  if (mimeType === 'image/png') return '.png'
  if (mimeType === 'image/jpeg') return '.jpg'
  if (mimeType === 'image/webp') return '.webp'
  if (mimeType === 'image/gif') return '.gif'
  if (mimeType === 'application/pdf') return '.pdf'
  if (mimeType === 'text/plain') return '.txt'
  return ''
}

function sanitizeDownloadFilename(name: string): string {
  const cleaned = name
    .trim()
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, '_')
    .replace(/\s+/g, ' ')
  return cleaned || 'threadline-attachment'
}

function attachmentFilename(attachment: AttachmentRecord, mimeType?: string): string {
  if (attachment.name?.trim()) return sanitizeDownloadFilename(attachment.name)
  const extension = extensionFromMimeType(mimeType ?? attachment.mimeType)
  return sanitizeDownloadFilename(`threadline-${attachment.kind}-${attachment.id.slice(-8)}${extension}`)
}

export async function getAttachmentDownload(
  attachmentId: string,
): Promise<{ filename: string; mimeType: string; dataUrl: string }> {
  const attachment = await db.attachments.get(attachmentId)
  if (!attachment) throw new Error('Attachment not found')
  if (attachment.status !== 'saved') throw new Error('Attachment was not saved')

  const blobRecord = await db.attachmentBlobs.where('attachmentId').equals(attachmentId).first()
  if (!blobRecord) throw new Error('Attachment blob not found')

  const blob = blobRecord.blob
  const mimeType = blobRecord.mimeType || blob.type || attachment.mimeType || 'application/octet-stream'
  const bytes = new Uint8Array(await blobToArrayBuffer(blob))
  return {
    filename: attachmentFilename(attachment, mimeType),
    mimeType,
    dataUrl: `data:${mimeType};base64,${bytesToBase64(bytes)}`,
  }
}

function dataUrlToBlob(dataUrl: string): Blob | null {
  const match = dataUrl.match(/^data:([^;,]+)?(;base64)?,(.*)$/)
  if (!match) return null
  const mimeType = match[1] || 'application/octet-stream'
  const isBase64 = Boolean(match[2])
  const body = match[3] ?? ''
  try {
    const bytes = isBase64
      ? Uint8Array.from(atob(body), (ch) => ch.charCodeAt(0))
      : new TextEncoder().encode(decodeURIComponent(body))
    return new Blob([bytes], { type: mimeType })
  } catch {
    return null
  }
}

async function fetchBlob(candidate: DomAttachmentCandidate): Promise<{
  blob?: Blob
  status: AttachmentSaveStatus
  error?: string
}> {
  if (candidate.dataUrl) {
    const blob = dataUrlToBlob(candidate.dataUrl)
    if (!blob) return { status: 'unsupported', error: 'Invalid data URL' }
    if (blob.size > MAX_ATTACHMENT_BYTES) return { status: 'too_large' }
    return { blob, status: 'saved' }
  }

  if (!candidate.url) {
    return { status: 'unsupported', error: 'No downloadable URL' }
  }

  if (candidate.url.startsWith('blob:')) {
    return { status: 'unsupported', error: 'Blob URL is not available in the background context' }
  }

  try {
    const response = await fetch(candidate.url, { credentials: 'include' })
    if (!response.ok) return { status: 'fetch_failed', error: `HTTP ${response.status}` }
    const size = Number(response.headers.get('content-length') ?? candidate.size ?? 0)
    if (size > MAX_ATTACHMENT_BYTES) return { status: 'too_large' }
    const blob = await response.blob()
    if (blob.size > MAX_ATTACHMENT_BYTES) return { status: 'too_large' }
    return { blob, status: 'saved' }
  } catch (err) {
    return { status: 'fetch_failed', error: String(err) }
  }
}

export async function saveDomAttachments(input: {
  provider: AIProvider
  sessionId: string
  candidates: DomAttachmentCandidate[]
  mode?: AttachmentSaveMode
}): Promise<{ saved: number; skipped: number }> {
  const mode = input.mode ?? await getAttachmentSaveMode()
  let saved = 0
  let skipped = 0

  for (const candidate of input.candidates) {
    if (!shouldProcessAttachmentKind(mode, candidate.kind)) {
      skipped += 1
      continue
    }

    const existing = await db.attachments.get(candidate.id)
    if (existing) {
      skipped += 1
      continue
    }

    const now = Date.now()
    const fetched = await fetchBlob(candidate)
    const attachment: AttachmentRecord = {
      id: candidate.id,
      messageId: candidate.messageId,
      sessionId: input.sessionId,
      provider: input.provider,
      kind: candidate.kind,
      source: candidate.source,
      url: candidate.url,
      name: candidate.name,
      mimeType: candidate.mimeType ?? fetched.blob?.type,
      size: fetched.blob?.size ?? candidate.size,
      status: fetched.status,
      createdAt: now,
      updatedAt: now,
      error: candidate.error ?? fetched.error,
    }

    const blobRecord: AttachmentBlobRecord | undefined = fetched.blob
      ? {
          id: `${candidate.id}:blob`,
          attachmentId: candidate.id,
          blob: fetched.blob,
          size: fetched.blob.size,
          mimeType: fetched.blob.type || candidate.mimeType,
          createdAt: now,
        }
      : undefined

    await db.transaction('rw', db.attachments, db.attachmentBlobs, async () => {
      await db.attachments.put(attachment)
      if (blobRecord) await db.attachmentBlobs.put(blobRecord)
    })

    saved += 1
  }

  return { saved, skipped }
}
