/**
 * Onboarding Overlay — Content Script
 *
 * Injects a floating onboarding guide panel directly onto AI platform pages
 * during Step 2 (capture first memory), Step 3 (use Recall), and Step 4 (congrats).
 *
 * State is driven by chrome.storage.local keys:
 *   onboarding_step2_active: true  → show Step 2 guide
 *   onboarding_step3_active: true  → show Step 3 guide (Recall highlight)
 *   onboarding_first_memory_saved  → Step 2 done
 *   onboarding_first_recall_used   → Step 3 done → show Step 4 congrats
 *   onboarding_completed: true     → never show again
 */

import React, { useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import type { PlasmoCSConfig } from 'plasmo'
import { LANG_NAMES, translations } from '../i18n/translations'
import type { LangCode } from '../i18n/translations'
import { detectDefaultLang, loadLangFromChrome, readLangFromLocalStorage, writeLangToLocalStorage, saveLangToChrome, LANG_STORAGE_KEY } from '../i18n/lang-storage'

export const config: PlasmoCSConfig = {
  matches: [
    'https://chat.openai.com/*',
    'https://chatgpt.com/*',
    'https://claude.ai/*',
    'https://gemini.google.com/*',
    'https://www.perplexity.ai/*',
    'https://grok.com/*',
  ],
}

export const render = () => undefined

// ─── Language helpers ──────────────────────────────────────────────────────────

const ALL_LANGS = Object.keys(LANG_NAMES) as LangCode[]

function detectOverlayLang(): LangCode {
  const fromLocal = readLangFromLocalStorage()
  if (fromLocal) return fromLocal

  const nav = typeof navigator !== 'undefined' ? navigator.language ?? '' : 'en'
  return detectDefaultLang(nav)
}

function saveOverlayLang(lang: LangCode): void {
  writeLangToLocalStorage(lang)
  void saveLangToChrome(lang)
}

// ─── Floating Panel ────────────────────────────────────────────────────────────

type OverlayStep = 'step2' | 'step3' | 'step4' | null

function OnboardingOverlay() {
  const [step, setStep] = useState<OverlayStep>(null)
  const [dismissed, setDismissed] = useState(false)
  const [memorySaved, setMemorySaved] = useState(false)
  const [visible, setVisible] = useState(false)
  const [confirmClose, setConfirmClose] = useState(false)
  const [lang, setLangState] = useState<LangCode>(detectOverlayLang)
  const prevStep = useRef<OverlayStep>(null)
  const stepRef = useRef<OverlayStep>(null)

  const t = translations[lang]

  // Sync language with chrome.storage.local
  useEffect(() => {
    let cancelled = false

    ;(async () => {
      const stored = await loadLangFromChrome()
      if (!cancelled && stored && stored !== lang) {
        setLangState(stored)
        writeLangToLocalStorage(stored)
      }
    })()

    const onChanged = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area !== 'local') return
      const change = changes[LANG_STORAGE_KEY]
      const next = change?.newValue as LangCode | undefined
      if (!next || next === lang) return
      setLangState(next)
      writeLangToLocalStorage(next)
    }

    try {
      chrome.storage.onChanged.addListener(onChanged)
    } catch {
      // ignore
    }

    return () => {
      cancelled = true
      try {
        chrome.storage.onChanged.removeListener(onChanged)
      } catch {
        // ignore
      }
    }
  }, [lang])

  const setLang = (next: LangCode) => {
    setLangState(next)
    saveOverlayLang(next)
  }

  // Fade in whenever we get a real step; keep ref in sync
  useEffect(() => {
    if (step !== null) {
      stepRef.current = step
      setVisible(true)
      prevStep.current = step
    }
  }, [step])

  useEffect(() => {
    chrome.storage.local.get([
      'onboarding_overlay_dismissed',
      'onboarding_step2_active',
      'onboarding_step3_active',
      'onboarding_first_memory_saved',
      'onboarding_first_recall_used',
    ], (r) => {
      if (r['onboarding_overlay_dismissed']) {
        setDismissed(true)
        return
      }
      if (r['onboarding_first_recall_used']) {
        setStep('step4')
      } else if (r['onboarding_step3_active']) {
        setStep('step3')
      } else if (r['onboarding_step2_active'] && !r['onboarding_first_memory_saved']) {
        setStep('step2')
      }
      if (r['onboarding_first_memory_saved'] && !r['onboarding_step3_active']) {
        setMemorySaved(true)
      }
    })

    const handler = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area !== 'local') return

      if ('onboarding_overlay_dismissed' in changes && changes['onboarding_overlay_dismissed']?.newValue) {
        setDismissed(true)
        return
      }
      if ('onboarding_step2_active' in changes && changes['onboarding_step2_active']?.newValue) {
        setStep('step2')
      }
      if ('onboarding_step3_active' in changes && changes['onboarding_step3_active']?.newValue) {
        setStep('step3')
      }
      if ('onboarding_first_memory_saved' in changes && changes['onboarding_first_memory_saved']?.newValue) {
        setMemorySaved(true)
      }
      if ('onboarding_first_recall_used' in changes && changes['onboarding_first_recall_used']?.newValue) {
        setStep('step4')
      }
    }

    chrome.storage.onChanged.addListener(handler)
    return () => chrome.storage.onChanged.removeListener(handler)
  }, [])

  const dismissForever = () => {
    chrome.storage.local.set({ onboarding_overlay_dismissed: true })
    chrome.storage.local.remove(['onboarding_step2_active', 'onboarding_step3_active'])
    setVisible(false)
    setTimeout(() => setDismissed(true), 400)
  }

  const handleCloseRequest = () => setConfirmClose(true)
  const handleCancelClose = () => setConfirmClose(false)
  const handleConfirmClose = () => dismissForever()

  if (dismissed || step === null) return null

  const isDark = window.matchMedia('(prefers-color-scheme: dark)').matches
  const bg = isDark ? '#1e1e2e' : '#ffffff'
  const text = isDark ? '#e2e8f0' : '#1a202c'
  const muted = isDark ? '#94a3b8' : '#64748b'
  const border = isDark ? '#334155' : '#e2e8f0'
  const accent = '#6366f1'
  const stepNum = step === 'step2' ? '2' : step === 'step3' ? '3' : '4'

  return (
    <>
      <style>{`
        @keyframes aim-fadein { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes aim-fadeout { from { opacity: 1; transform: translateY(0); } to { opacity: 0; transform: translateY(8px); } }
      `}</style>

      <div
        style={{
          position: 'fixed',
          bottom: '80px',
          right: '20px',
          zIndex: 2147483647,
          width: '300px',
          backgroundColor: bg,
          border: `1px solid ${border}`,
          borderRadius: '16px',
          boxShadow: isDark ? '0 8px 32px rgba(0,0,0,0.5)' : '0 8px 32px rgba(0,0,0,0.12)',
          padding: '20px',
          fontFamily: 'ui-sans-serif, system-ui, -apple-system, sans-serif',
          display: 'flex',
          flexDirection: 'column',
          gap: '12px',
          animation: visible ? 'aim-fadein 0.3s ease forwards' : 'aim-fadeout 0.35s ease forwards',
        }}
      >
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', minWidth: 0 }}>
          <div style={{
            fontSize: '12px',
            fontWeight: '700',
            color: accent,
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
            whiteSpace: 'nowrap',
            flexShrink: 0,
          }}>
            🧠 SETUP
          </div>

          <div style={{
            fontSize: '11px',
            color: muted,
            background: isDark ? '#334155' : '#f1f5f9',
            padding: '1px 7px',
            borderRadius: '20px',
            whiteSpace: 'nowrap',
            flexShrink: 0,
          }}>
            {stepNum} / 4
          </div>

          <div style={{ flex: 1 }} />

          {/* Language picker */}
          <select
            value={lang}
            onChange={(e) => setLang(e.target.value as LangCode)}
            style={{
              fontSize: '11px',
              color: muted,
              background: isDark ? '#334155' : '#f1f5f9',
              border: 'none',
              borderRadius: '6px',
              padding: '1px 4px',
              cursor: 'pointer',
              flexShrink: 0,
              outline: 'none',
              fontFamily: 'inherit',
              maxWidth: '80px',
            }}
          >
            {ALL_LANGS.map((code) => (
              <option key={code} value={code}>{LANG_NAMES[code]}</option>
            ))}
          </select>

          <button
            type="button"
            onClick={handleCloseRequest}
            title="Close tutorial"
            style={{
              flexShrink: 0,
              width: '18px',
              height: '18px',
              borderRadius: '50%',
              border: 'none',
              background: 'transparent',
              color: muted,
              fontSize: '13px',
              lineHeight: '1',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: 0,
            }}
          >
            ✕
          </button>
        </div>

        {/* Step 2 */}
        {step === 'step2' && (
          <>
            <div style={{ fontSize: '15px', fontWeight: '600', color: text }}>
              💬 {t.onboardingStep2Title}
            </div>
            <div style={{ fontSize: '13px', color: muted, lineHeight: 1.6 }}>
              {t.onboardingStep2Instruction}
            </div>
            <div style={{
              padding: '10px 14px',
              borderRadius: '10px',
              border: `1px solid ${memorySaved ? '#22c55e' : border}`,
              backgroundColor: memorySaved ? 'rgba(34,197,94,0.1)' : (isDark ? '#0f172a' : '#f8fafc'),
              fontSize: '13px',
              fontWeight: '500',
              textAlign: 'center' as const,
              color: memorySaved ? '#16a34a' : muted,
              transition: 'all 0.3s ease',
            }}>
              {memorySaved ? t.onboardingStep2Done : t.onboardingStep2Waiting}
            </div>
          </>
        )}

        {/* Step 3 */}
        {step === 'step3' && (
          <>
            <div style={{ fontSize: '15px', fontWeight: '600', color: text }}>
              🔍 {t.onboardingStep3Title}
            </div>
            <div style={{ fontSize: '13px', color: muted, lineHeight: 1.6 }}>
              {t.onboardingStep3Instruction}
            </div>
            <div style={{
              padding: '10px 14px',
              borderRadius: '10px',
              border: `1px solid ${accent}`,
              backgroundColor: 'rgba(99,102,241,0.08)',
              fontSize: '13px',
              fontWeight: '500',
              textAlign: 'center' as const,
              color: accent,
            }}>
              👇 {t.onboardingStep3Waiting}
            </div>
          </>
        )}

        {/* Step 4 — Congrats */}
        {step === 'step4' && (
          <>
            <div style={{ fontSize: '15px', fontWeight: '600', color: text }}>
              {t.onboardingCompleteTitle}
            </div>
            <div style={{ fontSize: '13px', color: muted, lineHeight: 1.6 }}>
              {t.onboardingCompleteSubtitle}
            </div>
            <div style={{
              padding: '10px 14px',
              borderRadius: '10px',
              border: `1px solid ${border}`,
              backgroundColor: isDark ? '#0f172a' : '#f8fafc',
              fontSize: '13px',
              color: muted,
              lineHeight: 1.6,
            }}>
              💡 {t.onboardingImportTip}
            </div>

            <button
              type="button"
              onClick={dismissForever}
              style={{
                padding: '10px',
                borderRadius: '10px',
                border: 'none',
                backgroundColor: accent,
                color: '#fff',
                fontSize: '13px',
                fontWeight: '600',
                cursor: 'pointer',
                fontFamily: 'inherit',
              }}
            >
              {t.onboardingGotIt}
            </button>
          </>
        )}

        {/* Confirm-close dialog */}
        {confirmClose && (
          <div style={{
            position: 'absolute',
            inset: 0,
            borderRadius: '16px',
            backgroundColor: bg,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '12px',
            padding: '24px',
            zIndex: 1,
          }}>
            <div style={{ fontSize: '14px', fontWeight: '600', color: text, textAlign: 'center' }}>
              {t.onboardingEndTitle}
            </div>
            <div style={{ fontSize: '13px', color: muted, textAlign: 'center', lineHeight: 1.5 }}>
              {t.onboardingEndDesc}
            </div>
            <div style={{ display: 'flex', gap: '8px', width: '100%' }}>
              <button
                type="button"
                onClick={handleCancelClose}
                style={{
                  flex: 1, padding: '8px', borderRadius: '8px',
                  border: `1px solid ${border}`, backgroundColor: 'transparent',
                  color: text, fontSize: '13px', cursor: 'pointer', fontFamily: 'inherit',
                }}
              >
                {t.onboardingEndContinue}
              </button>
              <button
                type="button"
                onClick={handleConfirmClose}
                style={{
                  flex: 1, padding: '8px', borderRadius: '8px',
                  border: 'none', backgroundColor: '#ef4444',
                  color: '#fff', fontSize: '13px', cursor: 'pointer', fontFamily: 'inherit',
                }}
              >
                {t.onboardingEndConfirm}
              </button>
            </div>
          </div>
        )}
      </div>
    </>
  )
}

// ─── Mount ─────────────────────────────────────────────────────────────────────

const ROOT_ID = 'ai-memory-onboarding-overlay-root'

function mountOverlay() {
  if (document.getElementById(ROOT_ID)) return
  const el = document.createElement('div')
  el.id = ROOT_ID
  document.documentElement.appendChild(el)
  createRoot(el).render(<OnboardingOverlay />)
}

function doMount() {
  if (document.body) {
    mountOverlay()
  } else {
    document.addEventListener('DOMContentLoaded', mountOverlay)
  }
}

doMount()

const _remountObserver = new MutationObserver(() => {
  if (!document.getElementById(ROOT_ID)) {
    mountOverlay()
  }
})
_remountObserver.observe(document.documentElement, { childList: true })
