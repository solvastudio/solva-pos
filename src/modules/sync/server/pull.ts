import '@tanstack/react-start/server-only'
import { sql } from 'drizzle-orm'
import { parseSafeBigint, withTenantReadOnly } from '~/server/db'
import { AppError } from '~/server/error-classify'
import type { FeedCursor, FeedKey, FeedRow, FeedScope } from '../domain/feed-types'
import { kWayMerge } from '../domain/merge'
import { getFeedSources } from './feed-registry'

export interface PullCycle {
  upper: number
  tombstoneFloor: number
}

export type PullPageResult =
  | { fullResyncRequired: true; reason: 'CURSOR_BELOW_FLOOR' }
  | {
      fullResyncRequired?: false
      upper: number
      tombstoneFloor: number
      rows: FeedRow[]
      nextCursor: FeedCursor | null
      hasMore: boolean
    }

interface SyncMetaRow {
  version: number
  tombstoneFloor: number
}

async function readSyncMeta(
  tx: Parameters<Parameters<typeof withTenantReadOnly>[1]>[0],
  tenantId: string,
): Promise<SyncMetaRow> {
  const res = await tx.execute(
    sql`SELECT version, tombstone_floor_version
        FROM tenant_sync
        WHERE tenant_id = ${tenantId}::uuid`,
  )
  if (res.rows.length !== 1) {
    throw new AppError('INTERNAL_ERROR', 'Missing tenant_sync metadata row')
  }
  const row = res.rows[0] as { version: unknown; tombstone_floor_version: unknown }
  return {
    version: parseSafeBigint(row.version),
    tombstoneFloor: parseSafeBigint(row.tombstone_floor_version),
  }
}

export async function startPullCycle(tenantId: string): Promise<PullCycle> {
  return withTenantReadOnly(tenantId, async (tx) => {
    const meta = await readSyncMeta(tx, tenantId)
    return {
      upper: meta.version,
      tombstoneFloor: meta.tombstoneFloor,
    }
  })
}

export async function pullPage(args: {
  tenantId: string
  scope: FeedScope
  cursor: FeedCursor | null
  cycleUpper: number | null
  pageSize: number
}): Promise<PullPageResult> {
  if (!Number.isSafeInteger(args.pageSize) || args.pageSize < 1 || args.pageSize > 500) {
    throw new AppError('VALIDATION_FAILED', `Invalid pull pageSize: ${args.pageSize}`)
  }

  return withTenantReadOnly(args.tenantId, async (tx) => {
    const meta = await readSyncMeta(tx, args.tenantId)
    const upper = args.cycleUpper === null ? meta.version : args.cycleUpper
    const tombstoneFloor = meta.tombstoneFloor

    if (args.cursor !== null && args.cursor.version < tombstoneFloor) {
      return { fullResyncRequired: true, reason: 'CURSOR_BELOW_FLOOR' }
    }

    const sources = getFeedSources()
    if (sources.length === 0) {
      return {
        fullResyncRequired: false,
        upper,
        tombstoneFloor,
        rows: [],
        nextCursor: args.cursor,
        hasMore: false,
      }
    }

    // Sequential on purpose: all queries share this transaction's single connection.
    const keyLists: FeedKey[][] = []
    for (const source of sources) {
      keyLists.push(
        await source.selectKeys(tx, {
          after: args.cursor,
          upper,
          scope: args.scope,
          limit: args.pageSize + 1,
        }),
      )
    }

    const merged = kWayMerge(keyLists, args.pageSize + 1)
    const hasMore = merged.length > args.pageSize
    const pageKeys = hasMore ? merged.slice(0, args.pageSize) : merged

    if (pageKeys.length === 0) {
      return {
        fullResyncRequired: false,
        upper,
        tombstoneFloor,
        rows: [],
        nextCursor: args.cursor,
        hasMore: false,
      }
    }

    const idsByEntity = new Map<string, string[]>()
    for (const key of pageKeys) {
      const ids = idsByEntity.get(key.entity)
      if (ids) {
        ids.push(key.id)
      } else {
        idsByEntity.set(key.entity, [key.id])
      }
    }

    const sourceByEntity = new Map(sources.map((s) => [s.entity, s]))
    const hydratedLists: FeedRow[][] = []
    for (const [entity, ids] of idsByEntity) {
      const source = sourceByEntity.get(entity)
      if (!source) {
        throw new AppError('INTERNAL_ERROR', `Missing registered feed source: ${entity}`)
      }
      hydratedLists.push(await source.hydrate(tx, ids, args.scope))
    }

    const rowMap = new Map<string, FeedRow>()
    for (const list of hydratedLists) {
      for (const row of list) {
        rowMap.set(`${row.entity}:${row.id}`, row)
      }
    }

    const rows: FeedRow[] = []
    for (const key of pageKeys) {
      const row = rowMap.get(`${key.entity}:${key.id}`)
      if (row) {
        rows.push(row)
      }
    }

    const lastKey = pageKeys[pageKeys.length - 1]!
    return {
      fullResyncRequired: false,
      upper,
      tombstoneFloor,
      rows,
      nextCursor: { version: lastKey.version, id: lastKey.id },
      hasMore,
    }
  })
}
