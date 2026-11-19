import type { Client } from 'pg'
import { describe, expect, it } from 'vitest'
import { masterTx } from './helpers/master'
import { createTestTenant, uniqueSlug } from './helpers/tenants'

async function runInSavepoint<T>(client: Client, fn: () => Promise<T>): Promise<T> {
  await client.query('SAVEPOINT sp_test')
  try {
    const res = await fn()
    await client.query('RELEASE SAVEPOINT sp_test')
    return res
  } catch (err) {
    await client.query('ROLLBACK TO SAVEPOINT sp_test')
    await client.query('RELEASE SAVEPOINT sp_test')
    throw err
  }
}

async function seedLegalEntity(
  client: Client,
  tenantId: string,
  version: number,
  isPkp: boolean,
): Promise<string> {
  const npwp = isPkp ? '0123456789012345' : null
  const res = await client.query<{ id: string }>(
    'INSERT INTO legal_entity (tenant_id, version, name, npwp, is_pkp) VALUES ($1, $2, $3, $4, $5) RETURNING id',
    [tenantId, version, 'PT Solva', npwp, isPkp],
  )
  return res.rows[0]!.id
}

async function seedOutlet(
  client: Client,
  tenantId: string,
  version: number,
  legalEntityId: string,
  code = 'OUT01',
): Promise<string> {
  const res = await client.query<{ id: string }>(
    `INSERT INTO outlet (tenant_id, version, legal_entity_id, code, name, price_tax_mode)
     VALUES ($1, $2, $3, $4, 'Main Outlet', 'INCLUSIVE') RETURNING id`,
    [tenantId, version, legalEntityId, code],
  )
  return res.rows[0]!.id
}

