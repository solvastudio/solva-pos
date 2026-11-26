import '@tanstack/react-start/server-only'
import { sql } from 'drizzle-orm'
import { withNoTenant, withTenant } from '~/server/db'
import { createLogger } from '~/server/log'

const log = createLogger('sync.idempotency_retention')

/**
 * SCHEMA OQ-S09 option A (DIUSULKAN): every `idempotency_command` row is kept; only the replay `result`
 * of commands older than this many months is blanked. Replays only happen while a command is still
 * pending on a device (days to weeks), so an old result is never read again.
 */
export const IDEMPOTENCY_RESULT_RETENTION_MONTHS = 12

/**
 * shortcut: only the 90 days before the cutoff are scanned, so rows blanked by earlier runs are not read
 * again. If the job was disabled for longer than that, run the UPDATE once by hand for the older rows.
 */
const SCAN_WINDOW_DAYS = 90
const BATCH_SIZE = 1_000

export interface BlankIdempotencyResultsDeps {
  nowIso?: () => string
  tenantIds?: readonly string[]
}

export interface BlankIdempotencyResultsSummary {
  tenantsProcessed: number
  rowsBlanked: number
}

/** Blanks the `result` of one tenant's commands received in `[cutoff - 90 days, cutoff)`, in batches. */
export async function blankOldIdempotencyResultsForTenant(
  tenantId: string,
  cutoffIso: string,
): Promise<number> {
  const windowStartIso = new Date(Date.parse(cutoffIso) - SCAN_WINDOW_DAYS * 86_400_000).toISOString()
  let total = 0
  for (;;) {
    const updated = await withTenant(tenantId, async (tx) => {
      const res = await tx.execute(sql`
        UPDATE idempotency_command
        SET result = '{}'::jsonb
        WHERE command_id IN (
          SELECT command_id
          FROM idempotency_command
          WHERE tenant_id = ${tenantId}::uuid
            AND received_at >= ${windowStartIso}::timestamptz
            AND received_at < ${cutoffIso}::timestamptz
            AND result <> '{}'::jsonb
          ORDER BY received_at
          LIMIT ${BATCH_SIZE}
        )
      `)
      return res.rowCount ?? 0
    })
    total += updated
    if (updated < BATCH_SIZE) {
      return total
    }
  }
}

/** Background job body: blanks old results for every active tenant (SCHEMA OQ-S09). */
export async function blankOldIdempotencyResults(
  deps?: BlankIdempotencyResultsDeps,
): Promise<BlankIdempotencyResultsSummary> {
  const now = new Date((deps?.nowIso ?? (() => new Date().toISOString()))())
  now.setUTCMonth(now.getUTCMonth() - IDEMPOTENCY_RESULT_RETENTION_MONTHS)
  const cutoffIso = now.toISOString()

  const tenantIds =
    deps?.tenantIds ??
    (await withNoTenant(async (tx) => {
      const res = await tx.execute(sql`SELECT id FROM list_active_tenants()`)
      return res.rows.map((r) => String((r as { id: unknown }).id).toLowerCase())
    }))

  let rowsBlanked = 0
  for (const tenantId of tenantIds) {
    rowsBlanked += await blankOldIdempotencyResultsForTenant(tenantId, cutoffIso)
  }

  log.info(
    { jobId: 'sync.blank_idempotency_results', rowCount: rowsBlanked, outcome: 'ACK' },
    'idempotency result retention sweep completed',
  )
  return { tenantsProcessed: tenantIds.length, rowsBlanked }
}
