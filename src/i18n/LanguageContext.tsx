import React, { createContext, useCallback, useContext, useEffect, useState } from 'react'
import type { LangCode, Translations } from './translations'
import { LANG_NAMES, translations } from './translations'
import { subscribeChromeStorage } from '../utils/chrome-storage'
import { detectDefaultLang, LANG_STORAGE_KEY, loadLangFromChrome, readLangFromLocalStorage, writeLangToLocalStorage, saveLangToChrome } from './lang-storage'

interface LanguageContextValue {
  lang: LangCode
  setLang: (lang: LangCode) => void
  t: Translations
  langNames: typeof LANG_NAMES
  langCodes: LangCode[]
}

const ALL_LANGS = Object.keys(LANG_NAMES) as LangCode[]

const LanguageContext = createContext<LanguageContextValue>({
  lang: 'en',
  setLang: () => void 0,
  t: translations['en'],
  langNames: LANG_NAMES,
  langCodes: ALL_LANGS,
})

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLangState] = useState<LangCode>(() => {
    const nav = typeof navigator !== 'undefined' ? navigator.language ?? '' : 'en'
    return detectDefaultLang(nav)
  })

  useEffect(() => {
    let cancelled = false

    ;(async () => {
      const fromLocal = readLangFromLocalStorage()
      if (!cancelled && fromLocal) {
        setLangState(fromLocal)
      }

      const fromChrome = await loadLangFromChrome()
      if (!cancelled && fromChrome) {
        setLangState(fromChrome)
        writeLangToLocalStorage(fromChrome)
      }
    })()

    // Keep in sync when another context (popup, other tab) changes the language
    const isValidLang = (v: unknown): v is LangCode =>
      typeof v === 'string' && (ALL_LANGS as string[]).includes(v)
    const unsub = subscribeChromeStorage(LANG_STORAGE_KEY, isValidLang, (next) => {
      setLangState(next)
      writeLangToLocalStorage(next)
    })

    return () => {
      cancelled = true
      unsub()
    }
  }, [])

  const setLang = useCallback((next: LangCode) => {
    setLangState(next)
    writeLangToLocalStorage(next)
    void saveLangToChrome(next)
  }, [])

  return (
    <LanguageContext.Provider
      value={{ lang, setLang, t: translations[lang], langNames: LANG_NAMES, langCodes: ALL_LANGS }}
    >
      {children}
    </LanguageContext.Provider>
  )
}

export function useTranslation() {
  return useContext(LanguageContext)
}
