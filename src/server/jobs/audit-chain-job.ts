import '@tanstack/react-start/server-only'
import { sql } from 'drizzle-orm'
import { verifyAuditChain, type VerifyAuditChainResult } from '~/modules/audit/public'
import { withNoTenant, withTenantReadOnly, type TenantTx } from '~/server/db'
import { createLogger } from '~/server/log'
import { getNotifier } from '~/server/notify/notifier'

const log = createLogger('jobs')

export interface AuditChainSweepDeps {
  tenantIds?: readonly string[]
  verify?: (tx: TenantTx) => Promise<VerifyAuditChainResult>
}

export interface AuditChainSweepResult {
  tenantsChecked: number
  tenantsBroken: number
}

/**
 * Verifies the audit hash chain of every active tenant and raises an alert for each broken chain
 * (ARCHITECTURE: scheduled audit-chain verification).
 *
 * shortcut: every run re-reads the whole chain of every tenant. Switch to `verifyAuditChain(tx, { fromSeq })`
 * with a stored checkpoint once a tenant has millions of audit rows.
 */
export async function verifyAuditChainsForActiveTenants(
  deps?: AuditChainSweepDeps,
): Promise<AuditChainSweepResult> {
  const verify = deps?.verify ?? verifyAuditChain
  const tenantIds =
    deps?.tenantIds ??
    (await withNoTenant(async (tx) => {
      const res = await tx.execute(sql`SELECT id FROM list_active_tenants()`)
      return res.rows.map((r) => String((r as { id: unknown }).id).toLowerCase())
    }))

  let tenantsBroken = 0
  for (const tenantId of tenantIds) {
    const result = await withTenantReadOnly(tenantId, (tx) => verify(tx))
    if (result.ok) {
      continue
    }
    tenantsBroken += 1
    log.error(
      {
        jobId: 'audit.verify_chain',
        tenantId,
        reason: `${result.reason} at chain_seq ${result.brokenAtSeq}`,
        outcome: 'REJECTED',
      },
      'audit chain verification failed',
    )
    getNotifier().notify('error_spike', { code: 'AUDIT_CHAIN_BROKEN', count: 1 })
  }

  log.info(
    {
      jobId: 'audit.verify_chain',
      rowCount: tenantIds.length,
      outcome: tenantsBroken === 0 ? 'ACK' : 'REJECTED',
    },
    'audit chain sweep completed',
  )
  return { tenantsChecked: tenantIds.length, tenantsBroken }
}
