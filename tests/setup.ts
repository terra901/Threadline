import { chromeMock } from './__mocks__/chrome'
// Patch chrome global for all tests
globalThis.chrome = chromeMock as unknown as typeof chrome
