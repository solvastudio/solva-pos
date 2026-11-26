import '@tanstack/react-start/server-only'
import { businessDate, type OutletTimezone } from '~/lib/kernel'
import { appendAudit } from '~/modules/audit/public'
import { writeMaster } from '~/modules/sync/public'
import { withTenant, withTenantReadOnly } from '~/server/db'
import { AppError } from '~/server/error-classify'
import { parseOrThrow } from '~/server/parse-or-throw'
import { nowIsoFrom } from '~/server/service-deps'
import {
  changeInvoicePrefixSchema,
  createRegisterSchema,
  currentMonthFirstDay,
  nextMonthFirstDay,
  updateRegisterSchema,
  type ChangeInvoicePrefixInput,
  type CreateRegisterInput,
  type PaperWidthMm,
  type RegisterPrefixHistoryView,
  type RegisterStatus,
  type RegisterType,
  type RegisterView,
  type UpdateRegisterInput,
} from '../shared'
import {
  identityIdGen,
  requireActorPermission,
  type IdentityAuthActor,
  type IdentityServiceDeps,
} from './code-crypto'
import { findOutletById } from './outlet.repo'
import {
  findPrefixOwner,
  findRegisterById,
  findRegisterByOutletAndCode,
  insertRegisterAndPrefixRows,
  listPrefixRowsForRegisters,
  listRegistersRows,
  updateRegisterRow,
  upsertNextMonthPrefixRow,
  type RegisterDbRow,
  type RegisterPrefixDbRow,
} from './register.repo'

function buildRegisterView(
  row: RegisterDbRow,
  prefixes: readonly RegisterPrefixDbRow[],
  nowIso: string,
): RegisterView {
  const bDate = businessDate(
    nowIso,
    row.outletTimezone as OutletTimezone,
    row.outletDayCutoffTime.slice(0, 5),
  )
  const currentMonth = currentMonthFirstDay(bDate)

  let currentPrefix: string | null = null
  let pendingNextPrefix: RegisterPrefixHistoryView | null = null

  for (const p of prefixes) {
    if (p.effectiveMonth <= currentMonth) {
      currentPrefix = p.invoicePrefix
    } else if (!pendingNextPrefix) {
      pendingNextPrefix = {
        id: p.id,
        effectiveMonth: p.effectiveMonth,
        invoicePrefix: p.invoicePrefix,
      }
    }
  }

  return {
    id: row.id,
    outletId: row.outletId,
    outletCode: row.outletCode,
    outletName: row.outletName,
    code: row.code,
    name: row.name,
    status: row.status as RegisterStatus,
    registerType: row.registerType as RegisterType,
    paperWidthMm: row.paperWidthMm as PaperWidthMm,
    defaultLocale: (row.defaultLocale as 'id-ID' | 'en-US' | null) ?? null,
    currentPrefix,
    pendingNextPrefix,
    prefixHistory: prefixes.map((p) => ({
      id: p.id,
      effectiveMonth: p.effectiveMonth,
      invoicePrefix: p.invoicePrefix,
    })),
    version: row.version,
  }
}

export async function listRegisters(
  actor: IdentityAuthActor,
  deps?: IdentityServiceDeps,
): Promise<RegisterView[]> {
  requireActorPermission(actor, 'user.manage')
  const allowedOutletIds = actor.outletIds === null ? null : (actor.outletIds ?? [])
  const nowIso = nowIsoFrom(deps)

  return withTenantReadOnly(actor.tenantId, async (tx) => {
    const regs = await listRegistersRows(tx, actor.tenantId, allowedOutletIds)
    const prefixes = await listPrefixRowsForRegisters(
      tx,
      actor.tenantId,
      regs.map((r) => r.id),
    )
    const byRegister = new Map<string, RegisterPrefixDbRow[]>()
    for (const p of prefixes) {
      const list = byRegister.get(p.registerId) ?? []
      list.push(p)
      byRegister.set(p.registerId, list)
    }
    return regs.map((r) => buildRegisterView(r, byRegister.get(r.id) ?? [], nowIso))
  })
}

