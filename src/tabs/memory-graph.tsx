import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { LanguageProvider, useTranslation } from '../i18n/LanguageContext'
import { ThemeProvider, useTheme } from '../i18n/ThemeContext'
import type { AIProvider, GraphMemoryRecord, MemorySessionSummary } from '../types/memory'
import type { DeleteMemorySessionResponse, PersistPendingSessionResponse, QueryMemorySessionsResponse, QuerySessionGraphResponse } from '../types/messages'
import { CopyIcon, DownloadIcon, ListIcon, MoreHorizontalIcon, NetworkIcon, RefreshIcon, TrashIcon, UploadIcon } from '../ui/icons'
import * as S from '../ui/styles'
import { getThemeTokens } from '../ui/theme'
import { SESSION_GRAPH_EXPORT_APP_NAME } from '../constants/branding'

type ProviderFilter = 'all' | AIProvider
type Notice = { type: 'success' | 'error'; message: string } | null
type CssVars = React.CSSProperties & Record<`--${string}`, string>
type CanvasViewport = { x: number; y: number; scale: number }
type GraphSessionSummary = MemorySessionSummary & { persisted?: boolean }

const MIN_SCALE = 0.45
const MAX_SCALE = 1.8
const DEFAULT_VIEWPORT: CanvasViewport = { x: 56, y: 36, scale: 1 }
const GRAPH_DRAG_SELECT_CLASS = 'threadlineGraphPanning'
const CANVAS_DRAG_IGNORE_SELECTOR =
  'button, a, input, textarea, select, option, [contenteditable="true"], .messagePanel, .canvasControls'

interface GraphRound {
  id: string
  index: number
  firstTimestamp: number
  records: GraphMemoryRecord[]
  userRecords: GraphMemoryRecord[]
  assistantRecords: GraphMemoryRecord[]
  hasBranches: boolean
}

interface BranchPath {
  id: string
  branchIndex: number
  records: GraphMemoryRecord[]
  firstTimestamp: number
  isMain: boolean
}

const PROVIDER_FILTERS: { value: ProviderFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'openai', label: 'ChatGPT' },
  { value: 'anthropic', label: 'Claude' },
  { value: 'google', label: 'Gemini' },
  { value: 'perplexity', label: 'Perplexity' },
  { value: 'xai', label: 'Grok' },
]

const ROLE_LABEL: Record<string, string> = {
  user: 'User',
  assistant: 'Assistant',
}

function formatProvider(provider: string): string {
  if (provider === 'openai') return 'ChatGPT'
  if (provider === 'anthropic') return 'Claude'
  if (provider === 'google') return 'Gemini'
  if (provider === 'perplexity') return 'Perplexity'
  if (provider === 'xai') return 'Grok'
  return provider || 'Unknown'
}

function formatDate(ms?: number): string {
  if (!ms) return ''
  return new Date(ms).toLocaleString(undefined, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

function toTimelineMillis(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim()) {
    const numeric = Number(value)
    if (Number.isFinite(numeric)) return numeric
    const parsed = Date.parse(value)
    if (Number.isFinite(parsed)) return parsed
  }
  if (value instanceof Date) {
    const time = value.getTime()
    if (Number.isFinite(time)) return time
  }
  return Number.POSITIVE_INFINITY
}

function getTurnIndex(record: GraphMemoryRecord): number {
  if (typeof record.turnIndex === 'number' && record.turnIndex >= 0) return record.turnIndex
  const metadataTurnIndex = record.metadata?.turnIndex
  return typeof metadataTurnIndex === 'number' && metadataTurnIndex >= 0
    ? metadataTurnIndex
    : Number.POSITIVE_INFINITY
}

function getRoundIndex(record: GraphMemoryRecord): number | undefined {
  if (typeof record.roundIndex === 'number' && record.roundIndex >= 0) return Math.floor(record.roundIndex)
  const metadataRoundIndex = record.metadata?.roundIndex
  if (typeof metadataRoundIndex === 'number' && metadataRoundIndex >= 0) {
    return Math.floor(metadataRoundIndex)
  }
  return undefined
}

function getBranchIndex(record: GraphMemoryRecord): number | undefined {
  if (typeof record.branchIndex === 'number' && record.branchIndex >= 0) return Math.floor(record.branchIndex)
  const metadataBranchIndex = record.metadata?.branchIndex
  if (typeof metadataBranchIndex === 'number' && metadataBranchIndex >= 0) {
    return Math.floor(metadataBranchIndex)
  }
  return undefined
}

function compareFinite(a: number, b: number): number {
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0
  return a - b
}

function sortGraphRecordsForTimeline(records: GraphMemoryRecord[]): GraphMemoryRecord[] {
  return [...records].sort((a, b) => {
    const roundA = getRoundIndex(a)
    const roundB = getRoundIndex(b)
    const bothHaveRound = roundA !== undefined && roundB !== undefined
    if (bothHaveRound && roundA !== roundB) return roundA - roundB

    if (bothHaveRound) {
      const turnDelta = compareFinite(getTurnIndex(a), getTurnIndex(b))
      if (turnDelta !== 0) return turnDelta
    }

    if (bothHaveRound) {
      const branchDelta =
        (getBranchIndex(a) ?? Number.POSITIVE_INFINITY) -
        (getBranchIndex(b) ?? Number.POSITIVE_INFINITY)
      if (Number.isFinite(branchDelta) && branchDelta !== 0) return branchDelta
    }

    const timestampDelta = toTimelineMillis(a.timestamp) - toTimelineMillis(b.timestamp)
    if (timestampDelta !== 0) return timestampDelta

    const turnDelta = compareFinite(getTurnIndex(a), getTurnIndex(b))
    if (turnDelta !== 0) return turnDelta

    if (a.role !== b.role) return a.role === 'user' ? -1 : 1

    const createdAtDelta = toTimelineMillis(a.createdAt) - toTimelineMillis(b.createdAt)
    if (createdAtDelta !== 0) return createdAtDelta

    return a.id.localeCompare(b.id)
  })
}

function inferRoundIndex(record: GraphMemoryRecord, fallbackRound: number): number {
  return getRoundIndex(record) ?? fallbackRound
}

function buildGraphRounds(records: GraphMemoryRecord[]): GraphRound[] {
  const sorted = sortGraphRecordsForTimeline(records)
  const groups = new Map<number, GraphMemoryRecord[]>()
  let fallbackRound = -1

  for (const record of sorted) {
    const explicitRound = getRoundIndex(record)
    if (explicitRound === undefined && (record.role === 'user' || fallbackRound < 0)) fallbackRound += 1
    const roundIndex = inferRoundIndex(record, Math.max(fallbackRound, 0))
    const list = groups.get(roundIndex) ?? []
    list.push(record)
    groups.set(roundIndex, list)
  }

  return [...groups.entries()]
    .map(([roundIndex, groupRecords]) => {
      const ordered = sortGraphRecordsForTimeline(groupRecords)
      const userRecords = ordered.filter((record) => record.role === 'user')
      const assistantRecords = ordered.filter((record) => record.role === 'assistant')
      return {
        id: `round-${roundIndex}`,
        index: roundIndex,
        firstTimestamp: Math.min(...ordered.map((record) => toTimelineMillis(record.timestamp))),
        records: ordered,
        userRecords,
        assistantRecords,
        hasBranches: userRecords.length > 1 || assistantRecords.length > 1,
      }
    })
    .sort((a, b) => {
      const indexDelta = a.index - b.index
      if (indexDelta !== 0) return indexDelta
      return a.firstTimestamp - b.firstTimestamp
    })
}

function pairRoundRecords(round: GraphRound): BranchPath[] {
  const grouped = new Map<number, GraphMemoryRecord[]>()
  const fallbackByRole = new Map<string, number>()

  for (const record of round.records) {
    let branchIndex = getBranchIndex(record)
    if (branchIndex === undefined) {
      const key = record.role
      branchIndex = fallbackByRole.get(key) ?? 0
      fallbackByRole.set(key, branchIndex + 1)
    }
    const list = grouped.get(branchIndex) ?? []
    list.push(record)
    grouped.set(branchIndex, list)
  }

  const branchGroups = [...grouped.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([branchIndex, branchRecords]) => ({
      branchIndex,
      records: sortGraphRecordsForTimeline(branchRecords),
    }))

  const mainGroup = branchGroups.find((group) => group.branchIndex === 0)
  const mainHasUser = mainGroup?.records.some((record) => record.role === 'user') ?? false
  const mainHasAssistant = mainGroup?.records.some((record) => record.role === 'assistant') ?? false
  if (mainGroup && mainHasUser && !mainHasAssistant) {
    const orphanAssistantGroup = branchGroups.find(
      (group) =>
        group.branchIndex > 0 &&
        group.records.some((record) => record.role === 'assistant') &&
        !group.records.some((record) => record.role === 'user'),
    )
    if (orphanAssistantGroup) {
      mainGroup.records = sortGraphRecordsForTimeline([
        ...mainGroup.records,
        ...orphanAssistantGroup.records,
      ])
      orphanAssistantGroup.records = []
    }
  }

  return branchGroups
    .filter((group) => group.records.length > 0)
    .map(({ branchIndex: rawBranchIndex, records }, displayIndex) => {
      const firstTimestamp = records.length > 0
        ? Math.min(...records.map((record) => toTimelineMillis(record.timestamp)))
        : round.firstTimestamp
      return {
        id: `${round.id}-branch-${rawBranchIndex}`,
        branchIndex: displayIndex,
        records,
        firstTimestamp,
        isMain: displayIndex === 0,
      }
    })
}

function truncate(text: string, max = 180): string {
  const trimmed = text.trim()
  return trimmed.length > max ? `${trimmed.slice(0, max)}...` : trimmed
}

function titleForSession(session?: MemorySessionSummary): string {
  if (!session) return 'Conversation'
  return session.title?.trim() || session.sessionId
}

function buildGraphUrl(sessionId?: string, recordId?: string): string {
  const params = new URLSearchParams()
  if (sessionId) params.set('sessionId', sessionId)
  if (recordId) params.set('recordId', recordId)
  return `${window.location.pathname}${params.toString() ? `?${params}` : ''}`
}

function getInitialSessionId(): string {
  return new URLSearchParams(window.location.search).get('sessionId') ?? ''
}

function getInitialRecordId(): string {
  return new URLSearchParams(window.location.search).get('recordId') ?? ''
}

function sanitizeFilename(value: string): string {
  return value
    .trim()
    .replace(/[\\/:*?"<>|]+/g, '-')
    .replace(/\s+/g, '-')
    .slice(0, 80) || 'conversation'
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function setGraphDragSelectionDisabled(active: boolean): void {
  document.documentElement.classList.toggle(GRAPH_DRAG_SELECT_CLASS, active)
  if (active) window.getSelection()?.removeAllRanges()
}

async function sendMessage<T>(message: unknown): Promise<T> {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response: T | undefined) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message))
        return
      }
      if (!response) {
        reject(new Error('No response from background'))
        return
      }
      resolve(response)
    })
  })
}

