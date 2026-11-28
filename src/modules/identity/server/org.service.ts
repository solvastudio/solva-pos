import '@tanstack/react-start/server-only'
import { appendAudit } from '~/modules/audit/public'
import { writeMaster, type MasterWriter } from '~/modules/sync/public'
import { withTenant, withTenantReadOnly, type TenantTx } from '~/server/db'
import { AppError } from '~/server/error-classify'
import { parseOrThrow } from '~/server/parse-or-throw'
import { nowIsoFrom } from '~/server/service-deps'
import type { OutletTimezoneValue } from '../shared'
import {
  createOutletSchema,
  legalEntityFormSchema,
  normalizeNpwpInput,
  updateLegalEntitySchema,
  updateOutletSchema,
  type CreateLegalEntityInput,
  type CreateOutletInput,
  type LegalEntityView,
  type OutletView,
  type PriceTaxMode,
  type TaxProfile,
  type UpdateLegalEntityInput,
  type UpdateOutletInput,
} from '../shared'
import {
  identityIdGen,
  requireActorAnyPermission,
  requireActorPermission,
  type IdentityAuthActor,
  type IdentityServiceDeps,
} from './code-crypto'
import {
  findLegalEntityById,
  findLegalEntityByNpwp,
  hasPpnOutletForLegalEntity,
  insertLegalEntityRow,
  listLegalEntitiesRows,
  updateLegalEntityRow,
} from './legal-entity.repo'
import {
  findOutletByCode,
  findOutletById,
  insertOutletAndReceiptSettingRows,
  listOutletsRows,
  updateOutletRow,
} from './outlet.repo'

export type OutletCreatedHook = (
  tx: TenantTx,
  writer: MasterWriter,
  outlet: OutletView,
) => Promise<void>

const outletCreatedHooks: OutletCreatedHook[] = []

/**
 * Registers a hook invoked inside the same `writeMaster` transaction when an outlet is created.
 * Reserved for catalog module default outlet availability seeding in later phases.
 */
export function registerOutletCreatedHook(hook: OutletCreatedHook): void {
  if (!outletCreatedHooks.includes(hook)) {
    outletCreatedHooks.push(hook)
  }
}

/**
 * Clears registered outlet-created hooks (test cleanup only).
 */
export function __clearOutletCreatedHooksForTests(): void {
  outletCreatedHooks.length = 0
}

function toOutletAuditSnapshot(o: OutletView): Record<string, unknown> {
  return {
    id: o.id,
    legalEntityId: o.legalEntityId,
    code: o.code,
    name: o.name,
    timezone: o.timezone,
    dayCutoffTime: o.dayCutoffTime,
    priceTaxMode: o.priceTaxMode,
    taxProfile: o.taxProfile,
    isActive: o.isActive,
    hasAddress: Boolean(o.address),
    hasContactNumber: Boolean(o.phone),
  }
}

function toOutletView(row: {
  id: string
  legalEntityId: string
  legalEntityName: string
  code: string
  name: string
  address: string | null
  phone: string | null
  timezone: string
  dayCutoffTime: string
  priceTaxMode: string
  taxProfile: string
  isActive: boolean
  version: number
}): OutletView {
  return {
    id: row.id,
    legalEntityId: row.legalEntityId,
    legalEntityName: row.legalEntityName,
    code: row.code,
    name: row.name,
    address: row.address,
    phone: row.phone,
    timezone: row.timezone as OutletTimezoneValue,
    // Normalize Postgres TIME `HH:MM:SS` to `HH:MM`.
    dayCutoffTime: row.dayCutoffTime.slice(0, 5),
    priceTaxMode: row.priceTaxMode as PriceTaxMode,
    taxProfile: row.taxProfile as TaxProfile,
    isActive: row.isActive,
    version: row.version,
  }
}

export async function listLegalEntities(actor: IdentityAuthActor): Promise<LegalEntityView[]> {
  requireActorAnyPermission(actor, ['user.manage', 'org.manage'])
  return withTenantReadOnly(actor.tenantId, async (tx) => {
    const entities = await listLegalEntitiesRows(tx, actor.tenantId)
    if (actor.outletIds === null) {
      return entities
    }
    const allowedOutlets = await listOutletsRows(tx, actor.tenantId, actor.outletIds ?? [])
    const allowedEntityIds = new Set(allowedOutlets.map((o) => o.legalEntityId))
    return entities.filter((e) => allowedEntityIds.has(e.id))
  })
}

