/**
 * Onboarding Tab — 3-step new user flow
 *
 * Opened automatically on first install via chrome.runtime.onInstalled.
 * Uses the existing LanguageProvider + ThemeProvider for i18n and theming.
 */

import React, { useCallback, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { LanguageProvider, useTranslation } from '../i18n/LanguageContext'
import { ThemeProvider, useTheme } from '../i18n/ThemeContext'
import { getThemeTokens } from '../ui/theme'

// ── Platform links shown on Step 2 ─────────────────────────────────────────────

const AI_PLATFORMS = [
  { name: 'ChatGPT', url: 'https://chatgpt.com', emoji: '🤖' },
  { name: 'Claude', url: 'https://claude.ai', emoji: '🧠' },
  { name: 'Gemini', url: 'https://gemini.google.com', emoji: '✨' },
  { name: 'Grok', url: 'https://grok.com', emoji: '⚡' },
  { name: 'Perplexity', url: 'https://www.perplexity.ai', emoji: '🔍' },
]

// ── Shared styles ───────────────────────────────────────────────────────────────

const CARD_MAX_WIDTH = 560

// ── Step 1: Welcome ─────────────────────────────────────────────────────────────

function Step1({ onNext }: { onNext: () => void }) {
  const { t } = useTranslation()
  const { theme } = useTheme()
  const tk = getThemeTokens(theme)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <div style={{ fontSize: 48, textAlign: 'center' }}>🧠</div>
      <h1 style={{ fontSize: 28, fontWeight: 700, margin: 0, textAlign: 'center', color: tk.text, lineHeight: 1.3 }}>
        {t.onboardingStep1Title}
      </h1>
      <p style={{ fontSize: 16, lineHeight: 1.6, margin: 0, color: tk.textMuted, textAlign: 'center' }}>
        {t.onboardingStep1Subtitle}
      </p>
      <button
        type="button"
        onClick={onNext}
        style={{
          padding: '14px 0',
          borderRadius: 10,
          border: 'none',
          backgroundColor: tk.accent,
          color: '#fff',
          fontSize: 16,
          fontWeight: 600,
          cursor: 'pointer',
          fontFamily: 'inherit',
        }}
      >
        {t.onboardingStep1Btn}
      </button>
    </div>
  )
}

// ── Step 2: Capture first memory ────────────────────────────────────────────────

function Step2({ onNext }: { onNext: () => void }) {
  const { t } = useTranslation()
  const { theme } = useTheme()
  const tk = getThemeTokens(theme)
  const [memorySaved, setMemorySaved] = useState(false)
  const [platformTabOpened, setPlatformTabOpened] = useState(false)

  // Set storage flag so the in-page overlay activates on AI platform tabs
  useEffect(() => {
    chrome.storage.local.set({ onboarding_step2_active: true })
    return () => {
      chrome.storage.local.remove('onboarding_step2_active')
    }
  }, [])

  // Watch storage for first memory saved (set by background worker)
  useEffect(() => {
    const handler = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area !== 'local') return
      if (changes['onboarding_first_memory_saved']?.newValue) {
        setMemorySaved(true)
        setTimeout(() => {
          onNext()
        }, 1200)
      }
    }
    chrome.storage.onChanged.addListener(handler)
    return () => chrome.storage.onChanged.removeListener(handler)
  }, [onNext])

  const openPlatformTab = (url: string) => {
    chrome.tabs.create({ url, active: true })
    setPlatformTabOpened(true)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <div style={{ fontSize: 48, textAlign: 'center' }}>💬</div>
      <h1 style={{ fontSize: 26, fontWeight: 700, margin: 0, textAlign: 'center', color: tk.text, lineHeight: 1.3 }}>
        {t.onboardingStep2Title}
      </h1>
      <p style={{ fontSize: 15, lineHeight: 1.6, margin: 0, color: tk.textMuted, textAlign: 'center' }}>
        {t.onboardingStep2Instruction}
      </p>

      {/* Platform quick-links — open in tab so overlay activates there */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'center' }}>
        {AI_PLATFORMS.map((p) => (
          <button
            key={p.name}
            type="button"
            onClick={() => openPlatformTab(p.url)}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              padding: '8px 14px',
              borderRadius: 8,
              border: `1px solid ${tk.border}`,
              backgroundColor: tk.btnBg,
              color: tk.text,
              fontSize: 13,
              fontWeight: 500,
              cursor: 'pointer',
              fontFamily: 'inherit',
            }}
          >
            {p.emoji} {p.name}
          </button>
        ))}
      </div>

      {platformTabOpened && (
        <div style={{ fontSize: 13, color: tk.textMuted, textAlign: 'center' }}>
          💡 Chat in the tab that just opened — a guide panel will appear there
        </div>
      )}

      {/* Status indicator */}
      <div style={{
        padding: '12px 16px',
        borderRadius: 10,
        border: `1px solid ${memorySaved ? '#22c55e' : tk.border}`,
        backgroundColor: memorySaved ? 'rgba(34,197,94,0.1)' : tk.btnBg,
        fontSize: 14,
        fontWeight: 500,
        textAlign: 'center',
        color: memorySaved ? '#16a34a' : tk.textMuted,
        transition: 'all 0.3s ease',
      }}>
        {memorySaved ? t.onboardingStep2Done : t.onboardingStep2Waiting}
      </div>
    </div>
  )
}

