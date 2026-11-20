import { CODE_LENGTH_PAIRING, normalizeCode } from '~/lib/kernel'

export type ParsePairResult =
  | { ok: true; code: string }
  | { ok: false; reason: 'WRONG_ADDRESS' | 'INVALID' }

/**
 * Parses pairing codes from raw input, URL hash fragments (`#pair=XXXX-XXXX` per ARCHITECTURE §6.3
 * and `#XXXX-XXXX` per DESIGN SCR-P01), or full QR URLs (`https://host/<slug>/pos#pair=...`).
 * Rejects full URLs belonging to a different tenant slug without touching any tenant lookup.
 */
export function parsePairInput(rawInput: string, currentSlug: string): ParsePairResult {
  const trimmed = rawInput.trim()
  if (!trimmed) {
    return { ok: false, reason: 'INVALID' }
  }

  let candidateFragment = trimmed
  if (/^https?:\/\//i.test(trimmed) || trimmed.startsWith('/')) {
    try {
      const parsed = new URL(trimmed, 'https://placeholder.solva.local')
      const segments = parsed.pathname.split('/').filter(Boolean)
      const urlSlug = segments[0]?.toLowerCase() ?? ''
      if (urlSlug && urlSlug !== currentSlug.trim().toLowerCase()) {
        return { ok: false, reason: 'WRONG_ADDRESS' }
      }
      candidateFragment = parsed.hash || parsed.searchParams.get('pair') || ''
    } catch {
      return { ok: false, reason: 'INVALID' }
    }
  }

  let rawCode = candidateFragment.replace(/^#/, '').trim()
  if (/^pair=/i.test(rawCode)) {
    rawCode = rawCode.slice('pair='.length)
  }

  const normalized = normalizeCode(rawCode)
  if (normalized.length !== CODE_LENGTH_PAIRING) {
    return { ok: false, reason: 'INVALID' }
  }

  return { ok: true, code: normalized }
}

export function stripPairFragment(): void {
  if (typeof window === 'undefined' || !window.location || !window.history) {
    return
  }
  if (window.location.hash) {
    window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`)
  }
}