export async function createLegalEntity(
  actor: IdentityAuthActor,
  rawInput: CreateLegalEntityInput,
  deps?: IdentityServiceDeps,
): Promise<LegalEntityView> {
  requireActorPermission(actor, 'org.manage', { requireTenantWide: true })
  const cleanRaw: CreateLegalEntityInput = {
    ...rawInput,
    npwp: rawInput.npwp ? normalizeNpwpInput(rawInput.npwp) || null : null,
  }
  const parsed = parseOrThrow(legalEntityFormSchema, cleanRaw, 'Invalid legal entity input')
  const npwp = parsed.npwp ?? null
  const pkpSince = parsed.isPkp ? (parsed.pkpSince ?? null) : null
  const address = parsed.address?.trim() || null
  const nowIso = nowIsoFrom(deps)
  const id = identityIdGen.newId()

  return withTenant(actor.tenantId, async (tx) => {
    if (npwp) {
      const dup = await findLegalEntityByNpwp(tx, actor.tenantId, npwp)
      if (dup) {
        throw new AppError('VALIDATION_FAILED', 'admin.settings.legalEntity.npwpTaken')
      }
    }

    const { version } = await writeMaster(tx, { actorUserId: actor.appUserId }, async (w) => {
      await insertLegalEntityRow(tx, w, {
        id,
        name: parsed.name,
        npwp,
        isPkp: parsed.isPkp,
        pkpSince,
        address,
        nowIso,
      })
      return true
    })

    const created: LegalEntityView = {
      id,
      name: parsed.name,
      npwp,
      isPkp: parsed.isPkp,
      pkpSince,
      address,
      version,
    }

    await appendAudit(
      tx,
      {
        action: 'outlet.changed',
        entityType: 'legal_entity',
        entityId: id,
        afterData: { ...created },
        actorUserId: actor.appUserId,
        occurredAt: nowIso,
      },
      { newId: () => identityIdGen.newId(), nowIso: () => nowIso },
    )

    return created
  })
}

export async function updateLegalEntity(
  actor: IdentityAuthActor,
  rawInput: UpdateLegalEntityInput,
  deps?: IdentityServiceDeps,
): Promise<LegalEntityView> {
  requireActorPermission(actor, 'org.manage', { requireTenantWide: true })
  const cleanRaw: UpdateLegalEntityInput = {
    ...rawInput,
    npwp: rawInput.npwp ? normalizeNpwpInput(rawInput.npwp) || null : null,
  }
  const parsed = parseOrThrow(updateLegalEntitySchema, cleanRaw, 'Invalid legal entity input')
  const npwp = parsed.npwp ?? null
  const pkpSince = parsed.isPkp ? (parsed.pkpSince ?? null) : null
  const address = parsed.address?.trim() || null
  const nowIso = nowIsoFrom(deps)

  return withTenant(actor.tenantId, async (tx) => {
    const existing = await findLegalEntityById(tx, actor.tenantId, parsed.id)
    if (!existing) {
      throw new AppError('VALIDATION_FAILED', 'Legal entity not found')
    }

    if (!parsed.isPkp && existing.isPkp) {
      const hasPpn = await hasPpnOutletForLegalEntity(tx, actor.tenantId, parsed.id)
      if (hasPpn) {
        throw new AppError('VALIDATION_FAILED', 'admin.settings.legalEntity.pkpInUseByPpnOutlet')
      }
    }

    if (npwp) {
      const dup = await findLegalEntityByNpwp(tx, actor.tenantId, npwp, parsed.id)
      if (dup) {
        throw new AppError('VALIDATION_FAILED', 'admin.settings.legalEntity.npwpTaken')
      }
    }

    const { version } = await writeMaster(tx, { actorUserId: actor.appUserId }, async (w) => {
      await updateLegalEntityRow(tx, w, {
        id: parsed.id,
        name: parsed.name,
        npwp,
        isPkp: parsed.isPkp,
        pkpSince,
        address,
        nowIso,
      })
      return true
    })

    const updated: LegalEntityView = {
      id: parsed.id,
      name: parsed.name,
      npwp,
      isPkp: parsed.isPkp,
      pkpSince,
      address,
      version,
    }

    await appendAudit(
      tx,
      {
        action: 'outlet.changed',
        entityType: 'legal_entity',
        entityId: parsed.id,
        beforeData: { ...existing },
        afterData: { ...updated },
        actorUserId: actor.appUserId,
        occurredAt: nowIso,
      },
      { newId: () => identityIdGen.newId(), nowIso: () => nowIso },
    )

    return updated
  })
}

export async function listOutlets(actor: IdentityAuthActor): Promise<OutletView[]> {
  requireActorAnyPermission(actor, ['user.manage', 'org.manage'])
  const allowedOutletIds = actor.outletIds === null ? null : (actor.outletIds ?? [])
  return withTenantReadOnly(actor.tenantId, async (tx) => {
    const rows = await listOutletsRows(tx, actor.tenantId, allowedOutletIds)
    return rows.map(toOutletView)
  })
}

