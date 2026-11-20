import '@tanstack/react-start/server-only'
import { and, asc, eq, isNull } from 'drizzle-orm'
import type { MasterWriter } from '~/modules/sync/public'
import type { TenantTx } from '~/server/db'
import { featureFlag } from './schema'

export interface FeatureFlagRow {
  id: string
  flagKey: string
  enabled: boolean
  params: Record<string, unknown> | null
  note: string | null
  version: number
  deletedAt: string | null
}

export async function findFeatureFlagByKey(
  tx: TenantTx,
  tenantId: string,
  flagKey: string,
): Promise<FeatureFlagRow | null> {
  const rows = await tx
    .select({
      id: featureFlag.id,
      flagKey: featureFlag.flagKey,
      enabled: featureFlag.enabled,
      params: featureFlag.params,
      note: featureFlag.note,
      version: featureFlag.version,
      deletedAt: featureFlag.deletedAt,
    })
    .from(featureFlag)
    .where(and(eq(featureFlag.tenantId, tenantId), eq(featureFlag.flagKey, flagKey)))
    .limit(1)
  return rows[0] ?? null
}

export async function listActiveFeatureFlags(
  tx: TenantTx,
  tenantId: string,
): Promise<FeatureFlagRow[]> {
  return tx
    .select({
      id: featureFlag.id,
      flagKey: featureFlag.flagKey,
      enabled: featureFlag.enabled,
      params: featureFlag.params,
      note: featureFlag.note,
      version: featureFlag.version,
      deletedAt: featureFlag.deletedAt,
    })
    .from(featureFlag)
    .where(and(eq(featureFlag.tenantId, tenantId), isNull(featureFlag.deletedAt)))
    .orderBy(asc(featureFlag.flagKey))
}

export async function upsertFeatureFlagRow(
  tx: TenantTx,
  w: MasterWriter,
  params: {
    id: string
    flagKey: string
    enabled: boolean
    params: Record<string, unknown> | null
    note: string | null
    nowIso: string
  },
): Promise<{ id: string }> {
  const rows = await tx
    .insert(featureFlag)
    .values({
      id: params.id,
      tenantId: w.tenantId,
      version: w.version,
      createdAt: params.nowIso,
      updatedAt: params.nowIso,
      createdBy: w.actorUserId,
      updatedBy: w.actorUserId,
      deletedAt: null,
      flagKey: params.flagKey,
      enabled: params.enabled,
      params: params.params,
      note: params.note,
    })
    .onConflictDoUpdate({
      target: [featureFlag.tenantId, featureFlag.flagKey],
      set: {
        enabled: params.enabled,
        params: params.params,
        note: params.note,
        deletedAt: null,
        version: w.version,
        updatedAt: params.nowIso,
        updatedBy: w.actorUserId,
      },
    })
    .returning({ id: featureFlag.id })
  return rows[0]!
}

export async function tombstoneFeatureFlagRow(
  tx: TenantTx,
  w: MasterWriter,
  flagKey: string,
  nowIso: string,
): Promise<void> {
  await tx
    .update(featureFlag)
    .set({
      deletedAt: nowIso,
      version: w.version,
      updatedAt: nowIso,
      updatedBy: w.actorUserId,
    })
    .where(
      and(
        eq(featureFlag.tenantId, w.tenantId),
        eq(featureFlag.flagKey, flagKey),
        isNull(featureFlag.deletedAt),
      ),
    )
}
