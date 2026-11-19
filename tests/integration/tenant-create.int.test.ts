import { webcrypto } from 'node:crypto'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { createIdGenerator } from '~/lib/kernel'
import {
  __clearTenantCacheForTests,
  createTenant,
  issueResetCodeAsOperator,
  listTenants,
  redeemInvite,
  redeemReset,
  renameTenant,
  resolveTenantBySlug,
  setTenantStatus,
  type PlatformOperatorActor,
} from '~/modules/identity/public'
import { PERMISSION_CODES, ROLE_DEFAULTS } from '~/modules/identity/shared'
import { __resetAuthInstancesForTests } from '~/server/auth/auth-factory'
import { getAuthContext } from '~/server/auth/auth-context'
import { handleAuthRoute } from '~/server/auth/login-handler'
import { resetLimitersForTests } from '~/server/auth/rate-limit/limiters'
import { resetLoginLimiterForTests } from '~/server/auth/rate-limit/login-limiter'
import { closePools } from '~/server/db'
import { ownerClient, withClient } from './helpers/db'
import { uniqueSlug } from './helpers/tenants'

const testIdGen = createIdGenerator({
  nowMs: () => Date.now(),
  nextUint32: () => {
    const buf = new Uint32Array(1)
    webcrypto.getRandomValues(buf)
    return buf[0]!
  },
})

function makeOperator(): PlatformOperatorActor {
  return {
    platformUserId: testIdGen.newId(),
    email: 'op@solva.example',
  }
}

