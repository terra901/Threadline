import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { FavoritePrompt } from '../../types/memory'
import { useTranslation } from '../../i18n/LanguageContext'
import { useTheme } from '../../i18n/ThemeContext'
import { getThemeTokens } from '../../ui/theme'
import { PromptTrie } from '../../utils/trie'
import {
  PROMPTS_STORAGE_KEY as STORAGE_KEY,
  FOLDERS_STORAGE_KEY as FOLDERS_KEY,
  PROMPT_DRAG_TYPE as DRAG_TYPE,
} from '../../constants/prompts'

// ── SVG Icons ──────────────────────────────────────────────────────────────────

const StarIcon = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
  </svg>
)

/** 2×3 grid of dots — drag handle indicator */
const GripIcon = () => (
  <svg width="10" height="14" viewBox="0 0 10 14" fill="currentColor">
    <circle cx="2.5" cy="2.5" r="1.2"/>
    <circle cx="7.5" cy="2.5" r="1.2"/>
    <circle cx="2.5" cy="7" r="1.2"/>
    <circle cx="7.5" cy="7" r="1.2"/>
    <circle cx="2.5" cy="11.5" r="1.2"/>
    <circle cx="7.5" cy="11.5" r="1.2"/>
  </svg>
)

// ── Component ──────────────────────────────────────────────────────────────────

const MAX_VISIBLE = 3

