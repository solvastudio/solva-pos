// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('workbox-window', () => ({
  Workbox: vi.fn().mockImplementation(() => {
    throw new Error('Workbox must not be constructed in dev')
  }),
}))

import { registerPosServiceWorker } from './register'

describe('registerPosServiceWorker', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('skips registration in dev even on a POS path, so the missing /sw.js does not reject', async () => {
    vi.stubGlobal('navigator', { ...globalThis.navigator, serviceWorker: {} })
    window.history.pushState({}, '', '/acme/pos/login')

    await expect(registerPosServiceWorker('acme')).resolves.toBeNull()
  })
})
