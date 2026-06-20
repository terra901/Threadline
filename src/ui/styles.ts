/**
 * Shared style primitives used across all popup and floating panel components.
 * Import these instead of duplicating style objects in every view.
 */
import type React from 'react'

// ── Font ────────────────────────────────────────────────────────────────────

export const FONT_FAMILY =
  '-apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", sans-serif'

// ── Base style objects ───────────────────────────────────────────────────────

/** Standard 360px view container used by all popup views */
export const viewContainer: React.CSSProperties = {
  width: 360,
  minWidth: 360,
  padding: '20px 16px 24px',
  fontFamily: FONT_FAMILY,
  boxSizing: 'border-box',
  display: 'flex',
  flexDirection: 'column',
  gap: 10,
}

/** Same as viewContainer but with larger gap (used by settings-style views) */
export const viewContainerLoose: React.CSSProperties = {
  ...viewContainer,
  gap: 14,
}

/** Thin 1px horizontal divider — set backgroundColor via theme token */
export const divider: React.CSSProperties = {
  height: 1,
  margin: '2px 0',
}

/** Full-width action button with icon+label layout */
export const menuBtn: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 12,
  width: '100%',
  padding: '13px 16px',
  border: '1px solid',
  borderRadius: 14,
  fontSize: 14,
  fontWeight: 500,
  cursor: 'pointer',
  textAlign: 'left',
  boxSizing: 'border-box',
  transition: 'opacity 0.12s ease',
  fontFamily: 'inherit',
  letterSpacing: '-0.01em',
}

/** Disabled state overlay for buttons */
export const btnDisabled: React.CSSProperties = {
  opacity: 0.45,
  cursor: 'not-allowed',
}

/** Square 32×32 icon button (theme toggle, back button, etc.) */
export const iconBtn: React.CSSProperties = {
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
}

/** Icon wrapper inside buttons — adds subtle dim */
export const iconWrap: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  flexShrink: 0,
  opacity: 0.8,
}

/** View header row (back button + title) */
export const viewHeader: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 10,
}

/** Section title label (ALL CAPS small text) */
export const sectionLabel: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 600,
  textTransform: 'uppercase',
  letterSpacing: '0.06em',
}

/** Status / feedback message chip */
export const statusMsg: React.CSSProperties = {
  marginTop: 6,
  padding: '6px 10px',
  borderRadius: 8,
  fontSize: 12,
  letterSpacing: '-0.01em',
}

/** Dropdown menu popup */
export const dropdownMenu: React.CSSProperties = {
  position: 'relative',
  marginTop: 8,
  width: '100%',
  border: '1px solid',
  borderRadius: 12,
  overflow: 'hidden',
  boxShadow: '0 4px 16px rgba(0,0,0,0.12)',
}

/** Label row at top of a dropdown menu */
export const dropdownMenuLabel: React.CSSProperties = {
  padding: '8px 14px 4px',
  fontSize: 11,
  fontWeight: 600,
  letterSpacing: '0.04em',
  textTransform: 'uppercase',
  fontFamily: FONT_FAMILY,
}

/** Individual item inside a dropdown menu */
export const dropdownMenuItem: React.CSSProperties = {
  display: 'block',
  width: '100%',
  padding: '10px 14px',
  border: 'none',
  background: 'transparent',
  fontSize: 13,
  fontWeight: 500,
  cursor: 'pointer',
  textAlign: 'left',
  fontFamily: FONT_FAMILY,
  letterSpacing: '-0.01em',
  transition: 'background-color 0.1s ease',
  boxSizing: 'border-box',
}

/** Page/view title text */
export const viewTitle: React.CSSProperties = {
  fontSize: 16,
  fontWeight: 600,
  letterSpacing: '-0.02em',
}
