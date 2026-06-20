export const APP_DISPLAY_NAME = 'Threadline'
export const LOG_PREFIX = '[Threadline]'

export const MEMORY_EXPORT_APP_NAME = 'Threadline'
export const LEGACY_MEMORY_EXPORT_APP_NAMES = ['PersonalAIMemoryLayer'] as const
export type MemoryExportAppName =
  | typeof MEMORY_EXPORT_APP_NAME
  | (typeof LEGACY_MEMORY_EXPORT_APP_NAMES)[number]

export function isMemoryExportAppName(value: unknown): value is MemoryExportAppName {
  return value === MEMORY_EXPORT_APP_NAME || LEGACY_MEMORY_EXPORT_APP_NAMES.includes(value as never)
}

export const SESSION_GRAPH_EXPORT_APP_NAME = 'ThreadlineSessionGraph'
export const LEGACY_SESSION_GRAPH_EXPORT_APP_NAMES = ['PersonalAIMemoryLayerSessionGraph'] as const