export async function createOutlet(
  actor: IdentityAuthActor,
  rawInput: CreateOutletInput,
  deps?: IdentityServiceDeps,
): Promise<OutletView> {
  requireActorPermission(actor, 'org.manage', { requireTenantWide: true })
  const parsed = parseOrThrow(createOutletSchema, rawInput, 'Invalid outlet input')
  const nowIso = nowIsoFrom(deps)
  const outletId = identityIdGen.newId()
  const receiptSettingId = identityIdGen.newId()
  const address = parsed.address?.trim() || null
  const phone = parsed.phone?.trim() || null

  return withTenant(actor.tenantId, async (tx) => {
    const entity = await findLegalEntityById(tx, actor.tenantId, parsed.legalEntityId)
    if (!entity) {
      throw new AppError('VALIDATION_FAILED', 'Legal entity not found')
    }
    if (parsed.taxProfile === 'PPN' && !entity.isPkp) {
      throw new AppError('VALIDATION_FAILED', 'admin.settings.outlet.ppnRequiresPkp')
    }

    const dupCode = await findOutletByCode(tx, actor.tenantId, parsed.code)
    if (dupCode) {
      throw new AppError('VALIDATION_FAILED', 'admin.settings.outlet.codeTaken')
    }

    const { version } = await writeMaster(tx, { actorUserId: actor.appUserId }, async (w) => {
      await insertOutletAndReceiptSettingRows(tx, w, {
        outletId,
        receiptSettingId,
        legalEntityId: parsed.legalEntityId,
        code: parsed.code,
        name: parsed.name,
        address,
        phone,
        timezone: parsed.timezone,
        dayCutoffTime: parsed.dayCutoffTime,
        priceTaxMode: parsed.priceTaxMode,
        taxProfile: parsed.taxProfile,
        nowIso,
      })

      const createdOutlet: OutletView = {
        id: outletId,
        legalEntityId: parsed.legalEntityId,
        legalEntityName: entity.name,
        code: parsed.code,
        name: parsed.name,
        address,
        phone,
        timezone: parsed.timezone,
        dayCutoffTime: parsed.dayCutoffTime,
        priceTaxMode: parsed.priceTaxMode,
        taxProfile: parsed.taxProfile,
        isActive: true,
        version: w.version,
      }

      for (const hook of outletCreatedHooks) {
        await hook(tx, w, createdOutlet)
      }

      return createdOutlet
    })

    const createdView: OutletView = {
      id: outletId,
      legalEntityId: parsed.legalEntityId,
      legalEntityName: entity.name,
      code: parsed.code,
      name: parsed.name,
      address,
      phone,
      timezone: parsed.timezone,
      dayCutoffTime: parsed.dayCutoffTime,
      priceTaxMode: parsed.priceTaxMode,
      taxProfile: parsed.taxProfile,
      isActive: true,
      version,
    }

    await appendAudit(
      tx,
      {
        outletId,
        action: 'outlet.changed',
        entityType: 'outlet',
        entityId: outletId,
        afterData: toOutletAuditSnapshot(createdView),
        actorUserId: actor.appUserId,
        occurredAt: nowIso,
      },
      { newId: () => identityIdGen.newId(), nowIso: () => nowIso },
    )

    return createdView
  })
}

export async function updateOutlet(
  actor: IdentityAuthActor,
  rawInput: UpdateOutletInput,
  deps?: IdentityServiceDeps,
): Promise<OutletView> {
  const parsed = parseOrThrow(updateOutletSchema, rawInput, 'Invalid outlet input')
  requireActorPermission(actor, 'org.manage', { outletId: parsed.id })
  const nowIso = nowIsoFrom(deps)

  return withTenant(actor.tenantId, async (tx) => {
    const existingRow = await findOutletById(tx, actor.tenantId, parsed.id)
    if (!existingRow) {
      throw new AppError('VALIDATION_FAILED', 'Outlet not found')
    }
    if (parsed.code !== undefined && parsed.code !== existingRow.code) {
      throw new AppError('VALIDATION_FAILED', 'admin.settings.outlet.codeLocked')
    }

    const before = toOutletView(existingRow)
    const nextName = parsed.name ?? before.name
    const nextAddress = parsed.address !== undefined ? parsed.address?.trim() || null : before.address
    const nextPhone = parsed.phone !== undefined ? parsed.phone?.trim() || null : before.phone
    const nextTimezone = parsed.timezone ?? before.timezone
    const nextCutoff = parsed.dayCutoffTime ?? before.dayCutoffTime
    const nextActive = parsed.isActive ?? before.isActive

    const { version } = await writeMaster(tx, { actorUserId: actor.appUserId }, async (w) => {
      await updateOutletRow(tx, w, {
        id: parsed.id,
        name: nextName,
        address: nextAddress,
        phone: nextPhone,
        timezone: nextTimezone,
        dayCutoffTime: nextCutoff,
        isActive: nextActive,
        nowIso,
      })
      return true
    })

    const after: OutletView = {
      ...before,
      name: nextName,
      address: nextAddress,
      phone: nextPhone,
      timezone: nextTimezone,
      dayCutoffTime: nextCutoff,
      isActive: nextActive,
      version,
    }

    await appendAudit(
      tx,
      {
        outletId: parsed.id,
        action: 'outlet.changed',
        entityType: 'outlet',
        entityId: parsed.id,
        beforeData: toOutletAuditSnapshot(before),
        afterData: toOutletAuditSnapshot(after),
        actorUserId: actor.appUserId,
        occurredAt: nowIso,
      },
      { newId: () => identityIdGen.newId(), nowIso: () => nowIso },
    )

    return after
  })
}
