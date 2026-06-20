/**
 * Reusable Chrome extension API mock for Vitest tests.
 */

import { vi } from "vitest"

type Listener = (...args: unknown[]) => void

let _lastError: { message: string } | undefined = undefined
let _storageOnChangedListeners: Listener[] = []

export const chromeMock = {
  tabs: {
    onUpdated: { addListener: vi.fn(), removeListener: vi.fn() },
    query: vi.fn(),
    create: vi.fn(),
  },
  action: {
    onClicked: { addListener: vi.fn(), removeListener: vi.fn() },
  },
  offscreen: {
    createDocument: vi.fn(),
  },
  scripting: {
    executeScript: vi.fn(),
  },
  contextMenus: {
    create: vi.fn(),
    onClicked: { addListener: vi.fn(), removeListener: vi.fn() },
  },
  alarms: {
    create: vi.fn(),
    onAlarm: { addListener: vi.fn(), removeListener: vi.fn() },
  },
  runtime: {
    sendMessage: vi.fn(
      (
        message: unknown,
        callback?: (response: { success: boolean }) => void,
      ) => {
        if (callback) {
          if (_lastError) {
            // lastError path — callback is called but runtime.lastError is set
            callback({ success: false })
          } else {
            callback({ success: true })
          }
        }
        return Promise.resolve({ success: true })
      },
    ),
    get lastError(): { message: string } | undefined {
      return _lastError
    },
    onMessage: {
      addListener: vi.fn(),
      removeListener: vi.fn(),
    },
    onInstalled: { addListener: vi.fn(), removeListener: vi.fn() },
    onStartup: { addListener: vi.fn(), removeListener: vi.fn() },
    getURL: vi.fn((path: string) => `chrome-extension://test-extension-id/${path}`),
    getContexts: vi.fn(() => Promise.resolve([])),
  },
  storage: {
    local: {
      get: vi.fn(
        (
          _keys: string | string[] | null,
          callback?: (result: Record<string, unknown>) => void,
        ) => {
          if (callback) callback({})
          return Promise.resolve({})
        },
      ),
      set: vi.fn(
        (
          _items: Record<string, unknown>,
          callback?: () => void,
        ) => {
          if (callback) callback()
          return Promise.resolve()
        },
      ),
    },
    onChanged: {
      addListener: vi.fn((fn: Listener) => {
        _storageOnChangedListeners.push(fn)
      }),
      removeListener: vi.fn((fn: Listener) => {
        _storageOnChangedListeners = _storageOnChangedListeners.filter(
          (l) => l !== fn,
        )
      }),
    },
  },
}

/**
 * Resets all mock call history and internal state.
 * Call in beforeEach to ensure test isolation.
 */
export function resetChromeMock(): void {
  _lastError = undefined
  _storageOnChangedListeners = []

  chromeMock.runtime.sendMessage.mockClear()
  chromeMock.runtime.onMessage.addListener.mockClear()
  chromeMock.runtime.onMessage.removeListener.mockClear()
  chromeMock.storage.local.get.mockClear()
  chromeMock.storage.local.set.mockClear()
  chromeMock.storage.onChanged.addListener.mockClear()
  chromeMock.storage.onChanged.removeListener.mockClear()
}

/**
 * Sets chrome.runtime.lastError for the duration of the next sendMessage call.
 * Reset via resetChromeMock().
 */
export function setLastError(message: string): void {
  _lastError = { message }
}
