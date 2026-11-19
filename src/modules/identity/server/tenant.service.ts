import '@tanstack/react-start/server-only'
import { z } from 'zod'
import { isUuid, validateSlug } from '~/lib/kernel'
import { appendAudit } from '~/modules/audit/public'
import { writeMaster } from '~/modules/sync/public'
import { withNoTenant, withTenant, withTenantReadOnly, type TenantTx } from '~/server/db'
import { AppError } from '~/server/error-classify'
import { identityIdGen, type IdentityServiceDeps } from './code-crypto'
import { issueInviteCore } from './invite.service'
import {
  deleteAllOrgSessions,
  findTenantDetailRow,
  insertOrganizationAndLinkTenant,
  insertTenantAndSyncRows,
  listTenantsViaDefiner,
  seedDefaultTenantMasterRows,
  updateTenantNameRow,
  updateTenantStatusRow,
  type PlatformTenantSummaryRow,
  type TenantDetailRow,
  type TenantLifecycleStatus,
} from './tenant.repo'
import { callResolveTenantBySlug } from './tenant-resolver.repo'
import { invalidateTenantCache } from './tenant-resolver.service'

export interface PlatformOperatorActor {
  platformUserId: string
  email: string
}

export interface CreateTenantInput {
  name: string
  slug: string
  ownerEmail: string
  ownerDisplayName: string
}

export interface CreateTenantResult {
  tenantId: string
  slug: string
  name: string
  ownerInvite: {
    codeId: string
    code: string
    expiresAt: string
    appUserId: string
  }
}

export interface CreateTenantDeps extends IdentityServiceDeps {
  beforeCommitInTx?: (tx: TenantTx) => Promise<void>
}

const emailSchema = z.string().trim().toLowerCase().email().max(254)

function hasControlChars(text: string): boolean {
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i)
    if (code < 0x20 || code === 0x7f) {
      return true
    }
  }
  return false
}

export function validateTenantDisplayName(raw: string): string {
  if (typeof raw !== 'string') {
    throw new AppError('VALIDATION_FAILED', 'Invalid tenant name')
  }
  const trimmed = raw.trim()
  if (trimmed.length < 1 || trimmed.length > 40 || hasControlChars(trimmed)) {
    throw new AppError('VALIDATION_FAILED', 'Tenant name must be 1-40 non-control characters')
  }
  return trimmed
}

function isPgUniqueViolation(err: unknown): boolean {
  let cur: unknown = err
  for (let i = 0; i < 4 && cur && typeof cur === 'object'; i += 1) {
    if ((cur as { code?: unknown }).code === '23505') return true
    cur = (cur as { cause?: unknown }).cause
  }
  return false
}

export async function createTenant(
  op: PlatformOperatorActor,
  input: CreateTenantInput,
  deps?: CreateTenantDeps,
): Promise<CreateTenantResult> {
  const name = validateTenantDisplayName(input.name)
  const slugCheck = validateSlug(input.slug)
  if (!slugCheck.ok) {
    throw new AppError('VALIDATION_FAILED', `Invalid tenant slug: ${slugCheck.reason}`)
  }
  const slug = slugCheck.slug

  const parsedEmail = emailSchema.safeParse(input.ownerEmail)
  if (!parsedEmail.success) {
    throw new AppError('VALIDATION_FAILED', 'Invalid owner email address')
  }
  const ownerEmail = parsedEmail.data

  const ownerDisplayName =
    typeof input.ownerDisplayName === 'string' ? input.ownerDisplayName.trim() : ''
  if (ownerDisplayName.length < 1 || ownerDisplayName.length > 80 || hasControlChars(ownerDisplayName)) {
    throw new AppError('VALIDATION_FAILED', 'Owner display name must be 1-80 characters')
  }

  const existing = await withNoTenant((tx) => callResolveTenantBySlug(tx, slug))
  if (existing) {
    throw new AppError('VALIDATION_FAILED', 'Slug is already taken')
  }

  const nowIso = (deps?.nowIso ?? (() => new Date().toISOString()))()
  const newTenantId = identityIdGen.newId()
  const orgId = identityIdGen.newId()
  const ownerAppUserId = identityIdGen.newId()

  try {
    const res = await withTenant(newTenantId, async (tx) => {
      await insertTenantAndSyncRows(tx, {
        id: newTenantId,
        name,
        slug,
        nowIso,
      })

      const masterRes = await writeMaster(tx, { actorUserId: null }, async (w) => {
        return seedDefaultTenantMasterRows(tx, w, {
          newId: () => identityIdGen.newId(),
          ownerAppUserId,
          ownerDisplayName,
          nowIso,
        })
      })

      await insertOrganizationAndLinkTenant(tx, {
        tenantId: newTenantId,
        orgId,
        name,
        slug,
        now: new Date(nowIso),
      })

      const issued = await issueInviteCore(
        tx,
        {
          tenantId: newTenantId,
          appUserId: ownerAppUserId,
          email: ownerEmail,
          issuedBy: null,
          nowIso,
        },
        deps,
      )

      await appendAudit(
        tx,
        {
          action: 'tenant.created',
          entityType: 'tenant',
          entityId: newTenantId,
          afterData: {
            slug,
            name,
            operatorId: op.platformUserId,
          },
          actorUserId: null,
          occurredAt: nowIso,
        },
        { newId: () => identityIdGen.newId(), nowIso: () => nowIso },
      )

      await appendAudit(
        tx,
        {
          action: 'member.invited',
          entityType: 'app_user',
          entityId: ownerAppUserId,
          afterData: {
            email: ownerEmail,
            roleId: masterRes.result.ownerRoleId,
            outletIds: null,
            codeId: issued.codeId,
            operatorId: op.platformUserId,
          },
          actorUserId: null,
          occurredAt: nowIso,
        },
        { newId: () => identityIdGen.newId(), nowIso: () => nowIso },
      )

      if (deps?.beforeCommitInTx) {
        await deps.beforeCommitInTx(tx)
      }

      return {
        tenantId: newTenantId,
        slug,
        name,
        ownerInvite: {
          codeId: issued.codeId,
          code: issued.code,
          expiresAt: issued.expiresAt,
          appUserId: ownerAppUserId,
        },
      }
    })

    invalidateTenantCache(slug)
    return res
  } catch (err: unknown) {
    if (isPgUniqueViolation(err)) {
      throw new AppError('VALIDATION_FAILED', 'Slug is already taken')
    }
    throw err
  }
}

