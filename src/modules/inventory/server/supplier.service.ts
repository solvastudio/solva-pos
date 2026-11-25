import '@tanstack/react-start/server-only'
import { and, asc, eq, isNull, sql } from 'drizzle-orm'
import { createIdGenerator, isUuid } from '~/lib/kernel'
import { requireActorPermission, type IdentityAuthActor } from '~/modules/identity/public'
import { AppError } from '~/server/error-classify'
import { withTenant } from '~/server/db'
import { supplier as supplierTable } from './schema'

/**
 * Suppliers (simple CRUD). `name ≤ 120`, unique regardless of case among active rows;
 * `contact ≤ 200`. Delete = soft-delete: old GRs still point to this row, so the FK stays valid.
 */

const idGen = createIdGenerator({
  nowMs: () => Date.now(),
  nextUint32: () => {
    const b = new Uint32Array(1)
    globalThis.crypto.getRandomValues(b)
    return b[0]!
  },
})

export interface SupplierRow {
  readonly id: string
  readonly name: string
  readonly contact: string | null
  readonly active: boolean
}

export interface SupplierInput {
  readonly id?: string
  readonly name: string
  readonly contact?: string | null
}

function normalize(input: SupplierInput): { name: string; contact: string | null } {
  const name = input.name.trim()
  if (name.length === 0 || name.length > 120) {
    throw new AppError('VALIDATION_FAILED', 'admin.stock.err.supplierNameRequired')
  }
  const contact = input.contact?.trim() ? input.contact.trim() : null
  if (contact && contact.length > 200) {
    throw new AppError('VALIDATION_FAILED', 'admin.stock.err.supplierContactMax')
  }
  return { name, contact }
}

export async function listSuppliers(actor: IdentityAuthActor, opts: { includeInactive?: boolean } = {}): Promise<SupplierRow[]> {
  requireActorPermission(actor, 'inventory.manage')
  return withTenant(actor.tenantId, async (tx) => {
    const rows = await tx
      .select({ id: supplierTable.id, name: supplierTable.name, contact: supplierTable.contact, deletedAt: supplierTable.deletedAt })
      .from(supplierTable)
      .where(
        and(
          eq(supplierTable.tenantId, actor.tenantId),
          opts.includeInactive ? sql`true` : isNull(supplierTable.deletedAt),
        ),
      )
      .orderBy(asc(supplierTable.name), asc(supplierTable.id))
    return rows.map((r) => ({ id: r.id, name: r.name, contact: r.contact, active: r.deletedAt === null }))
  })
}

export async function saveSupplier(actor: IdentityAuthActor, input: SupplierInput): Promise<{ id: string }> {
  requireActorPermission(actor, 'inventory.manage')
  const data = normalize(input)
  if (input.id !== undefined && !isUuid(input.id)) throw new AppError('VALIDATION_FAILED', 'admin.stock.err.supplierInvalid')
  return withTenant(actor.tenantId, async (tx) => {
    // Unique lower(name) among active rows (matches the partial index uq_supplier__tenant_name).
    const dup = await tx.execute<{ id: string }>(sql`
      SELECT id FROM supplier
      WHERE tenant_id = ${actor.tenantId}::uuid AND deleted_at IS NULL
        AND lower(name) = lower(${data.name})
        AND (${input.id ?? null}::uuid IS NULL OR id <> ${input.id ?? null}::uuid)
      LIMIT 1`)
    if (dup.rows.length > 0) throw new AppError('VALIDATION_FAILED', 'admin.stock.err.supplierNameTaken')

    const now = new Date().toISOString()
    if (input.id) {
      const res = await tx
        .update(supplierTable)
        .set({ name: data.name, contact: data.contact, updatedAt: now, updatedBy: actor.appUserId })
        .where(and(eq(supplierTable.tenantId, actor.tenantId), eq(supplierTable.id, input.id), isNull(supplierTable.deletedAt)))
        .returning({ id: supplierTable.id })
      if (res.length === 0) throw new AppError('VALIDATION_FAILED', 'admin.stock.err.supplierNotFound')
      return { id: input.id }
    }
    const id = idGen.newId()
    await tx.insert(supplierTable).values({
      id,
      tenantId: actor.tenantId,
      name: data.name,
      contact: data.contact,
      createdBy: actor.appUserId,
      updatedBy: actor.appUserId,
    })
    return { id }
  })
}

export async function deleteSupplier(actor: IdentityAuthActor, id: string): Promise<void> {
  requireActorPermission(actor, 'inventory.manage')
  if (!isUuid(id)) throw new AppError('VALIDATION_FAILED', 'admin.stock.err.supplierInvalid')
  return withTenant(actor.tenantId, async (tx) => {
    const res = await tx
      .update(supplierTable)
      .set({ deletedAt: new Date().toISOString(), updatedBy: actor.appUserId })
      .where(and(eq(supplierTable.tenantId, actor.tenantId), eq(supplierTable.id, id), isNull(supplierTable.deletedAt)))
      .returning({ id: supplierTable.id })
    if (res.length === 0) throw new AppError('VALIDATION_FAILED', 'admin.stock.err.supplierNotFound')
  })
}
