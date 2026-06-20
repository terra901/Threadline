import { loadFromChrome, saveToChrome } from '../utils/chrome-storage'
import type { LangCode } from './translations'

export const LANG_STORAGE_KEY = 'ai-memory-lang'

const ALL_LANGS: LangCode[] = ['zh-TW', 'zh-CN', 'en', 'ja', 'ko', 'es', 'fr', 'de']

function isValidLangCode(value: unknown): value is LangCode {
  return typeof value === 'string' && (ALL_LANGS as string[]).includes(value)
}

export function detectDefaultLang(nav: string): LangCode {
  const lang = nav || ''
  if (lang.startsWith('zh-TW') || lang.startsWith('zh-Hant')) return 'zh-TW'
  if (lang.startsWith('zh')) return 'zh-CN'
  if (lang.startsWith('ja')) return 'ja'
  if (lang.startsWith('ko')) return 'ko'
  if (lang.startsWith('es')) return 'es'
  if (lang.startsWith('fr')) return 'fr'
  if (lang.startsWith('de')) return 'de'
  return 'en'
}

export function readLangFromLocalStorage(): LangCode | null {
  try {
    if (typeof localStorage === 'undefined') return null
    const raw = localStorage.getItem(LANG_STORAGE_KEY)
    if (isValidLangCode(raw)) return raw
  } catch {
    // localStorage may be unavailable in some extension contexts
  }
  return null
}

export function writeLangToLocalStorage(lang: LangCode): void {
  try {
    if (typeof localStorage === 'undefined') return
    localStorage.setItem(LANG_STORAGE_KEY, lang)
  } catch {
    // ignore
  }
}

export async function loadLangFromChrome(): Promise<LangCode | null> {
  return loadFromChrome(LANG_STORAGE_KEY, isValidLangCode)
}

export async function saveLangToChrome(lang: LangCode): Promise<void> {
  return saveToChrome(LANG_STORAGE_KEY, lang)
}

