export type CaptureMode = 'auto' | 'manual'

export const CAPTURE_MODE_STORAGE_KEY = 'ai_memory_capture_mode'
export const PENDING_MEMORY_SESSIONS_STORAGE_KEY = 'ai_memory_pending_sessions'
export const DEFAULT_CAPTURE_MODE: CaptureMode = 'auto'

export function isCaptureMode(value: unknown): value is CaptureMode {
  return value === 'auto' || value === 'manual'
}
