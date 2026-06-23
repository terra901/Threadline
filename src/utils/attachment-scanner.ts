import { MAX_ATTACHMENT_BYTES } from '../constants/attachments'
import type { AttachmentCaptureSource, AttachmentKind, DomAttachmentCandidate } from '../types/memory'

export interface AttachmentScannerOptions {
  messageId: string
  root: Element
  includeImages: boolean
  includeFiles: boolean
}

function stableHash(input: string): string {
  let hash = 2166136261
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(36)
}

function normalizeUrl(url: string): string | undefined {
  const trimmed = url.trim()
  if (!trimmed || trimmed.startsWith('javascript:')) return undefined
  try {
    return new URL(trimmed, window.location.href).href
  } catch {
    return undefined
  }
}

function inferNameFromUrl(url?: string): string | undefined {
  if (!url) return undefined
  try {
    const parsed = new URL(url)
    const name = parsed.pathname.split('/').filter(Boolean).pop()
    return name ? decodeURIComponent(name).slice(0, 180) : undefined
  } catch {
    return undefined
  }
}

function inferKindFromElement(el: Element, url?: string): AttachmentKind {
  if (el instanceof HTMLImageElement) return 'image'
  const text = (el.textContent ?? '').toLowerCase()
  const path = (url ?? '').toLowerCase()
  if (/\.(png|jpe?g|gif|webp|avif|bmp|svg)(?:$|[?#])/.test(path)) return 'image'
  if (/\b(image|photo|picture)\b/.test(text)) return 'image'
  return 'file'
}

async function canvasImageToDataUrl(img: HTMLImageElement): Promise<string | undefined> {
  if (!img.complete || img.naturalWidth <= 0 || img.naturalHeight <= 0) return undefined
  const scale = Math.min(1, 512 / Math.max(img.naturalWidth, img.naturalHeight))
  const width = Math.max(1, Math.round(img.naturalWidth * scale))
  const height = Math.max(1, Math.round(img.naturalHeight * scale))
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) return undefined
  try {
    ctx.drawImage(img, 0, 0, width, height)
    return canvas.toDataURL('image/png')
  } catch {
    return undefined
  }
}

async function buildCandidate(
  messageId: string,
  kind: AttachmentKind,
  source: AttachmentCaptureSource,
  seed: string,
  attrs: Omit<DomAttachmentCandidate, 'id' | 'messageId' | 'kind' | 'source'>,
): Promise<DomAttachmentCandidate> {
  const id = `${messageId}:att:${stableHash(`${kind}:${source}:${seed}`)}`
  return { id, messageId, kind, source, ...attrs }
}

export async function scanDomAttachments(
  options: AttachmentScannerOptions,
): Promise<DomAttachmentCandidate[]> {
  const { root, messageId, includeImages, includeFiles } = options
  const candidates = new Map<string, DomAttachmentCandidate>()

  if (includeImages) {
    const images = root.querySelectorAll<HTMLImageElement>('img[src], img[srcset]')
    for (const img of images) {
      const url = normalizeUrl(img.currentSrc || img.src || img.getAttribute('src') || '')
      const dataUrl = img.src.startsWith('data:') && img.src.length <= MAX_ATTACHMENT_BYTES * 2
        ? img.src
        : await canvasImageToDataUrl(img)
      const seed = url ?? dataUrl ?? img.alt ?? String(candidates.size)
      const candidate = await buildCandidate(messageId, 'image', 'dom_scan', seed, {
        url,
        dataUrl,
        name: img.alt || inferNameFromUrl(url),
        mimeType: dataUrl?.match(/^data:([^;,]+)/)?.[1],
      })
      candidates.set(candidate.id, candidate)
    }
  }

  const links = root.querySelectorAll<HTMLAnchorElement>('a[href]')
  for (const link of links) {
    const url = normalizeUrl(link.href || link.getAttribute('href') || '')
    if (!url) continue
    const kind = inferKindFromElement(link, url)
    if (kind === 'image' && !includeImages) continue
    if (kind === 'file' && !includeFiles) continue
    const downloadName = link.getAttribute('download') || undefined
    const candidate = await buildCandidate(messageId, kind, 'remote', url, {
      url,
      name: downloadName || link.textContent?.trim() || inferNameFromUrl(url),
    })
    candidates.set(candidate.id, candidate)
  }

  return [...candidates.values()]
}

export function fileToAttachmentCandidate(
  file: File,
  messageId: string,
  source: AttachmentCaptureSource,
): DomAttachmentCandidate {
  const kind: AttachmentKind = file.type.startsWith('image/') ? 'image' : 'file'
  return {
    id: `${messageId}:att:${stableHash(`${source}:${file.name}:${file.size}:${file.lastModified}`)}`,
    messageId,
    kind,
    source,
    name: file.name,
    mimeType: file.type || undefined,
    size: file.size,
  }
}
