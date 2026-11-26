import '@tanstack/react-start/server-only'
import { purgeMemberCodes } from '~/modules/identity/public'
import { blankOldIdempotencyResults, cleanTombstoneFloors } from '~/modules/sync/public'
import { getBackgroundPool } from '~/server/db'
import { createLogger } from '~/server/log'
import { verifyAuditChainsForActiveTenants } from './audit-chain-job'

const log = createLogger('jobs')

export interface BackgroundJobDefinition {
  name: string
  intervalMs: number
  run: () => Promise<void>
}

const ONE_HOUR_MS = 60 * 60 * 1000
const SIX_HOURS_MS = 6 * ONE_HOUR_MS
const ONE_DAY_MS = 24 * ONE_HOUR_MS
const INITIAL_RUN_DELAY_MS = 60_000
const INITIAL_RUN_STAGGER_MS = 30_000
const registry: BackgroundJobDefinition[] = []
const activeTimers: NodeJS.Timeout[] = []
let started = false

export function registerJob(job: BackgroundJobDefinition): void {
  if (!registry.some((existing) => existing.name === job.name)) {
    registry.push(job)
  }
}

async function runJobWithAdvisoryLock(job: BackgroundJobDefinition): Promise<void> {
  const pool = getBackgroundPool()
  const client = await pool.connect()
  let locked = false

  try {
    const lockRes = await client.query<{ acquired: boolean }>(
      'SELECT pg_try_advisory_lock(hashtext($1)) AS acquired',
      [job.name],
    )
    locked = Boolean(lockRes.rows[0]?.acquired)
    if (!locked) {
      return
    }
    await job.run()
  } catch (err: unknown) {
    log.warn({ err, jobId: job.name }, 'background job execution failed')
  } finally {
    if (locked) {
      await client
        .query('SELECT pg_advisory_unlock(hashtext($1))', [job.name])
        .catch(() => undefined)
    }
    client.release()
  }
}

export function startBackgroundJobs(): void {
  if (started || process.env.VITEST) {
    return
  }
  started = true

  registerJob({
    name: 'identity.purge_member_codes',
    intervalMs: ONE_HOUR_MS,
    run: async () => {
      await purgeMemberCodes()
    },
  })

  registerJob({
    name: 'sync.clean_tombstone_floors',
    intervalMs: SIX_HOURS_MS,
    run: async () => {
      await cleanTombstoneFloors()
    },
  })

  registerJob({
    name: 'sync.blank_idempotency_results',
    intervalMs: SIX_HOURS_MS,
    run: async () => {
      await blankOldIdempotencyResults()
    },
  })

  registerJob({
    name: 'audit.verify_chain',
    intervalMs: ONE_DAY_MS,
    run: async () => {
      await verifyAuditChainsForActiveTenants()
    },
  })

  registry.forEach((job, index) => {
    const timer = setInterval(() => {
      void runJobWithAdvisoryLock(job)
    }, job.intervalMs)
    timer.unref()
    activeTimers.push(timer)

    // One early run, staggered so jobs do not start together: with long intervals and manual deploys
    // a process that restarts more often than the interval would otherwise never run the job.
    const initial = setTimeout(
      () => void runJobWithAdvisoryLock(job),
      INITIAL_RUN_DELAY_MS + index * INITIAL_RUN_STAGGER_MS,
    )
    initial.unref()
    activeTimers.push(initial)
  })
}

export function stopBackgroundJobsForTests(): void {
  for (const timer of activeTimers) {
    // Node shares one id space, so this also cancels the initial-run timeouts.
    clearInterval(timer)
  }
  activeTimers.length = 0
  started = false
}
