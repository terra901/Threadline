import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  detectDefaultLang,
  readLangFromLocalStorage,
  writeLangToLocalStorage,
  loadLangFromChrome,
  saveLangToChrome,
  LANG_STORAGE_KEY,
} from '../../../src/i18n/lang-storage'
import { chromeMock, resetChromeMock } from '../../__mocks__/chrome'

// happy-dom's localStorage doesn't implement setItem/getItem; provide a proper stub
let _localStorageStore: Record<string, string> = {}
const localStorageMock = {
  getItem: vi.fn((key: string) => _localStorageStore[key] ?? null),
  setItem: vi.fn((key: string, value: string) => { _localStorageStore[key] = value }),
  removeItem: vi.fn((key: string) => { delete _localStorageStore[key] }),
  clear: vi.fn(() => { _localStorageStore = {} }),
}

beforeEach(() => {
  resetChromeMock()
  _localStorageStore = {}
  localStorageMock.getItem.mockClear()
  localStorageMock.setItem.mockClear()
  localStorageMock.removeItem.mockClear()
  localStorageMock.clear.mockClear()
  vi.stubGlobal('localStorage', localStorageMock)
})

describe('detectDefaultLang', () => {
  it('returns en for empty string', () => {
    expect(detectDefaultLang('')).toBe('en')
  })

  it('returns en for en', () => {
    expect(detectDefaultLang('en')).toBe('en')
  })

  it('returns en for en-US', () => {
    expect(detectDefaultLang('en-US')).toBe('en')
  })

  it('returns en for unknown-lang', () => {
    expect(detectDefaultLang('unknown-lang')).toBe('en')
  })

  it('returns en for single unknown char x', () => {
    expect(detectDefaultLang('x')).toBe('en')
  })

  it('returns zh-TW for zh-TW', () => {
    expect(detectDefaultLang('zh-TW')).toBe('zh-TW')
  })

  it('returns zh-TW for zh-Hant', () => {
    expect(detectDefaultLang('zh-Hant')).toBe('zh-TW')
  })

  it('returns zh-TW for zh-Hant-TW', () => {
    expect(detectDefaultLang('zh-Hant-TW')).toBe('zh-TW')
  })

  it('returns zh-CN for zh', () => {
    expect(detectDefaultLang('zh')).toBe('zh-CN')
  })

  it('returns zh-CN for zh-CN', () => {
    expect(detectDefaultLang('zh-CN')).toBe('zh-CN')
  })

  it('returns ja for ja', () => {
    expect(detectDefaultLang('ja')).toBe('ja')
  })

  it('returns ja for ja-JP', () => {
    expect(detectDefaultLang('ja-JP')).toBe('ja')
  })

  it('returns ko for ko', () => {
    expect(detectDefaultLang('ko')).toBe('ko')
  })

  it('returns es for es', () => {
    expect(detectDefaultLang('es')).toBe('es')
  })

  it('returns es for es-MX', () => {
    expect(detectDefaultLang('es-MX')).toBe('es')
  })

  it('returns fr for fr', () => {
    expect(detectDefaultLang('fr')).toBe('fr')
  })

  it('returns fr for fr-CA', () => {
    expect(detectDefaultLang('fr-CA')).toBe('fr')
  })

  it('returns de for de', () => {
    expect(detectDefaultLang('de')).toBe('de')
  })
})

describe('readLangFromLocalStorage / writeLangToLocalStorage', () => {
  it('write ja then read returns ja', () => {
    writeLangToLocalStorage('ja')
    expect(readLangFromLocalStorage()).toBe('ja')
  })

  it('write fr then read returns fr', () => {
    writeLangToLocalStorage('fr')
    expect(readLangFromLocalStorage()).toBe('fr')
  })

  it('returns null when key not set', () => {
    expect(readLangFromLocalStorage()).toBeNull()
  })

  it('returns null when an invalid code is stored manually', () => {
    localStorage.setItem(LANG_STORAGE_KEY, 'not-a-valid-lang')
    expect(readLangFromLocalStorage()).toBeNull()
  })

  it('returns null when stored value is empty string', () => {
    localStorage.setItem(LANG_STORAGE_KEY, '')
    expect(readLangFromLocalStorage()).toBeNull()
  })
})

describe('loadLangFromChrome', () => {
  it('resolves to null when storage returns empty object (default mock)', async () => {
    const result = await loadLangFromChrome()
    expect(result).toBeNull()
  })

  it('resolves to the stored lang code when storage returns a valid value', async () => {
    chromeMock.storage.local.get.mockImplementationOnce(
      (_keys: unknown, cb?: (result: Record<string, unknown>) => void) => {
        if (cb) cb({ [LANG_STORAGE_KEY]: 'ko' })
        return Promise.resolve({ [LANG_STORAGE_KEY]: 'ko' })
      },
    )
    const result = await loadLangFromChrome()
    expect(result).toBe('ko')
  })

  it('resolves to null when storage returns an invalid lang code', async () => {
    chromeMock.storage.local.get.mockImplementationOnce(
      (_keys: unknown, cb?: (result: Record<string, unknown>) => void) => {
        if (cb) cb({ [LANG_STORAGE_KEY]: 'invalid-code' })
        return Promise.resolve({})
      },
    )
    const result = await loadLangFromChrome()
    expect(result).toBeNull()
  })
})

describe('saveLangToChrome', () => {
  it('calls chrome.storage.local.set with the correct key and value', async () => {
    await saveLangToChrome('de')
    expect(chromeMock.storage.local.set).toHaveBeenCalledTimes(1)
    expect(chromeMock.storage.local.set).toHaveBeenCalledWith(
      { [LANG_STORAGE_KEY]: 'de' },
      expect.any(Function),
    )
  })

  it('calls chrome.storage.local.set with zh-TW', async () => {
    await saveLangToChrome('zh-TW')
    expect(chromeMock.storage.local.set).toHaveBeenCalledWith(
      { [LANG_STORAGE_KEY]: 'zh-TW' },
      expect.any(Function),
    )
  })
})
