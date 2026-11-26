import { createIdGenerator } from '~/lib/kernel'

/**
 * Process-wide UUIDv7 generator for runtime code paths (server and POS client).
 * Only relies on `globalThis.crypto`, which exists in browsers and in Node 22.
 * Lives outside `lib/kernel` on purpose: the kernel must stay deterministic (no clock, no randomness).
 */
export const runtimeIdGenerator = createIdGenerator({
  nowMs: () => Date.now(),
  nextUint32: () => {
    const buf = new Uint32Array(1)
    globalThis.crypto.getRandomValues(buf)
    return buf[0]!
  },
})
