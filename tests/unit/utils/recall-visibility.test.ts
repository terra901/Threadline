import { beforeEach, describe, expect, it, vi } from 'vitest'

const storage = vi.hoisted(() => ({
  values: {} as Record<string, unknown>,
  listener: null as ((changes: Record<string, { newValue?: unknown }>) => void) | null,
}))

vi.mock('../../../src/utils/extension-context', () => ({
  safeStorageLocalGet: (_keys: unknown, callback: (items: Record<string, unknown>) => void) => {
    callback(storage.values)
  },
  safeStorageOnChanged: (listener: typeof storage.listener) => {
    storage.listener = listener
  },
}))

import {
  initRecallVisibility,
  isRecallButtonEnabled,
  RECALL_BUTTON_ENABLED_KEY,
} from '../../../src/utils/recall-visibility'

describe('Recall visibility defaults', () => {
  beforeEach(() => {
    storage.values = {}
    storage.listener = null
    initRecallVisibility()
  })

  it('starts disabled when no user preference is stored', () => {
    expect(isRecallButtonEnabled()).toBe(false)
  })

  it('honors an explicitly enabled preference and turns off when cleared', () => {
    storage.values = { [RECALL_BUTTON_ENABLED_KEY]: true }
    initRecallVisibility()
    expect(isRecallButtonEnabled()).toBe(true)

    storage.listener?.({ [RECALL_BUTTON_ENABLED_KEY]: { newValue: undefined } })
    expect(isRecallButtonEnabled()).toBe(false)
  })
})