async function copyToClipboard(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text)
    return
  }

  const textarea = document.createElement('textarea')
  textarea.value = text
  textarea.style.position = 'fixed'
  textarea.style.left = '-9999px'
  document.body.appendChild(textarea)
  textarea.focus()
  textarea.select()
  document.execCommand('copy')
  document.body.removeChild(textarea)
}

async function saveFile(filename: string, content: string, type: string): Promise<boolean> {
  const blob = new Blob([content], { type })
  const showSaveFilePicker = (
    window as Window & { showSaveFilePicker?: (opts: object) => Promise<FileSystemFileHandle> }
  ).showSaveFilePicker

  if (typeof showSaveFilePicker === 'function') {
    try {
      const handle = await showSaveFilePicker({
        suggestedName: filename,
        types: [{ description: 'Memory export', accept: { [type]: [filename.endsWith('.json') ? '.json' : '.txt'] } }],
      })
      const writable = await handle.createWritable()
      await writable.write(blob)
      await writable.close()
      return true
    } catch (err) {
      if ((err as DOMException)?.name === 'AbortError') return false
    }
  }

  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
  return true
}

function buildMessageText(record: GraphMemoryRecord): string {
  const header = [
    `Role: ${ROLE_LABEL[record.role] ?? record.role}`,
    `Provider: ${formatProvider(record.provider)}`,
    record.model ? `Model: ${record.model}` : '',
    `Time: ${formatDate(record.timestamp)}`,
  ].filter(Boolean)

  return `${header.join('\n')}\n\n${record.content.trim()}`
}

function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="stat">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  )
}

function ActionButton({
  children,
  disabled,
  icon,
  onClick,
  primary,
  title,
}: {
  children: React.ReactNode
  disabled?: boolean
  icon?: React.ReactNode
  onClick?: () => void
  primary?: boolean
  title?: string
}) {
  return (
    <button
      type="button"
      className={`actionButton${primary ? ' primary' : ''}`}
      disabled={disabled}
      onClick={onClick}
      title={title}
    >
      {icon && <span className="buttonIcon">{icon}</span>}
      <span>{children}</span>
    </button>
  )
}

function IconButton({
  children,
  disabled,
  onClick,
  title,
}: {
  children: React.ReactNode
  disabled?: boolean
  onClick?: () => void
  title: string
}) {
  return (
    <button
      type="button"
      className="iconButton"
      disabled={disabled}
      onClick={onClick}
      title={title}
    >
      {children}
    </button>
  )
}

function SessionList({
  activeSessionId,
  activeMenuSessionId,
  activeMenuPosition,
  deletingSessionId,
  exportingSessionId,
  onCloseMenu,
  onDeleteSession,
  onExportSession,
  onPersistSession,
  onSelect,
  onToggleMenu,
  persistingSessionId,
  sessions,
}: {
  activeSessionId: string
  activeMenuSessionId: string
  activeMenuPosition?: { top: number; right: number }
  deletingSessionId: string
  exportingSessionId: string
  onCloseMenu: () => void
  onDeleteSession: (session: GraphSessionSummary) => void
  onExportSession: (session: GraphSessionSummary) => void
  onPersistSession: (session: GraphSessionSummary) => void
  onSelect: (sessionId: string) => void
  onToggleMenu: (sessionId: string, position?: { top: number; right: number }) => void
  persistingSessionId: string
  sessions: GraphSessionSummary[]
}) {
  const activeMenuSession = sessions.find((session) => session.sessionId === activeMenuSessionId)
  const activePending = activeMenuSession?.persisted === false
  const activeExporting = activeMenuSession?.sessionId === exportingSessionId
  const activePersisting = activeMenuSession?.sessionId === persistingSessionId
  const activeDeleting = activeMenuSession?.sessionId === deletingSessionId

  return (
    <div className="sessionArea" onClick={onCloseMenu}>
      <div className="sessionList" onScroll={onCloseMenu}>
        {sessions.map((session) => {
          const active = session.sessionId === activeSessionId
          const pending = session.persisted === false
          const menuOpen = activeMenuSessionId === session.sessionId
          return (
            <div
              key={session.sessionId}
              className={`sessionRow${active ? ' active' : ''}${pending ? ' pending' : ''}`}
            >
              <button
                type="button"
                className="sessionSelectButton"
                onClick={() => onSelect(session.sessionId)}
              >
                <span className="sessionTitleRow">
                  <span className="sessionTitle">{titleForSession(session)}</span>
                  <span className={`sessionBadge ${pending ? 'pending' : 'saved'}`}>
                    {pending ? 'Pending' : 'Saved'}
                  </span>
                </span>
                <span className="sessionMeta">
                  {formatProvider(session.provider)} - {session.messageCount} messages
                </span>
                <span className="sessionDate">{formatDate(session.lastTimestamp)}</span>
              </button>
              <button
                type="button"
                className={`sessionMenuButton${menuOpen ? ' active' : ''}`}
                title="Session actions"
                onClick={(event) => {
                  event.stopPropagation()
                  const button = event.currentTarget
                  const area = button.closest('.sessionArea')
                  const areaRect = area?.getBoundingClientRect()
                  const buttonRect = button.getBoundingClientRect()
                  const position = areaRect
                    ? {
                      top: Math.max(8, Math.min(buttonRect.bottom - areaRect.top + 6, areaRect.height - 124)),
                      right: Math.max(8, areaRect.right - buttonRect.right),
                    }
                    : undefined
                  onToggleMenu(session.sessionId, position)
                }}
              >
                <MoreHorizontalIcon size={15} />
              </button>
            </div>
          )
        })}
      </div>
      {activeMenuSession && activeMenuPosition && (
        <div
          className="sessionMenu"
          onClick={(event) => event.stopPropagation()}
          style={{ top: activeMenuPosition.top, right: activeMenuPosition.right }}
        >
          <button
            type="button"
            disabled={!activePending || !!persistingSessionId || !!deletingSessionId}
            onClick={() => onPersistSession(activeMenuSession)}
          >
            <UploadIcon size={14} />
            <span>{activePersisting ? 'Saving...' : '落库'}</span>
          </button>
          <button
            type="button"
            disabled={!!exportingSessionId || !!deletingSessionId}
            onClick={() => onExportSession(activeMenuSession)}
          >
            <DownloadIcon size={14} />
            <span>{activeExporting ? 'Exporting...' : '导出'}</span>
          </button>
          <button
            type="button"
            className="danger"
            disabled={!!deletingSessionId || !!persistingSessionId}
            onClick={() => onDeleteSession(activeMenuSession)}
          >
            <TrashIcon size={14} />
            <span>{activeDeleting ? 'Deleting...' : '删除'}</span>
          </button>
        </div>
      )}
    </div>
  )
}

