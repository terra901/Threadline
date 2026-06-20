/**
 * Onboarding Step 3 — Recall button highlight overlay.
 *
 * When onboarding reaches Step 3, we inject a pulsing ring + bouncing arrow
 * tooltip directly onto the Recall button in the AI platform's page so the
 * user knows exactly where to click.
 *
 * Usage:
 *   startOnboardingHighlight(buttonId)   — call once on storage change
 *   stopOnboardingHighlight()            — call when step is done / button clicked
 */

const OVERLAY_ID = 'ai-memory-onboarding-overlay'
const KEYFRAMES_ID = 'ai-memory-onboarding-keyframes'

function ensureKeyframes(): void {
  if (document.getElementById(KEYFRAMES_ID)) return
  const style = document.createElement('style')
  style.id = KEYFRAMES_ID
  style.textContent = `
    @keyframes aim-pulse-ring {
      0%   { box-shadow: 0 0 0 0 rgba(99,102,241,0.7); }
      70%  { box-shadow: 0 0 0 10px rgba(99,102,241,0); }
      100% { box-shadow: 0 0 0 0 rgba(99,102,241,0); }
    }
    @keyframes aim-bounce-arrow {
      0%, 100% { margin-top: 0px; }
      50%       { margin-top: -6px; }
    }
  `
  document.head.appendChild(style)
}

/**
 * Attaches a pulsing highlight ring + bouncing arrow tooltip to the
 * Recall button identified by buttonId.
 *
 * The tooltip is positioned fixed (viewport-relative) so it always renders
 * on top regardless of the host page's stacking contexts or z-index wars.
 * A rAF loop keeps the tooltip anchored as the page scrolls or resizes.
 */
export function startOnboardingHighlight(buttonId: string): boolean {
  // Already showing
  if (document.getElementById(OVERLAY_ID)) return true

  const btn = document.getElementById(buttonId)
  if (!btn) return false

  // Walk up to the wrapper <span> that contains the button
  const wrapper = btn.parentElement as HTMLElement | null
  if (!wrapper) return false

  ensureKeyframes()

  // Apply pulsing ring to the wrapper
  const prevOutline = wrapper.style.outline
  const prevBorderRadius = wrapper.style.borderRadius
  wrapper.style.outline = '2px solid rgb(99,102,241)'
  wrapper.style.borderRadius = '10px'
  wrapper.dataset.aimPrevOutline = prevOutline
  wrapper.dataset.aimPrevBorderRadius = prevBorderRadius

  // Pulsing ring overlay — fixed so it escapes the toolbar stacking context
  const ring = document.createElement('div')
  ring.id = 'ai-memory-ring'
  Object.assign(ring.style, {
    position: 'fixed',
    borderRadius: '10px',
    border: '2px solid rgb(99,102,241)',
    animation: 'aim-pulse-ring 1.4s ease-in-out infinite',
    pointerEvents: 'none',
    zIndex: '2147483646',
  })
  document.documentElement.appendChild(ring)

  // Arrow tooltip above the button — also fixed
  const arrow = document.createElement('div')
  arrow.id = OVERLAY_ID
  Object.assign(arrow.style, {
    position: 'fixed',
    background: 'rgb(99,102,241)',
    color: '#fff',
    fontSize: '12px',
    fontWeight: '600',
    fontFamily: 'ui-sans-serif, system-ui, -apple-system, sans-serif',
    padding: '5px 10px',
    borderRadius: '8px',
    whiteSpace: 'nowrap',
    pointerEvents: 'none',
    zIndex: '2147483647',
    animation: 'aim-bounce-arrow 1s ease-in-out infinite',
    boxShadow: '0 2px 8px rgba(99,102,241,0.4)',
  })
  arrow.textContent = '👆 Click Recall'

  // Caret below the tooltip bubble
  const caret = document.createElement('div')
  Object.assign(caret.style, {
    position: 'absolute',
    top: '100%',
    left: '50%',
    transform: 'translateX(-50%)',
    width: '0',
    height: '0',
    borderLeft: '6px solid transparent',
    borderRight: '6px solid transparent',
    borderTop: '6px solid rgb(99,102,241)',
  })
  arrow.appendChild(caret)
  document.documentElement.appendChild(arrow)

  // rAF loop: keep fixed elements positioned above the wrapper
  let rafId: number
  function positionOverlays(): void {
    const rect = wrapper!.getBoundingClientRect()
    if (rect.width === 0 && rect.height === 0) {
      // Wrapper removed from DOM — clean up
      stopOnboardingHighlight(buttonId)
      return
    }
    Object.assign(ring.style, {
      top: `${rect.top - 3}px`,
      left: `${rect.left - 3}px`,
      width: `${rect.width + 6}px`,
      height: `${rect.height + 6}px`,
    })
    arrow.style.top = `${rect.top - 10 - 32}px` // 32px ≈ tooltip height
    arrow.style.left = `${rect.left + rect.width / 2}px`
    arrow.style.transform = 'translateX(-50%)'
    rafId = requestAnimationFrame(positionOverlays)
  }
  rafId = requestAnimationFrame(positionOverlays)
  // Store rafId so stopOnboardingHighlight can cancel it
  ;(wrapper as HTMLElement & { _aimRafId?: number })._aimRafId = rafId
  return true
}

