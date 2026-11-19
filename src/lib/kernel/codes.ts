/**
 * 32-character human-friendly code alphabet (excludes ambiguous I, O, 0, 1).
 * 256 divides evenly by 32 (`byte & 31`), giving zero modulo bias.
 */
export const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

export const CODE_LENGTH_MEMBER = 10
export const CODE_LENGTH_PAIRING = 8

const ALPHABET_SET = new Set(CODE_ALPHABET.split(''))

export function generateCode(randomBytes: Uint8Array, length: number): string {
  if (!Number.isSafeInteger(length) || length < 1) {
    throw new RangeError(`Code length must be a positive integer, received ${length}`)
  }
  if (randomBytes.length < length) {
    throw new RangeError(
      `Insufficient random bytes: need ${length}, received ${randomBytes.length}`,
    )
  }

  let out = ''
  for (let i = 0; i < length; i += 1) {
    out += CODE_ALPHABET[randomBytes[i]! & 31]!
  }
  return out
}

export function formatCode(code: string): string {
  if (code.length === CODE_LENGTH_MEMBER) {
    return `${code.slice(0, 5)}-${code.slice(5, 10)}`
  }
  if (code.length === CODE_LENGTH_PAIRING) {
    return `${code.slice(0, 4)}-${code.slice(4, 8)}`
  }
  return code
}

export function normalizeCode(input: string): string {
  if (typeof input !== 'string') {
    return ''
  }
  const compact = input.toUpperCase().replace(/[\s-]+/g, '')
  if (compact.length === 0) {
    return ''
  }
  for (let i = 0; i < compact.length; i += 1) {
    if (!ALPHABET_SET.has(compact[i]!)) {
      return ''
    }
  }
  return compact
}
