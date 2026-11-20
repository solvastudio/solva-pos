import '@tanstack/react-start/server-only'
import { withTenantReadOnly } from '~/server/db'
import { AppError } from '~/server/error-classify'
import type { AuditLogView, AuditQueryFilter, VerifyChainStatus } from '../shared'
import { queryAuditRows } from './audit-query.repo'
import { verifyAuditChain } from './audit.service'

export interface AuditActorContext {
  readonly tenantId: string
  readonly appUserId: string
  readonly outletIds?: readonly string[] | null
  readonly permissions: ReadonlySet<string> | readonly string[]
}

function hasAuditPermission(actor: AuditActorContext, code: string): boolean {
  return actor.permissions instanceof Set
    ? actor.permissions.has(code)
    : (actor.permissions as readonly string[]).includes(code)
}

function assertAuditViewAccess(actor: AuditActorContext, outletId?: string | null): void {
  if (!hasAuditPermission(actor, 'audit.view')) {
    throw new AppError('FORBIDDEN', 'Missing permission audit.view')
  }
  const outletIds = actor.outletIds ?? null
  if (outletId && outletIds !== null && !outletIds.includes(outletId)) {
    throw new AppError('FORBIDDEN', 'Outlet outside actor scope')
  }
}

export async function listAudit(
  actor: AuditActorContext,
  filter?: AuditQueryFilter,
): Promise<AuditLogView[]> {
  assertAuditViewAccess(actor, filter?.outletId)
  return withTenantReadOnly(actor.tenantId, (tx) =>
    queryAuditRows(tx, actor.tenantId, {
      ...filter,
      allowedOutletIds: actor.outletIds ?? null,
    }),
  )
}

const FORMULA_TRIGGER_RE = /^[=+\-@\t\r]/

/**
 * Escapes any string cell against CSV formula injection (OWASP CSV injection protection)
 * and standard RFC 4180 double-quote escaping.
 */
export function escapeCsvCell(raw: unknown): string {
  if (raw === null || raw === undefined) return ''
  let text = typeof raw === 'string' ? raw : JSON.stringify(raw)
  if (FORMULA_TRIGGER_RE.test(text)) {
    text = `'${text}`
  }
  if (/[",\n\r]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`
  }
  return text
}

export async function exportAuditCsv(
  actor: AuditActorContext,
  filter?: AuditQueryFilter,
): Promise<{ filename: string; csv: string; count: number }> {
  assertAuditViewAccess(actor, filter?.outletId)
  const rows = await withTenantReadOnly(actor.tenantId, (tx) =>
    queryAuditRows(tx, actor.tenantId, {
      ...filter,
      sort: 'asc',
      limit: 500,
      allowedOutletIds: actor.outletIds ?? null,
    }),
  )

  const header = [
    'chain_seq',
    'occurred_at',
    'outlet',
    'action',
    'actor',
    'approver',
    'entity_type',
    'entity_id',
    'reason_code',
    'reason_text',
    'before_data',
    'after_data',
  ].join(',')

  const bodyLines = rows.map((r) =>
    [
      escapeCsvCell(String(r.chainSeq)),
      escapeCsvCell(r.occurredAt),
      escapeCsvCell(r.outletName ?? r.outletId ?? ''),
      escapeCsvCell(r.action),
      escapeCsvCell(r.actorName ?? r.actorUserId ?? ''),
      escapeCsvCell(r.approverName ?? r.approverUserId ?? ''),
      escapeCsvCell(r.entityType),
      escapeCsvCell(r.entityId ?? ''),
      escapeCsvCell(r.reasonCode ?? ''),
      escapeCsvCell(r.reasonText ?? ''),
      escapeCsvCell(r.beforeData ? JSON.stringify(r.beforeData) : ''),
      escapeCsvCell(r.afterData ? JSON.stringify(r.afterData) : ''),
    ].join(','),
  )

  const csv = `${[header, ...bodyLines].join('\n')}\n`
  const datePart = new Date().toISOString().slice(0, 10)
  return {
    filename: `solva-audit-${datePart}.csv`,
    csv,
    count: rows.length,
  }
}

export async function verifyTenantAuditChain(
  actor: AuditActorContext,
): Promise<VerifyChainStatus> {
  assertAuditViewAccess(actor)
  return withTenantReadOnly(actor.tenantId, (tx) => verifyAuditChain(tx))
}
