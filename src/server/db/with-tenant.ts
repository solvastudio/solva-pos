import '@tanstack/react-start/server-only'
import { sql } from 'drizzle-orm'
import { isUuid } from '~/lib/kernel'
import { AppError } from '../error-classify'
import { clearAfterCommit, runAfterCommit } from './after-commit'
import { getDb } from './pool'
import type { NoTenantTx, TenantTx } from './tenant-tx'

export interface TxOptions {
  readOnly?: boolean
  repeatableRead?: boolean
  statementTimeoutMs?: number
  lockTimeoutMs?: number
}

const DEFAULT_STATEMENT_TIMEOUT_MS = 15_000
const DEFAULT_LOCK_TIMEOUT_MS = 5_000
const IDLE_IN_TX_TIMEOUT_MS = 30_000

function validateTimeoutMs(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new AppError('VALIDATION_FAILED', `Invalid ${label}: ${value}`)
  }
  return value
}

export async function withTenant<T>(
  tenantId: string,
  fn: (tx: TenantTx) => Promise<T>,
  opts?: TxOptions,
): Promise<T> {
  if (!isUuid(tenantId)) {
    throw new AppError('FORBIDDEN', 'Invalid tenant context')
  }

  const statementTimeoutMs = validateTimeoutMs(
    opts?.statementTimeoutMs ?? DEFAULT_STATEMENT_TIMEOUT_MS,
    'statementTimeoutMs',
  )
  const lockTimeoutMs = validateTimeoutMs(
    opts?.lockTimeoutMs ?? DEFAULT_LOCK_TIMEOUT_MS,
    'lockTimeoutMs',
  )

  let capturedTx: object | null = null
  let result: T
  try {
    result = await getDb().transaction(
      async (tx) => {
        capturedTx = tx
        await tx.execute(sql`SELECT set_config('app.tenant_id', ${tenantId}, true)`)
        await tx.execute(
          sql`SELECT set_config('statement_timeout', ${String(statementTimeoutMs)}, true), set_config('lock_timeout', ${String(lockTimeoutMs)}, true), set_config('idle_in_transaction_session_timeout', ${String(IDLE_IN_TX_TIMEOUT_MS)}, true)`,
        )
        return fn(tx as TenantTx)
      },
      {
        isolationLevel: opts?.repeatableRead ? 'repeatable read' : undefined,
        accessMode: opts?.readOnly ? 'read only' : undefined,
      },
    )
  } catch (err) {
    if (capturedTx) {
      clearAfterCommit(capturedTx)
    }
    throw err
  }

  if (capturedTx) {
    await runAfterCommit(capturedTx)
  }
  return result
}

/** Execute a read-only REPEATABLE READ transaction scoped to a tenant (used for pull sync, AD-07). */
export function withTenantReadOnly<T>(
  tenantId: string,
  fn: (tx: TenantTx) => Promise<T>,
  opts?: Omit<TxOptions, 'readOnly' | 'repeatableRead'>,
): Promise<T> {
  return withTenant(tenantId, fn, { ...opts, readOnly: true, repeatableRead: true })
}

/**
 * Transaction without `app.tenant_id` context.
 * ONLY for cross-tenant SECURITY DEFINER calls in `modules/identity` and `modules/sync`.
 */
export function withNoTenant<T>(fn: (tx: NoTenantTx) => Promise<T>): Promise<T> {
  return getDb().transaction(async (tx) => {
    await tx.execute(
      sql`SELECT set_config('statement_timeout', ${String(DEFAULT_STATEMENT_TIMEOUT_MS)}, true), set_config('lock_timeout', ${String(DEFAULT_LOCK_TIMEOUT_MS)}, true), set_config('idle_in_transaction_session_timeout', ${String(IDLE_IN_TX_TIMEOUT_MS)}, true)`,
    )
    return fn(tx as NoTenantTx)
  })
}
