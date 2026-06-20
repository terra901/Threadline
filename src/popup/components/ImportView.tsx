import React, { useRef, useState, useEffect } from 'react'
import type { IMemoryExportEnvelope, SerializableMemoryRecord } from '../../types/memory'
import type { ImportMemoriesResponse } from '../../types/messages'
import { IMPORTERS } from '../../importers/index'
import type { IConversationImporter } from '../../importers/index'
import { useTranslation } from '../../i18n/LanguageContext'
import { useTheme } from '../../i18n/ThemeContext'
import { getThemeTokens } from '../../ui/theme'
import { DownloadIcon, ChevronRightIcon } from '../../ui/icons'
import * as S from '../../ui/styles'
import { isMemoryExportAppName } from '../../constants/branding'

// ── Component ──────────────────────────────────────────────────────────────────

type Status = { type: 'idle' } | { type: 'success'; msg: string } | { type: 'error'; msg: string }
interface ImportViewProps { onImported?: () => void }

export function ImportView({ onImported }: ImportViewProps) {
  const [status, setStatus] = useState<Status>({ type: 'idle' })
  const [importing, setImporting] = useState(false)
  const [activeImporterId, setActiveImporterId] = useState<string | null>(null)
  const [menuOpen, setMenuOpen] = useState(false)

  const containerRef = useRef<HTMLDivElement>(null)
  const backupInputRef = useRef<HTMLInputElement>(null)
  const providerInputRef = useRef<HTMLInputElement>(null)
  const currentImporterRef = useRef<IConversationImporter | null>(null)
  const btnRef = useRef<HTMLButtonElement>(null)

  const { t } = useTranslation()
  const { theme } = useTheme()
  const tk = getThemeTokens(theme)

  // Delay close menu to avoid mousedown event swallowing the button click
  useEffect(() => {
    let timeoutId: number
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        timeoutId = window.setTimeout(() => {
          setMenuOpen(false)
        }, 150) // Delay 150ms to ensure the Export button can be clicked successfully
      }
    }
    if (menuOpen) {
      document.addEventListener('mousedown', handleClickOutside)
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      clearTimeout(timeoutId)
    }
  }, [menuOpen])

  async function sendRecordsToBackground(
    records: SerializableMemoryRecord[],
  ): Promise<{ count: number; skipped: number }> {
    const resp = await new Promise<ImportMemoriesResponse>((resolve, reject) => {
      chrome.runtime.sendMessage(
        { type: 'IMPORT_MEMORIES', payload: { records } },
        (r: ImportMemoriesResponse | undefined) => {
          if (chrome.runtime.lastError)
            return reject(new Error(chrome.runtime.lastError.message))
          if (!r) return reject(new Error('No response from background'))
          resolve(r)
        },
      )
    })
    if (!resp.payload.success) throw new Error(resp.payload.error ?? '寫入失敗')
    return { count: resp.payload.count, skipped: resp.payload.skipped ?? 0 }
  }

  // ── Backup file handler (Threadline backup format) ───────────────────────────

  async function handleBackupFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setImporting(true)
    setStatus({ type: 'idle' })
    const reader = new FileReader()
    reader.onload = async (ev) => {
      try {
        const data = JSON.parse(ev.target?.result as string) as IMemoryExportEnvelope
        if (!isMemoryExportAppName(data?.metadata?.app)) throw new Error(t.importInvalidApp)
        if (!Array.isArray(data.payload)) throw new Error(t.importInvalidPayload)
        const resp = await new Promise<ImportMemoriesResponse>((resolve, reject) => {
          chrome.runtime.sendMessage({
            type: 'IMPORT_MEMORIES',
            payload: {
              records: data.payload as SerializableMemoryRecord[],
              ...(Array.isArray(data.prompts) && data.prompts.length > 0 && { prompts: data.prompts }),
              ...(Array.isArray(data.folders) && data.folders.length > 0 && { folders: data.folders }),
            },
          }, (r: ImportMemoriesResponse | undefined) => {
            if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message))
            if (!r) return reject(new Error('No response from background'))
            resolve(r)
          })
        })
        if (!resp.payload.success) throw new Error(resp.payload.error ?? '寫入失敗')
        setStatus({ type: 'success', msg: t.importSuccess(resp.payload.count) })
        setTimeout(() => setStatus({ type: 'idle' }), 3000)
        setMenuOpen(false)
        onImported?.()
      } catch (err) {
        setStatus({ type: 'error', msg: t.importFailed((err as Error).message ?? String(err)) })
      } finally {
        setImporting(false)
        e.target.value = ''
      }
    }
    reader.onerror = () => { setStatus({ type: 'error', msg: t.importReadFailed }); setImporting(false) }
    reader.readAsText(file)
  }

  // ── Generic provider importer handler ───────────────────────────────────────

  async function handleProviderFileChange(e: React.ChangeEvent<HTMLInputElement>, importer: IConversationImporter) {
    const file = e.target.files?.[0]
    if (!file) return
    setActiveImporterId(importer.id)
    setStatus({ type: 'idle' })
    const reader = new FileReader()
    reader.onload = async (ev) => {
      try {
        let raw: unknown
        try { raw = JSON.parse(ev.target?.result as string) } catch { throw new Error(t.importProviderInvalidFile(importer.displayName)) }
        if (!importer.canHandle(raw)) throw new Error(t.importProviderInvalidFile(importer.displayName))
        const records = importer.parse(raw)
        if (records.length === 0) throw new Error(t.importProviderInvalidFile(importer.displayName))
        const { count, skipped } = await sendRecordsToBackground(records)
        let successMsg: string
        if (count === 0 && skipped > 0) {
          successMsg = t.importProviderAlreadyImported(importer.displayName)
        } else if (skipped > 0) {
          successMsg = t.importProviderSuccessWithSkipped(importer.displayName, count, skipped)
        } else {
          successMsg = t.importProviderSuccess(importer.displayName, count)
        }
        setStatus({ type: 'success', msg: successMsg })
        setTimeout(() => setStatus({ type: 'idle' }), 3000)
        setMenuOpen(false)
        onImported?.()
      } catch (err) {
        setStatus({ type: 'error', msg: t.importProviderFailed(importer.displayName, (err as Error).message ?? String(err)) })
      } finally {
        setActiveImporterId(null)
        e.target.value = ''
      }
    }
    reader.onerror = () => { setStatus({ type: 'error', msg: t.importReadFailed }); setActiveImporterId(null) }
    reader.readAsText(file)
  }

  const busy = importing || activeImporterId !== null
  const activeImporter = activeImporterId ? IMPORTERS.find(i => i.id === activeImporterId) : null
  const buttonLabel = activeImporter
    ? t.importingProvider(activeImporter.displayName)
    : importing
      ? t.importing
      : t.importBackup

  const toggleMenu = (e: React.MouseEvent) => {
    e.stopPropagation()
    setMenuOpen(!menuOpen)
  }

  return (
    <div ref={containerRef} style={{ position: 'relative', width: '100%' }}>
      <button
        ref={btnRef}
        style={busy ? { ...S.menuBtn, ...S.btnDisabled } : { ...S.menuBtn, backgroundColor: tk.btnBg, borderColor: tk.border, color: tk.text }}
        onClick={toggleMenu}
        disabled={busy}
        type="button"
      >
        <span style={S.iconWrap}><DownloadIcon /></span>
        <span style={{ flex: 1 }}>{buttonLabel}</span>
        <span style={{ ...S.iconWrap, opacity: 0.4, transform: menuOpen ? 'rotate(90deg)' : 'rotate(0deg)', transition: 'transform 0.2s ease' }}>
          <ChevronRightIcon />
        </span>
      </button>

      {menuOpen && (
        <div style={{ ...S.dropdownMenu, backgroundColor: tk.bg, borderColor: tk.border }}>
          <div style={{ ...S.dropdownMenuLabel, color: tk.textMuted }}>{t.importChoose}</div>

          {/* Backup file (special: uses Threadline envelope format) */}
          <button
            style={{ ...S.dropdownMenuItem, color: tk.text }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.backgroundColor = tk.btnBg }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.backgroundColor = 'transparent' }}
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); backupInputRef.current?.click() }}
            type="button"
          >
            {t.importTypeBackup}
          </button>

          {/* Dynamic provider importers from registry */}
          {IMPORTERS.map((importer) => (
            <button
              key={importer.id}
              style={{ ...S.dropdownMenuItem, color: tk.text }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.backgroundColor = tk.btnBg }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.backgroundColor = 'transparent' }}
              onClick={(e) => {
                e.preventDefault()
                e.stopPropagation()
                currentImporterRef.current = importer
                providerInputRef.current?.click()
              }}
              type="button"
            >
              {importer.displayName}
            </button>
          ))}
        </div>
      )}

      {/* Backup file input (used to import the backup file from the Threadline backup format) */}
      <input ref={backupInputRef} type="file" accept=".json" onChange={handleBackupFileChange} style={{ display: 'none' }} />

      {/* Shared provider file input — dispatches to currentImporterRef */}
      <input
        ref={providerInputRef}
        type="file"
        accept=".json"
        onChange={(e) => {
          const importer = currentImporterRef.current
          currentImporterRef.current = null
          if (importer) handleProviderFileChange(e, importer)
        }}
        style={{ display: 'none' }}
      />

      {status.type !== 'idle' && (
        <div style={status.type === 'success' ? { ...S.statusMsg, backgroundColor: tk.successBg, color: tk.successText } : { ...S.statusMsg, backgroundColor: tk.errorBg, color: tk.errorText }}>
          {status.msg}
        </div>
      )}
    </div>
  )
}
