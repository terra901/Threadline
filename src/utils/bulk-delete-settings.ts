export const BULK_DELETE_SELECTION_KEY = 'bulkDeleteSelection'
export const DEFAULT_BULK_DELETE_SELECTION = 10
export const MAX_BULK_DELETE_SELECTION = 999

export function normalizeBulkDeleteSelection(value: unknown): number {
  const numeric = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(numeric)) return DEFAULT_BULK_DELETE_SELECTION
  return Math.min(MAX_BULK_DELETE_SELECTION, Math.max(1, Math.floor(numeric)))
}