export function FavoritePromptsSection() {
  const { t } = useTranslation()
  const { theme } = useTheme()
  const tk = getThemeTokens(theme)
  const [prompts, setPrompts] = useState<FavoritePrompt[]>([])
  const [newText, setNewText] = useState('')
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [listExpanded, setListExpanded] = useState(false)
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set())
  const [suggestionsDismissed, setSuggestionsDismissed] = useState(false)
  const [selectedSuggestionIndex, setSelectedSuggestionIndex] = useState(0)
  // drag-to-reorder: which item is being dragged, and where the drop line should appear
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [dropTarget, setDropTarget] = useState<{ id: string; edge: 'before' | 'after' } | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const trieRef = useRef(new PromptTrie())

  useEffect(() => {
    chrome.storage.local.get(STORAGE_KEY, (result) => {
      const stored = result[STORAGE_KEY]
      if (Array.isArray(stored)) {
        setPrompts(stored)
        trieRef.current.rebuild(stored.map((p: FavoritePrompt) => p.text))
      }
    })
    const listener = (changes: { [key: string]: chrome.storage.StorageChange }) => {
      if (changes[STORAGE_KEY]?.newValue != null && Array.isArray(changes[STORAGE_KEY].newValue)) {
        const next = changes[STORAGE_KEY].newValue as FavoritePrompt[]
        setPrompts(next)
        trieRef.current.rebuild(next.map((p) => p.text))
      }
    }
    chrome.storage.onChanged.addListener(listener)
    return () => chrome.storage.onChanged.removeListener(listener)
  }, [])

  const savePrompts = useCallback((next: FavoritePrompt[]) => {
    setPrompts(next)
    trieRef.current.rebuild(next.map((p) => p.text))
    chrome.storage.local.set({ [STORAGE_KEY]: next })
  }, [])

  const savePrompt = useCallback(() => {
    const text = newText.trim()
    if (!text) return
    const prompt: FavoritePrompt = { id: Date.now().toString(), text, createdAt: Date.now() }
    savePrompts([...prompts, prompt])
    setNewText('')
  }, [newText, prompts, savePrompts])

  const deletePrompt = useCallback(
    (id: string) => {
      const removed = prompts.find((p) => p.id === id)
      savePrompts(prompts.filter((p) => p.id !== id))
      if (removed) trieRef.current.remove(removed.text)
      chrome.storage.local.get(FOLDERS_KEY, (r) => {
        const folders = r[FOLDERS_KEY] as Array<{ id: string; promptIds: string[] }> | undefined
        if (Array.isArray(folders)) {
          const updated = folders.map((f) => ({
            ...f,
            promptIds: f.promptIds.filter((pid) => pid !== id),
          }))
          chrome.storage.local.set({ [FOLDERS_KEY]: updated })
        }
      })
    },
    [prompts, savePrompts]
  )

  const copyPrompt = useCallback((text: string, id: string) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopiedId(id)
      setTimeout(() => setCopiedId(null), 1500)
    })
  }, [])

  const toggleExpand = useCallback((id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const canSave = newText.trim().length > 0
  const visiblePrompts = listExpanded ? prompts : prompts.slice(0, MAX_VISIBLE)
  const hiddenCount = prompts.length - MAX_VISIBLE

  const suggestList = useMemo(() => {
    const prefix = newText.trim()
    if (prefix.length < 2) return []
    return trieRef.current.suggest(prefix, 5).filter((s) => s !== prefix)
  }, [newText])

  const applySuggestion = useCallback((text: string) => {
    setNewText(text)
    setSuggestionsDismissed(true)
    setSelectedSuggestionIndex(0)
    textareaRef.current?.focus()
  }, [])

  const handleTextareaKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
        savePrompt()
        return
      }
      if (e.key === 'Escape' && suggestList.length > 0) {
        setSuggestionsDismissed(true)
        setSelectedSuggestionIndex(0)
        return
      }
      if (suggestList.length === 0) return
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setSelectedSuggestionIndex((i) => (i + 1) % suggestList.length)
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setSelectedSuggestionIndex((i) => (i - 1 + suggestList.length) % suggestList.length)
        return
      }
      if (e.key === 'Tab') {
        e.preventDefault()
        const chosen = suggestList[selectedSuggestionIndex]
        if (chosen) applySuggestion(chosen)
      }
    },
    [suggestList, selectedSuggestionIndex, savePrompt, applySuggestion]
  )

  const handleTextareaChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setNewText(e.target.value)
    setSuggestionsDismissed(false)
    setSelectedSuggestionIndex(0)
  }, [])

  // ── Drag-to-reorder handlers ──────────────────────────────────────────────

  const handleDragStart = useCallback((e: React.DragEvent, prompt: FavoritePrompt) => {
    e.dataTransfer.setData(DRAG_TYPE, prompt.id)
    // Set the actual text so dropping onto an external textarea inserts the prompt content
    e.dataTransfer.setData('text/plain', prompt.text)
    e.dataTransfer.effectAllowed = 'copyMove'
    setDraggingId(prompt.id)
  }, [])

  const handleDragEnd = useCallback(() => {
    setDraggingId(null)
    setDropTarget(null)
  }, [])

  const handleDragOver = useCallback((e: React.DragEvent, targetId: string) => {
    if (!e.dataTransfer.types.includes(DRAG_TYPE)) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    // Determine if cursor is in the top half (insert before) or bottom half (insert after)
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const edge: 'before' | 'after' = e.clientY < rect.top + rect.height / 2 ? 'before' : 'after'
    setDropTarget((prev) =>
      prev?.id === targetId && prev?.edge === edge ? prev : { id: targetId, edge }
    )
  }, [])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    // Only clear if leaving to outside the row (not to a child element)
    if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node)) {
      setDropTarget(null)
    }
  }, [])

  const handleDrop = useCallback((e: React.DragEvent, targetId: string) => {
    e.preventDefault()
    const sourceId = e.dataTransfer.getData(DRAG_TYPE)
    if (!sourceId || sourceId === targetId) {
      setDropTarget(null)
      setDraggingId(null)
      return
    }
    const sourceIdx = prompts.findIndex((p) => p.id === sourceId)
    if (sourceIdx === -1) {
      setDropTarget(null)
      setDraggingId(null)
      return
    }
    const targetIdx = prompts.findIndex((p) => p.id === targetId)
    if (targetIdx === -1) {
      setDropTarget(null)
      setDraggingId(null)
      return
    }
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const edge: 'before' | 'after' = e.clientY < rect.top + rect.height / 2 ? 'before' : 'after'

    const next = [...prompts]
    const [moved] = next.splice(sourceIdx, 1)
    // Recalculate targetIdx after removal
    const newTargetIdx = next.findIndex((p) => p.id === targetId)
    const insertAt = edge === 'before' ? newTargetIdx : newTargetIdx + 1
    next.splice(insertAt, 0, moved)
    savePrompts(next)
    setDropTarget(null)
    setDraggingId(null)
  }, [prompts, savePrompts])

  return (
    <div style={styles.container}>
      {/* Section header */}
      <div style={styles.sectionHeader}>
        <span style={{ ...styles.starIcon, color: tk.textMuted }}>
          <StarIcon />
        </span>
        <span style={{ ...styles.sectionTitle, color: tk.text }}>{t.favoritePrompts}</span>
      </div>

      {/* Saved prompts list */}
      {prompts.length > 0 ? (
        <div style={styles.promptList}>
          {visiblePrompts.map((p) => {
            const isExpanded = expandedIds.has(p.id)
            const isDragging = draggingId === p.id
            const showLineBefore = dropTarget?.id === p.id && dropTarget.edge === 'before'
            const showLineAfter = dropTarget?.id === p.id && dropTarget.edge === 'after'
            return (
              <div key={p.id} style={{ position: 'relative' }}>
                {/* Drop indicator line — before */}
                {showLineBefore && (
                  <div style={{ ...styles.dropLine, backgroundColor: tk.accent, top: -3 }} />
                )}

                <div
                  style={{
                    ...styles.promptRow,
                    backgroundColor: tk.bgCard,
                    borderColor: tk.border,
                    opacity: isDragging ? 0.4 : 1,
                    transition: 'opacity 0.1s',
                  }}
                  draggable
                  onDragStart={(e) => handleDragStart(e, p)}
                  onDragEnd={handleDragEnd}
                  onDragOver={(e) => handleDragOver(e, p.id)}
                  onDragLeave={handleDragLeave}
                  onDrop={(e) => handleDrop(e, p.id)}
                >
                  {/* Grip handle */}
                  <span style={{ ...styles.gripHandle, color: tk.textTertiary }}>
                    <GripIcon />
                  </span>

                  {/* Prompt text — click to expand/collapse */}
                  <span
                    style={{
                      ...styles.promptText,
                      color: tk.text,
                      whiteSpace: isExpanded ? 'pre-wrap' : 'nowrap',
                      overflow: isExpanded ? 'visible' : 'hidden',
                      textOverflow: isExpanded ? 'clip' : 'ellipsis',
                      cursor: 'pointer',
                      wordBreak: isExpanded ? 'break-word' : undefined,
                    }}
                    title={isExpanded ? undefined : p.text}
                    onClick={() => toggleExpand(p.id)}
                  >
                    {p.text}
                  </span>

                  <div style={styles.promptActions}>
                    <button
                      type="button"
                      style={{ ...styles.copyBtn, color: tk.accent }}
                      onClick={() => copyPrompt(p.text, p.id)}
                      onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.textDecoration = 'underline' }}
                      onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.textDecoration = 'none' }}
                    >
                      {copiedId === p.id ? t.copied : t.copyBtn}
                    </button>
                    <button
                      type="button"
                      style={{ ...styles.deletePromptBtn, color: tk.textTertiary }}
                      onClick={() => deletePrompt(p.id)}
                      title={t.deleteBtn}
                      onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.color = tk.errorText }}
                      onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.color = tk.textTertiary }}
                    >
                      ×
                    </button>
                  </div>
                </div>

                {/* Drop indicator line — after */}
                {showLineAfter && (
                  <div style={{ ...styles.dropLine, backgroundColor: tk.accent, bottom: -3 }} />
                )}
              </div>
            )
          })}

          {prompts.length > MAX_VISIBLE && (
            <button
              type="button"
              style={{ ...styles.listToggleBtn, color: tk.accent }}
              onClick={() => setListExpanded((v) => !v)}
            >
              {listExpanded ? t.seeLess : `${t.seeMore} (${hiddenCount})`}
            </button>
          )}
        </div>
      ) : (
        <div style={{ ...styles.noPrompts, color: tk.textMuted }}>{t.noPrompts}</div>
      )}

      {/* New prompt input with autosuggest */}
      <div style={styles.inputWrapper}>
        <textarea
          ref={textareaRef}
          value={newText}
          onChange={handleTextareaChange}
          placeholder={t.promptPlaceholder}
          style={{
            ...styles.textarea,
            backgroundColor: tk.inputBg,
            borderColor: tk.inputBorder,
            color: tk.text,
          }}
          rows={3}
          onKeyDown={handleTextareaKeyDown}
        />
        {suggestList.length > 0 && !suggestionsDismissed && (
          <div
            style={{
              ...styles.suggestList,
              backgroundColor: theme === 'dark' ? 'rgba(36,36,38,0.98)' : 'rgba(255,255,255,0.99)',
              borderColor: tk.border,
              boxShadow: theme === 'dark'
                ? '0 8px 28px rgba(0,0,0,0.55), 0 1px 4px rgba(0,0,0,0.3)'
                : '0 8px 28px rgba(0,0,0,0.14), 0 1px 4px rgba(0,0,0,0.06)',
            }}
          >
            <div style={{ ...styles.suggestLabel, color: tk.textMuted }}>{t.suggestFromHistory}</div>
            {suggestList.map((s, i) => {
              const isSelected = i === selectedSuggestionIndex
              return (
                <button
                  key={s}
                  type="button"
                  style={{
                    ...styles.suggestItem,
                    color: isSelected ? '#fff' : tk.text,
                    backgroundColor: isSelected ? tk.accent : 'transparent',
                    fontWeight: isSelected ? 500 : 400,
                  }}
                  onClick={() => applySuggestion(s)}
                  onMouseEnter={() => setSelectedSuggestionIndex(i)}
                >
                  {s.length > 80 ? s.slice(0, 80) + '…' : s}
                </button>
              )
            })}
          </div>
        )}
      </div>
      <div style={styles.saveRow}>
        <span style={{ ...styles.hint, color: tk.textTertiary }}>⌘↵</span>
        <button
          type="button"
          onClick={savePrompt}
          disabled={!canSave}
          style={
            canSave
              ? { ...styles.saveBtn, backgroundColor: tk.btnPrimaryBg }
              : { ...styles.saveBtn, ...styles.saveBtnDisabled }
          }
        >
          {t.savePrompt}
        </button>
      </div>
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
  },
  sectionHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
  },
  starIcon: {
    display: 'flex',
    alignItems: 'center',
    flexShrink: 0,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: 600,
    letterSpacing: '-0.01em',
  },
  promptList: {
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
  },
  dropLine: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 2,
    borderRadius: 1,
    pointerEvents: 'none',
    zIndex: 2,
  },
  promptRow: {
    display: 'flex',
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 4,
    border: '1px solid',
    borderRadius: 10,
    padding: '6px 8px 6px 6px',
    cursor: 'default',
  },
  gripHandle: {
    display: 'flex',
    alignItems: 'center',
    flexShrink: 0,
    cursor: 'grab',
    paddingTop: 1,
    opacity: 0.55,
  },
  promptActions: {
    display: 'flex',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    flexShrink: 0,
    paddingTop: 1,
  },
  promptText: {
    fontSize: 12,
    lineHeight: 1.5,
    letterSpacing: '-0.01em',
    flex: 1,
    minWidth: 0,
  },
  copyBtn: {
    fontSize: 11,
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    padding: '1px 4px',
    textDecoration: 'none',
    whiteSpace: 'nowrap',
    fontFamily: 'inherit',
  },
  deletePromptBtn: {
    fontSize: 15,
    lineHeight: 1,
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    padding: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: 18,
    height: 18,
    flexShrink: 0,
  },
  listToggleBtn: {
    fontSize: 11,
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    padding: '2px 0',
    textDecoration: 'underline',
    textAlign: 'left',
    fontFamily: 'inherit',
  },
  noPrompts: {
    fontSize: 12,
    fontStyle: 'italic',
    textAlign: 'center',
    padding: '2px 0',
  },
  inputWrapper: {
    position: 'relative',
  },
  suggestList: {
    position: 'absolute',
    top: '100%',
    left: 0,
    right: 0,
    marginTop: 4,
    border: '1px solid',
    borderRadius: 10,
    zIndex: 10,
    maxHeight: 140,
    overflowY: 'auto',
  },
  suggestLabel: {
    fontSize: 10,
    padding: '5px 10px',
    borderBottom: '1px solid rgba(128,128,128,0.15)',
    letterSpacing: '0.03em',
  },
  suggestItem: {
    display: 'block',
    width: '100%',
    padding: '7px 10px',
    fontSize: 12,
    textAlign: 'left',
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    fontFamily: 'inherit',
    transition: 'background-color 0.08s ease, color 0.08s ease',
    borderRadius: 6,
    margin: '2px 4px',
    boxSizing: 'border-box',
  },
  textarea: {
    width: '100%',
    padding: '8px 10px',
    borderRadius: 10,
    border: '1px solid',
    fontSize: 13,
    lineHeight: 1.5,
    resize: 'vertical',
    outline: 'none',
    fontFamily: 'ui-sans-serif, system-ui, -apple-system, sans-serif',
    boxSizing: 'border-box',
    minHeight: 70,
    letterSpacing: '-0.01em',
  },
  saveRow: {
    display: 'flex',
    justifyContent: 'flex-end',
    alignItems: 'center',
    gap: 8,
  },
  hint: {
    fontSize: 11,
    letterSpacing: '0.02em',
  },
  saveBtn: {
    fontSize: 12,
    fontWeight: 600,
    color: '#fff',
    border: 'none',
    borderRadius: 8,
    padding: '5px 14px',
    cursor: 'pointer',
    fontFamily: 'inherit',
    letterSpacing: '-0.01em',
  },
  saveBtnDisabled: {
    backgroundColor: 'rgba(128,128,128,0.25)',
    cursor: 'not-allowed',
  },
}
