const MIN_CODE_LENGTH = 2
const MAX_CODE_LENGTH = 30
const FALLBACK_CODE = 'ROLE'

/** 0 -> A, 25 -> Z, 26 -> AA (digits are not allowed in role codes). */
function lettersSuffix(index: number): string {
  let n = index
  let out = ''
  do {
    out = String.fromCharCode(65 + (n % 26)) + out
    n = Math.floor(n / 26) - 1
  } while (n >= 0)
  return out
}

/**
 * Derives a stable role code (`^[A-Z_]{2,30}$`) from a display name.
 * Accents are stripped, every run of non-letters becomes one underscore, and a letter suffix
 * (`_A`, `_B`, ... `_AA`) resolves collisions with `takenCodes`.
 */
export function deriveRoleCode(name: string, takenCodes: ReadonlySet<string>): string {
  const cleaned = name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z]+/g, '_')
    .replace(/^_+|_+$/g, '')
  const root = (cleaned.length >= MIN_CODE_LENGTH ? cleaned : FALLBACK_CODE)
    .slice(0, MAX_CODE_LENGTH)
    .replace(/_+$/, '')
  if (!takenCodes.has(root)) {
    return root
  }
  for (let i = 0; ; i += 1) {
    const suffix = `_${lettersSuffix(i)}`
    const candidate = `${root.slice(0, MAX_CODE_LENGTH - suffix.length).replace(/_+$/, '')}${suffix}`
    if (!takenCodes.has(candidate)) {
      return candidate
    }
  }
}
