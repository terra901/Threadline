import type { ThemeMode } from '../i18n/ThemeContext'

export interface ThemeTokens {
  bg: string
  bgSecondary: string
  bgCard: string
  text: string
  textMuted: string
  textTertiary: string
  border: string
  borderLight: string
  separator: string
  accent: string
  accentHover: string
  btnBg: string
  btnBorder: string
  btnHoverBg: string
  btnPrimaryBg: string
  btnPrimaryHover: string
  successBg: string
  successText: string
  errorBg: string
  errorText: string
  inputBg: string
  inputBorder: string
  shadow: string
}

export const lightTheme: ThemeTokens = {
  bg: '#f2f2f7',
  bgSecondary: 'rgba(255,255,255,0.80)',
  bgCard: 'rgba(255,255,255,0.90)',
  text: '#1c1c1e',
  textMuted: 'rgba(60,60,67,0.60)',
  textTertiary: 'rgba(60,60,67,0.36)',
  border: 'rgba(60,60,67,0.13)',
  borderLight: 'rgba(60,60,67,0.08)',
  separator: 'rgba(60,60,67,0.18)',
  accent: '#007AFF',
  accentHover: '#0066CC',
  btnBg: 'rgba(255,255,255,0.90)',
  btnBorder: 'rgba(60,60,67,0.13)',
  btnHoverBg: 'rgba(242,242,247,0.95)',
  btnPrimaryBg: '#007AFF',
  btnPrimaryHover: '#0066CC',
  successBg: 'rgba(52,199,89,0.14)',
  successText: '#1a7f37',
  errorBg: 'rgba(255,59,48,0.12)',
  errorText: '#c0392b',
  inputBg: 'rgba(255,255,255,0.75)',
  inputBorder: 'rgba(60,60,67,0.20)',
  shadow: '0 1px 8px rgba(0,0,0,0.07), 0 0 1px rgba(0,0,0,0.05)',
}

export const darkTheme: ThemeTokens = {
  bg: '#1c1c1e',
  bgSecondary: 'rgba(44,44,46,0.92)',
  bgCard: 'rgba(44,44,46,0.90)',
  text: '#ffffff',
  textMuted: 'rgba(235,235,245,0.60)',
  textTertiary: 'rgba(235,235,245,0.36)',
  border: 'rgba(255,255,255,0.10)',
  borderLight: 'rgba(255,255,255,0.06)',
  separator: 'rgba(255,255,255,0.14)',
  accent: '#0A84FF',
  accentHover: '#3395FF',
  btnBg: 'rgba(58,58,60,0.92)',
  btnBorder: 'rgba(255,255,255,0.10)',
  btnHoverBg: 'rgba(72,72,74,0.92)',
  btnPrimaryBg: '#0A84FF',
  btnPrimaryHover: '#3395FF',
  successBg: 'rgba(48,209,88,0.18)',
  successText: '#30d158',
  errorBg: 'rgba(255,69,58,0.18)',
  errorText: '#ff453a',
  inputBg: 'rgba(58,58,60,0.60)',
  inputBorder: 'rgba(255,255,255,0.14)',
  shadow: '0 4px 24px rgba(0,0,0,0.50), 0 1px 4px rgba(0,0,0,0.25)',
}

export function getThemeTokens(theme: ThemeMode): ThemeTokens {
  return theme === 'dark' ? darkTheme : lightTheme
}
