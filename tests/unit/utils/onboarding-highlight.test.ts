import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  startOnboardingHighlight,
  stopOnboardingHighlight,
} from '../../../src/utils/onboarding-highlight'

beforeEach(() => {
  // Stub rAF / cAF before each test
  vi.stubGlobal('requestAnimationFrame', vi.fn(() => 42))
  vi.stubGlobal('cancelAnimationFrame', vi.fn())

  // Clear DOM state
  document.documentElement.innerHTML = ''
  document.head.innerHTML = ''
})

afterEach(() => {
  vi.unstubAllGlobals()
})

/** Helper: create a button wrapped in a span and append to body */
function addButton(id: string): { btn: HTMLButtonElement; wrapper: HTMLSpanElement } {
  const wrapper = document.createElement('span')
  const btn = document.createElement('button')
  btn.id = id
  wrapper.appendChild(btn)
  document.body.appendChild(wrapper)
  return { btn, wrapper }
}

describe('startOnboardingHighlight', () => {
  it('returns false when the button is not in the DOM', () => {
    const result = startOnboardingHighlight('non-existent-btn')
    expect(result).toBe(false)
  })

  it('returns true when the button exists in the DOM', () => {
    addButton('my-btn')
    const result = startOnboardingHighlight('my-btn')
    expect(result).toBe(true)
  })

  it('adds the ring element to the document', () => {
    addButton('my-btn')
    startOnboardingHighlight('my-btn')
    expect(document.getElementById('ai-memory-ring')).not.toBeNull()
  })

  it('adds the overlay (arrow) element to the document', () => {
    addButton('my-btn')
    startOnboardingHighlight('my-btn')
    expect(document.getElementById('ai-memory-onboarding-overlay')).not.toBeNull()
  })

  it('adds the keyframes style tag to document.head', () => {
    addButton('my-btn')
    startOnboardingHighlight('my-btn')
    expect(document.getElementById('ai-memory-onboarding-keyframes')).not.toBeNull()
  })

  it('calls requestAnimationFrame', () => {
    addButton('my-btn')
    startOnboardingHighlight('my-btn')
    expect(requestAnimationFrame).toHaveBeenCalled()
  })

  it('stores the rafId on the wrapper element', () => {
    const { wrapper } = addButton('my-btn')
    startOnboardingHighlight('my-btn')
    expect((wrapper as any)._aimRafId).toBe(42)
  })

  it('applies outline style to the wrapper', () => {
    const { wrapper } = addButton('my-btn')
    startOnboardingHighlight('my-btn')
    // happy-dom normalizes outline shorthand order; check it's non-empty
    expect(wrapper.style.outline).toBeTruthy()
    // Verify the color component is present (browser may reorder shorthand parts)
    expect(wrapper.style.outline).toContain('99')
  })

  it('returns true (no duplicate) when overlay already present', () => {
    addButton('my-btn')
    startOnboardingHighlight('my-btn')

    // Clear call count to verify no new elements added
    const ringCount = document.querySelectorAll('#ai-memory-ring').length
    const result = startOnboardingHighlight('my-btn')

    expect(result).toBe(true)
    // Should not add a second ring
    expect(document.querySelectorAll('#ai-memory-ring').length).toBe(ringCount)
  })

  it('only adds the keyframes style tag once on repeated calls', () => {
    addButton('my-btn')
    // Remove overlay so second call proceeds past early-return
    startOnboardingHighlight('my-btn')
    document.getElementById('ai-memory-onboarding-overlay')?.remove()
    document.getElementById('ai-memory-ring')?.remove()

    startOnboardingHighlight('my-btn')
    const styleTags = document.querySelectorAll('#ai-memory-onboarding-keyframes')
    expect(styleTags.length).toBe(1)
  })
})

describe('stopOnboardingHighlight', () => {
  it('removes the ring element from the DOM', () => {
    addButton('my-btn')
    startOnboardingHighlight('my-btn')
    expect(document.getElementById('ai-memory-ring')).not.toBeNull()

    stopOnboardingHighlight('my-btn')
    expect(document.getElementById('ai-memory-ring')).toBeNull()
  })

  it('removes the overlay element from the DOM', () => {
    addButton('my-btn')
    startOnboardingHighlight('my-btn')
    expect(document.getElementById('ai-memory-onboarding-overlay')).not.toBeNull()

    stopOnboardingHighlight('my-btn')
    expect(document.getElementById('ai-memory-onboarding-overlay')).toBeNull()
  })

  it('calls cancelAnimationFrame with the stored rafId', () => {
    addButton('my-btn')
    startOnboardingHighlight('my-btn')

    stopOnboardingHighlight('my-btn')
    expect(cancelAnimationFrame).toHaveBeenCalledWith(42)
  })

  it('restores wrapper outline to empty string', () => {
    const { wrapper } = addButton('my-btn')
    // Ensure initial outline was empty
    expect(wrapper.style.outline).toBe('')
    startOnboardingHighlight('my-btn')
    expect(wrapper.style.outline).not.toBe('')

    stopOnboardingHighlight('my-btn')
    expect(wrapper.style.outline).toBe('')
  })

  it('restores wrapper borderRadius to empty string', () => {
    const { wrapper } = addButton('my-btn')
    expect(wrapper.style.borderRadius).toBe('')
    startOnboardingHighlight('my-btn')

    stopOnboardingHighlight('my-btn')
    expect(wrapper.style.borderRadius).toBe('')
  })

  it('does not throw when the button is not in the DOM (no-op)', () => {
    expect(() => stopOnboardingHighlight('non-existent-btn')).not.toThrow()
  })
})
