import React, { useEffect, useRef, useState } from 'react'
import type { CaptureMode } from '../../constants/capture'
import { useTranslation } from '../../i18n/LanguageContext'
import { useTheme } from '../../i18n/ThemeContext'
import { getThemeTokens } from '../../ui/theme'
import { getCaptureModeTone } from '../../ui/captureModeTone'
import { ChevronLeftIcon, TrashIcon } from '../../ui/icons'
import * as S from '../../ui/styles'
import type { ClearAllMemoriesResponse, GetCaptureModeResponse, SetCaptureModeResponse } from '../../types/messages'

// ── Component ──────────────────────────────────────────────────────────────────

interface SettingsViewProps {
  onBack: () => void
  onAllDeleted?: () => void
}

export function SettingsView({ onBack, onAllDeleted }: SettingsViewProps) {
  const { t } = useTranslation()
  const { theme } = useTheme()
  const tk = getThemeTokens(theme)

  const [confirming, setConfirming] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [captureMode, setCaptureMode] = useState<CaptureMode>('auto')
  const [savingMode, setSavingMode] = useState(false)
  const [deleteStatus, setDeleteStatus] = useState<string | null>(null)
  const [modeToast, setModeToast] = useState<{ type: 'success' | 'error'; mode?: CaptureMode; message: string } | null>(null)
  const modeToastTimerRef = useRef<number | null>(null)

  useEffect(() => {
    chrome.runtime.sendMessage({ type: 'GET_CAPTURE_MODE' }, (response: GetCaptureModeResponse | undefined) => {
      if (response?.payload?.mode) setCaptureMode(response.payload.mode)
    })
  }, [])

  useEffect(() => () => {
    if (modeToastTimerRef.current !== null) window.clearTimeout(modeToastTimerRef.current)
  }, [])

  const showModeToast = (type: 'success' | 'error', message: string, mode?: CaptureMode) => {
    if (modeToastTimerRef.current !== null) window.clearTimeout(modeToastTimerRef.current)
    setModeToast({ type, message, mode })
    modeToastTimerRef.current = window.setTimeout(() => {
      setModeToast(null)
      modeToastTimerRef.current = null
    }, 1000)
  }

  const updateCaptureMode = async (mode: CaptureMode) => {
    if (mode === captureMode || savingMode) return
    setSavingMode(true)
    setModeToast(null)
    try {
      const response = await new Promise<SetCaptureModeResponse>((resolve) => {
        chrome.runtime.sendMessage({ type: 'SET_CAPTURE_MODE', payload: { mode } }, resolve)
      })
      if (response?.payload?.success) {
        setCaptureMode(response.payload.mode)
        showModeToast('success', t.captureModeUpdated, response.payload.mode)
      } else {
        showModeToast('error', t.captureModeUpdateFailed(response?.payload?.error ?? 'unknown'))
      }
    } catch (err) {
      showModeToast('error', t.captureModeUpdateFailed(String(err)))
    } finally {
      setSavingMode(false)
    }
  }

  const handleDeleteAll = async () => {
    setDeleting(true)
    setDeleteStatus(null)
    try {
      const response = await new Promise<ClearAllMemoriesResponse>((resolve) => {
        chrome.runtime.sendMessage({ type: 'CLEAR_ALL_MEMORIES' }, resolve)
      })
      if (response?.payload?.success) {
        setDeleteStatus(t.deleteAllSuccess)
        setTimeout(() => setDeleteStatus(null), 3000)
        setConfirming(false)
        onAllDeleted?.()
      } else {
        setDeleteStatus(t.deleteAllFailed(response?.payload?.error ?? 'unknown'))
      }
    } catch (err) {
      setDeleteStatus(t.deleteAllFailed(String(err)))
    } finally {
      setDeleting(false)
    }
  }

  const actionBtn: React.CSSProperties = {
    flex: 1,
    padding: '8px 0',
    borderRadius: 8,
    border: '1px solid',
    fontSize: 13,
    fontWeight: 500,
    cursor: 'pointer',
    fontFamily: 'inherit',
  }

  const activeModeTone = getCaptureModeTone(modeToast?.mode ?? captureMode, tk)
  const modeToastTone = modeToast?.type === 'success'
    ? activeModeTone
    : {
        backgroundColor: tk.errorBg,
        borderColor: tk.errorText,
        color: tk.errorText,
        ringColor: tk.errorBg,
      }

  return (
    <div style={{ ...S.viewContainerLoose, minHeight: '100%', backgroundColor: tk.bg, color: tk.text }}>
      {/* Header */}
      <div style={S.viewHeader}>
        <button
          type="button"
          onClick={onBack}
          style={{ ...S.iconBtn, backgroundColor: tk.btnBg, borderColor: tk.border, color: tk.text }}
        >
          <ChevronLeftIcon />
        </button>
        <span style={{ ...S.viewTitle, color: tk.text }}>{t.settings}</span>
      </div>

      <div style={{ ...S.divider, backgroundColor: tk.separator }} />

      <div style={{ borderRadius: 12, border: '1px solid', borderColor: tk.border, backgroundColor: tk.bgCard, padding: '14px', display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3, flex: 1 }}>
            <div style={{ fontSize: 14, fontWeight: 600, letterSpacing: '-0.01em', color: tk.text }}>{t.autoSaveMemory}</div>
            <div style={{ fontSize: 12, lineHeight: 1.45, color: tk.textMuted }}>{t.autoSaveMemoryDesc}</div>
          </div>
          <div style={{ display: 'flex', padding: 3, borderRadius: 10, border: `1px solid ${tk.border}`, backgroundColor: tk.inputBg }}>
            {(['auto', 'manual'] as const).map((mode) => {
              const active = captureMode === mode
              return (
                <button
                  key={mode}
                  type="button"
                  disabled={savingMode}
                  onClick={() => updateCaptureMode(mode)}
                  style={{
                    border: 'none',
                    borderRadius: 8,
                    padding: '5px 9px',
                    backgroundColor: active ? tk.accent : 'transparent',
                    color: active ? '#fff' : tk.textMuted,
                    cursor: savingMode ? 'not-allowed' : 'pointer',
                    fontSize: 12,
                    fontWeight: 650,
                    fontFamily: 'inherit',
                  }}
                >
                  {mode === 'auto' ? t.captureModeAuto : t.captureModeManual}
                </button>
              )
            })}
          </div>
        </div>
      </div>

      {/* Danger Zone */}
      <div style={{ borderRadius: 12, border: '1px solid', borderColor: tk.errorText, padding: '14px 14px 10px', display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ ...S.sectionLabel, color: tk.errorText }}>
          {t.dangerZone}
        </div>

        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3, flex: 1 }}>
            <div style={{ fontSize: 14, fontWeight: 500, letterSpacing: '-0.01em', color: tk.text }}>{t.deleteAllMemory}</div>
            <div style={{ fontSize: 12, lineHeight: 1.4, color: tk.textMuted }}>{t.deleteAllMemoryDesc}</div>
          </div>
          {!confirming && (
            <button
              type="button"
              onClick={() => { setDeleteStatus(null); setConfirming(true) }}
              style={{ ...S.iconBtn, borderRadius: 8, backgroundColor: 'transparent', borderColor: tk.errorText, color: tk.errorText }}
            >
              <TrashIcon />
            </button>
          )}
        </div>

        {confirming && (
          <div style={{ borderRadius: 10, border: '1px solid', borderColor: tk.errorText, backgroundColor: tk.errorBg, padding: '12px', display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: tk.errorText }}>
              {t.deleteAllConfirmTitle}
            </div>
            <div style={{ fontSize: 12, lineHeight: 1.4, color: tk.textMuted }}>
              {t.deleteAllConfirmDesc}
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 2 }}>
              <button
                type="button"
                onClick={() => setConfirming(false)}
                disabled={deleting}
                style={{ ...actionBtn, backgroundColor: tk.btnBg, borderColor: tk.border, color: tk.text }}
              >
                {t.deleteAllCancel}
              </button>
              <button
                type="button"
                onClick={handleDeleteAll}
                disabled={deleting}
                style={{ ...actionBtn, backgroundColor: tk.errorText, borderColor: tk.errorText, color: '#fff', opacity: deleting ? 0.6 : 1 }}
              >
                {deleting ? '…' : t.deleteAllConfirm}
              </button>
            </div>
          </div>
        )}

        {deleteStatus && (
          <div style={{ fontSize: 12, fontWeight: 500, color: deleteStatus.startsWith('✓') ? tk.successText : tk.errorText }}>
            {deleteStatus}
          </div>
        )}
      </div>

      {modeToast && (
        <div
          role="status"
          aria-live="polite"
          style={{
            position: 'sticky',
            bottom: 10,
            marginTop: 'auto',
            padding: '9px 12px',
            borderRadius: 12,
            border: `1px solid ${modeToastTone.borderColor}`,
            backgroundColor: modeToastTone.backgroundColor,
            color: modeToastTone.color,
            boxShadow: `${tk.shadow}, 0 0 0 3px ${modeToastTone.ringColor}`,
            fontSize: 12,
            fontWeight: 650,
            letterSpacing: '-0.01em',
            textAlign: 'center',
          }}
        >
          {modeToast.message}
        </div>
      )}
    </div>
  )
}
