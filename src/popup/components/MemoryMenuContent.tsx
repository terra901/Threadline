import React from 'react'
import { FavoritePromptsSection } from './FavoritePromptsSection'
import { ImportView } from './ImportView'
import { ExportView } from './ExportView'
import { useTranslation } from '../../i18n/LanguageContext'
import { useTheme } from '../../i18n/ThemeContext'
import { getThemeTokens } from '../../ui/theme'
import { FolderIcon, NetworkIcon } from '../../ui/icons'
import * as S from '../../ui/styles'

// ── Component ──────────────────────────────────────────────────────────────────

interface MemoryMenuContentProps {
  onOpenGraph?: () => void
  onOpenFolder?: () => void
  onImported?: () => void
  /** Save the currently open ChatGPT conversation (DOM + backend API) now */
  onSaveCurrentConversation?: () => void
  /** Load every ChatGPT conversation from the backend API */
  onSyncChatGPTHistory?: () => void
  /** Inline sync progress ({done, total} | null) */
  syncProgress?: { done: number; total: number; currentTitle?: string } | null
}

/**
 * Shared menu items used by both the popup's MainMenuView and the in-page
 * FloatingMemoryPanel. Renders as a React fragment so items participate in the
 * parent's flex-column / gap layout without an extra wrapper element.
 */
export function MemoryMenuContent({
  onOpenGraph,
  onOpenFolder,
  onImported,
  onSaveCurrentConversation,
  onSyncChatGPTHistory,
  syncProgress,
}: MemoryMenuContentProps) {
  const { t } = useTranslation()
  const { theme } = useTheme()
  const tk = getThemeTokens(theme)

  const syncing = !!syncProgress && syncProgress.total > 0

  return (
    <>
      <FavoritePromptsSection />

      {onOpenFolder && (
        <button
          type="button"
          style={{ ...S.menuBtn, backgroundColor: tk.btnBg, borderColor: tk.border, color: tk.text }}
          onClick={onOpenFolder}
        >
          <span style={S.iconWrap}><FolderIcon /></span>
          <span>{t.promptsFolder}</span>
        </button>
      )}

      <div style={{ ...S.divider, backgroundColor: tk.separator }} />

      {onSaveCurrentConversation && (
        <button
          type="button"
          disabled={syncing}
          style={{ ...S.menuBtn, backgroundColor: tk.btnBg, borderColor: tk.border, color: tk.text, opacity: syncing ? 0.6 : 1 }}
          onClick={onSaveCurrentConversation}
          title={t.saveCurrentConversationDesc}
        >
          <span style={S.iconWrap}><NetworkIcon /></span>
          <span>{t.saveCurrentConversation}</span>
        </button>
      )}

      {onSyncChatGPTHistory && (
        <button
          type="button"
          disabled={syncing}
          style={{ ...S.menuBtn, backgroundColor: tk.btnBg, borderColor: tk.border, color: tk.text, opacity: syncing ? 0.6 : 1 }}
          onClick={onSyncChatGPTHistory}
          title={t.syncChatGPTHistoryDesc}
        >
          <span style={S.iconWrap}><NetworkIcon /></span>
          <span>
            {syncing
              ? `${t.syncChatGPTHistoryRunning} ${syncProgress.done}/${syncProgress.total}`
              : t.syncChatGPTHistory}
          </span>
        </button>
      )}

      {onOpenGraph && (
        <button
          type="button"
          style={{ ...S.menuBtn, backgroundColor: tk.btnBg, borderColor: tk.border, color: tk.text }}
          onClick={onOpenGraph}
        >
          <span style={S.iconWrap}><NetworkIcon /></span>
          <span>{t.memoryGraph}</span>
        </button>
      )}

      <ImportView onImported={onImported} />

      <ExportView />
    </>
  )
}
