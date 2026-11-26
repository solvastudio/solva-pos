import { executeRetentionChunk, type RetentionChunkSummary } from '../data/maintenance.repo'
import type { SolvaDb } from '../db/solva-db'

export const DEFAULT_RETENTION_CHUNK_SIZE = 200
export const NORMAL_OUTBOX_ACKED_DAYS = 7
export const AGGRESSIVE_OUTBOX_ACKED_DAYS = 1
export const PRINT_JOB_DONE_DAYS = 7

export interface RetentionResult extends RetentionChunkSummary {
  readonly cutoffBusinessDate: string
}

/**
 * Returns `YYYY-MM-01` for the calendar month 3 months prior to `nowMs` (UTC).
 */
export function computeRetentionCutoffDate(nowMs: number): string {
  const d = new Date(nowMs)
  const target = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 3, 1))
  const yyyy = target.getUTCFullYear()
  const mm = String(target.getUTCMonth() + 1).padStart(2, '0')
  return `${yyyy}-${mm}-01`
}

/**
 * Runs one chunked (`chunkSize = 200`) local retention pass (BR-SYN-050..054):
 * - Deletes `sale`/`credit_note`/`cash_movement`/`shift` ONLY when `sync_status` is synced
 *   and `business_date < cutoffDate` (children deleted in same atomic rw transaction).
 * - NEVER deletes `PENDING`, `SENDING`, `NEEDS_ATTENTION`, or `OPEN` shift records.
 * - Strips payload from `ACKED` outbox rows older than 7 days (or 1 day under >85% storage pressure).
 * - Cleans `DONE` print jobs (>7d), stale `pull_stage`, `USED` `cart_draft`, and `device_log` excess.
 */
export async function runRetentionPass(
  db: SolvaDb,
  opts?: { trustedNowMs?: number; aggressive?: boolean; chunkSize?: number },
): Promise<RetentionResult> {
  const nowMs = opts?.trustedNowMs ?? Date.now()
  const chunkSize = Math.max(1, opts?.chunkSize ?? DEFAULT_RETENTION_CHUNK_SIZE)
  const cutoffDate = computeRetentionCutoffDate(nowMs)
  const outboxDays = opts?.aggressive ? AGGRESSIVE_OUTBOX_ACKED_DAYS : NORMAL_OUTBOX_ACKED_DAYS
  const outboxCutoffIso = new Date(nowMs - outboxDays * 86_400_000).toISOString()
  const printCutoffIso = new Date(nowMs - PRINT_JOB_DONE_DAYS * 86_400_000).toISOString()

  const summary = await executeRetentionChunk(db, {
    cutoffDate,
    outboxCutoffIso,
    printCutoffIso,
    chunkSize,
    nowMs,
  })

  return {
    cutoffBusinessDate: cutoffDate,
    ...summary,
  }
}

/**
 * Schedules a non-blocking idle retention pass using `scheduler.postTask('background')`
 * or `requestIdleCallback` (falling back to `setTimeout`), active instance only.
 */
export function scheduleRetentionOnIdle(
  db: SolvaDb,
  opts?: { trustedNowMs?: () => number; onCompleted?: (res: RetentionResult) => void },
): () => void {
  let cancelled = false

  const execute = () => {
    if (cancelled || !db.isOpen()) return
    void runRetentionPass(db, {
      trustedNowMs: opts?.trustedNowMs?.(),
    })
      .then((res) => {
        if (!cancelled) opts?.onCompleted?.(res)
      })
      .catch(() => {})
  }

  const g = globalThis as typeof globalThis & {
    scheduler?: { postTask?: (cb: () => void, o: { priority: string }) => Promise<unknown> }
    requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number
    cancelIdleCallback?: (id: number) => void
  }

  if (typeof g.scheduler?.postTask === 'function') {
    void g.scheduler.postTask(execute, { priority: 'background' })
    return () => {
      cancelled = true
    }
  }

  if (typeof g.requestIdleCallback === 'function') {
    const id = g.requestIdleCallback(execute, { timeout: 2000 })
    return () => {
      cancelled = true
      g.cancelIdleCallback?.(id)
    }
  }

  const timer = setTimeout(execute, 500)
  return () => {
    cancelled = true
    clearTimeout(timer)
  }
}
