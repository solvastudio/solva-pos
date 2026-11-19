import { sql } from 'drizzle-orm'
import { afterAll, describe, expect, it } from 'vitest'
import { closePools } from '~/server/db'
import { ownerClient, withClient } from './helpers/db'
import { createTestTenant, uniqueSlug, withTestTenant } from './helpers/tenants'

const IDENTITY_TENANT_TABLES = [
  'legal_entity',
  'outlet',
  'tax_rate_history',
  'cash_master',
  'register_invoice_prefix',
  'outlet_receipt_setting',
  'payment_method',
  'app_user',
  'role',
  'role_permission',
  'user_outlet',
] as const

describe('identity RLS isolation and composite tenant foreign keys', () => {
  afterAll(async () => {
    await closePools()
  })

  it('isolates all 11 tenant-scoped identity tables under tenant A context', async () => {
    const tenantA = await createTestTenant(uniqueSlug('ida'))
    const tenantB = await createTestTenant(uniqueSlug('idb'))

    // Seed one representative row in tenant B
    const bIds = await withClient(ownerClient, async (client) => {
      await client.query('BEGIN')
      try {
        await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantB.id])
        const leId = (
          await client.query<{ id: string }>(
            `INSERT INTO legal_entity (tenant_id, version, name) VALUES ($1, 1, 'Entity B') RETURNING id`,
            [tenantB.id],
          )
        ).rows[0]!.id
        const outletId = (
          await client.query<{ id: string }>(
            `INSERT INTO outlet (tenant_id, version, legal_entity_id, code, name, price_tax_mode)
             VALUES ($1, 1, $2, 'OUTB', 'Outlet B', 'INCLUSIVE') RETURNING id`,
            [tenantB.id, leId],
          )
        ).rows[0]!.id
        await client.query(
          `INSERT INTO tax_rate_history (tenant_id, version, tax_code, effective_from, rate)
           VALUES ($1, 1, 'PB1', '2026-01-01', 10)`,
          [tenantB.id],
        )
        const regId = (
          await client.query<{ id: string }>(
            `INSERT INTO cash_master (tenant_id, version, outlet_id, code, name)
             VALUES ($1, 1, $2, 'POSB', 'POS B') RETURNING id`,
            [tenantB.id, outletId],
          )
        ).rows[0]!.id
        await client.query(
          `INSERT INTO register_invoice_prefix (tenant_id, version, register_id, effective_month, invoice_prefix)
           VALUES ($1, 1, $2, '2026-11-01', 'POSB')`,
          [tenantB.id, regId],
        )
        await client.query(
          `INSERT INTO outlet_receipt_setting (tenant_id, version, outlet_id) VALUES ($1, 1, $2)`,
          [tenantB.id, outletId],
        )
        await client.query(
          `INSERT INTO payment_method (tenant_id, version, code, name, kind) VALUES ($1, 1, 'CASH', 'Cash B', 'CASH')`,
          [tenantB.id],
        )
        const userId = (
          await client.query<{ id: string }>(
            `INSERT INTO app_user (tenant_id, version, display_name) VALUES ($1, 1, 'Bob B') RETURNING id`,
            [tenantB.id],
          )
        ).rows[0]!.id
        const roleId = (
          await client.query<{ id: string }>(
            `INSERT INTO role (tenant_id, version, code, name) VALUES ($1, 1, 'CASHIER', 'Cashier B') RETURNING id`,
            [tenantB.id],
          )
        ).rows[0]!.id
        await client.query(
          `INSERT INTO role_permission (tenant_id, version, role_id, permission_code)
           VALUES ($1, 1, $2, 'sale.create')`,
          [tenantB.id, roleId],
        )
        await client.query(
          `INSERT INTO user_outlet (tenant_id, version, user_id, outlet_id, role_id)
           VALUES ($1, 1, $2, $3, $4)`,
          [tenantB.id, userId, outletId, roleId],
        )
        await client.query('COMMIT')
        return { leId }
      } catch (err) {
        await client.query('ROLLBACK')
        throw err
      }
    })

    await withTestTenant(tenantA.id, async (tx) => {
      for (const table of IDENTITY_TENANT_TABLES) {
        const res = await tx.execute(sql.raw(`SELECT count(*)::int AS cnt FROM "${table}"`))
        expect(res.rows[0], `Tenant A should see 0 rows in ${table}`).toMatchObject({ cnt: 0 })
      }
    })

    // Writing with tenant B id fails RLS WITH CHECK
    await expect(
      withTestTenant(tenantA.id, async (tx) => {
        await tx.execute(
          sql`INSERT INTO legal_entity (tenant_id, version, name) VALUES (${tenantB.id}::uuid, 1, 'Cross')`,
        )
      }),
    ).rejects.toMatchObject({ cause: { code: '42501' } })

    // Composite FK rejects referencing tenant B legal_entity from tenant A outlet
    await expect(
      withTestTenant(tenantA.id, async (tx) => {
        await tx.execute(
          sql`INSERT INTO outlet (tenant_id, version, legal_entity_id, code, name, price_tax_mode)
              VALUES (${tenantA.id}::uuid, 1, ${bIds.leId}::uuid, 'OUTA', 'Cross FK', 'INCLUSIVE')`,
        )
      }),
    ).rejects.toMatchObject({ cause: { code: '23503' } })
  })
})