export async function createRegister(
  actor: IdentityAuthActor,
  rawInput: CreateRegisterInput,
  deps?: IdentityServiceDeps,
): Promise<RegisterView> {
  const parsed = parseOrThrow(createRegisterSchema, rawInput, 'Invalid register input')
  requireActorPermission(actor, 'user.manage', { outletId: parsed.outletId })

  const nowIso = nowIsoFrom(deps)
  const registerId = identityIdGen.newId()
  const prefixRowId = identityIdGen.newId()

  return withTenant(actor.tenantId, async (tx) => {
    const outletRow = await findOutletById(tx, actor.tenantId, parsed.outletId)
    if (!outletRow) {
      throw new AppError('VALIDATION_FAILED', 'Outlet not found')
    }

    const dupCode = await findRegisterByOutletAndCode(tx, actor.tenantId, parsed.outletId, parsed.code)
    if (dupCode) {
      throw new AppError('VALIDATION_FAILED', 'admin.users.register.codeTaken')
    }

    let prefixData: { id: string; effectiveMonth: string; invoicePrefix: string } | null = null
    if (parsed.registerType === 'CASHIER') {
      const prefix = parsed.invoicePrefix!.trim()
      const existingOwner = await findPrefixOwner(tx, actor.tenantId, prefix)
      if (existingOwner) {
        throw new AppError('VALIDATION_FAILED', 'admin.users.register.prefixTaken')
      }
      const bDate = businessDate(
        nowIso,
        outletRow.timezone as OutletTimezone,
        outletRow.dayCutoffTime.slice(0, 5),
      )
      prefixData = {
        id: prefixRowId,
        effectiveMonth: currentMonthFirstDay(bDate),
        invoicePrefix: prefix,
      }
    }

    const { version } = await writeMaster(tx, { actorUserId: actor.appUserId }, async (w) => {
      await insertRegisterAndPrefixRows(tx, w, {
        registerId,
        outletId: parsed.outletId,
        code: parsed.code,
        name: parsed.name,
        registerType: parsed.registerType,
        paperWidthMm: parsed.paperWidthMm,
        defaultLocale: parsed.defaultLocale ?? null,
        prefixRow: prefixData,
        nowIso,
      })
      return true
    })

    await appendAudit(
      tx,
      {
        outletId: parsed.outletId,
        action: 'register.created',
        entityType: 'cash_master',
        entityId: registerId,
        afterData: {
          code: parsed.code,
          name: parsed.name,
          registerType: parsed.registerType,
          invoicePrefix: prefixData?.invoicePrefix ?? null,
        },
        actorUserId: actor.appUserId,
        occurredAt: nowIso,
      },
      { newId: () => identityIdGen.newId(), nowIso: () => nowIso },
    )

    return {
      id: registerId,
      outletId: parsed.outletId,
      outletCode: outletRow.code,
      outletName: outletRow.name,
      code: parsed.code,
      name: parsed.name,
      status: 'ACTIVE',
      registerType: parsed.registerType,
      paperWidthMm: parsed.paperWidthMm,
      defaultLocale: parsed.defaultLocale ?? null,
      currentPrefix: prefixData?.invoicePrefix ?? null,
      pendingNextPrefix: null,
      prefixHistory: prefixData ? [prefixData] : [],
      version,
    }
  })
}