export async function setTenantStatus(
  op: PlatformOperatorActor,
  tenantId: string,
  nextStatus: TenantLifecycleStatus,
  deps?: IdentityServiceDeps,
): Promise<TenantDetailRow> {
  if (!isUuid(tenantId)) {
    throw new AppError('VALIDATION_FAILED', 'Invalid tenant id')
  }
  if (nextStatus !== 'ACTIVE' && nextStatus !== 'SUSPENDED' && nextStatus !== 'CLOSED') {
    throw new AppError('VALIDATION_FAILED', 'Invalid tenant status')
  }

  const nowIso = (deps?.nowIso ?? (() => new Date().toISOString()))()

  const updated = await withTenant(tenantId, async (tx) => {
    const existing = await findTenantDetailRow(tx, tenantId)
    if (!existing) {
      throw new AppError('VALIDATION_FAILED', 'Tenant not found')
    }

    if (existing.status === 'CLOSED' && nextStatus !== 'CLOSED') {
      throw new AppError('VALIDATION_FAILED', 'Closed tenant cannot be reopened')
    }

    await writeMaster(tx, { actorUserId: null }, async (w) => {
      await updateTenantStatusRow(tx, w, nextStatus, nowIso)
      return true
    })

    if (nextStatus !== 'ACTIVE' && existing.authOrgId) {
      await deleteAllOrgSessions(tx, existing.authOrgId)
    }

    await appendAudit(
      tx,
      {
        action: 'tenant.status_changed',
        entityType: 'tenant',
        entityId: tenantId,
        beforeData: { status: existing.status },
        afterData: { status: nextStatus, operatorId: op.platformUserId },
        actorUserId: null,
        occurredAt: nowIso,
      },
      { newId: () => identityIdGen.newId(), nowIso: () => nowIso },
    )

    return {
      ...existing,
      status: nextStatus,
    }
  })

  invalidateTenantCache(updated.slug)
  return updated
}

export async function renameTenant(
  op: PlatformOperatorActor,
  tenantId: string,
  rawName: string,
  deps?: IdentityServiceDeps,
): Promise<TenantDetailRow> {
  if (!isUuid(tenantId)) {
    throw new AppError('VALIDATION_FAILED', 'Invalid tenant id')
  }
  const nextName = validateTenantDisplayName(rawName)
  const nowIso = (deps?.nowIso ?? (() => new Date().toISOString()))()

  const updated = await withTenant(tenantId, async (tx) => {
    const existing = await findTenantDetailRow(tx, tenantId)
    if (!existing) {
      throw new AppError('VALIDATION_FAILED', 'Tenant not found')
    }

    await writeMaster(tx, { actorUserId: null }, async (w) => {
      await updateTenantNameRow(tx, w, nextName, nowIso)
      return true
    })

    await appendAudit(
      tx,
      {
        action: 'tenant.renamed',
        entityType: 'tenant',
        entityId: tenantId,
        beforeData: { name: existing.name },
        afterData: { name: nextName, operatorId: op.platformUserId },
        actorUserId: null,
        occurredAt: nowIso,
      },
      { newId: () => identityIdGen.newId(), nowIso: () => nowIso },
    )

    return {
      ...existing,
      name: nextName,
    }
  })

  invalidateTenantCache(updated.slug)
  return updated
}

export async function listTenants(
  _op: PlatformOperatorActor,
): Promise<PlatformTenantSummaryRow[]> {
  return withNoTenant((tx) => listTenantsViaDefiner(tx))
}

export async function getTenantDetail(
  _op: PlatformOperatorActor,
  tenantId: string,
): Promise<TenantDetailRow | null> {
  if (!isUuid(tenantId)) {
    return null
  }
  return withTenantReadOnly(tenantId, (tx) => findTenantDetailRow(tx, tenantId))
}
