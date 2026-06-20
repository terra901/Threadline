import React, { createContext, useCallback, useContext, useEffect, useState } from 'react'
import { loadFromChrome, saveToChrome, subscribeChromeStorage } from '../utils/chrome-storage'

const STORAGE_KEY = 'ai-memory-theme'

export type ThemeMode = 'light' | 'dark'

interface ThemeContextValue {
  theme: ThemeMode
  setTheme: (theme: ThemeMode) => void
  toggleTheme: () => void
}

const ThemeContext = createContext<ThemeContextValue>({
  theme: 'light',
  setTheme: () => void 0,
  toggleTheme: () => void 0,
})

function isValidTheme(value: unknown): value is ThemeMode {
  return value === 'light' || value === 'dark'
}

function loadThemeFromLocalStorage(): ThemeMode | null {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (isValidTheme(stored)) return stored
  } catch {
    /* ignore */
  }
  return null
}

function writeThemeToLocalStorage(theme: ThemeMode): void {
  try {
    localStorage.setItem(STORAGE_KEY, theme)
  } catch {
    /* ignore */
  }
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<ThemeMode>(() => loadThemeFromLocalStorage() ?? 'light')

  useEffect(() => {
    let cancelled = false

    // Load authoritative value from chrome.storage (shared across all extension contexts)
    void (async () => {
      const fromChrome = await loadFromChrome(STORAGE_KEY, isValidTheme)
      if (!cancelled && fromChrome) {
        setThemeState(fromChrome)
        writeThemeToLocalStorage(fromChrome)
      }
    })()

    // Keep in sync when another context (popup, other tab) changes the theme
    const unsub = subscribeChromeStorage(STORAGE_KEY, isValidTheme, (next) => {
      setThemeState(next)
      writeThemeToLocalStorage(next)
    })

    return () => {
      cancelled = true
      unsub()
    }
  }, [])

  const setTheme = useCallback((next: ThemeMode) => {
    setThemeState(next)
    writeThemeToLocalStorage(next)
    void saveToChrome(STORAGE_KEY, next)
  }, [])

  const toggleTheme = useCallback(() => {
    setThemeState((prev) => {
      const next = prev === 'light' ? 'dark' : 'light'
      writeThemeToLocalStorage(next)
      void saveToChrome(STORAGE_KEY, next)
      return next
    })
  }, [])

  return (
    <ThemeContext.Provider value={{ theme, setTheme, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  )
}

export function useTheme() {
  return useContext(ThemeContext)
}
