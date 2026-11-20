import { AppError } from '~/server/error-classify'

export const MAX_CONCURRENT_REPORTS_PER_TENANT = 2

const activeReportsByTenant = new Map<string, number>()

export type ReleaseReportSlot = () => void

/**
 * Attempts to acquire one of the `MAX_CONCURRENT_REPORTS_PER_TENANT` (2) report slots
 * for `tenantId` (ARCHITECTURE §6.9.3). Returns an idempotent `ReleaseReportSlot` callback
 * when acquired, or `null` when 2 reports are already running for `tenantId`.
 */
export function acquireReportSlot(tenantId: string): ReleaseReportSlot | null {
  const key = tenantId.trim().toLowerCase()
  const current = activeReportsByTenant.get(key) ?? 0
  if (current >= MAX_CONCURRENT_REPORTS_PER_TENANT) {
    return null
  }
  activeReportsByTenant.set(key, current + 1)

  let released = false
  return () => {
    if (released) return
    released = true
    const after = (activeReportsByTenant.get(key) ?? 1) - 1
    if (after <= 0) {
      activeReportsByTenant.delete(key)
    } else {
      activeReportsByTenant.set(key, after)
    }
  }
}

export const acquire = acquireReportSlot

export function getActiveReportCount(tenantId: string): number {
  return activeReportsByTenant.get(tenantId.trim().toLowerCase()) ?? 0
}

export function isReportBusyError(err: unknown): boolean {
  if (err instanceof AppError) {
    return (
      err.code === 'RATE_LIMITED' &&
      (err.meta?.kind === 'REPORT_BUSY' || err.message === 'REPORT_BUSY')
    )
  }
  return false
}

/**
 * Runs `fn` inside a per-tenant report slot (max 2 concurrent per tenant).
 * Throws `AppError('RATE_LIMITED', 'REPORT_BUSY', { kind: 'REPORT_BUSY' })`
 * when no slot is available.
 */
export async function withReportSlot<T>(tenantId: string, fn: () => Promise<T>): Promise<T> {
  const release = acquireReportSlot(tenantId)
  if (!release) {
    throw new AppError('RATE_LIMITED', 'REPORT_BUSY', {
      kind: 'REPORT_BUSY',
    })
  }
  try {
    return await fn()
  } finally {
    release()
  }
}

export function __resetReportSlotsForTests(): void {
  activeReportsByTenant.clear()
}
