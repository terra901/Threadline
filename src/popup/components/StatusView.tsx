import React from 'react'
import type { ErrorLog, MemoryRecord } from '../../types/memory'
import { APP_DISPLAY_NAME } from '../../constants/branding'

interface StatusViewProps {
  totalRecords: number
  recentRecords: MemoryRecord[]
  errors: ErrorLog[]
  lastCaptureTime?: number
  quotaExceeded?: boolean
  onClearErrors: () => void
}

function formatTime(ms: number): string {
  return new Date(ms).toLocaleString()
}

function truncate(text: string, max = 80): string {
  return text.length > max ? text.slice(0, max) + '…' : text
}

const roleLabel: Record<string, string> = {
  user: '👤 User',
  assistant: '🤖 AI',
}

const providerLabel: Record<string, string> = {
  openai: 'ChatGPT',
  anthropic: 'Claude',
  google: 'Gemini',
  perplexity: 'Perplexity',
}

export function StatusView({
  totalRecords,
  recentRecords,
  errors,
  lastCaptureTime,
  quotaExceeded,
  onClearErrors,
}: StatusViewProps) {
  return (
    <div style={styles.container}>
      {/* Header */}
      <div style={styles.header}>
        <span style={styles.title}>{APP_DISPLAY_NAME}</span>
        <span style={styles.localBadge}>🔒 Local Only</span>
      </div>

      {/* Stats */}
      <div style={styles.statsRow}>
        <div style={styles.stat}>
          <span style={styles.statNumber}>{totalRecords}</span>
          <span style={styles.statLabel}>memories</span>
        </div>
        {lastCaptureTime && (
          <div style={styles.stat}>
            <span style={styles.statLabel}>Last capture</span>
            <span style={styles.statSub}>{formatTime(lastCaptureTime)}</span>
          </div>
        )}
      </div>

      {/* Quota warning */}
      {quotaExceeded && (
        <div style={styles.warning}>
          ⚠️ Storage quota exceeded — capture paused
        </div>
      )}

      {/* Recent Records */}
      <div style={styles.section}>
        <div style={styles.sectionTitle}>Recent Memories</div>
        {recentRecords.length === 0 ? (
          <div style={styles.empty}>
            No memories yet. Start a conversation on ChatGPT, Claude, or Gemini.
          </div>
        ) : (
          <div style={styles.recordList}>
            {recentRecords.map((r) => (
              <div key={r.id} style={styles.record}>
                <div style={styles.recordMeta}>
                  <span style={styles.role}>{roleLabel[r.role] ?? r.role}</span>
                  <span style={styles.provider}>{providerLabel[r.provider] ?? r.provider}</span>
                  <span style={styles.timestamp}>{formatTime(r.timestamp)}</span>
                  {r.isPartial && <span style={styles.partial}>partial</span>}
                </div>
                <div style={styles.content}>{truncate(r.content)}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Errors */}
      {errors.length > 0 && (
        <div style={styles.section}>
          <div style={styles.sectionHeader}>
            <div style={styles.sectionTitle}>Errors</div>
            <button style={styles.clearBtn} onClick={onClearErrors}>
              Clear
            </button>
          </div>
          <div style={styles.errorList}>
            {errors.map((e, i) => (
              <div key={i} style={styles.errorItem}>
                <span style={styles.errorTime}>{formatTime(e.timestamp)}</span>
                <span>{e.message}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    width: 360,
    minHeight: 200,
    maxHeight: 520,
    overflowY: 'auto',
    fontFamily: 'ui-sans-serif, system-ui, -apple-system, sans-serif',
    fontSize: 13,
    color: '#1a1a1a',
    backgroundColor: '#fff',
    padding: '12px 14px',
    boxSizing: 'border-box',
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  title: {
    fontSize: 16,
    fontWeight: 600,
    color: '#111',
  },
  localBadge: {
    fontSize: 11,
    backgroundColor: '#e8f5e9',
    color: '#2e7d32',
    padding: '2px 8px',
    borderRadius: 10,
    fontWeight: 500,
  },
  statsRow: {
    display: 'flex',
    gap: 16,
    marginBottom: 12,
    padding: '8px 10px',
    backgroundColor: '#f5f5f5',
    borderRadius: 8,
  },
  stat: {
    display: 'flex',
    flexDirection: 'column',
  },
  statNumber: {
    fontSize: 22,
    fontWeight: 700,
    color: '#1976d2',
    lineHeight: 1,
  },
  statLabel: {
    fontSize: 11,
    color: '#666',
    marginTop: 2,
  },
  statSub: {
    fontSize: 11,
    color: '#444',
    marginTop: 2,
  },
  warning: {
    backgroundColor: '#fff3e0',
    color: '#e65100',
    padding: '6px 10px',
    borderRadius: 6,
    marginBottom: 10,
    fontSize: 12,
  },
  section: {
    marginBottom: 10,
  },
  sectionTitle: {
    fontSize: 11,
    fontWeight: 600,
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
    color: '#888',
    marginBottom: 6,
  },
  sectionHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  empty: {
    color: '#999',
    fontStyle: 'italic',
    fontSize: 12,
    padding: '6px 0',
  },
  recordList: {
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
  },
  record: {
    border: '1px solid #e8e8e8',
    borderRadius: 6,
    padding: '6px 8px',
    backgroundColor: '#fafafa',
  },
  recordMeta: {
    display: 'flex',
    gap: 8,
    alignItems: 'center',
    marginBottom: 3,
    flexWrap: 'wrap',
  },
  role: {
    fontSize: 11,
    fontWeight: 600,
    color: '#444',
  },
  provider: {
    fontSize: 11,
    backgroundColor: '#e3f2fd',
    color: '#1565c0',
    padding: '1px 6px',
    borderRadius: 8,
  },
  timestamp: {
    fontSize: 10,
    color: '#bbb',
    marginLeft: 'auto',
  },
  partial: {
    fontSize: 10,
    backgroundColor: '#fff9c4',
    color: '#f57f17',
    padding: '1px 5px',
    borderRadius: 6,
  },
  content: {
    fontSize: 12,
    color: '#555',
    lineHeight: 1.4,
  },
  errorList: {
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
  },
  errorItem: {
    fontSize: 11,
    color: '#c62828',
    display: 'flex',
    gap: 8,
  },
  errorTime: {
    color: '#999',
    flexShrink: 0,
  },
  clearBtn: {
    fontSize: 11,
    color: '#1976d2',
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    padding: '0 4px',
    textDecoration: 'underline',
  },
}
