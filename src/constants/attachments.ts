export type AttachmentSaveMode = 'text_only' | 'text_files_and_images'

export const ATTACHMENT_SAVE_MODE_STORAGE_KEY = 'threadline_attachment_save_mode'

export const DEFAULT_ATTACHMENT_SAVE_MODE: AttachmentSaveMode = 'text_only'

export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024

export function isAttachmentSaveMode(value: unknown): value is AttachmentSaveMode {
  return value === 'text_only' || value === 'text_files_and_images'
}

export function normalizeAttachmentSaveMode(value: unknown): AttachmentSaveMode {
  if (isAttachmentSaveMode(value)) return value
  if (value === 'text_and_images' || value === 'text_and_files') {
    return 'text_files_and_images'
  }
  return DEFAULT_ATTACHMENT_SAVE_MODE
}

export function shouldSaveImages(mode: AttachmentSaveMode): boolean {
  return mode === 'text_files_and_images'
}

export function shouldSaveFiles(mode: AttachmentSaveMode): boolean {
  return mode === 'text_files_and_images'
}