// ── Step 3: Use Recall ──────────────────────────────────────────────────────────

function Step3({ onNext }: { onNext: () => void }) {
  const { t } = useTranslation()
  const { theme } = useTheme()
  const tk = getThemeTokens(theme)
  const [recallUsed, setRecallUsed] = useState(false)

  // Signal injectors to show the highlight overlay while this step is active
  useEffect(() => {
    chrome.storage.local.set({ onboarding_step3_active: true })
    return () => {
      chrome.storage.local.remove('onboarding_step3_active')
    }
  }, [])

  // Watch storage for first recall used (set by background after injector sends FIRST_RECALL_USED)
  useEffect(() => {
    const handler = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area !== 'local') return
      if (changes['onboarding_first_recall_used']?.newValue) {
        chrome.storage.local.remove('onboarding_step3_active')
        setRecallUsed(true)
        setTimeout(() => {
          onNext()
        }, 1200)
      }
    }
    chrome.storage.onChanged.addListener(handler)
    return () => chrome.storage.onChanged.removeListener(handler)
  }, [onNext])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <div style={{ fontSize: 48, textAlign: 'center' }}>🔍</div>
      <h1 style={{ fontSize: 26, fontWeight: 700, margin: 0, textAlign: 'center', color: tk.text, lineHeight: 1.3 }}>
        {t.onboardingStep3Title}
      </h1>

      {/* Step-by-step instructions */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {[
          { n: '1', label: 'Go to an AI chat tab (ChatGPT, Claude, Gemini…)' },
          { n: '2', label: 'Type a topic or question in the chat input' },
          { n: '3', label: 'Click the Recall button in the toolbar — it will search your saved conversations and inject relevant context' },
        ].map(({ n, label }) => (
          <div key={n} style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
            <div style={{
              flexShrink: 0,
              width: 24,
              height: 24,
              borderRadius: '50%',
              backgroundColor: tk.accent,
              color: '#fff',
              fontSize: 13,
              fontWeight: 700,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}>{n}</div>
            <div style={{ fontSize: 14, lineHeight: 1.6, color: tk.textMuted, paddingTop: 2 }}>{label}</div>
          </div>
        ))}
      </div>

      {/* Status indicator */}
      <div style={{
        padding: '12px 16px',
        borderRadius: 10,
        border: `1px solid ${recallUsed ? '#22c55e' : tk.border}`,
        backgroundColor: recallUsed ? 'rgba(34,197,94,0.1)' : tk.btnBg,
        fontSize: 14,
        fontWeight: 500,
        textAlign: 'center',
        color: recallUsed ? '#16a34a' : tk.textMuted,
        transition: 'all 0.3s ease',
      }}>
        {recallUsed ? '✅ Recall used!' : t.onboardingStep3Waiting}
      </div>
    </div>
  )
}

// ── Complete: Aha moment ────────────────────────────────────────────────────────

