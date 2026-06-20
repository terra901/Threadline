import type { CaptureMode } from '../constants/capture'
import type { ThemeTokens } from './theme'

function rgbaFromHex(hex: string, alpha: number): string {
  const normalized = hex.trim().replace('#', '')
  if (!/^[\da-f]{6}$/i.test(normalized)) return hex
  const value = Number.parseInt(normalized, 16)
  const r = (value >> 16) & 255
  const g = (value >> 8) & 255
  const b = value & 255
  return `rgba(${r},${g},${b},${alpha})`
}

export function getCaptureModeTone(mode: CaptureMode, tk: ThemeTokens) {
  if (mode === 'auto') {
    return {
      backgroundColor: tk.successBg,
      borderColor: tk.successText,
      color: tk.successText,
      ringColor: rgbaFromHex(tk.successText, 0.18),
    }
  }

  return {
    backgroundColor: rgbaFromHex(tk.accent, 0.14),
    borderColor: tk.accent,
    color: tk.accent,
    ringColor: rgbaFromHex(tk.accent, 0.18),
  }
}
