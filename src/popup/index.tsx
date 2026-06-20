import React, { useCallback, useEffect, useState } from 'react'
import { MemoryMenuContent } from './components/MemoryMenuContent'
import { FolderView } from './components/FolderView'
import { SettingsView } from './components/SettingsView'
import { LanguageProvider, useTranslation } from '../i18n/LanguageContext'
import { ThemeProvider, useTheme } from '../i18n/ThemeContext'
import { getThemeTokens } from '../ui/theme'
import { SunIcon, MoonIcon, GearIcon, ExternalLinkIcon } from '../ui/icons'
import * as S from '../ui/styles'
import type { LangCode } from '../i18n/translations'
import { inferSessionIdFromUrl } from '../utils/session-url'
import { APP_DISPLAY_NAME } from '../constants/branding'

type View = 'main' | 'folder' | 'settings'

const AI_ORIGINS = [
  'https://chat.openai.com',
  'https://chatgpt.com',
  // TODO: Implement ClaudeAdapter
  'https://claude.ai',
  'https://gemini.google.com',
  'https://www.perplexity.ai',
  'https://grok.com',
]

const POPUP_WIDTH = 360

const THEME_TRANSITION_CSS = `
.aim-panel * {
  transition-property: background-color, color, border-color, box-shadow;
  transition-duration: 0.25s;
  transition-timing-function: ease;
}
`

function App() {
  useEffect(() => {
    const id = 'aim-theme-transition-style'
    if (document.getElementById(id)) return
    const el = document.createElement('style')
    el.id = id
    el.textContent = THEME_TRANSITION_CSS
    document.head.appendChild(el)
  }, [])
  const [view, setView] = useState<View>('main')
  const [activeTabId, setActiveTabId] = useState<number | null>(null)
  const [activeTabUrl, setActiveTabUrl] = useState('')
  const [isOnAISite, setIsOnAISite] = useState(false)
  const { theme, toggleTheme } = useTheme()
  const tk = getThemeTokens(theme)
  const { t, lang, setLang, langNames, langCodes } = useTranslation()

  // Detect AI site
  useEffect(() => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tab = tabs[0]
      if (tab?.id && tab.url && AI_ORIGINS.some((o) => tab.url!.startsWith(o))) {
        setActiveTabId(tab.id)
        setActiveTabUrl(tab.url)
        setIsOnAISite(true)
      }
    })
  }, [])

  // Send OPEN_MEMORY_PANEL to the active AI tab, then close the popup
  const handleOpenPanel = useCallback(() => {
    if (!activeTabId) return
    chrome.tabs
      .sendMessage(activeTabId, { type: 'OPEN_MEMORY_PANEL' })
      .catch(() => void 0)
      .finally(() => window.close())
  }, [activeTabId])

  const handleOpenGraph = useCallback(() => {
    const sessionId = activeTabUrl ? inferSessionIdFromUrl(activeTabUrl) : undefined
    chrome.runtime.sendMessage(
      { type: 'OPEN_MEMORY_GRAPH', payload: { sessionId } },
      () => {
        window.close()
      },
    )
  }, [activeTabUrl])

  const goBack = useCallback(() => setView('main'), [])
  const openSettings = useCallback(() => setView('settings'), [])

  // Slot order: settings(0) | main(1) | detail(2)
  // Settings slides in from the left, detail slides in from the right — no cross-over.
  const slideIndex = view === 'settings' ? 0 : view === 'main' ? 1 : 2

  return (
    <div
      className="aim-panel"
      style={{
        width: POPUP_WIDTH,
        minWidth: POPUP_WIDTH,
        overflow: 'hidden',
        backgroundColor: tk.bg,
      }}
    >
      <div
        style={{
          display: 'flex',
          width: POPUP_WIDTH * 3,
          transform: `translateX(-${slideIndex * POPUP_WIDTH}px)`,
          transition: 'transform 0.32s cubic-bezier(0.4, 0, 0.2, 1)',
        }}
      >
        {/* Slot 0: Settings (slides in from left) */}
        <div style={{ width: POPUP_WIDTH, flexShrink: 0, opacity: view === 'settings' ? 1 : 0, transition: 'opacity 0.24s ease, background-color 0.25s ease, color 0.25s ease, border-color 0.25s ease, box-shadow 0.25s ease' }}>
          <SettingsView onBack={goBack} />
        </div>

        {/* Slot 1: Main menu (center) */}
        <div style={{ width: POPUP_WIDTH, flexShrink: 0, opacity: view === 'main' ? 1 : 0, transition: 'opacity 0.24s ease, background-color 0.25s ease, color 0.25s ease, border-color 0.25s ease, box-shadow 0.25s ease' }}>
          <div style={{ ...S.viewContainer, backgroundColor: tk.bg, color: tk.text }}>
            {/* Header */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ fontSize: 17, fontWeight: 700, letterSpacing: '-0.02em', color: tk.text }}>{APP_DISPLAY_NAME}</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <button
                  type="button"
                  onClick={toggleTheme}
                  style={{ ...S.iconBtn, backgroundColor: tk.btnBg, borderColor: tk.border, color: tk.textMuted }}
                  title={theme === 'light' ? t.themeDark : t.themeLight}
                >
                  {theme === 'light' ? <MoonIcon /> : <SunIcon />}
                </button>
                <button
                  type="button"
                  onClick={openSettings}
                  style={{ ...S.iconBtn, backgroundColor: tk.btnBg, borderColor: tk.border, color: tk.textMuted }}
                  title={t.settings}
                >
                  <GearIcon />
                </button>
                <select
                  value={lang}
                  onChange={(e) => setLang(e.target.value as LangCode)}
                  style={{ fontSize: 12, padding: '6px 8px', borderRadius: 10, border: '1px solid', borderColor: tk.inputBorder, backgroundColor: tk.inputBg, color: tk.text, cursor: 'pointer', outline: 'none', minWidth: 88, fontFamily: 'inherit' }}
                  title={t.language}
                >
                  {langCodes.map((code) => (
                    <option key={code} value={code}>{langNames[code]}</option>
                  ))}
                </select>
              </div>
            </div>

            {isOnAISite && (
              <button
                type="button"
                onClick={handleOpenPanel}
                style={{ ...S.menuBtn, backgroundColor: tk.btnPrimaryBg, borderColor: tk.btnPrimaryBg, color: '#fff' }}
              >
                <span style={S.iconWrap}><ExternalLinkIcon /></span>
                <span>{t.openOnPage}</span>
              </button>
            )}

            <MemoryMenuContent
              onOpenGraph={handleOpenGraph}
              onOpenFolder={() => setView('folder')}
            />
          </div>
        </div>

        {/* Slot 2: Detail view */}
        <div style={{ width: POPUP_WIDTH, flexShrink: 0, position: 'relative', opacity: view === 'folder' ? 1 : 0, transition: 'opacity 0.24s ease, background-color 0.25s ease, color 0.25s ease, border-color 0.25s ease, box-shadow 0.25s ease' }}>
          <FolderView onBack={goBack} width={POPUP_WIDTH} />
        </div>
      </div>
    </div>
  )
}

export default function PopupRoot() {
  return (
    <LanguageProvider>
      <ThemeProvider>
        <App />
      </ThemeProvider>
    </LanguageProvider>
  )
}
