import '@tanstack/react-start/server-only'
import { z } from 'zod'
import { FEATURE_FLAGS, type FeatureFlagDefinition } from '~/lib/feature-flags'
import { appendAudit } from '~/modules/audit/public'
import { writeMaster } from '~/modules/sync/public'
import { withTenant, withTenantReadOnly } from '~/server/db'
import { AppError } from '~/server/error-classify'
import {
  identityIdGen,
  requireActorPermission,
  type IdentityAuthActor,
  type IdentityServiceDeps,
} from './code-crypto'
import {
  findFeatureFlagByKey,
  listActiveFeatureFlags,
  tombstoneFeatureFlagRow,
  upsertFeatureFlagRow,
  type FeatureFlagRow,
} from './feature-flag.repo'

const setFeatureFlagSchema = z.object({
  key: z.string().trim().regex(/^[a-z][a-z0-9_.]{2,63}$/),
  enabled: z.boolean(),
  params: z.record(z.string(), z.unknown()).nullable().optional(),
  note: z.string().trim().max(200).nullable().optional(),
})

export interface FeatureFlagServiceDeps extends IdentityServiceDeps {
  registry?: Readonly<Record<string, FeatureFlagDefinition>>
  newId?: () => string
}

export interface SetFeatureFlagInput {
  key: string
  enabled: boolean
  params?: Record<string, unknown> | null
  note?: string | null
}

function nowIsoFrom(deps?: IdentityServiceDeps): string {
  return (deps?.nowIso ?? (() => new Date().toISOString()))()
}

function assertKnownFlagKey(
  key: string,
  registry: Readonly<Record<string, FeatureFlagDefinition>>,
): void {
  if (!Object.hasOwn(registry, key)) {
    throw new AppError('VALIDATION_FAILED', `Unknown feature flag key: ${key}`)
  }
}

export async function listFeatureFlags(actor: IdentityAuthActor): Promise<FeatureFlagRow[]> {
  requireActorPermission(actor, 'flag.manage', { requireTenantWide: true })
  return withTenantReadOnly(actor.tenantId, async (tx) => {
    return listActiveFeatureFlags(tx, actor.tenantId)
  })
}

export async function setFeatureFlag(
  actor: IdentityAuthActor,
  rawInput: SetFeatureFlagInput,
  deps?: FeatureFlagServiceDeps,
): Promise<FeatureFlagRow> {
  requireActorPermission(actor, 'flag.manage', { requireTenantWide: true })

  const parsedRes = setFeatureFlagSchema.safeParse(rawInput)
  if (!parsedRes.success) {
    throw new AppError(
      'VALIDATION_FAILED',
      parsedRes.error.issues[0]?.message ?? 'Invalid feature flag payload',
    )
  }
  const parsed = parsedRes.data
  const registry = deps?.registry ?? FEATURE_FLAGS
  assertKnownFlagKey(parsed.key, registry)

  const nowIso = nowIsoFrom(deps)
  const nextId = (deps?.newId ?? (() => identityIdGen.newId()))()
  const cleanNote = parsed.note?.trim() || null
  const paramsObj = parsed.params ?? null

  return withTenant(actor.tenantId, async (tx) => {
    const existing = await findFeatureFlagByKey(tx, actor.tenantId, parsed.key)
    const beforeData =
      existing && existing.deletedAt === null
        ? {
            flagKey: existing.flagKey,
            enabled: existing.enabled,
            params: existing.params,
            note: existing.note,
          }
        : null

    let rowId = nextId
    const { version } = await writeMaster(tx, { actorUserId: actor.appUserId }, async (w) => {
      const res = await upsertFeatureFlagRow(tx, w, {
        id: existing?.id ?? nextId,
        flagKey: parsed.key,
        enabled: parsed.enabled,
        params: paramsObj,
        note: cleanNote,
        nowIso,
      })
      rowId = res.id
    })

    const afterData = {
      flagKey: parsed.key,
      enabled: parsed.enabled,
      params: paramsObj,
      note: cleanNote,
    }

    await appendAudit(
      tx,
      {
        action: 'feature_flag.changed',
        entityType: 'feature_flag',
        entityId: rowId,
        beforeData,
        afterData,
        actorUserId: actor.appUserId,
        occurredAt: nowIso,
      },
      { newId: deps?.newId ?? (() => identityIdGen.newId()), nowIso: () => nowIso },
    )

    return {
      id: rowId,
      flagKey: parsed.key,
      enabled: parsed.enabled,
      params: paramsObj,
      note: cleanNote,
      version,
      deletedAt: null,
    }
  })
}

export async function clearFeatureFlag(
  actor: IdentityAuthActor,
  key: string,
  deps?: FeatureFlagServiceDeps,
): Promise<{ cleared: boolean; version: number | null }> {
  requireActorPermission(actor, 'flag.manage', { requireTenantWide: true })
  const registry = deps?.registry ?? FEATURE_FLAGS
  assertKnownFlagKey(key, registry)

  const nowIso = nowIsoFrom(deps)

  return withTenant(actor.tenantId, async (tx) => {
    const existing = await findFeatureFlagByKey(tx, actor.tenantId, key)
    if (!existing || existing.deletedAt !== null) {
      return { cleared: false, version: null }
    }

    const { version } = await writeMaster(tx, { actorUserId: actor.appUserId }, async (w) => {
      await tombstoneFeatureFlagRow(tx, w, key, nowIso)
    })

    await appendAudit(
      tx,
      {
        action: 'feature_flag.changed',
        entityType: 'feature_flag',
        entityId: existing.id,
        beforeData: {
          flagKey: existing.flagKey,
          enabled: existing.enabled,
          params: existing.params,
          note: existing.note,
        },
        afterData: null,
        actorUserId: actor.appUserId,
        occurredAt: nowIso,
      },
      { newId: deps?.newId ?? (() => identityIdGen.newId()), nowIso: () => nowIso },
    )

    return { cleared: true, version }
  })
}