function GraphNode({
  active,
  branchIndex,
  index,
  onSelect,
  record,
}: {
  active: boolean
  branchIndex: number
  index: number
  onSelect: (record: GraphMemoryRecord) => void
  record: GraphMemoryRecord
}) {
  const isUser = record.role === 'user'
  return (
    <button
      type="button"
      className={`graphNode ${isUser ? 'user' : 'assistant'}${active ? ' active' : ''}`}
      data-record-id={record.id}
      onClick={() => onSelect(record)}
    >
      <span className="nodeBody">
        <span className="nodeTop">
          <span className={`rolePill ${isUser ? 'user' : 'assistant'}`}>
            {ROLE_LABEL[record.role] ?? record.role}
          </span>
          <span className="nodeIndex">#{String(index + 1).padStart(2, '0')}</span>
          {branchIndex > 0 && <span className="branchPill">Branch {branchIndex + 1}</span>}
          <span className="nodeTime">{formatDate(record.timestamp)}</span>
        </span>
        <span className="nodeContent">{truncate(record.content)}</span>
        <span className="nodeFooter">
          {record.model && <span>{record.model}</span>}
          {record.isChunked && <span>{record.chunkCount} chunks</span>}
        </span>
      </span>
    </button>
  )
}

function BranchColumn({
  branch,
  globalIndexOffset,
  onSelect,
  selectedRecordId,
}: {
  branch: BranchPath
  globalIndexOffset: (record: GraphMemoryRecord) => number
  onSelect: (record: GraphMemoryRecord) => void
  selectedRecordId: string
}) {
  return (
    <div className={`branchColumn${branch.isMain ? ' mainBranch' : ' forkBranch'}`}>
      {!branch.isMain && <span className="forkConnector" />}
      <div className="branchStem" />
      <div className="branchLabel">
        {branch.isMain ? 'Main path' : `Branch ${branch.branchIndex + 1}`}
      </div>
      {branch.records.map((record) => (
        <GraphNode
          key={record.id}
          active={record.id === selectedRecordId}
          branchIndex={branch.branchIndex}
          index={globalIndexOffset(record)}
          onSelect={onSelect}
          record={record}
        />
      ))}
    </div>
  )
}