/**
 * Removes the highlight overlay and restores the wrapper's original styles.
 */
export function stopOnboardingHighlight(buttonId: string): void {
  const btn = document.getElementById(buttonId)
  const wrapper = btn?.parentElement as (HTMLElement & { _aimRafId?: number }) | null

  if (wrapper) {
    wrapper.style.outline = wrapper.dataset.aimPrevOutline ?? ''
    wrapper.style.borderRadius = wrapper.dataset.aimPrevBorderRadius ?? ''
    delete wrapper.dataset.aimPrevOutline
    delete wrapper.dataset.aimPrevBorderRadius
    if (wrapper._aimRafId !== undefined) {
      cancelAnimationFrame(wrapper._aimRafId)
      delete wrapper._aimRafId
    }
  }

  document.getElementById('ai-memory-ring')?.remove()
  document.getElementById(OVERLAY_ID)?.remove()
}

/**
 * Tries to start the highlight, retrying via MutationObserver if the button
 * isn't in the DOM yet (e.g. Gemini only renders its toolbar after input).
 */
function startOnboardingHighlightWhenReady(buttonId: string): void {
  if (startOnboardingHighlight(buttonId) !== false) return // already attached or succeeded

  // Button not yet in DOM — observe until it appears (max 30 s)
  let settled = false
  const timeout = setTimeout(() => {
    obs.disconnect()
  }, 30_000)

  const obs = new MutationObserver(() => {
    if (settled) return
    if (!document.getElementById(buttonId)) return
    settled = true
    obs.disconnect()
    clearTimeout(timeout)
    startOnboardingHighlight(buttonId)
  })
  obs.observe(document.body, { childList: true, subtree: true })
}

/**
 * Registers listeners on chrome.storage.onChanged so injectors react to
 * the onboarding step 3 flag.  Also checks the current storage state immediately.
 *
 * Call this once from each injector's start() function.
 */
export function watchOnboardingStep3(buttonId: string): void {
  // Check current state on load
  chrome.storage.local.get('onboarding_step3_active', (r) => {
    if (r['onboarding_step3_active']) {
      startOnboardingHighlightWhenReady(buttonId)
    }
  })

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return
    if ('onboarding_step3_active' in changes) {
      const newVal = changes['onboarding_step3_active']?.newValue
      if (newVal) {
        startOnboardingHighlightWhenReady(buttonId)
      } else {
        stopOnboardingHighlight(buttonId)
      }
    }
  })
}
