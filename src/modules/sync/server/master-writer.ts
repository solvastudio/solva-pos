import '@tanstack/react-start/server-only'
import { sql } from 'drizzle-orm'
import { parseSafeBigint, registerAfterCommit, type TenantTx } from '~/server/db'
import { AppError } from '~/server/error-classify'
import { publishMasterChanged } from './signals'

export interface MasterWriteContext {
  actorUserId: string | null
}

export interface MasterWriter {
  readonly version: number
  readonly tenantId: string
  readonly actorUserId: string | null
}

const usedTransactions = new WeakSet<object>()

/**
 * Single-door master writer (BR-SYN-010 / BR-ARC-006).
 * Atomically bumps `tenant_sync.version` under row lock, stamps rows via `w.version`,
 * and publishes a post-commit master-changed signal.
 */
export async function writeMaster<T>(
  tx: TenantTx,
  ctx: MasterWriteContext,
  fn: (w: MasterWriter) => Promise<T>,
): Promise<{ result: T; version: number }> {
  if (usedTransactions.has(tx)) {
    throw new Error('writeMaster called twice in the same transaction')
  }
  usedTransactions.add(tx)

  const res = await tx.execute(
    sql`UPDATE tenant_sync
        SET version = version + 1, updated_at = now()
        WHERE tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
        RETURNING tenant_id, version`,
  )

  if (res.rows.length !== 1) {
    throw new AppError('INTERNAL_ERROR', 'Missing tenant_sync row for tenant context')
  }

  const row = res.rows[0] as { tenant_id: unknown; version: unknown }
  const version = parseSafeBigint(row.version)
  const tenantId = String(row.tenant_id).toLowerCase()

  const writer: MasterWriter = {
    version,
    tenantId,
    actorUserId: ctx.actorUserId,
  }

  const result = await fn(writer)
  registerAfterCommit(tx, () => publishMasterChanged(tenantId, version))
  return { result, version }
}
