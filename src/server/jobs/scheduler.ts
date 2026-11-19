import '@tanstack/react-start/server-only'
import { purgeMemberCodes } from '~/modules/identity/public'
import { getBackgroundPool } from '~/server/db'
import { createLogger } from '~/server/log'

const log = createLogger('jobs')

export interface BackgroundJobDefinition {
  name: string
  intervalMs: number
  run: () => Promise<void>
}

const ONE_HOUR_MS = 60 * 60 * 1000
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

  for (const job of registry) {
    const timer = setInterval(() => {
      void runJobWithAdvisoryLock(job)
    }, job.intervalMs)
    timer.unref()
    activeTimers.push(timer)
  }
}

export function stopBackgroundJobsForTests(): void {
  for (const timer of activeTimers) {
    clearInterval(timer)
  }
  activeTimers.length = 0
  started = false
}
