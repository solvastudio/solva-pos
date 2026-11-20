export const WEDGE_MAX_GAP_MS = 50
export const WEDGE_MIN_LENGTH = 4
export const WEDGE_MAX_LENGTH = 64

export interface WedgeKeyInput {
  key: string
  nowMs?: number
  ctrlKey?: boolean
  altKey?: boolean
  metaKey?: boolean
}

export interface WedgePushResult {
  matched: string | null
  consumed: boolean
}

/**
 * Pure keyboard-wedge barcode detector. Distinguishes rapid HID scanner bursts
 * (`< 50ms` inter-character delay, `>= 4` chars terminated by `Enter`) from human typing.
 */
export class WedgeBuffer {
  private buffer = ''
  private lastKeyAtMs: number | null = null
  private readonly nowMs: () => number
  private readonly maxGapMs: number
  private readonly minLength: number

  constructor(opts: { nowMs?: () => number; maxGapMs?: number; minLength?: number } = {}) {
    this.nowMs = opts.nowMs ?? (() => performance.now())
    this.maxGapMs = opts.maxGapMs ?? WEDGE_MAX_GAP_MS
    this.minLength = opts.minLength ?? WEDGE_MIN_LENGTH
  }

  reset(): void {
    this.buffer = ''
    this.lastKeyAtMs = null
  }

  get length(): number {
    return this.buffer.length
  }

  push(input: WedgeKeyInput): WedgePushResult {
    if (input.ctrlKey || input.altKey || input.metaKey) {
      this.reset()
      return { matched: null, consumed: false }
    }

    const now = input.nowMs ?? this.nowMs()

    if (input.key === 'Enter') {
      const withinGap =
        this.lastKeyAtMs !== null && now - this.lastKeyAtMs <= this.maxGapMs * 2
      const candidate = this.buffer
      this.reset()
      if (withinGap && candidate.length >= this.minLength) {
        return { matched: candidate, consumed: true }
      }
      return { matched: null, consumed: false }
    }

    if (input.key.length !== 1) {
      return { matched: null, consumed: false }
    }

    if (this.lastKeyAtMs !== null && now - this.lastKeyAtMs >= this.maxGapMs) {
      this.buffer = input.key
      this.lastKeyAtMs = now
      return { matched: null, consumed: false }
    }

    if (this.buffer.length >= WEDGE_MAX_LENGTH) {
      this.reset()
      return { matched: null, consumed: false }
    }

    this.buffer += input.key
    this.lastKeyAtMs = now
    return { matched: null, consumed: false }
  }
}

export function isWedgeIgnoredTarget(target: EventTarget | null): boolean {
  if (!target || typeof (target as HTMLElement).tagName !== 'string') return false
  const el = target as HTMLElement
  if (el.dataset.wedgeIgnore === 'true') return true
  if (el.isContentEditable) return true

  const tag = el.tagName.toUpperCase()
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true
  if (tag === 'INPUT') {
    const input = el as HTMLInputElement
    if (input.dataset.scannerSearch === 'true') {
      return false
    }
    const type = input.type.toLowerCase()
    if (type === 'password' || type === 'number' || input.inputMode === 'numeric') {
      return true
    }
    return true
  }
  return el.getAttribute('role') === 'spinbutton'
}
