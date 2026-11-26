import '@tanstack/react-start/server-only'
import { sql } from 'drizzle-orm'
import { normalizeSemverAppVersion } from '~/lib/app-version'
import {
  SCHEMA_VERSION,
  SUPPORTED_SCHEMA_VERSIONS,
  type BillsSnapshotBlock,
  type FullPageRequest,
  type FullPageResponse,
  type FullStartRequest,
  type FullStartResponse,
  type PullRequest,
  type PullResponse,
  type StockSnapshotBlock,
} from '~/lib/contracts'
import { getLimiters } from '~/server/auth/rate-limit/limiters'
import { parseSafeBigint, withTenant, withTenantReadOnly, type TenantTx } from '~/server/db'
import { AppError } from '~/server/error-classify'
import { createLogger } from '~/server/log'
import type { SyncDeviceIdentity } from '../domain/command-types'
import type { FeedScope } from '../domain/feed-types'
import { FULL_RESYNC_ENTITY_ORDER } from '../shared'
import { buildBillsSnapshot } from './bills-snapshot.service'
import { getDeviceStatusPort } from './device-status-port'
import { getFeedSources, type FeedSource } from './feed-registry'
import {
  getCachedManifestCounts,
  manifestCountsKey,
  setCachedManifestCounts,
} from './manifest-cache'
import { findCommandStatusesForDevice } from './idempotency.repo'
import { buildStockSnapshot } from './stock-snapshot.service'
import { pullPage } from './pull'
import {
  evaluateClientVersion,
  getReleasePolicy,
  releaseBlock,
  UpdateRequiredError,
} from './release.service'
import { signSnapshotToken, verifySnapshotToken } from './snapshot-token'

const log = createLogger('sync.pull')

export class PullRateLimitedError extends Error {
  constructor(public readonly retryAfterMs: number) {
    super('RATE_LIMITED')
    this.name = 'PullRateLimitedError'
  }
}

export interface PullRequestMeta {
  schemaVersion: number
  appVersion: string | null
  syncProtocol: number | null
  requestRef: string
}

export interface PullServiceDeps {
  nowIso?: () => string
  nowMs?: () => number
}

function deviceScope(device: SyncDeviceIdentity): FeedScope {
  return {
    tenantId: device.tenantId,
    outletId: device.outletId,
    registerId: device.registerId,
    deviceId: device.deviceId,
  }
}

/** Counts live rows per feed entity. Sequential: every query shares the transaction's single connection. */
async function countFeedEntities(
  tx: TenantTx,
  sources: readonly FeedSource[],
  args: { upper: number; scope: FeedScope },
): Promise<Record<string, number>> {
  const counts: Record<string, number> = {}
  for (const source of sources) {
    counts[source.entity] = await source.count(tx, args)
  }
  return counts
}

/**
 * Serves one incremental pull page for an authenticated device, appending `command_updates`
 * and `manifest` on the final page (`has_more = false`) and persisting `DeviceReport`.
 */