function StepComplete() {
  const { t } = useTranslation()
  const { theme } = useTheme()
  const tk = getThemeTokens(theme)
  const [totalMemories, setTotalMemories] = useState(0)

  useEffect(() => {
    chrome.runtime.sendMessage(
      { type: 'QUERY_MEMORY_SESSIONS', payload: { limit: 1000, offset: 0 } },
      (r: { payload?: { sessions?: Array<{ messageCount?: number }> } } | undefined) => {
        if (!chrome.runtime.lastError && Array.isArray(r?.payload?.sessions)) {
          setTotalMemories(
            r.payload.sessions.reduce((sum, session) => sum + (session.messageCount ?? 0), 0),
          )
        }
      },
    )
    chrome.storage.local.set({ onboarding_completed: true })
  }, [])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <div style={{ fontSize: 48, textAlign: 'center' }}>🎉</div>
      <h1 style={{ fontSize: 26, fontWeight: 700, margin: 0, textAlign: 'center', color: tk.text, lineHeight: 1.3 }}>
        {t.onboardingCompleteTitle}
      </h1>
      <p style={{ fontSize: 15, lineHeight: 1.6, margin: 0, color: tk.textMuted, textAlign: 'center' }}>
        {t.onboardingCompleteSubtitle}
      </p>
      <div style={{
        padding: '16px',
        borderRadius: 10,
        border: `1px solid ${tk.border}`,
        backgroundColor: tk.btnBg,
        textAlign: 'center',
        fontSize: 15,
        color: tk.text,
        fontWeight: 500,
      }}>
        {t.onboardingMemoriesCount(totalMemories)}
      </div>

      {/* Import tip */}
      <div style={{
        padding: '14px 16px',
        borderRadius: 10,
        border: `1px solid ${tk.border}`,
        backgroundColor: tk.btnBg,
        fontSize: 14,
        color: tk.textMuted,
        lineHeight: 1.6,
      }}>
        💡 <strong style={{ color: tk.text }}>Import from other platforms</strong><br />
        You can bring in your full chat history from ChatGPT, Gemini, or Claude via the extension popup → <em>Import</em>. All your past conversations become searchable memories instantly.
      </div>
    </div>
  )
}

// ── Step indicator ──────────────────────────────────────────────────────────────

function StepDots({ current, total }: { current: number; total: number }) {
  const { theme } = useTheme()
  const tk = getThemeTokens(theme)
  return (
    <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
      {Array.from({ length: total }).map((_, i) => (
        <div
          key={i}
          style={{
            width: i === current ? 20 : 8,
            height: 8,
            borderRadius: 4,
            backgroundColor: i <= current ? tk.accent : tk.border,
            transition: 'all 0.3s ease',
          }}
        />
      ))}
    </div>
  )
}

// ── Main onboarding app ─────────────────────────────────────────────────────────

type Step = 0 | 1 | 2 | 'complete'

function OnboardingApp() {
  const { theme } = useTheme()
  const tk = getThemeTokens(theme)
  const [step, setStep] = useState<Step>(0)

  const nextStep = useCallback(() => {
    setStep((prev) => {
      if (prev === 0) return 1
      if (prev === 1) return 2
      if (prev === 2) return 'complete'
      return 'complete'
    })
  }, [])

  const isComplete = step === 'complete'

  return (
    <div
      style={{
        minHeight: '100vh',
        backgroundColor: tk.bg,
        color: tk.text,
        fontFamily: 'ui-sans-serif, system-ui, -apple-system, sans-serif',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '32px 16px',
      }}
    >
      <div style={{ width: '100%', maxWidth: CARD_MAX_WIDTH, display: 'flex', flexDirection: 'column', gap: 32 }}>
        {/* Step dots — only shown during steps 0-2 */}
        {!isComplete && <StepDots current={step as number} total={3} />}

        {/* Step content */}
        <div style={{
          borderRadius: 16,
          border: `1px solid ${tk.border}`,
          backgroundColor: tk.bg,
          padding: '32px 32px',
          boxShadow: theme === 'dark' ? '0 4px 32px rgba(0,0,0,0.4)' : '0 4px 32px rgba(0,0,0,0.08)',
        }}>
          {step === 0 && <Step1 onNext={nextStep} />}
          {step === 1 && <Step2 onNext={nextStep} />}
          {step === 2 && <Step3 onNext={nextStep} />}
          {step === 'complete' && <StepComplete />}
        </div>
      </div>
    </div>
  )
}

// ── Entry point ─────────────────────────────────────────────────────────────────

function OnboardingRoot() {
  return (
    <LanguageProvider>
      <ThemeProvider>
        <OnboardingApp />
      </ThemeProvider>
    </LanguageProvider>
  )
}

const container = document.getElementById('root') ?? document.body.appendChild(Object.assign(document.createElement('div'), { id: 'root' }))
createRoot(container).render(<OnboardingRoot />)

export {}
