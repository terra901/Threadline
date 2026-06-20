import React, { useCallback, useEffect, useState } from 'react'
import type { FavoritePrompt, PromptFolder } from '../../types/memory'
import { useTranslation } from '../../i18n/LanguageContext'
import { useTheme } from '../../i18n/ThemeContext'
import { getThemeTokens } from '../../ui/theme'
import {
  PROMPTS_STORAGE_KEY as PROMPTS_KEY,
  FOLDERS_STORAGE_KEY as FOLDERS_KEY,
  PROMPT_DRAG_TYPE as DRAG_TYPE,
} from '../../constants/prompts'

// ── SVG Icons ──────────────────────────────────────────────────────────────────

const ChevronLeftIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="15 18 9 12 15 6"/>
  </svg>
)

// ── Constants ──────────────────────────────────────────────────────────────────

const TRUNCATE_AT = 80
const FOLDER_PROMPTS_MAX_HEIGHT = 160
const FROM_FAVORITES_MAX_HEIGHT = 100
const FAVORITES_PREVIEW_LEN = 50

// ── Component ──────────────────────────────────────────────────────────────────

interface FolderViewProps {
  onBack: () => void
  width?: number
}

export function FolderView({ onBack, width }: FolderViewProps) {
  const { t } = useTranslation()
  const { theme } = useTheme()
  const tk = getThemeTokens(theme)
  const [prompts, setPrompts] = useState<FavoritePrompt[]>([])
  const [folders, setFolders] = useState<PromptFolder[]>([])
  const [newFolderName, setNewFolderName] = useState('')
  const [addingToFolderId, setAddingToFolderId] = useState<string | null>(null)
  const [inlinePromptText, setInlinePromptText] = useState('')
  const [dropTargetId, setDropTargetId] = useState<string | null>(null)
  const [expandedPromptIds, setExpandedPromptIds] = useState<Set<string>>(new Set())
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [addedToFavId, setAddedToFavId] = useState<string | null>(null)
  const [removedFromFolderIds, setRemovedFromFolderIds] = useState<Set<string>>(new Set())
  const [reorderDragId, setReorderDragId] = useState<string | null>(null)
  const [reorderFolderId, setReorderFolderId] = useState<string | null>(null)

  useEffect(() => {
    const load = () => {
      chrome.storage.local.get([PROMPTS_KEY, FOLDERS_KEY], (r) => {
        if (Array.isArray(r[PROMPTS_KEY])) setPrompts(r[PROMPTS_KEY])
        if (Array.isArray(r[FOLDERS_KEY])) setFolders(r[FOLDERS_KEY])
      })
    }
    load()
    const listener = (changes: { [key: string]: chrome.storage.StorageChange }) => {
      if (changes[PROMPTS_KEY]?.newValue != null && Array.isArray(changes[PROMPTS_KEY].newValue)) {
        setPrompts(changes[PROMPTS_KEY].newValue)
      }
      if (changes[FOLDERS_KEY]?.newValue != null && Array.isArray(changes[FOLDERS_KEY].newValue)) {
        setFolders(changes[FOLDERS_KEY].newValue)
      }
    }
    chrome.storage.onChanged.addListener(listener)
    return () => chrome.storage.onChanged.removeListener(listener)
  }, [])

  const saveFolders = useCallback((next: PromptFolder[]) => {
    setFolders(next)
    chrome.storage.local.set({ [FOLDERS_KEY]: next })
  }, [])

  const promptMap = new Map(prompts.map((p) => [p.id, p]))
  // "From Favorites" drag source: not in any folder AND not previously removed from a folder this session
  const promptsNotInFolders = prompts.filter(
    (p) => !folders.some((f) => f.promptIds.includes(p.id)) && !removedFromFolderIds.has(p.id)
  )

  const addFolder = useCallback(() => {
    const name = newFolderName.trim()
    if (!name) return
    const folder: PromptFolder = {
      id: Date.now().toString(),
      name,
      promptIds: [],
      createdAt: Date.now(),
    }
    saveFolders([...folders, folder])
    setNewFolderName('')
  }, [folders, newFolderName, saveFolders])

  const deleteFolder = useCallback(
    (id: string) => {
      saveFolders(folders.filter((f) => f.id !== id))
    },
    [folders, saveFolders]
  )

  const addPromptToFolder = useCallback(
    (folderId: string, promptId: string) => {
      const folder = folders.find((f) => f.id === folderId)
      if (!folder || folder.promptIds.includes(promptId)) return
      saveFolders(
        folders.map((f) =>
          f.id === folderId ? { ...f, promptIds: [...f.promptIds, promptId] } : f
        )
      )
    },
    [folders, saveFolders]
  )

  const removePromptFromFolder = useCallback(
    (folderId: string, promptId: string) => {
      saveFolders(
        folders.map((f) =>
          f.id === folderId ? { ...f, promptIds: f.promptIds.filter((id) => id !== promptId) } : f
        )
      )
      // Mark as removed so it doesn't reappear in "From Favorites" drag source
      setRemovedFromFolderIds((prev) => new Set([...prev, promptId]))
    },
    [folders, saveFolders]
  )

  const handleDrop = useCallback(
    (e: React.DragEvent, folderId: string) => {
      e.preventDefault()
      e.stopPropagation()
      setDropTargetId(null)
      const promptId =
        e.dataTransfer.getData(DRAG_TYPE) || e.dataTransfer.getData('text/plain')
      if (promptId) addPromptToFolder(folderId, promptId)
    },
    [addPromptToFolder]
  )

  const handleDragOver = useCallback((e: React.DragEvent, folderId: string) => {
    e.preventDefault()
    e.stopPropagation()
    e.dataTransfer.dropEffect = 'copy'
    setDropTargetId(folderId)
  }, [])

  const handleFolderDragLeave = useCallback((e: React.DragEvent) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node)) setDropTargetId(null)
  }, [])

  const handleDragStart = useCallback((e: React.DragEvent, promptId: string) => {
    e.dataTransfer.setData(DRAG_TYPE, promptId)
    e.dataTransfer.setData('text/plain', promptId)
    e.dataTransfer.effectAllowed = 'copy'
  }, [])

  // ── Intra-folder reorder ────────────────────────────────────────────────────

  const handleReorderDragStart = useCallback(
    (e: React.DragEvent, folderId: string, promptId: string) => {
      e.stopPropagation()
      e.dataTransfer.setData(DRAG_TYPE, promptId)
      e.dataTransfer.setData('text/plain', promptId)
      e.dataTransfer.effectAllowed = 'move'
      setReorderDragId(promptId)
      setReorderFolderId(folderId)
    },
    []
  )

  const handleReorderDrop = useCallback(
    (e: React.DragEvent, folderId: string, targetPromptId: string) => {
      e.preventDefault()
      e.stopPropagation()
      const draggedId =
        e.dataTransfer.getData(DRAG_TYPE) || e.dataTransfer.getData('text/plain')
      if (!draggedId || draggedId === targetPromptId) {
        setReorderDragId(null)
        setReorderFolderId(null)
        return
      }
      saveFolders(
        folders.map((f) => {
          if (f.id !== folderId) return f
          const ids = [...f.promptIds]
          const fromIdx = ids.indexOf(draggedId)
          const toIdx = ids.indexOf(targetPromptId)
          if (fromIdx === -1 || toIdx === -1) return f
          ids.splice(fromIdx, 1)
          ids.splice(toIdx, 0, draggedId)
          return { ...f, promptIds: ids }
        })
      )
      setReorderDragId(null)
      setReorderFolderId(null)
    },
    [folders, saveFolders]
  )

  const handleReorderDragEnd = useCallback(() => {
    setReorderDragId(null)
    setReorderFolderId(null)
  }, [])

  // ── Add prompt to main favorites ────────────────────────────────────────────

  const addToMainFavorites = useCallback(
    (promptId: string) => {
      // The prompt already exists in the prompts array; no data to add.
      // Just flash the button to confirm.
      setAddedToFavId(promptId)
      setTimeout(() => setAddedToFavId(null), 1500)
    },
    []
  )

  const saveInlinePrompt = useCallback(
    (folderId: string) => {
      const text = inlinePromptText.trim()
      if (!text) {
        setAddingToFolderId(null)
        setInlinePromptText('')
        return
      }
      const prompt: FavoritePrompt = { id: Date.now().toString(), text, createdAt: Date.now() }
      const nextPrompts = [...prompts, prompt]
      setPrompts(nextPrompts)
      chrome.storage.local.set({ [PROMPTS_KEY]: nextPrompts })
      addPromptToFolder(folderId, prompt.id)
      setAddingToFolderId(null)
      setInlinePromptText('')
    },
    [inlinePromptText, prompts, addPromptToFolder]
  )

  const togglePromptExpanded = useCallback((id: string) => {
    setExpandedPromptIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const copyPrompt = useCallback((text: string, id: string) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopiedId(id)
      setTimeout(() => setCopiedId(null), 1500)
    })
  }, [])

  return (
    <>
      <style>{`
        .folder-view-hide-scrollbar::-webkit-scrollbar { display: none }
        .folder-view-hide-scrollbar { scrollbar-width: none; -ms-overflow-style: none }
      `}</style>
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 10,
          padding: '12px 16px',
          boxSizing: 'border-box',
          width: width ?? '100%',
          minWidth: 0,
          overflowX: 'hidden',
          backgroundColor: tk.bg,
          fontFamily: 'ui-sans-serif, system-ui, -apple-system, sans-serif',
        }}
      >
        {/* Header with back button */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, }}>
          <button
            type="button"
            style={{
              width: 32,
              height: 32,
              padding: 0,
              borderRadius: 10,
              border: '1px solid',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
              backgroundColor: tk.btnBg,
              borderColor: tk.border,
              color: tk.text,
            }}
            onClick={onBack}
          >
            <ChevronLeftIcon />
          </button>
          <span style={{ fontSize: 16, fontWeight: 600, paddingLeft:2, letterSpacing: '-0.02em', color: tk.text }}>{t.promptsFolder}</span>
        </div>

        {/* From Favorites - only prompts not yet in any folder */}
        {promptsNotInFolders.length > 0 && (
          <div
            style={{
              padding: '8px 10px',
              backgroundColor: theme === 'dark' ? 'rgba(10,132,255,0.10)' : 'rgba(0,122,255,0.06)',
              borderRadius: 10,
              border: `1px solid ${theme === 'dark' ? 'rgba(10,132,255,0.20)' : 'rgba(0,122,255,0.15)'}`,
              flexShrink: 0,
              minWidth: 0,
              overflow: 'hidden',
            }}
          >
            <div style={{ fontSize: 11, color: tk.textMuted, marginBottom: 6, flexShrink: 0 }}>
              {t.fromFavorites}
            </div>
            <div
              className="folder-view-hide-scrollbar"
              style={{
                maxHeight: FROM_FAVORITES_MAX_HEIGHT,
                overflowY: 'auto',
                overflowX: 'hidden',
                display: 'flex',
                flexDirection: 'column',
                gap: 4,
                minHeight: 0,
              }}
            >
              {promptsNotInFolders.map((p) => {
                const preview =
                  p.text.length > FAVORITES_PREVIEW_LEN
                    ? p.text.slice(0, FAVORITES_PREVIEW_LEN) + '…'
                    : p.text
                return (
                  <div
                    key={p.id}
                    style={{
                      fontSize: 12,
                      color: tk.text,
                      padding: '6px 8px',
                      backgroundColor: tk.bgCard,
                      borderRadius: 8,
                      border: `1px solid ${tk.border}`,
                      cursor: 'grab',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                      minWidth: 0,
                      flexShrink: 0,
                    }}
                    draggable
                    onDragStart={(e) => handleDragStart(e, p.id)}
                  >
                    {preview}
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* New folder input */}
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input
            type="text"
            value={newFolderName}
            onChange={(e) => setNewFolderName(e.target.value)}
            placeholder={t.folderNamePlaceholder}
            style={{
              flex: 1,
              padding: '8px 10px',
              borderRadius: 10,
              border: `1px solid ${tk.inputBorder}`,
              fontSize: 13,
              outline: 'none',
              fontFamily: 'inherit',
              color: tk.text,
              backgroundColor: tk.inputBg,
              boxSizing: 'border-box',
              letterSpacing: '-0.01em',
            }}
            onKeyDown={(e) => e.key === 'Enter' && addFolder()}
          />
          <button
            type="button"
            style={
              newFolderName.trim()
                ? {
                    fontSize: 12,
                    padding: '8px 14px',
                    borderRadius: 10,
                    border: 'none',
                    backgroundColor: tk.btnPrimaryBg,
                    color: '#fff',
                    cursor: 'pointer',
                    whiteSpace: 'nowrap',
                    fontFamily: 'inherit',
                    fontWeight: 500,
                    letterSpacing: '-0.01em',
                  }
                : {
                    fontSize: 12,
                    padding: '8px 14px',
                    borderRadius: 10,
                    border: 'none',
                    backgroundColor: 'rgba(128,128,128,0.25)',
                    color: tk.textMuted,
                    cursor: 'not-allowed',
                    whiteSpace: 'nowrap',
                    fontFamily: 'inherit',
                    fontWeight: 500,
                    letterSpacing: '-0.01em',
                  }
            }
            onClick={addFolder}
            disabled={!newFolderName.trim()}
          >
            {t.newFolder}
          </button>
        </div>

        {/* Folder list */}
        <div className="folder-view-hide-scrollbar" style={{ flex: 1, minHeight: 0, overflowY: 'auto', overflowX: 'hidden' }}>
          {folders.length === 0 ? (
            <div style={{ fontSize: 13, color: tk.textMuted, fontStyle: 'italic', padding: '16px 0', textAlign: 'center' }}>
              {t.noFolders}
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, minWidth: 0 }}>
              {folders.map((folder) => {
                const isDropTarget = dropTargetId === folder.id
                const folderPrompts = folder.promptIds
                  .map((id) => promptMap.get(id))
                  .filter((p): p is FavoritePrompt => !!p)
                const isAdding = addingToFolderId === folder.id

                return (
                  <div
                    key={folder.id}
                    style={{
                      border: `1px solid ${isDropTarget
                        ? (theme === 'dark' ? 'rgba(10,132,255,0.5)' : 'rgba(0,122,255,0.4)')
                        : tk.border}`,
                      borderRadius: 12,
                      overflow: 'hidden',
                      backgroundColor: isDropTarget
                        ? (theme === 'dark' ? 'rgba(10,132,255,0.10)' : 'rgba(0,122,255,0.06)')
                        : tk.bgCard,
                      transition: 'border-color 0.15s ease, background-color 0.15s ease',
                    }}
                    onDragEnter={(e) => {
                      e.preventDefault()
                      setDropTargetId(folder.id)
                    }}
                    onDragOver={(e) => handleDragOver(e, folder.id)}
                    onDragLeave={handleFolderDragLeave}
                    onDrop={(e) => handleDrop(e, folder.id)}
                    title={t.addToFolder}
                  >
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 8,
                        padding: '10px 12px',
                        backgroundColor: theme === 'dark' ? 'rgba(58,58,60,0.6)' : 'rgba(242,242,247,0.8)',
                        borderBottom: `1px solid ${tk.borderLight}`,
                      }}
                    >
                      <span
                        style={{
                          flex: 1,
                          fontSize: 14,
                          fontWeight: 600,
                          color: tk.text,
                          minWidth: 0,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                          letterSpacing: '-0.01em',
                        }}
                      >
                        {folder.name}
                      </span>
                      <span style={{ fontSize: 12, color: tk.textMuted }}>
                        ({folder.promptIds.length})
                      </span>
                      <button
                        type="button"
                        style={{
                          background: 'none',
                          border: 'none',
                          cursor: 'pointer',
                          fontSize: 16,
                          color: tk.textTertiary,
                          padding: '0 4px',
                          lineHeight: 1,
                        }}
                        onClick={(ev) => {
                          ev.stopPropagation()
                          deleteFolder(folder.id)
                        }}
                        title={t.deleteBtn}
                      >
                        ×
                      </button>
                    </div>

                    <div style={{ padding: 8 }}>
                      <div
                        className="folder-view-hide-scrollbar"
                        style={{
                          maxHeight: FOLDER_PROMPTS_MAX_HEIGHT,
                          overflowY: 'auto',
                          overflowX: 'hidden',
                          display: 'flex',
                          flexDirection: 'column',
                          gap: 6,
                          minWidth: 0,
                        }}
                      >
                        {folderPrompts.map((p) => {
                          const isExpanded = expandedPromptIds.has(p.id)
                          const needsTruncation = p.text.length > TRUNCATE_AT
                          const displayText =
                            !isExpanded && needsTruncation
                              ? p.text.slice(0, TRUNCATE_AT) + '…'
                              : p.text
                          const isDragging = reorderDragId === p.id
                          return (
                            <div
                              key={p.id}
                              draggable
                              onDragStart={(e) => handleReorderDragStart(e, folder.id, p.id)}
                              onDragEnd={handleReorderDragEnd}
                              onDragOver={(e) => { e.preventDefault(); e.stopPropagation() }}
                              onDrop={(e) => handleReorderDrop(e, folder.id, p.id)}
                              style={{
                                display: 'flex',
                                alignItems: 'flex-start',
                                gap: 8,
                                padding: '8px 10px',
                                backgroundColor: tk.bg,
                                borderRadius: 8,
                                border: `1px solid ${tk.borderLight}`,
                                cursor: 'grab',
                                opacity: isDragging ? 0.4 : 1,
                                transition: 'opacity 0.15s ease',
                              }}
                            >
                              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
                                <span
                                  style={{
                                    fontSize: 12,
                                    color: tk.text,
                                    lineHeight: 1.5,
                                    wordBreak: 'break-word',
                                    whiteSpace: 'pre-wrap',
                                    letterSpacing: '-0.01em',
                                  }}
                                >
                                  {displayText}
                                </span>
                                {needsTruncation && (
                                  <button
                                    type="button"
                                    style={{
                                      fontSize: 11,
                                      color: tk.accent,
                                      background: 'none',
                                      border: 'none',
                                      cursor: 'pointer',
                                      padding: 0,
                                      textDecoration: 'underline',
                                      textAlign: 'left',
                                      whiteSpace: 'nowrap',
                                      fontFamily: 'inherit',
                                    }}
                                    onClick={() => togglePromptExpanded(p.id)}
                                  >
                                    {isExpanded ? t.seeLess : t.seeMore}
                                  </button>
                                )}
                              </div>
                              <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 4, flexShrink: 0 }}>
                                <button
                                  type="button"
                                  style={{
                                    fontSize: 11,
                                    color: addedToFavId === p.id ? tk.accent : tk.textMuted,
                                    background: 'none',
                                    border: 'none',
                                    cursor: 'pointer',
                                    padding: '2px 4px',
                                    textDecoration: 'underline',
                                    whiteSpace: 'nowrap',
                                    fontFamily: 'inherit',
                                  }}
                                  onClick={() => addToMainFavorites(p.id)}
                                  title={t.addToMyFav}
                                >
                                  {addedToFavId === p.id ? '★' : t.addToMyFav}
                                </button>
                                <button
                                  type="button"
                                  style={{
                                    fontSize: 11,
                                    color: tk.accent,
                                    background: 'none',
                                    border: 'none',
                                    cursor: 'pointer',
                                    padding: '2px 4px',
                                    textDecoration: 'underline',
                                    whiteSpace: 'nowrap',
                                    fontFamily: 'inherit',
                                  }}
                                  onClick={() => copyPrompt(p.text, p.id)}
                                >
                                  {copiedId === p.id ? t.copied : t.copyBtn}
                                </button>
                                <button
                                  type="button"
                                  style={{
                                    fontSize: 14,
                                    color: tk.textTertiary,
                                    background: 'none',
                                    border: 'none',
                                    cursor: 'pointer',
                                    padding: '0 2px',
                                    lineHeight: 1,
                                  }}
                                  onClick={() => removePromptFromFolder(folder.id, p.id)}
                                  title={t.deleteBtn}
                                >
                                  ×
                                </button>
                              </div>
                            </div>
                          )
                        })}

                        {isAdding ? (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                            <textarea
                              value={inlinePromptText}
                              onChange={(e) => setInlinePromptText(e.target.value)}
                              placeholder={t.promptPlaceholder}
                              style={{
                                width: '100%',
                                padding: '8px 10px',
                                borderRadius: 8,
                                border: `1px solid ${tk.inputBorder}`,
                                fontSize: 12,
                                resize: 'none',
                                outline: 'none',
                                fontFamily: 'inherit',
                                color: tk.text,
                                backgroundColor: tk.inputBg,
                                boxSizing: 'border-box',
                              }}
                              rows={2}
                              autoFocus
                              onKeyDown={(e) => {
                                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey))
                                  saveInlinePrompt(folder.id)
                              }}
                            />
                            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                              <button
                                type="button"
                                style={{
                                  fontSize: 12,
                                  padding: '6px 12px',
                                  borderRadius: 8,
                                  border: 'none',
                                  backgroundColor: tk.btnPrimaryBg,
                                  color: '#fff',
                                  cursor: 'pointer',
                                  fontFamily: 'inherit',
                                  fontWeight: 500,
                                }}
                                onClick={() => saveInlinePrompt(folder.id)}
                              >
                                {t.savePrompt}
                              </button>
                              <button
                                type="button"
                                style={{
                                  fontSize: 12,
                                  padding: '6px 10px',
                                  background: 'none',
                                  border: 'none',
                                  color: tk.textMuted,
                                  cursor: 'pointer',
                                  fontFamily: 'inherit',
                                }}
                                onClick={() => {
                                  setAddingToFolderId(null)
                                  setInlinePromptText('')
                                }}
                              >
                                {t.seeLess}
                              </button>
                            </div>
                          </div>
                        ) : (
                          <button
                            type="button"
                            style={{
                              fontSize: 12,
                              padding: '8px 10px',
                              background: 'none',
                              border: `1px dashed ${tk.border}`,
                              borderRadius: 8,
                              color: tk.textMuted,
                              cursor: 'pointer',
                              textAlign: 'left',
                              width: '100%',
                              fontFamily: 'inherit',
                              letterSpacing: '-0.01em',
                            }}
                            onClick={() => setAddingToFolderId(folder.id)}
                          >
                            + {t.addPromptInFolder}
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </>
  )
}