describe('platform tenant lifecycle: createTenant, rename, status, and operator reset', () => {
  beforeEach(() => {
    __clearTenantCacheForTests()
    __resetAuthInstancesForTests()
    resetLimitersForTests()
    resetLoginLimiterForTests()
  })

  afterAll(async () => {
    await closePools()
  })

  it('scenario 1 & 6: createTenant seeds 7 system roles, CASH method, BA org, owner invite, and redeemable Owner with full permissions', async () => {
    const slug = uniqueSlug('ct1')
    const op = makeOperator()
    const ownerEmail = `owner-${slug}@example.test`
    const created = await createTenant(op, {
      name: 'Kopi Kita Indonesia',
      slug,
      ownerEmail,
      ownerDisplayName: 'Budi Owner',
    })

    expect(created.slug).toBe(slug)
    expect(created.ownerInvite.code).toMatch(/^[A-HJ-NP-Z2-9]{5}-[A-HJ-NP-Z2-9]{5}$/)

    await withClient(ownerClient, async (client) => {
      await client.query('BEGIN')
      try {
        await client.query("SELECT set_config('app.tenant_id', $1, true)", [created.tenantId])
        const tRes = await client.query<{ status: string; auth_org_id: string | null }>(
          'SELECT status, auth_org_id FROM tenant WHERE id = $1',
          [created.tenantId],
        )
        expect(tRes.rows[0]?.status).toBe('ACTIVE')
        expect(tRes.rows[0]?.auth_org_id).toBeTruthy()

        const rolesRes = await client.query<{ code: string }>('SELECT code FROM role ORDER BY code')
        expect(rolesRes.rows.map((r) => r.code).sort()).toEqual(
          ROLE_DEFAULTS.map((d) => d.code).sort(),
        )

        const pmRes = await client.query<{ code: string; kind: string }>(
          'SELECT code, kind FROM payment_method',
        )
        expect(pmRes.rows).toEqual([{ code: 'CASH', kind: 'CASH' }])

        const auditRes = await client.query<{ action: string }>(
          'SELECT action FROM audit_log ORDER BY chain_seq',
        )
        expect(auditRes.rows.map((a) => a.action)).toEqual(['tenant.created', 'member.invited'])
        await client.query('COMMIT')
      } catch (err) {
        await client.query('ROLLBACK')
        throw err
      }
    })

    // Scenario 6: Redeem first owner invite and confirm full permission set on login.
    const ownerPass = 'OwnerFirstPassword123!'
    const redeem = await redeemInvite({
      tenantId: created.tenantId,
      tenantSlug: slug,
      authOrgId: (await withClient(ownerClient, async (c) => {
        await c.query('BEGIN')
        await c.query("SELECT set_config('app.tenant_id', $1, true)", [created.tenantId])
        const r = await c.query<{ auth_org_id: string }>('SELECT auth_org_id FROM tenant WHERE id = $1', [
          created.tenantId,
        ])
        await c.query('COMMIT')
        return r.rows[0]!.auth_org_id
      })),
      email: ownerEmail,
      code: created.ownerInvite.code,
      password: ownerPass,
    })
    expect(redeem.ok).toBe(true)

    const loginRes = await handleAuthRoute(
      new Request(`http://localhost:3000/${slug}/admin/api/auth/sign-in/email`, {
        method: 'POST',
        headers: { Host: 'localhost:3000', Origin: 'http://localhost:3000', 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: ownerEmail, password: ownerPass }),
      }),
      slug,
      { minLoginDelayMs: 0 },
    )
    expect(loginRes.status).toBe(200)
    const cookiePair = loginRes.headers.getSetCookie().find((c) => c.startsWith(`solva_s_${slug}`))!.split(';')[0]!
    const ctx = await getAuthContext(
      new Request(`http://localhost:3000/${slug}/admin`, { headers: { Cookie: cookiePair } }),
      slug,
    )
    expect(ctx?.roleCodes).toEqual(['OWNER'])
    expect(ctx?.permissions.size).toBe(PERMISSION_CODES.length)
  })

  it('scenario 2 (V-33, V-39): enforces slug format, reserved words, case-sensitivity, uniqueness, and 40-char name limit', async () => {
    const op = makeOperator()
    const validSlug = `toko-${uniqueSlug('v').slice(0, 12)}`
    const exact40 = 'A'.repeat(40)
    const created = await createTenant(op, {
      name: exact40,
      slug: validSlug,
      ownerEmail: `o-${validSlug}@example.test`,
      ownerDisplayName: 'Owner 40',
    })
    expect(created.name).toBe(exact40)

    // Duplicate & uppercase variant of existing slug rejected.
    await expect(
      createTenant(op, {
        name: 'Dup',
        slug: validSlug,
        ownerEmail: 'd@example.test',
        ownerDisplayName: 'D',
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' })
    await expect(
      createTenant(op, {
        name: 'DupUpper',
        slug: validSlug.toUpperCase(),
        ownerEmail: 'd@example.test',
        ownerDisplayName: 'D',
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' })

    // Invalid slugs rejected.
    const badSlugs = ['ab', '-acme', 'acme-', 'Acme_1', 'admin', 'pos', 'platform', 'health', 'a'.repeat(31)]
    for (const bad of badSlugs) {
      await expect(
        createTenant(op, {
          name: 'Bad Slug',
          slug: bad,
          ownerEmail: 'bad@example.test',
          ownerDisplayName: 'Bad',
        }),
      ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' })
    }

    // Name > 40 chars rejected.
    await expect(
      createTenant(op, {
        name: 'B'.repeat(41),
        slug: uniqueSlug('v41'),
        ownerEmail: 'b41@example.test',
        ownerDisplayName: 'B41',
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' })
  })

  it('scenario 3: rolls back full transaction (including BA organization) if mid-transaction failure occurs', async () => {
    const op = makeOperator()
    const slug = uniqueSlug('ct3')

    await expect(
      createTenant(
        op,
        {
          name: 'Rollback Store',
          slug,
          ownerEmail: `${slug}@example.test`,
          ownerDisplayName: 'RB',
        },
        {
          beforeCommitInTx: async () => {
            throw new Error('Forced tenant creation rollback')
          },
        },
      ),
    ).rejects.toThrow('Forced tenant creation rollback')

    expect(await resolveTenantBySlug(slug)).toBeNull()
    await withClient(ownerClient, async (c) => {
      const orgs = await c.query('SELECT id FROM organization WHERE slug = $1', [slug])
      expect(orgs.rows).toHaveLength(0)
    })
  })

  it('scenario 4-5: supports renameTenant, blocks direct slug mutation via DB trigger, revokes sessions on SUSPENDED, and forbids CLOSED->ACTIVE', async () => {
    const op = makeOperator()
    const slug = uniqueSlug('ct4')
    const ownerEmail = `owner-${slug}@example.test`
    const ownerPass = 'StatusOwnerPassword123!'
    const created = await createTenant(op, {
      name: 'Initial Name',
      slug,
      ownerEmail,
      ownerDisplayName: 'Owner',
    })

    const renamed = await renameTenant(op, created.tenantId, 'Renamed Store Name')
    expect(renamed.name).toBe('Renamed Store Name')

    // Trigger rejects slug mutation.
    await withClient(ownerClient, async (c) => {
      await c.query('BEGIN')
      await c.query("SELECT set_config('app.tenant_id', $1, true)", [created.tenantId])
      await expect(
        c.query('UPDATE tenant SET slug = $1 WHERE id = $2', ['tampered-slug', created.tenantId]),
      ).rejects.toThrow(/tenant\.slug is permanent/)
      await c.query('ROLLBACK')
    })

    // Redeem owner invite and sign in.
    await redeemInvite({
      tenantId: created.tenantId,
      tenantSlug: slug,
      authOrgId: renamed.authOrgId!,
      email: ownerEmail,
      code: created.ownerInvite.code,
      password: ownerPass,
    })
    const loginRes = await handleAuthRoute(
      new Request(`http://localhost:3000/${slug}/admin/api/auth/sign-in/email`, {
        method: 'POST',
        headers: { Host: 'localhost:3000', Origin: 'http://localhost:3000', 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: ownerEmail, password: ownerPass }),
      }),
      slug,
      { minLoginDelayMs: 0 },
    )
    const cookiePair = loginRes.headers.getSetCookie().find((c) => c.startsWith(`solva_s_${slug}`))!.split(';')[0]!
    expect(
      await getAuthContext(new Request(`http://localhost:3000/${slug}/admin`, { headers: { Cookie: cookiePair } }), slug),
    ).not.toBeNull()

    // Suspend clears cache & deletes BA sessions.
    await setTenantStatus(op, created.tenantId, 'SUSPENDED')
    expect((await resolveTenantBySlug(slug))?.status).toBe('SUSPENDED')
    expect(
      await getAuthContext(new Request(`http://localhost:3000/${slug}/admin`, { headers: { Cookie: cookiePair } }), slug),
    ).toBeNull()

    // Reactivate works; Close is irreversible.
    await setTenantStatus(op, created.tenantId, 'ACTIVE')
    expect((await resolveTenantBySlug(slug))?.status).toBe('ACTIVE')

    await setTenantStatus(op, created.tenantId, 'CLOSED')
    await expect(setTenantStatus(op, created.tenantId, 'ACTIVE')).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
    })
  })

  it('scenario 7 & 8: operator issues reset code for multi-tenant Owner and listTenants exposes only 5 summary columns', async () => {
    const op = makeOperator()
    const slugA = uniqueSlug('ct7a')
    const slugB = uniqueSlug('ct7b')
    const sharedEmail = `multi-owner-${slugA}@example.test`
    const oldPass = 'MultiOwnerOldPassword123!'
    const newPass = 'MultiOwnerNewPassword456!'

    const tenantA = await createTenant(op, {
      name: 'Multi A',
      slug: slugA,
      ownerEmail: sharedEmail,
      ownerDisplayName: 'Multi Owner',
    })
    const tenantB = await createTenant(op, {
      name: 'Multi B',
      slug: slugB,
      ownerEmail: sharedEmail,
      ownerDisplayName: 'Multi Owner',
    })

    const orgA = (await withClient(ownerClient, async (c) => {
      await c.query('BEGIN')
      await c.query("SELECT set_config('app.tenant_id', $1, true)", [tenantA.tenantId])
      const r = await c.query<{ auth_org_id: string }>('SELECT auth_org_id FROM tenant WHERE id = $1', [tenantA.tenantId])
      await c.query('COMMIT')
      return r.rows[0]!.auth_org_id
    }))
    const orgB = (await withClient(ownerClient, async (c) => {
      await c.query('BEGIN')
      await c.query("SELECT set_config('app.tenant_id', $1, true)", [tenantB.tenantId])
      const r = await c.query<{ auth_org_id: string }>('SELECT auth_org_id FROM tenant WHERE id = $1', [tenantB.tenantId])
      await c.query('COMMIT')
      return r.rows[0]!.auth_org_id
    }))

    await redeemInvite({
      tenantId: tenantA.tenantId,
      tenantSlug: slugA,
      authOrgId: orgA,
      email: sharedEmail,
      code: tenantA.ownerInvite.code,
      password: oldPass,
    })
    await redeemInvite({
      tenantId: tenantB.tenantId,
      tenantSlug: slugB,
      authOrgId: orgB,
      email: sharedEmail,
      code: tenantB.ownerInvite.code,
      password: oldPass,
    })

    // Non-member rejected.
    await expect(
      issueResetCodeAsOperator(op, {
        tenantId: tenantA.tenantId,
        appUserId: tenantB.ownerInvite.appUserId,
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' })

    // Operator reset succeeds for multi-tenant OWNER and redeems cleanly.
    const opReset = await issueResetCodeAsOperator(op, {
      tenantId: tenantA.tenantId,
      appUserId: tenantA.ownerInvite.appUserId,
    })
    const redeemed = await redeemReset({
      tenantId: tenantA.tenantId,
      tenantSlug: slugA,
      authOrgId: orgA,
      email: sharedEmail,
      code: opReset.code,
      password: newPass,
    })
    expect(redeemed.ok).toBe(true)

    const list = await listTenants(op)
    const foundA = list.find((t) => t.id === tenantA.tenantId)
    expect(foundA).toBeDefined()
    expect(Object.keys(foundA!).sort()).toEqual(['createdAt', 'id', 'name', 'slug', 'status'])
  })
})