function Timeline({
  onSelect,
  records,
  selectedRecordId,
}: {
  onSelect: (record: GraphMemoryRecord) => void
  records: GraphMemoryRecord[]
  selectedRecordId: string
}) {
  if (records.length === 0) {
    return <div className="emptyState">No messages in this session.</div>
  }

  const rounds = buildGraphRounds(records)
  const sortedRecords = sortGraphRecordsForTimeline(records)
  const globalIndex = new Map(sortedRecords.map((record, index) => [record.id, index]))

  return (
    <div className="treeTimeline">
      {rounds.map((round, visualIndex) => (
        <section
          key={round.id}
          className={`treeRound${round.hasBranches ? ' hasBranches' : ''}`}
          style={{ '--branch-count': String(pairRoundRecords(round).length) } as CssVars}
        >
          <div className="roundHeader">
            <span>Round {visualIndex + 1}</span>
            <time>{formatDate(round.firstTimestamp)}</time>
          </div>
          <div className="branchGrid">
            {pairRoundRecords(round).map((branch) => (
              <BranchColumn
                key={branch.id}
                branch={branch}
                globalIndexOffset={(record) => globalIndex.get(record.id) ?? 0}
                onSelect={onSelect}
                selectedRecordId={selectedRecordId}
              />
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}

function CanvasViewportControls({
  onReset,
  onZoomIn,
  onZoomOut,
  scale,
}: {
  onReset: () => void
  onZoomIn: () => void
  onZoomOut: () => void
  scale: number
}) {
  return (
    <div className="canvasControls">
      <IconButton onClick={onZoomOut} title="Zoom out">-</IconButton>
      <span>{Math.round(scale * 100)}%</span>
      <IconButton onClick={onZoomIn} title="Zoom in">+</IconButton>
      <button type="button" onClick={onReset} title="Reset canvas view">
        Reset
      </button>
    </div>
  )
}

function MessageBoard({
  onClose,
  notice,
  onCopy,
  onExport,
  record,
}: {
  onClose: () => void
  notice: Notice
  onCopy: () => void
  onExport: () => void
  record?: GraphMemoryRecord
}) {
  if (!record) {
    return null
  }

  const isUser = record.role === 'user'
  return (
    <aside className="messagePanel">
      <div className="panelHeader messageHeader">
        <div className="messageTitleRow">
          <span className={`messageAvatar ${isUser ? 'user' : 'assistant'}`}>
            {isUser ? 'U' : 'AI'}
          </span>
          <div>
            <h2>{ROLE_LABEL[record.role] ?? record.role} message</h2>
            <p>{formatDate(record.timestamp)}</p>
          </div>
        </div>
        <div className="messageActions">
          <ActionButton icon={<CopyIcon />} onClick={onCopy} title="Copy message content">
            Copy
          </ActionButton>
          <ActionButton icon={<DownloadIcon />} onClick={onExport} title="Export this message as text">
            Export
          </ActionButton>
          <IconButton onClick={onClose} title="Close message detail">x</IconButton>
        </div>
      </div>

      {notice && <div className={`notice ${notice.type}`}>{notice.message}</div>}

      <div className="messageFacts">
        <div>
          <span>Provider</span>
          <strong>{formatProvider(record.provider)}</strong>
        </div>
        <div>
          <span>Model</span>
          <strong>{record.model || 'Unknown'}</strong>
        </div>
        <div>
          <span>Chunks</span>
          <strong>{record.chunkCount}</strong>
        </div>
      </div>

      <div className="messageContent">
        <p>{record.content}</p>
      </div>
    </aside>
  )
}

function MemoryGraphApp() {
  const { t } = useTranslation()
  const { theme } = useTheme()
  const tk = getThemeTokens(theme)
  const [sessions, setSessions] = useState<GraphSessionSummary[]>([])
  const [totalSessions, setTotalSessions] = useState(0)
  const [activeSessionId, setActiveSessionId] = useState(getInitialSessionId)
  const [activeSession, setActiveSession] = useState<MemorySessionSummary | undefined>()
  const [records, setRecords] = useState<GraphMemoryRecord[]>([])
  const [selectedRecordId, setSelectedRecordId] = useState('')
  const [flashingRecordId, setFlashingRecordId] = useState('')
  const [providerFilter, setProviderFilter] = useState<ProviderFilter>('all')
  const [query, setQuery] = useState('')
  const [loadingSessions, setLoadingSessions] = useState(true)
  const [loadingGraph, setLoadingGraph] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState<Notice>(null)
  const [exportingSessionId, setExportingSessionId] = useState('')
  const [persistingSessionId, setPersistingSessionId] = useState('')
  const [deletingSessionId, setDeletingSessionId] = useState('')
  const [activeMenuSessionId, setActiveMenuSessionId] = useState('')
  const [activeMenuPosition, setActiveMenuPosition] = useState<{ top: number; right: number } | undefined>()
  const [viewport, setViewport] = useState<CanvasViewport>(DEFAULT_VIEWPORT)
  const graphCanvasRef = useRef<HTMLDivElement | null>(null)
  const pendingFocusRecordIdRef = useRef(getInitialRecordId())
  const dragRef = useRef<{
    pointerId: number
    startX: number
    startY: number
    originX: number
    originY: number
    moved: boolean
  } | null>(null)

  const pageVars: CssVars = {
    '--aim-bg': tk.bg,
    '--aim-bg-secondary': tk.bgSecondary,
    '--aim-card': tk.bgCard,
    '--aim-text': tk.text,
    '--aim-muted': tk.textMuted,
    '--aim-tertiary': tk.textTertiary,
    '--aim-border': tk.border,
    '--aim-border-light': tk.borderLight,
    '--aim-separator': tk.separator,
    '--aim-accent': tk.accent,
    '--aim-accent-hover': tk.accentHover,
    '--aim-btn-bg': tk.btnBg,
    '--aim-btn-hover': tk.btnHoverBg,
    '--aim-input-bg': tk.inputBg,
    '--aim-input-border': tk.inputBorder,
    '--aim-shadow': tk.shadow,
    '--aim-error-bg': tk.errorBg,
    '--aim-error-text': tk.errorText,
    '--aim-success-bg': tk.successBg,
    '--aim-success-text': tk.successText,
    '--aim-font': S.FONT_FAMILY,
  }

  const selectedRecord = useMemo(
    () => records.find((record) => record.id === selectedRecordId),
    [records, selectedRecordId],
  )

  const showNotice = useCallback((next: Notice) => {
    setNotice(next)
    if (next) {
      window.setTimeout(() => setNotice(null), 2200)
    }
  }, [])

  const loadSessions = useCallback(async () => {
    setLoadingSessions(true)
    setError('')
    try {
      const response = await sendMessage<QueryMemorySessionsResponse>({
        type: 'QUERY_MEMORY_SESSIONS',
        payload: {
          provider: providerFilter === 'all' ? undefined : providerFilter,
          query,
          limit: 300,
          offset: 0,
        },
      })
      if (response.payload.error) throw new Error(response.payload.error)
      setSessions(response.payload.sessions as GraphSessionSummary[])
      setTotalSessions(response.payload.total)
      setActiveSessionId((current) => {
        if (current && response.payload.sessions.some((session) => session.sessionId === current)) {
          return current
        }
        return response.payload.sessions[0]?.sessionId || ''
      })
    } catch (err) {
      setError(String(err))
      setSessions([])
      setTotalSessions(0)
    } finally {
      setLoadingSessions(false)
    }
  }, [providerFilter, query])

  const loadGraph = useCallback(async (sessionId: string) => {
    if (!sessionId) {
      setRecords([])
      setActiveSession(undefined)
      setSelectedRecordId('')
      return
    }
    setLoadingGraph(true)
    setError('')
    try {
      const response = await sendMessage<QuerySessionGraphResponse>({
        type: 'QUERY_SESSION_GRAPH',
        payload: { sessionId },
      })
      if (response.payload.error) throw new Error(response.payload.error)
      const sortedRecords = sortGraphRecordsForTimeline(response.payload.records)
      const pendingFocusRecordId = pendingFocusRecordIdRef.current
      const focusRecordId = pendingFocusRecordId && sortedRecords.some((record) => record.id === pendingFocusRecordId)
        ? pendingFocusRecordId
        : ''
      setActiveSession(response.payload.session)
      setRecords(sortedRecords)
      setSelectedRecordId(focusRecordId)
      setFlashingRecordId(focusRecordId)
      pendingFocusRecordIdRef.current = ''
      setViewport(DEFAULT_VIEWPORT)
    } catch (err) {
      setError(String(err))
      setActiveSession(undefined)
      setRecords([])
      setSelectedRecordId('')
    } finally {
      setLoadingGraph(false)
    }
  }, [])

  useEffect(() => {
    void loadSessions()
  }, [loadSessions])

  useEffect(() => {
    const pendingFocusRecordId = pendingFocusRecordIdRef.current
    void loadGraph(activeSessionId)
    window.history.replaceState(null, '', buildGraphUrl(activeSessionId, pendingFocusRecordId || undefined))
  }, [activeSessionId, loadGraph])

  useEffect(() => {
    if (!flashingRecordId || loadingGraph) return
    const timeout = window.setTimeout(() => {
      const node = document.querySelector<HTMLElement>(
        `[data-record-id="${CSS.escape(flashingRecordId)}"]`,
      )
      const canvas = graphCanvasRef.current
      if (node && canvas) {
        const nodeRect = node.getBoundingClientRect()
        const canvasRect = canvas.getBoundingClientRect()
        const dx = canvasRect.left + canvasRect.width / 2 - (nodeRect.left + nodeRect.width / 2)
        const dy = canvasRect.top + canvasRect.height / 2 - (nodeRect.top + nodeRect.height / 2)
        setViewport((current) => ({
          ...current,
          x: current.x + dx,
          y: current.y + dy,
        }))
      }
      node?.classList.add('flashTarget')
      window.setTimeout(() => {
        node?.classList.remove('flashTarget')
        setFlashingRecordId('')
      }, 1800)
    }, 220)
    return () => window.clearTimeout(timeout)
  }, [flashingRecordId, loadingGraph, records])

  const handleRefresh = useCallback(() => {
    setActiveMenuSessionId('')
    setActiveMenuPosition(undefined)
    void loadSessions()
    if (activeSessionId) void loadGraph(activeSessionId)
  }, [activeSessionId, loadGraph, loadSessions])

  const updateScale = useCallback((nextScale: number, anchor?: { x: number; y: number }) => {
    setViewport((current) => {
      const scale = clamp(nextScale, MIN_SCALE, MAX_SCALE)
      if (!anchor || scale === current.scale) return { ...current, scale }
      const graphX = (anchor.x - current.x) / current.scale
      const graphY = (anchor.y - current.y) / current.scale
      return {
        scale,
        x: anchor.x - graphX * scale,
        y: anchor.y - graphY * scale,
      }
    })
  }, [])

  const handleZoomIn = useCallback(() => updateScale(viewport.scale + 0.12), [updateScale, viewport.scale])
  const handleZoomOut = useCallback(() => updateScale(viewport.scale - 0.12), [updateScale, viewport.scale])
  const handleResetViewport = useCallback(() => {
    setViewport(DEFAULT_VIEWPORT)
  }, [])

  const handleCanvasPointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return
    setActiveMenuSessionId('')
    setActiveMenuPosition(undefined)
    const target = event.target
    if (target instanceof Element && target.closest(CANVAS_DRAG_IGNORE_SELECTOR)) return

    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: viewport.x,
      originY: viewport.y,
      moved: false,
    }
  }, [viewport.x, viewport.y])

  const handleCanvasPointerMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    event.preventDefault()
    const dx = event.clientX - drag.startX
    const dy = event.clientY - drag.startY
    if (!drag.moved && Math.abs(dx) + Math.abs(dy) > 3) {
      drag.moved = true
      setGraphDragSelectionDisabled(true)
    }
    setViewport((current) => ({
      ...current,
      x: drag.originX + dx,
      y: drag.originY + dy,
    }))
  }, [])

  const handleCanvasPointerUp = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    dragRef.current = null
    setGraphDragSelectionDisabled(false)
    try {
      event.currentTarget.releasePointerCapture(event.pointerId)
    } catch {
      /* pointer capture may already be released */
    }
    if (!drag.moved) setSelectedRecordId('')
  }, [])

  const handleCanvasPointerCancel = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    dragRef.current = null
    setGraphDragSelectionDisabled(false)
  }, [])

  useEffect(() => {
    return () => setGraphDragSelectionDisabled(false)
  }, [])

  const handleNativeCanvasWheel = useCallback((event: WheelEvent) => {
    const canvas = graphCanvasRef.current
    const target = event.target
    if (!canvas || !(target instanceof Node) || !canvas.contains(target)) return

    event.preventDefault()
    event.stopPropagation()

    const rect = canvas.getBoundingClientRect()
    const anchor = {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
    }

    if (event.ctrlKey || event.metaKey) {
      const factor = event.deltaY > 0 ? 0.9 : 1.1
      updateScale(viewport.scale * factor, anchor)
      return
    }

    if (event.shiftKey) {
      setViewport((current) => ({ ...current, x: current.x - event.deltaY }))
      return
    }

    setViewport((current) => ({
      ...current,
      x: current.x - event.deltaX,
      y: current.y - event.deltaY,
    }))
  }, [updateScale, viewport.scale])

  useEffect(() => {
    document.addEventListener('wheel', handleNativeCanvasWheel, {
      capture: true,
      passive: false,
    })
    return () => {
      document.removeEventListener('wheel', handleNativeCanvasWheel, true)
    }
  }, [handleNativeCanvasWheel])

  const handleNodeSelect = useCallback((record: GraphMemoryRecord) => {
    setSelectedRecordId(record.id)
  }, [])

  const exportSession = useCallback(async (
    session: GraphSessionSummary,
    sessionRecords: GraphMemoryRecord[],
  ) => {
    if (sessionRecords.length === 0) {
      showNotice({ type: 'error', message: 'No messages to export.' })
      return
    }
    const payload = {
      metadata: {
        app: SESSION_GRAPH_EXPORT_APP_NAME,
        version: 'session-graph-1.0',
        exportedAt: new Date().toISOString(),
        exportType: 'session-graph',
        recordCount: sessionRecords.length,
      },
      session,
      records: sessionRecords,
    }
    const filename = `threadline-${sanitizeFilename(titleForSession(session))}.json`
    try {
      const saved = await saveFile(filename, JSON.stringify(payload, null, 2), 'application/json')
      if (saved) showNotice({ type: 'success', message: 'Session JSON exported.' })
    } catch (err) {
      showNotice({ type: 'error', message: `Export failed: ${String(err)}` })
    }
  }, [showNotice])

  const handleExportActiveSession = useCallback(async () => {
    if (!activeSession || records.length === 0) return
    setExportingSessionId(activeSession.sessionId)
    try {
      await exportSession(activeSession, records)
    } finally {
      setExportingSessionId('')
    }
  }, [activeSession, exportSession, records])

  const handleExportListedSession = useCallback(async (session: GraphSessionSummary) => {
    if (exportingSessionId) return
    setExportingSessionId(session.sessionId)
    try {
      const response = await sendMessage<QuerySessionGraphResponse>({
        type: 'QUERY_SESSION_GRAPH',
        payload: { sessionId: session.sessionId },
      })
      if (response.payload.error) throw new Error(response.payload.error)
      const sessionForExport = response.payload.session ?? session
      const recordsForExport = sortGraphRecordsForTimeline(response.payload.records)
      await exportSession(sessionForExport, recordsForExport)
    } catch (err) {
      showNotice({ type: 'error', message: `Export failed: ${String(err)}` })
    } finally {
      setExportingSessionId('')
    }
  }, [exportSession, exportingSessionId, showNotice])

  const handlePersistSession = useCallback(async (session: GraphSessionSummary) => {
    if (session.persisted !== false || persistingSessionId) return
    setActiveMenuSessionId('')
    setActiveMenuPosition(undefined)
    setPersistingSessionId(session.sessionId)
    try {
      const response = await sendMessage<PersistPendingSessionResponse>({
        type: 'PERSIST_PENDING_SESSION',
        payload: { sessionId: session.sessionId },
      })
      if (!response.payload.success) throw new Error(response.payload.error ?? 'Persist failed')
      showNotice({ type: 'success', message: `Saved ${response.payload.count} records.` })
      await loadSessions()
      await loadGraph(session.sessionId)
      setActiveSessionId(session.sessionId)
    } catch (err) {
      showNotice({ type: 'error', message: `Save failed: ${String(err)}` })
    } finally {
      setPersistingSessionId('')
    }
  }, [loadGraph, loadSessions, persistingSessionId, showNotice])

  const handleDeleteSession = useCallback(async (session: GraphSessionSummary) => {
    const confirmed = window.confirm(`Delete "${titleForSession(session)}"?`)
    if (!confirmed || deletingSessionId) return
    setActiveMenuSessionId('')
    setDeletingSessionId(session.sessionId)
    try {
      const response = await sendMessage<DeleteMemorySessionResponse>({
        type: 'DELETE_MEMORY_SESSION',
        payload: { sessionId: session.sessionId },
      })
      if (!response.payload.success) throw new Error(response.payload.error ?? 'Delete failed')
      showNotice({ type: 'success', message: 'Session deleted.' })
      const nextSessionId = sessions.find((item) => item.sessionId !== session.sessionId)?.sessionId ?? ''
      setActiveSessionId(nextSessionId)
      await loadSessions()
      if (nextSessionId) {
        await loadGraph(nextSessionId)
      } else {
        setRecords([])
        setActiveSession(undefined)
      }
    } catch (err) {
      showNotice({ type: 'error', message: `Delete failed: ${String(err)}` })
    } finally {
      setDeletingSessionId('')
    }
  }, [deletingSessionId, loadGraph, loadSessions, sessions, showNotice])

  const handleCopyMessage = useCallback(async () => {
    if (!selectedRecord) return
    try {
      await copyToClipboard(selectedRecord.content)
      showNotice({ type: 'success', message: 'Message copied.' })
    } catch (err) {
      showNotice({ type: 'error', message: `Copy failed: ${String(err)}` })
    }
  }, [selectedRecord, showNotice])

  const handleExportMessage = useCallback(async () => {
    if (!selectedRecord) return
    const filename = `personal-ai-message-${sanitizeFilename(selectedRecord.role)}-${selectedRecord.timestamp}.txt`
    try {
      const saved = await saveFile(filename, buildMessageText(selectedRecord), 'text/plain')
      if (saved) showNotice({ type: 'success', message: 'Message exported.' })
    } catch (err) {
      showNotice({ type: 'error', message: `Export failed: ${String(err)}` })
    }
  }, [selectedRecord, showNotice])

  return (
    <div className="page" style={pageVars}>
      <header className="topbar">
        <div className="brandRow">
          <span className="brandMark"><NetworkIcon /></span>
          <div>
            <h1>{t.memoryGraph}</h1>
            <p>{t.memoryGraphSubtitle}</p>
          </div>
        </div>
        <ActionButton icon={<RefreshIcon />} onClick={handleRefresh}>
          Refresh
        </ActionButton>
      </header>

      <main className={`layout${selectedRecord ? ' detailOpen' : ''}`}>
        <aside className="sidebar">
          <div className="panelHeader">
            <div>
              <h2>Sessions</h2>
              <p>{totalSessions} conversations</p>
            </div>
            <span className="panelIcon"><ListIcon /></span>
          </div>

          <div className="sidebarActions">
            <ActionButton
              disabled={!!exportingSessionId || !activeSession || records.length === 0}
              icon={<DownloadIcon />}
              onClick={handleExportActiveSession}
              primary
              title="Export the selected session as JSON"
            >
              {exportingSessionId === activeSession?.sessionId ? 'Exporting...' : 'Export JSON'}
            </ActionButton>
          </div>

          <input
            className="searchInput"
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search sessions"
            type="search"
            value={query}
          />

          <div className="filters">
            {PROVIDER_FILTERS.map((filter) => (
              <button
                key={filter.value}
                type="button"
                className={providerFilter === filter.value ? 'active' : ''}
                onClick={() => setProviderFilter(filter.value)}
              >
                {filter.label}
              </button>
            ))}
          </div>

          {loadingSessions ? (
            <div className="emptyState compact">Loading sessions.</div>
          ) : sessions.length === 0 ? (
            <div className="emptyState compact">No sessions found.</div>
          ) : (
            <SessionList
              activeSessionId={activeSessionId}
              activeMenuSessionId={activeMenuSessionId}
              activeMenuPosition={activeMenuPosition}
              deletingSessionId={deletingSessionId}
              exportingSessionId={exportingSessionId}
              onCloseMenu={() => {
                setActiveMenuSessionId('')
                setActiveMenuPosition(undefined)
              }}
              onDeleteSession={handleDeleteSession}
              onExportSession={handleExportListedSession}
              onPersistSession={handlePersistSession}
              onSelect={setActiveSessionId}
              onToggleMenu={(sessionId, position) => {
                setActiveMenuSessionId((current) => {
                  if (current === sessionId) {
                    setActiveMenuPosition(undefined)
                    return ''
                  }
                  setActiveMenuPosition(position)
                  return sessionId
                })
              }}
              persistingSessionId={persistingSessionId}
              sessions={sessions}
            />
          )}
        </aside>

        <section className="canvasPanel">
          <div className="canvasHeader">
            <div>
              <h2>{titleForSession(activeSession)}</h2>
              <p>{activeSession?.sessionId ?? 'Select a session'}</p>
            </div>
            {activeSession && (
              <div className="stats">
                <Stat label="Messages" value={activeSession.messageCount} />
                <Stat label="User" value={activeSession.userCount} />
                <Stat label="Assistant" value={activeSession.assistantCount} />
                <Stat label="Vectors" value={activeSession.hasEmbeddingCount} />
              </div>
            )}
          </div>

          {error && <div className="errorBox">{error}</div>}

          <div
            ref={graphCanvasRef}
            className="graphCanvas"
            onPointerDown={handleCanvasPointerDown}
            onPointerMove={handleCanvasPointerMove}
            onPointerUp={handleCanvasPointerUp}
            onPointerCancel={handleCanvasPointerCancel}
            onLostPointerCapture={handleCanvasPointerCancel}
          >
            <CanvasViewportControls
              onReset={handleResetViewport}
              onZoomIn={handleZoomIn}
              onZoomOut={handleZoomOut}
              scale={viewport.scale}
            />
            {loadingGraph ? (
              <div className="emptyState">Loading graph.</div>
            ) : (
              <div
                className="graphViewport"
                style={{
                  transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.scale})`,
                }}
              >
                <Timeline
                  onSelect={handleNodeSelect}
                  records={records}
                  selectedRecordId={selectedRecord?.id ?? ''}
                />
              </div>
            )}
          </div>
        </section>

        <MessageBoard
          onClose={() => setSelectedRecordId('')}
          notice={notice}
          onCopy={handleCopyMessage}
          onExport={handleExportMessage}
          record={selectedRecord}
        />
        {notice && !selectedRecord && <div className={`globalNotice ${notice.type}`}>{notice.message}</div>}
      </main>
    </div>
  )
}

export default function MemoryGraphRoot() {
  return (
    <LanguageProvider>
      <ThemeProvider>
        <MemoryGraphApp />
      </ThemeProvider>
    </LanguageProvider>
  )
}

const css = `
* { box-sizing: border-box; }
html, body, #root { margin: 0; width: 100%; height: 100%; min-height: 100%; overflow: hidden; }
body {
  background: var(--aim-bg);
  color: var(--aim-text);
  font-family: var(--aim-font);
  overscroll-behavior: none;
}
button, input {
  font: inherit;
}
button {
  color: inherit;
}
.page {
  width: 100%;
  height: 100dvh;
  min-width: 0;
  display: grid;
  grid-template-rows: auto 1fr;
  background: var(--aim-bg);
  color: var(--aim-text);
  font-family: var(--aim-font);
}
.topbar {
  min-height: 72px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 16px;
  padding: clamp(10px, 1vw, 14px) clamp(12px, 1.4vw, 20px);
  background: var(--aim-bg-secondary);
  border-bottom: 1px solid var(--aim-border);
  backdrop-filter: blur(18px);
}
.brandRow,
.messageTitleRow {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
}
.brandMark,
.panelIcon,
.messageAvatar {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 auto;
}
.brandMark {
  width: 34px;
  height: 34px;
  border-radius: 11px;
  background: var(--aim-accent);
  color: #fff;
}
h1, h2, h3, p {
  margin: 0;
}
h1 {
  font-size: 18px;
  line-height: 1.15;
  letter-spacing: -0.02em;
}
.topbar p,
.panelHeader p,
.canvasHeader p,
.sessionMeta,
.sessionDate,
.nodeTime,
.nodeFooter,
.messageHeader p,
.messageFacts span {
  color: var(--aim-muted);
}
.topbar p {
  margin-top: 3px;
  font-size: 13px;
}
.layout {
  min-height: 0;
  min-width: 0;
  display: grid;
  grid-template-columns: minmax(240px, clamp(260px, 20vw, 320px)) minmax(0, 1fr);
  gap: clamp(8px, 1vw, 14px);
  padding: clamp(8px, 1vw, 14px);
}
.layout.detailOpen {
  grid-template-columns:
    minmax(240px, clamp(260px, 18vw, 320px))
    minmax(0, 1fr)
    minmax(320px, clamp(340px, 25vw, 400px));
}
.sidebar,
.canvasPanel,
.messagePanel {
  min-height: 0;
  min-width: 0;
  overflow: hidden;
  background: var(--aim-card);
  border: 1px solid var(--aim-border);
  border-radius: 18px;
  box-shadow: var(--aim-shadow);
}
.sidebar,
.messagePanel {
  display: flex;
  flex-direction: column;
}
.panelHeader,
.canvasHeader {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 14px;
  padding: 16px;
  border-bottom: 1px solid var(--aim-border-light);
}
.panelHeader h2,
.canvasHeader h2,
.messageHeader h2 {
  font-size: 15px;
  font-weight: 650;
  line-height: 1.2;
  letter-spacing: -0.02em;
}
.panelHeader p,
.canvasHeader p,
.messageHeader p {
  margin-top: 4px;
  font-size: 12px;
}
.panelIcon {
  width: 30px;
  height: 30px;
  border-radius: 10px;
  background: var(--aim-btn-bg);
  border: 1px solid var(--aim-border);
  color: var(--aim-muted);
}
.sidebarActions {
  padding: 12px 16px 0;
}
.actionButton {
  min-height: 34px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  border: 1px solid var(--aim-border);
  border-radius: 11px;
  background: var(--aim-btn-bg);
  color: var(--aim-text);
  padding: 0 12px;
  font-size: 13px;
  font-weight: 550;
  letter-spacing: -0.01em;
  cursor: pointer;
  transition: background-color 0.14s ease, border-color 0.14s ease, color 0.14s ease, opacity 0.14s ease;
}
.actionButton:hover:not(:disabled) {
  background: var(--aim-btn-hover);
  border-color: var(--aim-input-border);
}
.actionButton.primary {
  width: 100%;
  background: var(--aim-accent);
  border-color: var(--aim-accent);
  color: #fff;
}
.actionButton.primary:hover:not(:disabled) {
  background: var(--aim-accent-hover);
  border-color: var(--aim-accent-hover);
}
.actionButton:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
.buttonIcon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
.iconButton {
  width: 34px;
  height: 34px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--aim-border);
  border-radius: 11px;
  background: var(--aim-btn-bg);
  color: var(--aim-muted);
  padding: 0;
  font-size: 15px;
  font-weight: 650;
  line-height: 1;
  cursor: pointer;
  transition: background-color 0.14s ease, border-color 0.14s ease, color 0.14s ease;
}
.iconButton:hover:not(:disabled) {
  background: var(--aim-btn-hover);
  border-color: var(--aim-input-border);
  color: var(--aim-text);
}
.iconButton:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
.searchInput {
  width: calc(100% - 32px);
  height: 38px;
  margin: 12px 16px 0;
  border: 1px solid var(--aim-input-border);
  border-radius: 12px;
  background: var(--aim-input-bg);
  color: var(--aim-text);
  padding: 0 12px;
  outline: none;
  font-size: 13px;
}
.searchInput:focus {
  border-color: var(--aim-accent);
}
.filters {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  padding: 12px 16px 14px;
  border-bottom: 1px solid var(--aim-border-light);
}
.filters button {
  min-height: 30px;
  border: 1px solid var(--aim-border);
  border-radius: 10px;
  background: var(--aim-btn-bg);
  color: var(--aim-muted);
  padding: 0 11px;
  font-size: 12px;
  font-weight: 550;
  cursor: pointer;
}
.filters button.active,
.filters button:hover {
  border-color: var(--aim-accent);
  color: var(--aim-accent);
}
.sessionArea {
  position: relative;
  min-height: 0;
  flex: 1;
  overflow: hidden;
}
.sessionList {
  height: 100%;
  min-height: 0;
  overflow: auto;
  padding: 8px;
  padding-bottom: 120px;
}
.sessionRow {
  width: 100%;
  display: grid;
  grid-template-columns: minmax(0, 1fr) 34px;
  align-items: center;
  gap: 8px;
  border: 1px solid transparent;
  border-radius: 13px;
  background: transparent;
  padding: 6px;
  transition: background-color 0.14s ease, border-color 0.14s ease;
}
.sessionRow:hover,
.sessionRow.active {
  background: var(--aim-btn-bg);
  border-color: var(--aim-border);
}
.sessionRow.pending {
  border-color: color-mix(in srgb, var(--aim-accent) 28%, transparent);
}
.sessionRow.active .sessionTitle {
  color: var(--aim-accent);
}
.sessionSelectButton {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
  border: 0;
  background: transparent;
  color: inherit;
  padding: 5px 6px;
  text-align: left;
  cursor: pointer;
}
.sessionTitle {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 13px;
  font-weight: 650;
  letter-spacing: -0.01em;
}
.sessionTitleRow {
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 6px;
}
.sessionBadge {
  flex: 0 0 auto;
  border-radius: 999px;
  border: 1px solid var(--aim-border);
  padding: 2px 6px;
  font-size: 10px;
  font-weight: 700;
  line-height: 1.1;
}
.sessionBadge.pending {
  border-color: var(--aim-accent);
  color: var(--aim-accent);
  background: color-mix(in srgb, var(--aim-accent) 12%, transparent);
}
.sessionBadge.saved {
  color: var(--aim-muted);
}
.sessionMeta,
.sessionDate {
  font-size: 12px;
  line-height: 1.25;
}
.sessionMenuButton {
  width: 32px;
  height: 32px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--aim-border);
  border-radius: 10px;
  background: color-mix(in srgb, var(--aim-btn-bg) 70%, transparent);
  color: var(--aim-muted);
  padding: 0;
  font-size: 11px;
  font-weight: 650;
  cursor: pointer;
  transition: background-color 0.14s ease, border-color 0.14s ease, color 0.14s ease, opacity 0.14s ease;
}
.sessionMenuButton:hover:not(:disabled) {
  background: var(--aim-btn-hover);
  border-color: var(--aim-accent);
  color: var(--aim-accent);
}
.sessionMenuButton.active {
  border-color: var(--aim-accent);
  color: var(--aim-accent);
}
.sessionMenuButton:disabled {
  opacity: 0.5;
  cursor: wait;
}
.sessionMenu {
  position: absolute;
  z-index: 20;
  min-width: 132px;
  display: flex;
  flex-direction: column;
  gap: 4px;
  border: 1px solid var(--aim-border);
  border-radius: 12px;
  background: var(--aim-bg-secondary);
  box-shadow: var(--aim-shadow);
  padding: 6px;
  max-height: calc(100% - 16px);
  overflow: auto;
}
.sessionMenu button {
  width: 100%;
  min-height: 31px;
  display: flex;
  align-items: center;
  gap: 8px;
  border: 0;
  border-radius: 9px;
  background: transparent;
  color: var(--aim-text);
  padding: 0 8px;
  font-size: 12px;
  font-weight: 600;
  text-align: left;
  cursor: pointer;
}
.sessionMenu button:hover:not(:disabled) {
  background: var(--aim-btn-hover);
}
.sessionMenu button:disabled {
  opacity: 0.42;
  cursor: not-allowed;
}
.sessionMenu button.danger {
  color: var(--aim-error-text);
}
.canvasPanel {
  min-width: 0;
  display: grid;
  grid-template-rows: auto 1fr;
}
.canvasHeader {
  align-items: center;
  background: var(--aim-bg-secondary);
  flex-wrap: wrap;
}
.stats {
  display: grid;
  grid-template-columns: repeat(4, minmax(68px, 1fr));
  gap: 8px;
  max-width: 100%;
}
.stat {
  min-width: 0;
  border: 1px solid var(--aim-border);
  border-radius: 12px;
  background: var(--aim-btn-bg);
  padding: 8px 10px;
}
.stat span {
  display: block;
  color: var(--aim-muted);
  font-size: 11px;
}
.stat strong {
  display: block;
  margin-top: 3px;
  font-size: 15px;
  line-height: 1;
  font-variant-numeric: tabular-nums;
}
.graphCanvas {
  position: relative;
  min-height: 0;
  width: 100%;
  height: 100%;
  overflow: hidden;
  touch-action: none;
  cursor: grab;
  background:
    linear-gradient(var(--aim-border-light) 1px, transparent 1px),
    linear-gradient(90deg, var(--aim-border-light) 1px, transparent 1px);
  background-size: 34px 34px;
  background-position: -1px -1px;
}
.graphCanvas:active {
  cursor: grabbing;
}
html.threadlineGraphPanning,
html.threadlineGraphPanning body,
html.threadlineGraphPanning .graphCanvas,
html.threadlineGraphPanning .graphCanvas * {
  -webkit-user-select: none !important;
  user-select: none !important;
}
html.threadlineGraphPanning .graphCanvas {
  cursor: grabbing;
}
.graphViewport {
  position: absolute;
  left: 0;
  top: 0;
  width: max-content;
  min-width: 760px;
  transform-origin: 0 0;
  will-change: transform;
}
.canvasControls {
  position: absolute;
  z-index: 8;
  right: 14px;
  bottom: 14px;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  border: 1px solid var(--aim-border);
  border-radius: 14px;
  background: color-mix(in srgb, var(--aim-card) 88%, transparent);
  box-shadow: var(--aim-shadow);
  padding: 6px;
  backdrop-filter: blur(14px);
}
.canvasControls span {
  min-width: 44px;
  color: var(--aim-muted);
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  text-align: center;
}
.canvasControls button {
  min-height: 34px;
  border: 1px solid var(--aim-border);
  border-radius: 11px;
  background: var(--aim-btn-bg);
  color: var(--aim-text);
  padding: 0 10px;
  font-size: 12px;
  font-weight: 650;
  cursor: pointer;
}
.canvasControls .iconButton {
  width: 34px;
  padding: 0;
}
.treeTimeline {
  position: relative;
  min-width: min(720px, calc(100vw - 32px));
  width: max-content;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  gap: 28px;
  padding: 6px 0 34px;
}
.treeTimeline::before {
  content: "";
  position: absolute;
  left: 150px;
  top: 14px;
  bottom: 28px;
  width: 2px;
  border-radius: 999px;
  background: var(--aim-separator);
}
.treeRound {
  position: relative;
  min-width: min(720px, calc(100vw - 32px));
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding-left: 80px;
}
.roundHeader {
  width: 300px;
  display: flex;
  align-items: center;
  justify-content: flex-start;
  gap: 8px;
  padding-left: 86px;
  color: var(--aim-muted);
  font-size: 12px;
}
.roundHeader span {
  color: var(--aim-text);
  font-weight: 650;
}
.roundHeader time {
  font-variant-numeric: tabular-nums;
}
.branchGrid {
  position: relative;
  display: grid;
  grid-template-columns: repeat(var(--branch-count), minmax(260px, 300px));
  align-items: start;
  gap: 42px;
}
.branchColumn {
  position: relative;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.branchColumn.mainBranch {
  grid-column: 1;
}
.branchColumn.forkBranch {
  padding-top: 34px;
}
.branchStem {
  position: absolute;
  left: 50%;
  top: 30px;
  bottom: 30px;
  width: 2px;
  border-radius: 999px;
  background: var(--aim-separator);
  transform: translateX(-1px);
}
.branchColumn.mainBranch .branchStem {
  display: none;
}
.forkConnector {
  position: absolute;
  top: 48px;
  right: calc(50% + 1px);
  width: 342px;
  height: 2px;
  background: var(--aim-separator);
}
.forkConnector::before,
.forkConnector::after {
  content: "";
  position: absolute;
  top: -4px;
  width: 10px;
  height: 10px;
  border-radius: 999px;
  background: var(--aim-card);
  border: 3px solid var(--aim-accent);
}
.forkConnector::before {
  left: -5px;
}
.forkConnector::after {
  right: -5px;
}
.branchLabel {
  position: relative;
  z-index: 2;
  align-self: center;
  min-height: 24px;
  display: inline-flex;
  align-items: center;
  border: 1px solid var(--aim-border);
  border-radius: 999px;
  background: var(--aim-btn-bg);
  color: var(--aim-muted);
  padding: 0 9px;
  font-size: 11px;
  font-weight: 650;
}
.mainBranch .branchLabel {
  color: var(--aim-accent);
}
.graphNode {
  position: relative;
  z-index: 1;
  width: 100%;
  display: block;
  border: 1px solid transparent;
  border-radius: 16px;
  background: transparent;
  padding: 0;
  text-align: left;
  cursor: pointer;
}
.graphNode,
.graphNode * {
  cursor: pointer;
}
.graphNode::before {
  content: "";
  position: absolute;
  z-index: 0;
  left: 50%;
  top: -12px;
  width: 2px;
  height: 12px;
  background: var(--aim-separator);
  transform: translateX(-1px);
}
.branchLabel + .graphNode::before {
  height: 20px;
  top: -20px;
}
.graphNode:hover .nodeBody,
.graphNode.active .nodeBody {
  border-color: var(--aim-accent);
}
.graphNode.flashTarget .nodeBody {
  animation: aimRecallFlash 0.82s ease-in-out 2;
}
@keyframes aimRecallFlash {
  0%, 100% {
    border-color: var(--aim-border);
    box-shadow: var(--aim-shadow);
  }
  50% {
    border-color: var(--aim-accent);
    box-shadow:
      0 0 0 2px color-mix(in srgb, var(--aim-accent) 58%, transparent),
      0 0 28px color-mix(in srgb, var(--aim-accent) 42%, transparent),
      var(--aim-shadow);
  }
}
.nodeBody {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
  border: 1px solid var(--aim-border);
  border-radius: 16px;
  background: var(--aim-card);
  box-shadow: var(--aim-shadow);
  padding: 12px 14px;
  transition: border-color 0.14s ease, background-color 0.14s ease;
}
.graphNode.user .nodeBody {
  background: color-mix(in srgb, var(--aim-accent) 7%, var(--aim-card));
}
.nodeTop,
.nodeFooter,
.messageActions {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
}
.rolePill {
  display: inline-flex;
  align-items: center;
  min-height: 22px;
  border-radius: 999px;
  padding: 0 9px;
  font-size: 11px;
  font-weight: 650;
}
.rolePill.user,
.messageAvatar.user {
  background: var(--aim-accent);
  color: #fff;
}
.rolePill.assistant,
.messageAvatar.assistant {
  background: var(--aim-btn-bg);
  border: 1px solid var(--aim-border);
  color: var(--aim-text);
}
.nodeIndex {
  color: var(--aim-tertiary);
  font-size: 12px;
  font-weight: 650;
}
.branchPill {
  min-height: 20px;
  display: inline-flex;
  align-items: center;
  border-radius: 999px;
  background: var(--aim-bg-secondary);
  color: var(--aim-muted);
  padding: 0 7px;
  font-size: 10px;
  font-weight: 650;
}
.nodeTime {
  margin-left: auto;
  font-size: 12px;
  font-variant-numeric: tabular-nums;
}
.nodeContent {
  display: block;
  color: var(--aim-text);
  font-size: 14px;
  line-height: 1.48;
  overflow-wrap: anywhere;
}
.nodeFooter {
  color: var(--aim-muted);
  font-size: 12px;
}
.messagePanel {
  min-width: 0;
}
.messageHeader {
  display: flex;
  flex-direction: column;
}
.messageAvatar {
  width: 34px;
  height: 34px;
  border-radius: 12px;
  font-size: 12px;
  font-weight: 750;
}
.notice {
  margin: 12px 16px 0;
  border-radius: 10px;
  padding: 8px 10px;
  font-size: 12px;
}
.notice.success {
  background: var(--aim-success-bg);
  color: var(--aim-success-text);
}
.notice.error {
  background: var(--aim-error-bg);
  color: var(--aim-error-text);
}
.globalNotice {
  position: fixed;
  z-index: 30;
  right: 18px;
  bottom: 18px;
  max-width: min(360px, calc(100vw - 36px));
  border: 1px solid var(--aim-border);
  border-radius: 14px;
  box-shadow: var(--aim-shadow);
  padding: 10px 12px;
  font-size: 13px;
}
.globalNotice.success {
  background: var(--aim-success-bg);
  color: var(--aim-success-text);
  border-color: transparent;
}
.globalNotice.error {
  background: var(--aim-error-bg);
  color: var(--aim-error-text);
  border-color: transparent;
}
.messageFacts {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
  padding: 12px 16px 0;
}
.messageFacts div {
  min-width: 0;
  border: 1px solid var(--aim-border);
  border-radius: 12px;
  background: var(--aim-btn-bg);
  padding: 9px 10px;
}
.messageFacts span,
.messageFacts strong {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.messageFacts span {
  font-size: 11px;
}
.messageFacts strong {
  margin-top: 3px;
  font-size: 12px;
}
.messageContent {
  min-height: 0;
  overflow: auto;
  margin: 12px 16px 16px;
  border: 1px solid var(--aim-border);
  border-radius: 16px;
  background: var(--aim-btn-bg);
  padding: 14px;
}
.messageContent p {
  color: var(--aim-text);
  font-size: 14px;
  line-height: 1.65;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.emptyState,
.errorBox {
  border: 1px solid var(--aim-border);
  border-radius: 14px;
  background: var(--aim-btn-bg);
  padding: 14px;
  color: var(--aim-muted);
  font-size: 13px;
}
.emptyState.compact {
  margin: 12px 16px;
}
.errorBox {
  margin: 14px 18px 0;
  background: var(--aim-error-bg);
  border-color: transparent;
  color: var(--aim-error-text);
}
@media (max-width: 1400px) {
  .layout.detailOpen {
    grid-template-columns: minmax(240px, clamp(260px, 20vw, 320px)) minmax(0, 1fr);
  }
  .layout.detailOpen .messagePanel {
    position: fixed;
    z-index: 20;
    top: calc(72px + clamp(8px, 1vw, 14px));
    right: clamp(8px, 1vw, 14px);
    bottom: clamp(8px, 1vw, 14px);
    width: min(400px, calc(100vw - 28px));
  }
}
@media (max-width: 1180px) {
  .layout {
    grid-template-columns: minmax(230px, 300px) minmax(0, 1fr);
  }
  .layout.detailOpen {
    grid-template-columns: minmax(230px, 300px) minmax(0, 1fr);
  }
  .layout.detailOpen .messagePanel {
    top: 88px;
  }
}
@media (max-width: 760px) {
  .page {
    height: 100dvh;
    min-height: 100dvh;
  }
  .topbar {
    align-items: flex-start;
    flex-direction: column;
  }
  .layout {
    grid-template-columns: 1fr;
    padding: 10px;
    grid-template-rows: minmax(180px, 38dvh) minmax(0, 1fr);
  }
  .sidebar {
    max-height: none;
  }
  .layout.detailOpen {
    grid-template-columns: 1fr;
    grid-template-rows: minmax(180px, 34dvh) minmax(0, 1fr);
  }
  .layout.detailOpen .messagePanel {
    top: auto;
    left: 10px;
    right: 10px;
    bottom: 10px;
    width: auto;
    max-height: min(58dvh, 520px);
  }
  .canvasHeader {
    align-items: flex-start;
    flex-direction: column;
  }
  .stats {
    width: 100%;
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .canvasControls {
    left: 12px;
    right: auto;
    bottom: 12px;
  }
  .canvasControls span {
    min-width: 38px;
  }
  .treeTimeline {
    margin: 0;
  }
  .treeTimeline::before {
    left: 150px;
  }
  .treeRound {
    padding-left: 0;
  }
  .roundHeader {
    justify-content: flex-start;
  }
  .nodeTime {
    width: 100%;
    margin-left: 0;
  }
}
`

const style = document.createElement('style')
style.textContent = css
document.head.appendChild(style)
