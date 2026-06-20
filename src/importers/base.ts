import type { AIProvider, SerializableMemoryRecord } from '../types/memory'

/**
 * Strategy interface for converting a provider's conversation export file
 * into normalised SerializableMemoryRecord[].
 */
export interface IConversationImporter {
  /** Stable machine ID: 'claude' | 'chatgpt' | 'gemini' | 'grok' | 'perplexity' */
  readonly id: string

  /** Human-readable label shown in the import dropdown menu */
  readonly displayName: string

  /** The AIProvider value written into each generated MemoryRecord */
  readonly provider: AIProvider

  /**
   * Fast structural check — returns false without throwing.
   * ImportView calls this before parse() to give a friendlier error.
   */
  canHandle(raw: unknown): boolean

  /**
   * Parse the raw file payload into MemoryRecords.
   * Throws an Error with a descriptive message on invalid input.
   * Returns [] for an empty but structurally valid export.
   */
  parse(raw: unknown): SerializableMemoryRecord[]
}

/** Ordered registry of all active importers. ImportView iterates this array. */
export const IMPORTERS: IConversationImporter[] = []

export function registerImporter(importer: IConversationImporter): void {
  IMPORTERS.push(importer)
}
