import { MAX_ATTACHMENT_BYTES } from '../constants/attachments'
import type { DomAttachmentCandidate } from '../types/memory'

type PendingUpload = Omit<DomAttachmentCandidate, 'id' | 'messageId'>
type PendingUploadTask = {
  done: boolean
  value?: PendingUpload
  promise: Promise<PendingUpload>
}

const PENDING_UPLOAD_WAIT_MS = 800

let pendingUploads: PendingUploadTask[] = []
let started = false

function trackPendingUpload(promise: Promise<PendingUpload>): PendingUploadTask {
  const task: PendingUploadTask = {
    done: false,
    promise,
  }
  task.promise
    .then((value) => {
      task.done = true
      task.value = value
      return value
    })
    .catch((err) => {
      task.done = true
      task.value = {
        kind: 'file',
        source: 'upload',
        error: String(err),
      }
      return task.value
    })
  return task
}

function stableHash(input: string): string {
  let hash = 2166136261
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(36)
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result ?? ''))
    reader.onerror = () => reject(reader.error ?? new Error('Failed to read file'))
    reader.readAsDataURL(file)
  })
}

async function captureFile(file: File, source: PendingUpload['source']): Promise<PendingUpload> {
  const kind = file.type.startsWith('image/') ? 'image' : 'file'
  const base: PendingUpload = {
    kind,
    source,
    name: file.name,
    mimeType: file.type || undefined,
    size: file.size,
  }

  if (file.size > MAX_ATTACHMENT_BYTES) {
    return {
      ...base,
      error: 'File is larger than the attachment save limit',
    }
  }

  try {
    return {
      ...base,
      dataUrl: await readFileAsDataUrl(file),
    }
  } catch (err) {
    return {
      ...base,
      error: String(err),
    }
  }
}

function captureFiles(files: FileList | File[] | null, source: PendingUpload['source']): void {
  if (!files) return
  for (const file of Array.from(files)) {
    pendingUploads.push(trackPendingUpload(captureFile(file, source)))
  }
}

export function startUploadAttachmentCapture(): void {
  if (started) return
  started = true

  document.addEventListener('change', (event) => {
    const target = event.target
    if (!(target instanceof HTMLInputElement) || target.type !== 'file') return
    captureFiles(target.files, 'upload')
  }, true)

  document.addEventListener('drop', (event) => {
    captureFiles(event.dataTransfer?.files ?? null, 'drop')
  }, true)

  document.addEventListener('paste', (event) => {
    captureFiles(event.clipboardData?.files ?? null, 'paste')
  }, true)
}

function timeout<T>(ms: number, fallback: T): Promise<T> {
  return new Promise((resolve) => {
    setTimeout(() => resolve(fallback), ms)
  })
}

function toCandidate(item: PendingUpload, messageId: string): DomAttachmentCandidate {
  return {
    ...item,
    messageId,
    id: `${messageId}:att:${stableHash(`${item.source}:${item.name ?? ''}:${item.size ?? ''}:${item.dataUrl?.length ?? ''}`)}`,
  }
}

export async function consumePendingUploadAttachments(messageId: string): Promise<DomAttachmentCandidate[]> {
  if (pendingUploads.length === 0) return []
  await Promise.race([
    Promise.allSettled(pendingUploads.map((task) => task.promise)),
    timeout(PENDING_UPLOAD_WAIT_MS, undefined),
  ])
  const ready = pendingUploads.filter((task) => task.done && task.value)
  pendingUploads = pendingUploads.filter((task) => !task.done)
  return ready.flatMap((task) =>
    task.value ? [toCandidate(task.value, messageId)] : [],
  )
}
