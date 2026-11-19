import { expect } from 'vitest'
import type { Client } from 'pg'

export const GLOBAL_TABLES = new Set([
  'permission',
  'app_release',
  'user',
  'session',
  'account',
  'verification',
  'organization',
  'member',
  'invitation',
])

export interface CatalogTableInfo {
  tableName: string
  hasTenantId: boolean
  hasVersion: boolean
  rlsEnabled: boolean
  rlsForced: boolean
  policyCount: number
  hasVersionGuardTrigger: boolean
}

export async function inspectPublicRlsCatalog(client: Client): Promise<CatalogTableInfo[]> {
  const res = await client.query<{
    table_name: string
    has_tenant_id: boolean
    has_version: boolean
    rls_enabled: boolean
    rls_forced: boolean
    policy_count: number
    has_version_guard_trigger: boolean
  }>(`
    SELECT
      c.relname AS table_name,
      EXISTS (
        SELECT 1
        FROM pg_attribute a
        WHERE a.attrelid = c.oid
          AND a.attname = 'tenant_id'
          AND NOT a.attisdropped
      ) AS has_tenant_id,
      EXISTS (
        SELECT 1
        FROM pg_attribute a
        WHERE a.attrelid = c.oid
          AND a.attname = 'version'
          AND NOT a.attisdropped
      ) AS has_version,
      c.relrowsecurity AS rls_enabled,
      c.relforcerowsecurity AS rls_forced,
      (
        SELECT count(*)::int
        FROM pg_policies p
        WHERE p.schemaname = 'public' AND p.tablename = c.relname
      ) AS policy_count,
      EXISTS (
        SELECT 1
        FROM pg_trigger t
        WHERE t.tgrelid = c.oid
          AND t.tgname = 'master_version_guard'
          AND NOT t.tgisinternal
      ) AS has_version_guard_trigger
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind IN ('r', 'p')
    ORDER BY c.relname
  `)

  return res.rows.map((row) => ({
    tableName: row.table_name,
    hasTenantId: row.has_tenant_id,
    hasVersion: row.has_version,
    rlsEnabled: row.rls_enabled,
    rlsForced: row.rls_forced,
    policyCount: row.policy_count,
    hasVersionGuardTrigger: row.has_version_guard_trigger,
  }))
}

export async function assertAllTenantTablesProtected(client: Client): Promise<number> {
  const tables = await inspectPublicRlsCatalog(client)
  let checkedTenantTables = 0

  for (const tbl of tables) {
    if (GLOBAL_TABLES.has(tbl.tableName)) {
      expect(tbl.hasTenantId, `Global table "${tbl.tableName}" must not have tenant_id`).toBe(false)
      continue
    }

    if (tbl.hasTenantId || tbl.tableName === 'tenant') {
      checkedTenantTables += 1
      expect(tbl.rlsEnabled, `Table "${tbl.tableName}" must enable RLS`).toBe(true)
      expect(tbl.rlsForced, `Table "${tbl.tableName}" must FORCE RLS`).toBe(true)
      expect(tbl.policyCount, `Table "${tbl.tableName}" must have >= 1 RLS policy`).toBeGreaterThanOrEqual(1)
    }

    if (tbl.hasVersion && tbl.tableName !== 'tenant' && tbl.tableName !== 'tenant_sync') {
      expect(
        tbl.hasVersionGuardTrigger,
        `Class M table "${tbl.tableName}" must have master_version_guard trigger`,
      ).toBe(true)
    }
  }

  return checkedTenantTables
}
