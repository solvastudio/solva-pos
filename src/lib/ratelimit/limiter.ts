export type LimitDecision =
  | { allowed: true; remaining: number }
  | { allowed: false; retryAfterMs: number }

export interface Limiter {
  /** Menghabiskan 1 poin untuk `key`. Tidak melempar saat melebihi batas. */
  consume(key: string, nowMs: number): Promise<LimitDecision>
  /** Hanya melihat sisa tanpa menghabiskan. */
  peek(key: string, nowMs: number): Promise<LimitDecision>
  /** Mengosongkan hitungan `key` (mis. setelah login sukses / terbit ulang undangan). */
  reset(key: string): Promise<void>
}

export type Clock = () => number
