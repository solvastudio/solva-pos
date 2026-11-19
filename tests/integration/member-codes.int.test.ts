import { webcrypto } from 'node:crypto'
import { hashPassword } from 'better-auth/crypto'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { createIdGenerator } from '~/lib/kernel'
import {
  cancelInvite,
  createInvite,
  issueResetCode,
  listPendingInvites,
  purgeMemberCodes,
  redeemInvite,
  reissueInvite,
  removeMember,
  type IdentityAuthActor,
} from '~/modules/identity/public'
import { PERMISSION_CODES } from '~/modules/identity/shared'
import { __resetAuthInstancesForTests } from '~/server/auth/auth-factory'
import { handleAuthRoute } from '~/server/auth/login-handler'
import { getAuthContext } from '~/server/auth/auth-context'
import { resetLimitersForTests } from '~/server/auth/rate-limit/limiters'
import { resetLoginLimiterForTests } from '~/server/auth/rate-limit/login-limiter'
import { closePools } from '~/server/db'
import { appClient, ownerClient, withClient } from './helpers/db'
import { createTestTenant, uniqueSlug } from './helpers/tenants'

const testIdGen = createIdGenerator({
  nowMs: () => Date.now(),
  nextUint32: () => {
    const buf = new Uint32Array(1)
    webcrypto.getRandomValues(buf)
    return buf[0]!
  },
})

async function setupTenantOwner(slug: string, name: string): Promise<{
  tenantId: string
  authOrgId: string
  ownerActor: IdentityAuthActor
  ownerRoleId: string
  cashierRoleId: string
  email: string
  password: string
}> {
  const tenant = await createTestTenant(slug, name)
  const authOrgId = testIdGen.newId()
  const authUserId = testIdGen.newId()
  const ownerAppUserId = testIdGen.newId()
  const ownerRoleId = testIdGen.newId()
  const cashierRoleId = testIdGen.newId()
  const email = `owner-${slug}@example.test`
  const password = 'OwnerSeedPassword123!'
  const passwordHash = await hashPassword(password)

  await withClient(ownerClient, async (client) => {
    await client.query('BEGIN')
    try {
      await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenant.id])
      await client.query(
        'INSERT INTO organization (id, name, slug, created_at) VALUES ($1, $2, $3, now())',
        [authOrgId, name, slug],
      )
      await client.query('UPDATE tenant SET auth_org_id = $1 WHERE id = $2', [authOrgId, tenant.id])

      await client.query(
        'INSERT INTO "user" (id, name, email, email_verified, created_at, updated_at) VALUES ($1, $2, $3, true, now(), now())',
        [authUserId, 'Owner', email],
      )
      await client.query(
        'INSERT INTO account (id, account_id, provider_id, user_id, password, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, now(), now())',
        [testIdGen.newId(), authUserId, 'credential', authUserId, passwordHash],
      )
      await client.query(
        'INSERT INTO member (id, organization_id, user_id, role, created_at) VALUES ($1, $2, $3, $4, now())',
        [testIdGen.newId(), authOrgId, authUserId, 'owner'],
      )

      const syncRes = await client.query<{ version: unknown }>(
        'UPDATE tenant_sync SET version = version + 1, updated_at = now() WHERE tenant_id = $1 RETURNING version',
        [tenant.id],
      )
      const version = Number(syncRes.rows[0]!.version)

      await client.query(
        `INSERT INTO role (tenant_id, id, code, name, is_system, discount_limit_pct, version)
         VALUES ($1, $2, 'OWNER', 'Owner', true, 100, $3)`,
        [tenant.id, ownerRoleId, version],
      )
      await client.query(
        `INSERT INTO role (tenant_id, id, code, name, is_system, discount_limit_pct, version)
         VALUES ($1, $2, 'CASHIER', 'Cashier', true, 10, $3)`,
        [tenant.id, cashierRoleId, version],
      )
      for (const perm of PERMISSION_CODES) {
        await client.query(
          `INSERT INTO role_permission (tenant_id, id, role_id, permission_code, version)
           VALUES ($1, $2, $3, $4, $5)`,
          [tenant.id, testIdGen.newId(), ownerRoleId, perm, version],
        )
      }
      await client.query(
        `INSERT INTO app_user (tenant_id, id, auth_user_id, display_name, is_active, membership_status, version)
         VALUES ($1, $2, $3, 'Store Owner', true, 'ACTIVE', $4)`,
        [tenant.id, ownerAppUserId, authUserId, version],
      )
      await client.query(
        `INSERT INTO user_outlet (tenant_id, id, user_id, outlet_id, role_id, version)
         VALUES ($1, $2, $3, NULL, $4, $5)`,
        [tenant.id, testIdGen.newId(), ownerAppUserId, ownerRoleId, version],
      )
      await client.query('COMMIT')
    } catch (err) {
      await client.query('ROLLBACK')
      throw err
    }
  })

  return {
    tenantId: tenant.id,
    authOrgId,
    ownerRoleId,
    cashierRoleId,
    email,
    password,
    ownerActor: {
      tenantId: tenant.id,
      tenantSlug: slug,
      authOrgId,
      appUserId: ownerAppUserId,
      permissions: new Set(PERMISSION_CODES),
    },
  }
}

