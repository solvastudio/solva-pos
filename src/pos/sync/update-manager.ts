import type { ReleaseBlock } from '~/lib/contracts'
import {
  UpdateManager,
  isSafeMoment,
  type SafeMomentInput,
  type UpdateStatus,
  type UpdateTransport,
} from '~/pwa/update-manager'
import { getMeta, setMeta } from '../data/meta.repo'
import { getOutboxQueueSummary } from '../data/outbox.repo'
import type { SolvaDb } from '../db/solva-db'
import { logDevice } from '../maintenance/device-log'
import { evaluateRelease, type ReleaseEvaluation } from './release-state'

export { UpdateManager, isSafeMoment, type SafeMomentInput, type UpdateStatus, type UpdateTransport }

export const UPDATE_SNOOZE_MS = 2 * 60 * 60 * 1000

export interface WorkMomentContext {
  readonly cartActive: boolean
  readonly paymentActive: boolean
  readonly shiftOpen: boolean
  readonly idleLocked?: boolean
  readonly clockOffsetMs?: number | null
}

export interface PersistentUpdateSnapshot {
  readonly status: UpdateStatus
  readonly evaluation: ReleaseEvaluation
  readonly promptVisible: boolean
  readonly snoozedUntilIso: string | null
  readonly canSnooze: boolean
  readonly mandatory: boolean
  readonly serverBehind: boolean
}

export interface PersistentUpdateController {
  getSnapshot(): PersistentUpdateSnapshot
  evaluate(opts: {
    release: ReleaseBlock | null
    hasWaitingWorker?: boolean
    context: WorkMomentContext
  }): Promise<PersistentUpdateSnapshot>
  snooze(): Promise<PersistentUpdateSnapshot>
  applyNow(opts?: { context?: WorkMomentContext }): Promise<boolean>
  handleControllerChange(): boolean
}

/**
 * Coordinates the full POS app update lifecycle (`NONE -> AVAILABLE -> PENDING_APPLY -> APPLYING`),
 * persisting `meta.update` (`next_prompt_at`, `dismissed_at`), enforcing 2-hour soft snooze,
 * delaying UI prompts during checkout, applying hard/required updates only at `isSafeMoment`,
 * and emitting `UPDATE_ACCEPTED`/`UPDATE_REJECTED` device logs.
 */
export function createPersistentUpdateController(opts: {
  db: SolvaDb
  appVersion: string
  schemaVersion: number
  transport?: Partial<UpdateTransport>
  nowMs?: () => number
}): PersistentUpdateController {
  const nowFn = opts.nowMs ?? (() => Date.now())
  const swMgr = new UpdateManager(opts.transport)

  let lastEvaluation: ReleaseEvaluation = 'UP_TO_DATE'
  let snoozedUntilIso: string | null = null
  let promptVisible = false
  let lastClockOffsetMs: number | null = null

  function toSnapshot(): PersistentUpdateSnapshot {
    return {
      status: swMgr.getStatus(),
      evaluation: lastEvaluation,
      promptVisible,
      snoozedUntilIso,
      canSnooze: lastEvaluation === 'SOFT',
      mandatory: lastEvaluation === 'HARD' || lastEvaluation === 'REQUIRED',
      serverBehind: lastEvaluation === 'SERVER_BEHIND',
    }
  }

  async function logDecision(code: 'UPDATE_ACCEPTED' | 'UPDATE_REJECTED', urgency: ReleaseEvaluation) {
    try {
      await logDevice(
        opts.db,
        {
          level: 'info',
          code,
          clockOffsetMs: lastClockOffsetMs,
          ctx: { urgency },
        },
        { correctedNowMs: nowFn },
      )
    } catch {
      // Diagnostic logging must never break update orchestration.
    }
  }

  return {
    getSnapshot: toSnapshot,

    async evaluate({ release, hasWaitingWorker, context }) {
      lastClockOffsetMs = context.clockOffsetMs ?? null
      const nowMs = nowFn()
      const evaluation = evaluateRelease(
        release,
        {
          appVersion: opts.appVersion,
          schemaVersion: opts.schemaVersion,
          hasWaitingWorker,
        },
        nowMs,
      )
      lastEvaluation = evaluation

      const [updateMeta, queue] = await Promise.all([
        getMeta(opts.db, 'update'),
        getOutboxQueueSummary(opts.db),
      ])
      snoozedUntilIso = updateMeta?.next_prompt_at ?? null

      if (evaluation === 'UP_TO_DATE' || evaluation === 'SERVER_BEHIND') {
        promptVisible = false
        return toSnapshot()
      }

      if (evaluation === 'SOFT') {
        swMgr.markAvailable()
        const snoozeMs = snoozedUntilIso ? Date.parse(snoozedUntilIso) : 0
        const snoozeElapsed = !snoozedUntilIso || !Number.isFinite(snoozeMs) || nowMs >= snoozeMs
        // Defer prompt silently during active checkout/payment (BR-VER-007)
        promptVisible = snoozeElapsed && !context.cartActive && !context.paymentActive
        return toSnapshot()
      }

      // HARD or REQUIRED: ensure PENDING_APPLY and NEVER offer snooze.
      swMgr.markAvailable()
      swMgr.markPendingApply()
      promptVisible = !context.cartActive && !context.paymentActive

      // queue.pending already excludes SCHEMA-held commands (ARCH §9.6.4).
      const safe = isSafeMoment({
        cartActive: context.cartActive,
        paymentActive: context.paymentActive,
        shiftOpen: context.shiftOpen,
        queueNonAcked: queue.pending,
      })

      if (safe && swMgr.getStatus() === 'pending_apply') {
        await logDecision('UPDATE_ACCEPTED', evaluation)
        swMgr.applyUpdate()
      }

      return toSnapshot()
    },

    async snooze() {
      if (lastEvaluation !== 'SOFT') {
        return toSnapshot()
      }
      const nowMs = nowFn()
      const nextPromptAt = new Date(nowMs + UPDATE_SNOOZE_MS).toISOString()
      const dismissedAt = new Date(nowMs).toISOString()
      snoozedUntilIso = nextPromptAt
      promptVisible = false
      await setMeta(opts.db, 'update', {
        next_prompt_at: nextPromptAt,
        dismissed_at: dismissedAt,
        status: 'AVAILABLE',
      })
      await logDecision('UPDATE_REJECTED', lastEvaluation)
      return toSnapshot()
    },

    async applyNow(applyOpts) {
      const ctx = applyOpts?.context
      const queue = await getOutboxQueueSummary(opts.db)
      const isHardOrReq = lastEvaluation === 'HARD' || lastEvaluation === 'REQUIRED'

      // On locked screen with closed shift (BR-VER-012) or closed checkout, manual trigger is permitted
      // unless a hard update would interrupt an open shift or non-SCHEMA queue.
      if (isHardOrReq && ctx) {
        if (ctx.shiftOpen || queue.pending > 0 || ctx.cartActive || ctx.paymentActive) {
          return false
        }
      }

      swMgr.markAvailable()
      if (swMgr.getStatus() === 'available' || swMgr.getStatus() === 'pending_apply') {
        await logDecision('UPDATE_ACCEPTED', lastEvaluation)
        await setMeta(opts.db, 'update', {
          next_prompt_at: null,
          dismissed_at: snoozedUntilIso,
          status: 'APPLYING',
        })
        return swMgr.applyUpdate()
      }
      return false
    },

    handleControllerChange() {
      return swMgr.handleControllerChange()
    },
  }
}
