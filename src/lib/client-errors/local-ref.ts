const REF_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789'

function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

function defaultRandom(): number {
  const c = globalThis.crypto
  if (c && typeof c.getRandomValues === 'function') {
    const buf = new Uint32Array(1)
    c.getRandomValues(buf)
    return buf[0]! / 0x1_0000_0000
  }
  return Math.random()
}

/**
 * Generates an offline-safe local diagnostic reference (`D-YYYYMMDD-HHmmss-xxxxx`)
 * in UTC using clock-offset-corrected time and unambiguous lowercase base31 suffix.
 */
export function newLocalRef(
  correctedNowMs: number = Date.now(),
  rand: () => number = defaultRandom,
): string {
  const d = new Date(correctedNowMs)
  const day = `${d.getUTCFullYear()}${pad2(d.getUTCMonth() + 1)}${pad2(d.getUTCDate())}`
  const time = `${pad2(d.getUTCHours())}${pad2(d.getUTCMinutes())}${pad2(d.getUTCSeconds())}`
  let suffix = ''
  for (let i = 0; i < 5; i += 1) {
    const raw = Math.max(0, Math.min(0.999999, rand()))
    const idx = Math.floor(raw * REF_ALPHABET.length)
    suffix += REF_ALPHABET[idx]!
  }
  return `D-${day}-${time}-${suffix}`
}