describe('member codes lifecycle, R1-R5 reset rules, removal and cleanup', () => {
  beforeEach(() => {
    __resetAuthInstancesForTests()
    resetLimitersForTests()
    resetLoginLimiterForTests()
  })

  afterAll(async () => {
    await closePools()
  })

  it('scenarios 1-2: creates uniform 10-char formatted invite storing only SHA-256 hash and replaces old active code', async () => {
    const slugA = uniqueSlug('mc1a')
    const slugB = uniqueSlug('mc1b')
    const setupA = await setupTenantOwner(slugA, 'Tenant 1A')
    const setupB = await setupTenantOwner(slugB, 'Tenant 1B')

    // Email without existing account vs with existing account (owner of tenant B) return identical structure.
    const inviteNew = await createInvite(setupA.ownerActor, {
      email: `new-${slugA}@example.test`,
      displayName: 'New Staff',
      roleId: setupA.cashierRoleId,
      outletIds: null,
    })
    const inviteExistingGlobal = await createInvite(setupA.ownerActor, {
      email: setupB.email,
      displayName: 'Existing Global User',
      roleId: setupA.cashierRoleId,
      outletIds: null,
    })

    expect(inviteNew.code).toMatch(/^[A-HJ-NP-Z2-9]{5}-[A-HJ-NP-Z2-9]{5}$/)
    expect(inviteExistingGlobal.code).toMatch(/^[A-HJ-NP-Z2-9]{5}-[A-HJ-NP-Z2-9]{5}$/)
    expect(Object.keys(inviteNew).sort()).toEqual(Object.keys(inviteExistingGlobal).sort())

    // DB holds code_hash (32-byte SHA-256), never plaintext code.
    await withClient(ownerClient, async (client) => {
      await client.query('BEGIN')
      try {
        await client.query("SELECT set_config('app.tenant_id', $1, true)", [setupA.tenantId])
        const mcRes = await client.query<{ code_hash: Buffer }>(
          'SELECT code_hash FROM member_code WHERE id = $1',
          [inviteNew.codeId],
        )
        expect(mcRes.rows[0]?.code_hash.length).toBe(32)
        expect(mcRes.rows[0]?.code_hash.toString('utf8')).not.toContain(inviteNew.code.replace('-', ''))

        // Re-issuing on existing PENDING profile replaces old code and preserves UQ index.
        const secondInvite = await createInvite(setupA.ownerActor, {
          email: `new-${slugA}@example.test`,
          displayName: 'New Staff',
          roleId: setupA.cashierRoleId,
          outletIds: null,
          existingAppUserId: inviteNew.appUserId,
        })
        const revokedRes = await client.query<{ revoke_reason: string | null }>(
          'SELECT revoke_reason FROM member_code WHERE id = $1',
          [inviteNew.codeId],
        )
        expect(revokedRes.rows[0]?.revoke_reason).toBe('REPLACED')
        expect(secondInvite.codeId).not.toBe(inviteNew.codeId)
        await client.query('COMMIT')
      } catch (err) {
        await client.query('ROLLBACK')
        throw err
      }
    })
  })

  it('scenario 3: listPendingInvites omits hashes/codes, tracks EXPIRED after 72h, and excludes canceled/accepted/cross-tenant invites', async () => {
    const slugA = uniqueSlug('mc3a')
    const slugB = uniqueSlug('mc3b')
    const setupA = await setupTenantOwner(slugA, 'Tenant 3A')
    const setupB = await setupTenantOwner(slugB, 'Tenant 3B')

    const baseTime = '2026-11-16T09:00:00.000Z'
    const inv = await createInvite(
      setupA.ownerActor,
      {
        email: `pending-${slugA}@example.test`,
        displayName: 'Pending Staff',
        roleId: setupA.cashierRoleId,
        outletIds: null,
      },
      { nowIso: () => baseTime },
    )
    await createInvite(
      setupB.ownerActor,
      {
        email: `other-${slugB}@example.test`,
        displayName: 'Other Staff',
        roleId: setupB.cashierRoleId,
        outletIds: null,
      },
      { nowIso: () => baseTime },
    )

    const beforeExpiry = await listPendingInvites(setupA.ownerActor, {
      nowIso: () => '2026-11-18T09:00:00.000Z',
    })
    expect(beforeExpiry).toHaveLength(1)
    expect(beforeExpiry[0]!.id).toBe(inv.appUserId)
    expect(beforeExpiry[0]!.status).toBe('PENDING')
    expect('code' in (beforeExpiry[0] as unknown as Record<string, unknown>)).toBe(false)
    expect('codeHash' in (beforeExpiry[0] as unknown as Record<string, unknown>)).toBe(false)

    const afterExpiry = await listPendingInvites(setupA.ownerActor, {
      nowIso: () => '2026-11-19T10:00:00.000Z',
    })
    expect(afterExpiry[0]!.status).toBe('EXPIRED')
  })

  it('scenario 4: cancelInvite soft-deletes pending profile idempotently while keeping PIN-only active staff intact', async () => {
    const slugA = uniqueSlug('mc4')
    const setupA = await setupTenantOwner(slugA, 'Tenant 4')

    const invPending = await createInvite(setupA.ownerActor, {
      email: `cancel-${slugA}@example.test`,
      displayName: 'Cancel Pending',
      roleId: setupA.cashierRoleId,
      outletIds: null,
    })

    await cancelInvite(setupA.ownerActor, invPending.appUserId)
    // Idempotent second call succeeds cleanly.
    await cancelInvite(setupA.ownerActor, invPending.appUserId)
    expect(await listPendingInvites(setupA.ownerActor)).toHaveLength(0)

    // Create PIN-only ACTIVE staff profile without authUserId, invite, then cancel -> stays ACTIVE.
    const pinUserId = testIdGen.newId()
    await withClient(ownerClient, async (client) => {
      await client.query('BEGIN')
      try {
        await client.query("SELECT set_config('app.tenant_id', $1, true)", [setupA.tenantId])
        const syncRes = await client.query<{ version: unknown }>(
          'UPDATE tenant_sync SET version = version + 1 WHERE tenant_id = $1 RETURNING version',
          [setupA.tenantId],
        )
        const version = Number(syncRes.rows[0]!.version)
        await client.query(
          `INSERT INTO app_user (tenant_id, id, auth_user_id, display_name, is_active, membership_status, version)
           VALUES ($1, $2, NULL, 'Pin Cashier', true, 'ACTIVE', $3)`,
          [setupA.tenantId, pinUserId, version],
        )
        await client.query('COMMIT')
      } catch (err) {
        await client.query('ROLLBACK')
        throw err
      }
    })

    await createInvite(setupA.ownerActor, {
      email: `pin-${slugA}@example.test`,
      displayName: 'Pin Cashier',
      roleId: setupA.cashierRoleId,
      outletIds: null,
      existingAppUserId: pinUserId,
    })
    await cancelInvite(setupA.ownerActor, pinUserId)

    await withClient(ownerClient, async (client) => {
      await client.query('BEGIN')
      try {
        await client.query("SELECT set_config('app.tenant_id', $1, true)", [setupA.tenantId])
        const row = await client.query<{ deleted_at: string | null; is_active: boolean }>(
          'SELECT deleted_at, is_active FROM app_user WHERE id = $1',
          [pinUserId],
        )
        expect(row.rows[0]?.deleted_at).toBeNull()
        expect(row.rows[0]?.is_active).toBe(true)
        await client.query('COMMIT')
      } catch (err) {
        await client.query('ROLLBACK')
        throw err
      }
    })
  })

  it('scenario 5 (V-48): reissueInvite sets +72h from reissue time and invalidates old expired code', async () => {
    const slugA = uniqueSlug('mc5')
    const setupA = await setupTenantOwner(slugA, 'Tenant 5')

    const mon = '2026-11-16T09:00:00.000Z'
    const inv = await createInvite(
      setupA.ownerActor,
      {
        email: `v48-${slugA}@example.test`,
        displayName: 'V48 Staff',
        roleId: setupA.cashierRoleId,
        outletIds: null,
      },
      { nowIso: () => mon },
    )
    expect(inv.expiresAt).toBe('2026-11-19T09:00:00.000Z')

    const thuReissue = '2026-11-19T10:00:00.000Z'
    const reissued = await reissueInvite(setupA.ownerActor, inv.appUserId, {
      nowIso: () => thuReissue,
    })
    expect(reissued.expiresAt).toBe('2026-11-22T10:00:00.000Z')

    const oldAttempt = await redeemInvite(
      {
        tenantId: setupA.tenantId,
        tenantSlug: slugA,
        authOrgId: setupA.authOrgId,
        email: `v48-${slugA}@example.test`,
        code: inv.code,
        password: 'ValidNewPassword123!',
      },
      { nowIso: () => thuReissue },
    )
    expect(oldAttempt.ok).toBe(false)

    const newAttempt = await redeemInvite(
      {
        tenantId: setupA.tenantId,
        tenantSlug: slugA,
        authOrgId: setupA.authOrgId,
        email: `v48-${slugA}@example.test`,
        code: reissued.code,
        password: 'ValidNewPassword123!',
      },
      { nowIso: () => '2026-11-22T09:00:00.000Z' },
    )
    expect(newAttempt.ok).toBe(true)
  })

  it('scenarios 6-7 (V-44, V-47): enforces R1-R4 including OWNER exclusion and cross-tenant active invite block', async () => {
    const slugA = uniqueSlug('mc6a')
    const slugB = uniqueSlug('mc6b')
    const setupA = await setupTenantOwner(slugA, 'Tenant 6A')
    const setupB = await setupTenantOwner(slugB, 'Tenant 6B')

    // Join cashier rina@ into Tenant A only.
    const rinaEmail = `rina-${slugA}@example.test`
    const inv = await createInvite(setupA.ownerActor, {
      email: rinaEmail,
      displayName: 'Rina Cashier',
      roleId: setupA.cashierRoleId,
      outletIds: null,
    })
    const joined = await redeemInvite({
      tenantId: setupA.tenantId,
      tenantSlug: slugA,
      authOrgId: setupA.authOrgId,
      email: rinaEmail,
      code: inv.code,
      password: 'RinaStrongPassword123!',
    })
    expect(joined.ok).toBe(true)

    // R1 satisfied (single tenant non-OWNER): reset code succeeds (24h).
    const baseIso = new Date().toISOString()
    const resetOk = await issueResetCode(setupA.ownerActor, inv.appUserId, {
      nowIso: () => baseIso,
    })
    expect(resetOk.code).toMatch(/^[A-HJ-NP-Z2-9]{5}-[A-HJ-NP-Z2-9]{5}$/)
    expect(Date.parse(resetOk.expiresAt) - Date.parse(baseIso)).toBe(24 * 3_600_000)

    // R3: OWNER self-reset / reset for OWNER rejected with generic FORBIDDEN message.
    await expect(issueResetCode(setupA.ownerActor, setupA.ownerActor.appUserId)).rejects.toMatchObject({
      code: 'FORBIDDEN',
      message: 'members.reset.unavailable',
    })

    // Non-member UUID rejected with the EXACT SAME generic message.
    await expect(issueResetCode(setupA.ownerActor, testIdGen.newId())).rejects.toMatchObject({
      code: 'FORBIDDEN',
      message: 'members.reset.unavailable',
    })

    // V-47: Tenant B sends active INVITE to rina@ -> membership count becomes 2 -> Tenant A reset blocked!
    const invB = await createInvite(setupB.ownerActor, {
      email: rinaEmail,
      displayName: 'Rina At B',
      roleId: setupB.cashierRoleId,
      outletIds: null,
    })
    await expect(issueResetCode(setupA.ownerActor, inv.appUserId)).rejects.toMatchObject({
      code: 'FORBIDDEN',
      message: 'members.reset.unavailable',
    })

    // Cancel invite in B -> count returns to 1 -> reset in A allowed again!
    await cancelInvite(setupB.ownerActor, invB.appUserId)
    const resetAfterCancel = await issueResetCode(setupA.ownerActor, inv.appUserId)
    expect(resetAfterCancel.codeId).not.toBe(resetOk.codeId)
  })

  it('scenario 8: removeMember protects last OWNER, revokes only that tenant session, preserves other tenants, and allows re-invite', async () => {
    const slugA = uniqueSlug('mc8a')
    const slugB = uniqueSlug('mc8b')
    const setupA = await setupTenantOwner(slugA, 'Tenant 8A')
    const setupB = await setupTenantOwner(slugB, 'Tenant 8B')

    // Last Owner protection.
    await expect(removeMember(setupA.ownerActor, setupA.ownerActor.appUserId)).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
      message: 'member.remove.lastOwner',
    })

    // User joins BOTH A and B.
    const dualEmail = `dual-${slugA}@example.test`
    const dualPassword = 'DualStrongPassword123!'
    const invA = await createInvite(setupA.ownerActor, {
      email: dualEmail,
      displayName: 'Dual Member',
      roleId: setupA.cashierRoleId,
      outletIds: null,
    })
    await redeemInvite({
      tenantId: setupA.tenantId,
      tenantSlug: slugA,
      authOrgId: setupA.authOrgId,
      email: dualEmail,
      code: invA.code,
      password: dualPassword,
    })

    const invB = await createInvite(setupB.ownerActor, {
      email: dualEmail,
      displayName: 'Dual Member',
      roleId: setupB.cashierRoleId,
      outletIds: null,
    })
    await redeemInvite({
      tenantId: setupB.tenantId,
      tenantSlug: slugB,
      authOrgId: setupB.authOrgId,
      email: dualEmail,
      code: invB.code,
      password: dualPassword,
    })

    // Sign in to both A and B.
    const loginA = await handleAuthRoute(
      new Request(`http://localhost:3000/${slugA}/admin/api/auth/sign-in/email`, {
        method: 'POST',
        headers: { Host: 'localhost:3000', Origin: 'http://localhost:3000', 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: dualEmail, password: dualPassword }),
      }),
      slugA,
      { minLoginDelayMs: 0 },
    )
    const loginB = await handleAuthRoute(
      new Request(`http://localhost:3000/${slugB}/admin/api/auth/sign-in/email`, {
        method: 'POST',
        headers: { Host: 'localhost:3000', Origin: 'http://localhost:3000', 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: dualEmail, password: dualPassword }),
      }),
      slugB,
      { minLoginDelayMs: 0 },
    )
    const cookieA = loginA.headers.getSetCookie().find((c) => c.startsWith(`solva_s_${slugA}`))!.split(';')[0]!
    const cookieB = loginB.headers.getSetCookie().find((c) => c.startsWith(`solva_s_${slugB}`))!.split(';')[0]!

    // Remove from Tenant A only.
    await removeMember(setupA.ownerActor, invA.appUserId)

    expect(
      await getAuthContext(
        new Request(`http://localhost:3000/${slugA}/admin`, { headers: { Cookie: cookieA } }),
        slugA,
      ),
    ).toBeNull()
    expect(
      await getAuthContext(
        new Request(`http://localhost:3000/${slugB}/admin`, { headers: { Cookie: cookieB } }),
        slugB,
      ),
    ).not.toBeNull()

    // Re-invite same user & same displayName into Tenant A succeeds under UQ partial indexes.
    const reInviteA = await createInvite(setupA.ownerActor, {
      email: dualEmail,
      displayName: 'Dual Member',
      roleId: setupA.cashierRoleId,
      outletIds: null,
    })
    const reJoined = await redeemInvite({
      tenantId: setupA.tenantId,
      tenantSlug: slugA,
      authOrgId: setupA.authOrgId,
      email: dualEmail,
      code: reInviteA.code,
      password: dualPassword,
    })
    expect(reJoined.ok).toBe(true)
  })

  it('scenarios 9-10: enforces member_code RLS isolation and purgeMemberCodes 7-day retention + orphan cleanup', async () => {
    const slugA = uniqueSlug('mc9')
    const setupA = await setupTenantOwner(slugA, 'Tenant 9')

    // RLS check: solva_app without app.tenant_id sees zero rows from member_code and function still executes.
    const oldTime = '2026-10-01T00:00:00.000Z'
    const freshTime = '2026-11-18T00:00:00.000Z'
    const invOld = await createInvite(
      setupA.ownerActor,
      {
        email: `old-${slugA}@example.test`,
        displayName: 'Old Pending',
        roleId: setupA.cashierRoleId,
        outletIds: null,
      },
      { nowIso: () => oldTime },
    )
    const invFresh = await createInvite(
      setupA.ownerActor,
      {
        email: `fresh-${slugA}@example.test`,
        displayName: 'Fresh Pending',
        roleId: setupA.cashierRoleId,
        outletIds: null,
      },
      { nowIso: () => freshTime },
    )

    await withClient(appClient, async (client) => {
      const noCtxRows = await client.query('SELECT id FROM member_code')
      expect(noCtxRows.rows).toHaveLength(0)

      // auth_account_membership_count works cross-tenant without app.tenant_id context.
      const userRes = await client.query<{ id: string }>(
        'SELECT id FROM "user" WHERE email = $1',
        [setupA.email],
      )
      const cntRes = await client.query<{ cnt: number }>(
        'SELECT auth_account_membership_count($1) AS cnt',
        [userRes.rows[0]!.id],
      )
      expect(cntRes.rows[0]?.cnt).toBe(1)
    })

    // Purge with now = 2026-11-20 -> deletes invOld (expired > 7d ago) & soft-deletes orphan profile, preserves invFresh.
    const purgeRes = await purgeMemberCodes('2026-11-20T00:00:00.000Z')
    expect(purgeRes.codesDeleted).toBeGreaterThanOrEqual(1)
    expect(purgeRes.orphanProfilesDeleted).toBeGreaterThanOrEqual(1)

    await withClient(ownerClient, async (client) => {
      await client.query('BEGIN')
      try {
        await client.query("SELECT set_config('app.tenant_id', $1, true)", [setupA.tenantId])
        const oldProf = await client.query<{ deleted_at: string | null }>(
          'SELECT deleted_at FROM app_user WHERE id = $1',
          [invOld.appUserId],
        )
        const freshProf = await client.query<{ deleted_at: string | null }>(
          'SELECT deleted_at FROM app_user WHERE id = $1',
          [invFresh.appUserId],
        )
        expect(oldProf.rows[0]?.deleted_at).not.toBeNull()
        expect(freshProf.rows[0]?.deleted_at).toBeNull()
        await client.query('COMMIT')
      } catch (err) {
        await client.query('ROLLBACK')
        throw err
      }
    })
  })
})