export async function updateRegister(
  actor: IdentityAuthActor,
  rawInput: UpdateRegisterInput,
  deps?: IdentityServiceDeps,
): Promise<RegisterView> {
  const parsed = parseOrThrow(updateRegisterSchema, rawInput, 'Invalid register input')
  const nowIso = nowIsoFrom(deps)

  return withTenant(actor.tenantId, async (tx) => {
    const existing = await findRegisterById(tx, actor.tenantId, parsed.id)
    if (!existing) {
      throw new AppError('VALIDATION_FAILED', 'Register not found')
    }
    requireActorPermission(actor, 'user.manage', { outletId: existing.outletId })

    if (parsed.registerType !== undefined && parsed.registerType !== existing.registerType) {
      throw new AppError('VALIDATION_FAILED', 'admin.users.register.typeLocked')
    }
    if (parsed.code !== undefined && parsed.code !== existing.code) {
      throw new AppError('VALIDATION_FAILED', 'admin.users.register.codeLocked')
    }

    const nextName = parsed.name ?? existing.name
    const nextStatus = parsed.status ?? existing.status
    const nextPaperWidth = parsed.paperWidthMm ?? existing.paperWidthMm
    const nextDefaultLocale =
      parsed.defaultLocale !== undefined ? parsed.defaultLocale : existing.defaultLocale

    const { version } = await writeMaster(tx, { actorUserId: actor.appUserId }, async (w) => {
      await updateRegisterRow(tx, w, {
        id: existing.id,
        name: nextName,
        status: nextStatus,
        paperWidthMm: nextPaperWidth,
        defaultLocale: nextDefaultLocale,
        nowIso,
      })
      return true
    })

    await appendAudit(
      tx,
      {
        outletId: existing.outletId,
        action: 'outlet.changed',
        entityType: 'cash_master',
        entityId: existing.id,
        beforeData: {
          name: existing.name,
          status: existing.status,
          paperWidthMm: existing.paperWidthMm,
          defaultLocale: existing.defaultLocale,
        },
        afterData: {
          name: nextName,
          status: nextStatus,
          paperWidthMm: nextPaperWidth,
          defaultLocale: nextDefaultLocale,
        },
        actorUserId: actor.appUserId,
        occurredAt: nowIso,
      },
      { newId: () => identityIdGen.newId(), nowIso: () => nowIso },
    )

    const prefixes = await listPrefixRowsForRegisters(tx, actor.tenantId, [existing.id])
    return buildRegisterView(
      {
        ...existing,
        name: nextName,
        status: nextStatus,
        paperWidthMm: nextPaperWidth,
        defaultLocale: nextDefaultLocale,
        version,
      },
      prefixes,
      nowIso,
    )
  })
}

export async function changeInvoicePrefix(
  actor: IdentityAuthActor,
  rawInput: ChangeInvoicePrefixInput,
  deps?: IdentityServiceDeps,
): Promise<RegisterView> {
  const parsed = parseOrThrow(changeInvoicePrefixSchema, rawInput, 'Invalid invoice prefix')
  const newPrefix = parsed.newPrefix.trim()
  const nowIso = nowIsoFrom(deps)

  return withTenant(actor.tenantId, async (tx) => {
    const existing = await findRegisterById(tx, actor.tenantId, parsed.registerId)
    if (!existing) {
      throw new AppError('VALIDATION_FAILED', 'Register not found')
    }
    requireActorPermission(actor, 'user.manage', { outletId: existing.outletId })

    if (existing.registerType !== 'CASHIER') {
      throw new AppError('VALIDATION_FAILED', 'admin.users.register.waiterNoPrefix')
    }

    const owner = await findPrefixOwner(tx, actor.tenantId, newPrefix)
    if (owner && owner.registerId !== existing.id) {
      throw new AppError('VALIDATION_FAILED', 'admin.users.register.prefixTaken')
    }

    const prefixesBefore = await listPrefixRowsForRegisters(tx, actor.tenantId, [existing.id])
    const currentView = buildRegisterView(existing, prefixesBefore, nowIso)
    if (currentView.currentPrefix === newPrefix && !currentView.pendingNextPrefix) {
      return currentView
    }
    if (currentView.pendingNextPrefix?.invoicePrefix === newPrefix) {
      return currentView
    }

    const bDate = businessDate(
      nowIso,
      existing.outletTimezone as OutletTimezone,
      existing.outletDayCutoffTime.slice(0, 5),
    )
    const nextMonth = nextMonthFirstDay(bDate)
    const newRowId = identityIdGen.newId()

    const { version } = await writeMaster(tx, { actorUserId: actor.appUserId }, async (w) => {
      await upsertNextMonthPrefixRow(tx, w, {
        newRowId,
        registerId: existing.id,
        effectiveMonth: nextMonth,
        invoicePrefix: newPrefix,
        nowIso,
      })
      return true
    })

    await appendAudit(
      tx,
      {
        outletId: existing.outletId,
        action: 'invoice_prefix.changed',
        entityType: 'cash_master',
        entityId: existing.id,
        beforeData: {
          invoicePrefix: currentView.currentPrefix,
        },
        afterData: {
          invoicePrefix: newPrefix,
          effectiveMonth: nextMonth,
        },
        actorUserId: actor.appUserId,
        occurredAt: nowIso,
      },
      { newId: () => identityIdGen.newId(), nowIso: () => nowIso },
    )

    const prefixesAfter = await listPrefixRowsForRegisters(tx, actor.tenantId, [existing.id])
    return buildRegisterView({ ...existing, version }, prefixesAfter, nowIso)
  })
}
