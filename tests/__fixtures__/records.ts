import type { MemoryRecord } from '../../src/types/memory'

export function makeRecord(overrides: Partial<MemoryRecord> = {}): MemoryRecord {
  return {
    id: 'test-id',
    role: 'user',
    content: 'test content',
    provider: 'openai',
    sessionId: 'openai:test-session',
    timestamp: 1_700_000_000_000,
    createdAt: 1_700_000_000_000,
    isPartial: false,
    isDeleted: false,
    isSuperseded: false,
    ...overrides,
  }
}