export async function handlePull(
  device: SyncDeviceIdentity,
  req: PullRequest,
  meta: PullRequestMeta,
  deps?: PullServiceDeps,
): Promise<PullResponse> {
  if (!SUPPORTED_SCHEMA_VERSIONS.includes(meta.schemaVersion)) {
    return {
      full_resync_required: true,
      reason: 'SCHEMA_INCOMPATIBLE',
    }
  }

  const nowMs = (deps?.nowMs ?? (() => Date.now()))()
  const nowIso = (deps?.nowIso ?? (() => new Date(nowMs).toISOString()))()
  const scope = deviceScope(device)
  const safeAppVersion = normalizeSemverAppVersion(meta.appVersion)

  const policy = await getReleasePolicy({ nowMs: () => nowMs })
  const release = releaseBlock(policy)
  const versionEval = evaluateClientVersion(
    {
      appVersion: safeAppVersion,
      schemaVersion: meta.schemaVersion,
      nowIso,
    },
    policy,
  )
  if (!versionEval.ok && versionEval.reason === 'APP_TOO_OLD') {
    throw new UpdateRequiredError(release, `Client app version below minimum: ${safeAppVersion ?? 'null'}`)
  }

  const page = await pullPage({
    tenantId: device.tenantId,
    scope,
    cursor: req.cursor,
    cycleUpper: req.cycle?.upper ?? null,
    pageSize: req.page_size,
  })

  if (page.fullResyncRequired) {
    const statusPort = getDeviceStatusPort()
    if (statusPort && req.report) {
      await withTenant(
        device.tenantId,
        async (tx) => {
          await statusPort.touchDeviceStatus(tx, device.tenantId, device.deviceId, {
            lastAttemptAt: nowIso,
            lastSuccessSyncAt: null,
            appVersion: safeAppVersion,
            schemaVersion: meta.schemaVersion,
            syncProtocolVersion: meta.syncProtocol,
            report: req.report,
          })
        },
        { statementTimeoutMs: 5_000 },
      )
    }

    log.info(
      {
        deviceId: device.deviceId,
        tenantId: device.tenantId,
        outcome: 'RESYNC_REQUIRED',
        reason: page.reason,
      },
      'pull cursor below tombstone floor; full resync required',
    )
    return {
      full_resync_required: true,
      reason: page.reason,
    }
  }

  const isLastPage = !page.hasMore
  let commandUpdates: Array<{ id: string; status: string }> | undefined
  let manifestCounts: Record<string, number> | undefined
  let stockPayload: StockSnapshotBlock | 'unchanged' | undefined
  let billsPayload: BillsSnapshotBlock | 'unchanged' | undefined

  if (isLastPage) {
    const sources = getFeedSources()
    const countsKey = manifestCountsKey(scope, page.upper)
    const cachedCounts = getCachedManifestCounts(countsKey)
    const summary = await withTenantReadOnly(device.tenantId, async (tx) => {
      const updates =
        req.attention_ids.length > 0
          ? await findCommandStatusesForDevice(tx, device.tenantId, device.deviceId, req.attention_ids)
          : []
      // Counts only change when the master version moves, so an unchanged `upper` reuses them.
      const counts =
        cachedCounts ?? (await countFeedEntities(tx, sources, { upper: page.upper, scope }))
      // Stock and open-bills snapshots, read in the same DB snapshot as the manifest.
      const stock = await buildStockSnapshot(tx, {
        tenantId: device.tenantId,
        outletId: device.outletId,
        deviceId: device.deviceId,
        nowIso,
      })
      const bills = await buildBillsSnapshot(tx, {
        tenantId: device.tenantId,
        outletId: device.outletId,
        deviceId: device.deviceId,
        registerId: device.registerId,
        nowIso,
      })
      return { updates, counts, stock, bills }
    })
    if (!cachedCounts) {
      setCachedManifestCounts(countsKey, summary.counts)
    }
    commandUpdates = summary.updates
    manifestCounts = summary.counts
    if (summary.stock) {
      stockPayload = req.stock_etag === summary.stock.etag ? 'unchanged' : summary.stock.block
    }
    if (summary.bills) {
      billsPayload = req.bills_etag === summary.bills.etag ? 'unchanged' : summary.bills.block
    }
  }

  const statusPort = getDeviceStatusPort()
  if (statusPort) {
    const syncSucceeded = isLastPage && req.report?.push_ok === true
    await withTenant(
      device.tenantId,
      async (tx) => {
        await statusPort.touchDeviceStatus(tx, device.tenantId, device.deviceId, {
          lastAttemptAt: nowIso,
          lastPullAt: nowIso,
          lastSuccessSyncAt: syncSucceeded ? nowIso : null,
          pullCursorVersion: isLastPage ? (page.nextCursor?.version ?? page.upper) : null,
          appVersion: safeAppVersion,
          schemaVersion: meta.schemaVersion,
          syncProtocolVersion: meta.syncProtocol,
          report: req.report,
        })

        if (syncSucceeded) {
          await statusPort.extendCredentialIfNeeded(tx, device.tenantId, device.deviceId, nowIso)
        }
      },
      { statementTimeoutMs: 5_000 },
    )
  }

  return {
    server_time: nowIso,
    upper: page.upper,
    tombstone_floor: page.tombstoneFloor,
    rows: page.rows,
    next_cursor: page.nextCursor,
    has_more: page.hasMore,
    max_schema_version: SCHEMA_VERSION,
    release,
    ...(isLastPage
      ? {
          command_updates: commandUpdates,
          manifest: { counts: manifestCounts ?? {} },
          ...(stockPayload !== undefined ? { stock: stockPayload } : {}),
          ...(billsPayload !== undefined ? { bills: billsPayload } : {}),
        }
      : {}),
  }
}

/**
 * Starts a rate-limited (`RL_FULL_RESYNC_PER_HOUR`, 1/hour/device) full-resync cycle,
 * returning the live manifest counts, `snapshot_version`, entity order, and signed HMAC token.
 */
