import { describe, it, expect, beforeEach } from 'vitest'
import { sendMessage, sendMessageFireAndForget } from '../../../src/utils/message-passing'
import { chromeMock, resetChromeMock, setLastError } from '../../__mocks__/chrome'

beforeEach(() => {
  resetChromeMock()
})

describe('sendMessage', () => {
  it('resolves with {success: true} when no lastError', async () => {
    const msg = {
      type: 'CAPTURE_MESSAGE',
      payload: { provider: 'openai', rawData: {}, url: 'https://example.com', timestamp: 1 },
    } as any
    const result = await sendMessage(msg)
    expect(result).toEqual({ success: true })
  })

  it('rejects with the lastError message when lastError is set', async () => {
    setLastError('Extension context invalidated')
    const msg = { type: 'CAPTURE_MESSAGE', payload: {} } as any
    await expect(sendMessage(msg)).rejects.toThrow('Extension context invalidated')
  })

  it("rejects with 'Unknown runtime error' when lastError.message is undefined", async () => {
    // Directly set _lastError via setLastError with empty-ish scenario:
    // The mock's lastError getter returns {message: string}, so we rely on the
    // sendMessage source which does: lastError.message ?? 'Unknown runtime error'
    // Simulate by setting a lastError that has no message property.
    // We patch the getter on chromeMock.runtime temporarily.
    const original = Object.getOwnPropertyDescriptor(chromeMock.runtime, 'lastError')
    Object.defineProperty(chromeMock.runtime, 'lastError', {
      get: () => ({ message: undefined }),
      configurable: true,
    })
    try {
      const msg = { type: 'CAPTURE_MESSAGE', payload: {} } as any
      await expect(sendMessage(msg)).rejects.toThrow('Unknown runtime error')
    } finally {
      if (original) {
        Object.defineProperty(chromeMock.runtime, 'lastError', original)
      }
    }
  })

  it('calls chrome.runtime.sendMessage once', async () => {
    const msg = { type: 'CAPTURE_MESSAGE', payload: {} } as any
    await sendMessage(msg)
    expect(chromeMock.runtime.sendMessage).toHaveBeenCalledTimes(1)
  })
})

describe('sendMessageFireAndForget', () => {
  it('calls chrome.runtime.sendMessage once', () => {
    const msg = { type: 'CAPTURE_MESSAGE', payload: {} } as any
    sendMessageFireAndForget(msg)
    expect(chromeMock.runtime.sendMessage).toHaveBeenCalledTimes(1)
  })

  it('returns void (undefined)', () => {
    const msg = { type: 'CAPTURE_MESSAGE', payload: {} } as any
    const result = sendMessageFireAndForget(msg)
    expect(result).toBeUndefined()
  })

  it('swallows lastError silently without rejection', () => {
    setLastError('some error')
    const msg = { type: 'CAPTURE_MESSAGE', payload: {} } as any
    expect(() => sendMessageFireAndForget(msg)).not.toThrow()
  })
})
