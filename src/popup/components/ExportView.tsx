import React, { useState } from 'react'
import type { ExportMemoriesResponse } from '../../types/messages'
import { useTranslation } from '../../i18n/LanguageContext'
import { useTheme } from '../../i18n/ThemeContext'
import { getThemeTokens } from '../../ui/theme'
import { UploadIcon } from '../../ui/icons'
import * as S from '../../ui/styles'
import { LOG_PREFIX } from '../../constants/branding'

// ── Component ──────────────────────────────────────────────────────────────────

type Status = { type: 'idle' } | { type: 'success'; msg: string } | { type: 'error'; msg: string }

export function ExportView() {
  const [status, setStatus] = useState<Status>({ type: 'idle' })
  const [exporting, setExporting] = useState(false)
  const { t } = useTranslation()
  const { theme } = useTheme()
  const tk = getThemeTokens(theme)

  async function handleExport() {
    setExporting(true)
    setStatus({ type: 'idle' })

    try {
      const resp = await new Promise<ExportMemoriesResponse>((resolve, reject) => {
        chrome.runtime.sendMessage({ type: 'EXPORT_MEMORIES' }, (r: ExportMemoriesResponse | undefined) => {
          if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message))
          if (!r) return reject(new Error('No response from background'))
          resolve(r)
        })
      })

      if (resp.payload.error) throw new Error(resp.payload.error)

      const { envelope } = resp.payload
      const hasMemories = envelope.payload.length > 0
      const hasPrompts = Array.isArray(envelope.prompts) && envelope.prompts.length > 0
      if (!hasMemories && !hasPrompts) {
        setStatus({ type: 'error', msg: t.exportNoMemories })
        return
      }
      const totalCount = envelope.payload.length + (envelope.prompts?.length ?? 0)
      const successMsg = hasPrompts ? t.exportSuccessItems : t.exportSuccess
      const successDownloadsMsg = hasPrompts ? t.exportSuccessDownloadsItems : t.exportSuccessDownloads

      const json = JSON.stringify(envelope, null, 2)
      const blob = new Blob([json], { type: 'application/json' })
      const filename = `threadline_v1_${new Date().toISOString().split('T')[0]}.json`

      const showSaveFilePicker = (
        window as Window & { showSaveFilePicker?: (opts: object) => Promise<FileSystemFileHandle> }
      ).showSaveFilePicker
      if (typeof showSaveFilePicker === 'function') {
        try {
          const handle = await showSaveFilePicker({
            suggestedName: filename,
            types: [{ description: 'Threadline backup', accept: { 'application/json': ['.json'] } }],
          })
          const writable = await handle.createWritable()
          await writable.write(blob)
          await writable.close()
          setStatus({ type: 'success', msg: successMsg(totalCount) })
          setTimeout(() => setStatus({ type: 'idle' }), 3000)
          return
        } catch (pickerErr) {
          if ((pickerErr as DOMException)?.name === 'AbortError') return
        }
      }

      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = filename
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)

      setStatus({ type: 'success', msg: successDownloadsMsg(totalCount) })
      setTimeout(() => setStatus({ type: 'idle' }), 3000)
    } catch (err) {
      console.error(`${LOG_PREFIX} Export failed:`, err)
      setStatus({ type: 'error', msg: t.exportFailed(String(err)) })
    } finally {
      setExporting(false)
    }
  }

  return (
    <div>
      <button
        style={
          exporting
            ? { ...S.menuBtn, ...S.btnDisabled }
            : { ...S.menuBtn, backgroundColor: tk.btnBg, borderColor: tk.border, color: tk.text }
        }
        onClick={handleExport}
        disabled={exporting}
        type="button"
      >
        <span style={S.iconWrap}><UploadIcon /></span>
        <span>{exporting ? t.exporting : t.exportBackup}</span>
      </button>

      {status.type !== 'idle' && (
        <div
          style={
            status.type === 'success'
              ? { ...S.statusMsg, backgroundColor: tk.successBg, color: tk.successText }
              : { ...S.statusMsg, backgroundColor: tk.errorBg, color: tk.errorText }
          }
        >
          {status.msg}
        </div>
      )}
    </div>
  )
}