export async function startFullResync(
  device: SyncDeviceIdentity,
  req: FullStartRequest,
  meta: PullRequestMeta,
  deps?: PullServiceDeps,
): Promise<FullStartResponse> {
  const nowMs = (deps?.nowMs ?? (() => Date.now()))()
  const nowIso = (deps?.nowIso ?? (() => new Date(nowMs).toISOString()))()

  const rlDecision = await getLimiters().fullResync.consume(device.deviceId, nowMs)
  if (!rlDecision.allowed) {
    log.warn(
      {
        deviceId: device.deviceId,
        tenantId: device.tenantId,
        scope: 'device:full_resync',
        outcome: 'RATE_LIMITED',
      },
      'full resync rate limited',
    )
    throw new PullRateLimitedError(rlDecision.retryAfterMs)
  }

  const scope = deviceScope(device)
  const sources = getFeedSources()
  const sourceSet = new Set(sources.map((s) => s.entity))
  const orderedEntities = [
    ...FULL_RESYNC_ENTITY_ORDER.filter((name) => sourceSet.has(name)),
    ...sources
      .map((s) => s.entity)
      .filter((name) => !(FULL_RESYNC_ENTITY_ORDER as readonly string[]).includes(name)),
  ]

  const metaSnapshot = await withTenantReadOnly(device.tenantId, async (tx) => {
    const syncRes = await tx.execute(
      sql`SELECT version, tombstone_floor_version
          FROM tenant_sync
          WHERE tenant_id = ${device.tenantId}::uuid`,
    )
    if (syncRes.rows.length !== 1) {
      throw new AppError('INTERNAL_ERROR', 'Missing tenant_sync metadata row')
    }
    const syncRow = syncRes.rows[0] as { version: unknown; tombstone_floor_version: unknown }
    const snapshotVersion = parseSafeBigint(syncRow.version)
    const tombstoneFloor = parseSafeBigint(syncRow.tombstone_floor_version)

    return {
      snapshotVersion,
      tombstoneFloor,
      counts: await countFeedEntities(tx, sources, { upper: snapshotVersion, scope }),
    }
  })

  const statusPort = getDeviceStatusPort()
  if (statusPort && req.report) {
    const safeAppVersion = normalizeSemverAppVersion(meta.appVersion)
    await withTenant(
      device.tenantId,
      async (tx) => {
        await statusPort.touchDeviceStatus(tx, device.tenantId, device.deviceId, {
          lastAttemptAt: nowIso,
          lastSuccessSyncAt: null,
          appVersion: safeAppVersion,
          schemaVersion: meta.schemaVersion,
          syncProtocolVersion: meta.syncProtocol,
          report: req.report,
        })
      },
      { statementTimeoutMs: 5_000 },
    )
  }

  const snapshotToken = signSnapshotToken(
    {
      deviceId: device.deviceId,
      snapshotVersion: metaSnapshot.snapshotVersion,
      iat: nowMs,
    },
    { nowMs: () => nowMs },
  )

  return {
    snapshot_version: metaSnapshot.snapshotVersion,
    tombstone_floor: metaSnapshot.tombstoneFloor,
    manifest: { counts: metaSnapshot.counts },
    snapshot_token: snapshotToken,
    entities: orderedEntities,
  }
}

/**
 * Fetches a single keyset-ordered live snapshot page for one entity within an active full resync.
 */
export async function fullResyncPage(
  device: SyncDeviceIdentity,
  req: FullPageRequest,
  deps?: PullServiceDeps,
): Promise<FullPageResponse> {
  const nowMs = (deps?.nowMs ?? (() => Date.now()))()
  verifySnapshotToken(req.snapshot_token, device.deviceId, { nowMs: () => nowMs })

  const source = getFeedSources().find((s) => s.entity === req.entity)
  if (!source) {
    throw new AppError('VALIDATION_FAILED', `Unknown sync entity: ${req.entity}`)
  }

  const scope = deviceScope(device)
  const fetched = await withTenantReadOnly(device.tenantId, async (tx) => {
    return source.snapshotPage(tx, {
      afterId: req.after_id,
      scope,
      limit: req.page_size + 1,
    })
  })

  const hasMore = fetched.length > req.page_size
  const rows = hasMore ? fetched.slice(0, req.page_size) : fetched
  const nextAfterId = rows.length > 0 ? rows[rows.length - 1]!.id : null

  return {
    rows,
    next_after_id: nextAfterId,
    has_more: hasMore,
  }
}
