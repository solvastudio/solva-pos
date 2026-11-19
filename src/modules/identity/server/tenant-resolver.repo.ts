import '@tanstack/react-start/server-only'
import { sql } from 'drizzle-orm'
import type { NoTenantTx } from '~/server/db'

export type TenantStatus = 'ACTIVE' | 'SUSPENDED' | 'CLOSED'

export interface ResolvedTenantRow {
  id: string
  status: TenantStatus
  name: string
}

export async function callResolveTenantBySlug(
  tx: NoTenantTx,
  slug: string,
): Promise<ResolvedTenantRow | null> {
  const res = await tx.execute(
    sql`SELECT id, status, name FROM resolve_tenant_by_slug(${slug})`,
  )
  if (res.rows.length === 0) {
    return null
  }
  const row = res.rows[0] as { id: unknown; status: unknown; name: unknown }
  return {
    id: String(row.id).toLowerCase(),
    status: String(row.status) as TenantStatus,
    name: String(row.name),
  }
}
