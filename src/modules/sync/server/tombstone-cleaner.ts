import '@tanstack/react-start/server-only'
import { sql } from 'drizzle-orm'
import { parseSafeBigint, withNoTenant, withTenant } from '~/server/db'
import { createLogger } from '~/server/log'
import { getFeedSources } from './feed-registry'

const log = createLogger('sync.tombstone')
const TOMBSTONE_RETENTION_MS = 30 * 24 * 60 * 60 * 1000

export interface CleanTombstonesResult {
  tenantsProcessed: number
  floorsAdvanced: number
}

/**
 * Computes the highest soft-deleted master version strictly older than 30 days across all
 * registered feeds for a single tenant and advances `tenant_sync.tombstone_floor_version`.
 */
export async function cleanTombstoneFloorForTenant(
  tenantId: string,
  nowIso: string = new Date().toISOString(),
): Promise<boolean> {
  const cutoffIso = new Date(Date.parse(nowIso) - TOMBSTONE_RETENTION_MS).toISOString()
  const sources = getFeedSources()

  return withTenant(tenantId, async (tx) => {
    let floorCandidate: number | null = null
    for (const source of sources) {
      if (!source.maxTombstoneVersionOlderThan) continue
      const candidate = await source.maxTombstoneVersionOlderThan(tx, { cutoffIso })
      if (candidate !== null && (floorCandidate === null || candidate > floorCandidate)) {
        floorCandidate = candidate
      }
    }

    const lockRes = await tx.execute(
      sql`SELECT version, tombstone_floor_version
          FROM tenant_sync
          WHERE tenant_id = ${tenantId}::uuid
          FOR UPDATE`,
    )
    if (lockRes.rows.length !== 1) {
      return false
    }
    const row = lockRes.rows[0] as { version: unknown; tombstone_floor_version: unknown }
    const currentVersion = parseSafeBigint(row.version)
    const currentFloor = parseSafeBigint(row.tombstone_floor_version)
    const boundedCandidate =
      floorCandidate !== null ? Math.min(floorCandidate, currentVersion) : currentFloor

    const advanced = boundedCandidate > currentFloor
    const effectiveFloor = advanced ? boundedCandidate : currentFloor

    if (advanced) {
      await tx.execute(
        sql`UPDATE tenant_sync
            SET tombstone_floor_version = LEAST(${boundedCandidate}::bigint, version),
                floor_updated_at = ${nowIso}::timestamptz
            WHERE tenant_id = ${tenantId}::uuid`,
      )
    }

    if (effectiveFloor > 0) {
      for (const source of sources) {
        if (source.purgeBelowFloor) {
          await source.purgeBelowFloor(tx, { floorVersion: effectiveFloor })
        }
      }
    }

    return advanced
  })
}

/**
 * Advances `tombstone_floor_version` across active tenants for tombstones older than 30 days
 * and purges unreferenced tombstones below the new floor.
 */
export async function cleanTombstoneFloors(deps?: {
  nowIso?: () => string
  tenantIds?: readonly string[]
}): Promise<CleanTombstonesResult> {
  const nowIso = (deps?.nowIso ?? (() => new Date().toISOString()))()
  const tenantIds =
    deps?.tenantIds ??
    (await withNoTenant(async (tx) => {
      const res = await tx.execute(sql`SELECT id FROM list_active_tenants()`)
      return res.rows.map((r) => String((r as { id: unknown }).id).toLowerCase())
    }))

  let floorsAdvanced = 0
  for (const tenantId of tenantIds) {
    const advanced = await cleanTombstoneFloorForTenant(tenantId, nowIso)
    if (advanced) {
      floorsAdvanced += 1
    }
  }

  log.info(
    {
      jobId: 'sync.clean_tombstone_floors',
      rowCount: floorsAdvanced,
      outcome: 'ACK',
    },
    'tombstone floor sweep completed',
  )

  return {
    tenantsProcessed: tenantIds.length,
    floorsAdvanced,
  }
}