describe('identity schema constraints and triggers', () => {
  it('enforces outlet.code uppercase format and uniqueness per tenant', async () => {
    const t = await createTestTenant(uniqueSlug('outcode'))
    await masterTx(t.id, async (client, version) => {
      const leId = await seedLegalEntity(client, t.id, version, false)

      await expect(
        runInSavepoint(client, () =>
          client.query(
            `INSERT INTO outlet (tenant_id, version, legal_entity_id, code, name, price_tax_mode)
             VALUES ($1, $2, $3, 'out01', 'Lower', 'INCLUSIVE')`,
            [t.id, version, leId],
          ),
        ),
      ).rejects.toMatchObject({ code: '23514' })

      await seedOutlet(client, t.id, version, leId, 'OUT01')
      await expect(
        runInSavepoint(client, () => seedOutlet(client, t.id, version, leId, 'OUT01')),
      ).rejects.toMatchObject({ code: '23505' })
    })
  })

  it('requires PKP legal entity for outlet with tax_profile = PPN', async () => {
    const t = await createTestTenant(uniqueSlug('ppn'))
    await masterTx(t.id, async (client, version) => {
      const nonPkpId = await seedLegalEntity(client, t.id, version, false)
      await expect(
        runInSavepoint(client, () =>
          client.query(
            `INSERT INTO outlet (tenant_id, version, legal_entity_id, code, name, price_tax_mode, tax_profile)
             VALUES ($1, $2, $3, 'OUT01', 'PPN Fail', 'EXCLUSIVE', 'PPN')`,
            [t.id, version, nonPkpId],
          ),
        ),
      ).rejects.toThrowError(/PPN requires PKP legal entity/)

      const pkpId = await seedLegalEntity(client, t.id, version, true)
      const ok = await client.query(
        `INSERT INTO outlet (tenant_id, version, legal_entity_id, code, name, price_tax_mode, tax_profile)
         VALUES ($1, $2, $3, 'OUT02', 'PPN Pass', 'EXCLUSIVE', 'PPN') RETURNING id`,
        [t.id, version, pkpId],
      )
      expect(ok.rows).toHaveLength(1)
    })
  })

  it('rejects non-zero service_charge_rate when service_charge_enabled is false', async () => {
    const t = await createTestTenant(uniqueSlug('sc'))
    await masterTx(t.id, async (client, version) => {
      const leId = await seedLegalEntity(client, t.id, version, false)
      await expect(
        runInSavepoint(client, () =>
          client.query(
            `INSERT INTO outlet (tenant_id, version, legal_entity_id, code, name, price_tax_mode, service_charge_enabled, service_charge_rate)
             VALUES ($1, $2, $3, 'OUT01', 'SC Fail', 'INCLUSIVE', false, 5)`,
            [t.id, version, leId],
          ),
        ),
      ).rejects.toMatchObject({ code: '23514' })
    })
  })

  it('allows only one active CASH payment_method per tenant while permitting soft-deleted rows', async () => {
    const t = await createTestTenant(uniqueSlug('pay'))
    await masterTx(t.id, async (client, version) => {
      await client.query(
        `INSERT INTO payment_method (tenant_id, version, code, name, kind) VALUES ($1, $2, 'CASH', 'Cash', 'CASH')`,
        [t.id, version],
      )
      await expect(
        runInSavepoint(client, () =>
          client.query(
            `INSERT INTO payment_method (tenant_id, version, code, name, kind) VALUES ($1, $2, 'CASH2', 'Cash 2', 'CASH')`,
            [t.id, version],
          ),
        ),
      ).rejects.toMatchObject({ code: '23505' })

      const softDel = await client.query(
        `INSERT INTO payment_method (tenant_id, version, code, name, kind, deleted_at)
         VALUES ($1, $2, 'CASH_OLD', 'Old Cash', 'CASH', now()) RETURNING id`,
        [t.id, version],
      )
      expect(softDel.rows).toHaveLength(1)
    })
  })

  it('enforces register_invoice_prefix format, month start, and cross-register uniqueness', async () => {
    const t = await createTestTenant(uniqueSlug('rip'))
    await masterTx(t.id, async (client, version) => {
      const leId = await seedLegalEntity(client, t.id, version, false)
      const outletId = await seedOutlet(client, t.id, version, leId)
      const regA = (
        await client.query<{ id: string }>(
          `INSERT INTO cash_master (tenant_id, version, outlet_id, code, name) VALUES ($1, $2, $3, 'POS01', 'Cashier 1') RETURNING id`,
          [t.id, version, outletId],
        )
      ).rows[0]!.id
      const regB = (
        await client.query<{ id: string }>(
          `INSERT INTO cash_master (tenant_id, version, outlet_id, code, name) VALUES ($1, $2, $3, 'POS02', 'Cashier 2') RETURNING id`,
          [t.id, version, outletId],
        )
      ).rows[0]!.id

      const valid = await client.query(
        `INSERT INTO register_invoice_prefix (tenant_id, version, register_id, effective_month, invoice_prefix)
         VALUES ($1, $2, $3, '2026-11-01', 'OUT01-POS02') RETURNING id`,
        [t.id, version, regA],
      )
      expect(valid.rows).toHaveLength(1)

      const reuseSameReg = await client.query(
        `INSERT INTO register_invoice_prefix (tenant_id, version, register_id, effective_month, invoice_prefix)
         VALUES ($1, $2, $3, '2026-12-01', 'OUT01-POS02') RETURNING id`,
        [t.id, version, regA],
      )
      expect(reuseSameReg.rows).toHaveLength(1)

      await expect(
        runInSavepoint(client, () =>
          client.query(
            `INSERT INTO register_invoice_prefix (tenant_id, version, register_id, effective_month, invoice_prefix)
             VALUES ($1, $2, $3, '2026-11-01', 'OUT01-POS02')`,
            [t.id, version, regB],
          ),
        ),
      ).rejects.toThrowError(/invoice prefix already used by another register/)

      for (const badPrefix of ['OUT01-NK', '-AB', 'AB-', 'A--B', 'A']) {
        await expect(
          runInSavepoint(client, () =>
            client.query(
              `INSERT INTO register_invoice_prefix (tenant_id, version, register_id, effective_month, invoice_prefix)
               VALUES ($1, $2, $3, '2027-01-01', $4)`,
              [t.id, version, regB, badPrefix],
            ),
          ),
        ).rejects.toMatchObject({ code: '23514' })
      }

      await expect(
        runInSavepoint(client, () =>
          client.query(
            `INSERT INTO register_invoice_prefix (tenant_id, version, register_id, effective_month, invoice_prefix)
             VALUES ($1, $2, $3, '2026-11-15', 'KSR2')`,
            [t.id, version, regB],
          ),
        ),
      ).rejects.toMatchObject({ code: '23514' })
    })
  })

  it('enforces UNIQUE NULLS NOT DISTINCT on tax_rate_history and user_outlet, and app_user checks', async () => {
    const t1 = await createTestTenant(uniqueSlug('multi1'))
    const t2 = await createTestTenant(uniqueSlug('multi2'))

    await masterTx(t1.id, async (client, version) => {
      await client.query(
        `INSERT INTO tax_rate_history (tenant_id, version, tax_code, outlet_id, effective_from, rate)
         VALUES ($1, $2, 'PPN', NULL, '2026-01-01', 11)`,
        [t1.id, version],
      )
      await expect(
        runInSavepoint(client, () =>
          client.query(
            `INSERT INTO tax_rate_history (tenant_id, version, tax_code, outlet_id, effective_from, rate)
             VALUES ($1, $2, 'PPN', NULL, '2026-01-01', 12)`,
            [t1.id, version],
          ),
        ),
      ).rejects.toMatchObject({ code: '23505' })

      await expect(
        runInSavepoint(client, () =>
          client.query(
            `INSERT INTO app_user (tenant_id, version, auth_user_id, display_name, membership_status)
             VALUES ($1, $2, 'ba-1', 'Pending User', 'PENDING')`,
            [t1.id, version],
          ),
        ),
      ).rejects.toMatchObject({ code: '23514' })

      const userId = (
        await client.query<{ id: string }>(
          `INSERT INTO app_user (tenant_id, version, auth_user_id, display_name)
           VALUES ($1, $2, 'ba-shared', 'Alice') RETURNING id`,
          [t1.id, version],
        )
      ).rows[0]!.id

      await expect(
        runInSavepoint(client, () =>
          client.query(
            `INSERT INTO app_user (tenant_id, version, auth_user_id, display_name)
             VALUES ($1, $2, 'ba-shared', 'Alice Two')`,
            [t1.id, version],
          ),
        ),
      ).rejects.toMatchObject({ code: '23505' })

      const roleId = (
        await client.query<{ id: string }>(
          `INSERT INTO role (tenant_id, version, code, name, is_system, discount_limit_pct)
           VALUES ($1, $2, 'OWNER', 'Owner', true, 100) RETURNING id`,
          [t1.id, version],
        )
      ).rows[0]!.id

      await client.query(
        `INSERT INTO user_outlet (tenant_id, version, user_id, outlet_id, role_id)
         VALUES ($1, $2, $3, NULL, $4)`,
        [t1.id, version, userId, roleId],
      )
      await expect(
        runInSavepoint(client, () =>
          client.query(
            `INSERT INTO user_outlet (tenant_id, version, user_id, outlet_id, role_id)
             VALUES ($1, $2, $3, NULL, $4)`,
            [t1.id, version, userId, roleId],
          ),
        ),
      ).rejects.toMatchObject({ code: '23505' })
    })

    // Same global auth_user_id is allowed on a different tenant
    await masterTx(t2.id, async (client, version) => {
      const ok = await client.query(
        `INSERT INTO app_user (tenant_id, version, auth_user_id, display_name)
         VALUES ($1, $2, 'ba-shared', 'Alice') RETURNING id`,
        [t2.id, version],
      )
      expect(ok.rows).toHaveLength(1)
    })
  })
})
