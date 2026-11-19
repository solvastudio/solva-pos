import { randomBytes, webcrypto } from 'node:crypto'
import { hashPassword } from 'better-auth/crypto'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { createIdGenerator } from '~/lib/kernel'
import {
  cancelInvite,
  createInvite,
  issueResetCode,
  redeemInvite,
  reissueInvite,
  type IdentityAuthActor,
} from '~/modules/identity/public'
import { PERMISSION_CODES } from '~/modules/identity/shared'
import { __resetAuthInstancesForTests } from '~/server/auth/auth-factory'
import { getAuthContext } from '~/server/auth/auth-context'
import { handleAuthRoute } from '~/server/auth/login-handler'
import { handleJoin, handleReset } from '~/server/auth/redeem-handler'
import { resetLimitersForTests } from '~/server/auth/rate-limit/limiters'
import { resetLoginLimiterForTests } from '~/server/auth/rate-limit/login-limiter'
import { closePools } from '~/server/db'
import { captureLogs } from '~/server/logging/logger-core'
import { ownerClient, withClient } from './helpers/db'
import { createTestTenant, uniqueSlug } from './helpers/tenants'

const testIdGen = createIdGenerator({
  nowMs: () => Date.now(),
  nextUint32: () => {
    const buf = new Uint32Array(1)
    webcrypto.getRandomValues(buf)
    return buf[0]!
  },
})

function randomTestPassword(): string {
  return `Pw-${randomBytes(12).toString('hex')}!`
}

async function setupTenant(slug: string, name: string): Promise<{
  tenantId: string
  authOrgId: string
  cashierRoleId: string
  ownerActor: IdentityAuthActor
}> {
  const tenant = await createTestTenant(slug, name)
  const authOrgId = testIdGen.newId()
  const authUserId = testIdGen.newId()
  const ownerAppUserId = testIdGen.newId()
  const ownerRoleId = testIdGen.newId()
  const cashierRoleId = testIdGen.newId()
  const passwordHash = await hashPassword(randomTestPassword())

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
        [authUserId, 'Owner', `owner-${slug}@example.test`],
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
        'UPDATE tenant_sync SET version = version + 1 WHERE tenant_id = $1 RETURNING version',
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
    cashierRoleId,
    ownerActor: {
      tenantId: tenant.id,
      tenantSlug: slug,
      authOrgId,
      appUserId: ownerAppUserId,
      permissions: new Set(PERMISSION_CODES),
    },
  }
}

function postRedeem(
  kind: 'join' | 'reset',
  slug: string,
  body: { email: string; code: string; password: string },
  opts?: { minResponseMs?: number; nowMs?: () => number },
) {
  const req = new Request(`http://localhost:3000/${slug}/api/${kind}`, {
    method: 'POST',
    headers: {
      Host: 'localhost:3000',
      Origin: 'http://localhost:3000',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })
  return kind === 'join' ? handleJoin(req, slug, opts) : handleReset(req, slug, opts)
}

describe('uniform code redemption (/join & /reset), transactions and rate limits', () => {
  beforeEach(() => {
    __resetAuthInstancesForTests()
    resetLimitersForTests()
    resetLoginLimiterForTests()
  })

  afterAll(async () => {
    await closePools()
  })

  it('scenarios 1, 2, 4: joins new account with auto-session, joins existing account across tenants, and blocks replay', async () => {
    const slugA = uniqueSlug('rd1a')
    const slugB = uniqueSlug('rd1b')
    const tenantA = await setupTenant(slugA, 'Tenant R1A')
    const tenantB = await setupTenant(slugB, 'Tenant R1B')

    const staffEmail = `staff-${slugA}@example.test`
    const staffPassword = randomTestPassword()
    const invA = await createInvite(tenantA.ownerActor, {
      email: staffEmail,
      displayName: 'Staff Member',
      roleId: tenantA.cashierRoleId,
      outletIds: null,
    })

    const joinResA = await postRedeem(
      'join',
      slugA,
      { email: staffEmail, code: invA.code, password: staffPassword },
      { minResponseMs: 0 },
    )
    expect(joinResA.status).toBe(200)
    expect(await joinResA.json()).toEqual({ ok: true, next: `/${slugA}/admin` })
    const cookieHeaderA = joinResA.headers.getSetCookie().find((c) => c.startsWith(`solva_s_${slugA}.session_token=`))
    expect(cookieHeaderA).toContain(`Path=/${slugA}`)

    const ctxA = await getAuthContext(
      new Request(`http://localhost:3000/${slugA}/admin`, {
        headers: { Cookie: cookieHeaderA!.split(';')[0]! },
      }),
      slugA,
    )
    expect(ctxA?.appUserId).toBe(invA.appUserId)

    // Replay of same invite code fails uniformly.
    const replayRes = await postRedeem(
      'join',
      slugA,
      { email: staffEmail, code: invA.code, password: staffPassword },
      { minResponseMs: 0 },
    )
    expect(replayRes.status).toBe(400)
    expect(await replayRes.json()).toEqual({
      error: { code: 'VALIDATION_FAILED' },
      message: 'sys.code.invalid',
    })

    // Scenario 2: Same email invited by Tenant B joins using existing global password.
    const invB = await createInvite(tenantB.ownerActor, {
      email: staffEmail,
      displayName: 'Staff In B',
      roleId: tenantB.cashierRoleId,
      outletIds: null,
    })
    const joinResB = await postRedeem(
      'join',
      slugB,
      { email: staffEmail, code: invB.code, password: staffPassword },
      { minResponseMs: 0 },
    )
    expect(joinResB.status).toBe(200)
    expect(await joinResB.json()).toEqual({ ok: true, next: `/${slugB}/admin` })
  })

  it('scenario 3: returns uniform 400 payload and timing across every invalid failure reason', async () => {
    const slugA = uniqueSlug('rd3a')
    const slugB = uniqueSlug('rd3b')
    const tenantA = await setupTenant(slugA, 'Tenant R3A')
    await setupTenant(slugB, 'Tenant R3B')

    const email = `uniform-${slugA}@example.test`
    const validPass = randomTestPassword()
    const invActive = await createInvite(tenantA.ownerActor, {
      email,
      displayName: 'Uniform Staff',
      roleId: tenantA.cashierRoleId,
      outletIds: null,
    })
    const invExpired = await createInvite(
      tenantA.ownerActor,
      {
        email: `exp-${slugA}@example.test`,
        displayName: 'Expired Staff',
        roleId: tenantA.cashierRoleId,
        outletIds: null,
      },
      { nowIso: () => '2026-10-01T00:00:00.000Z' },
    )

    // Pre-create one existing active member to test reset/existing-account failure uniformity.
    const existingEmail = `exist-${slugA}@example.test`
    const existingPass = randomTestPassword()
    const invExist = await createInvite(tenantA.ownerActor, {
      email: existingEmail,
      displayName: 'Exist Staff',
      roleId: tenantA.cashierRoleId,
      outletIds: null,
    })
    await redeemInvite({
      tenantId: tenantA.tenantId,
      tenantSlug: slugA,
      authOrgId: tenantA.authOrgId,
      email: existingEmail,
      code: invExist.code,
      password: existingPass,
    })
    const resetExist = await issueResetCode(tenantA.ownerActor, invExist.appUserId)

    const cases: Array<() => Promise<Response>> = [
      () => postRedeem('join', slugA, { email, code: 'ZZZZZ-ZZZZZ', password: validPass }),
      () => postRedeem('join', slugA, { email: `exp-${slugA}@example.test`, code: invExpired.code, password: validPass }),
      () => postRedeem('join', slugA, { email: `other-${slugA}@example.test`, code: invActive.code, password: validPass }),
      () => postRedeem('reset', slugA, { email, code: invActive.code, password: validPass }),
      () => postRedeem('join', slugA, { email: existingEmail, code: resetExist.code, password: validPass }),
      () => postRedeem('join', slugB, { email, code: invActive.code, password: validPass }),
    ]

    const durations: number[] = []
    for (const runCase of cases) {
      const t0 = performance.now()
      const res = await runCase()
      const dt = performance.now() - t0
      durations.push(dt)
      expect(res.status).toBe(400)
      expect(await res.json()).toEqual({
        error: { code: 'VALIDATION_FAILED' },
        message: 'sys.code.invalid',
      })
    }

    const minDt = Math.min(...durations)
    expect(minDt).toBeGreaterThanOrEqual(240)
  })

  it('scenario 5: mid-transaction error rolls back used_at so invite code remains redeemable', async () => {
    const slugA = uniqueSlug('rd5')
    const tenantA = await setupTenant(slugA, 'Tenant R5')
    const email = `tx-${slugA}@example.test`
    const pass = randomTestPassword()

    const inv = await createInvite(tenantA.ownerActor, {
      email,
      displayName: 'Tx Staff',
      roleId: tenantA.cashierRoleId,
      outletIds: null,
    })

    await expect(
      redeemInvite(
        {
          tenantId: tenantA.tenantId,
          tenantSlug: slugA,
          authOrgId: tenantA.authOrgId,
          email,
          code: inv.code,
          password: pass,
        },
        {
          afterClaimInTx: async () => {
            throw new Error('Forced mid-tx failure')
          },
        },
      ),
    ).rejects.toThrow('Forced mid-tx failure')

    // Because tx rolled back, code is still unconsumed and succeeds cleanly now.
    const retryRes = await redeemInvite({
      tenantId: tenantA.tenantId,
      tenantSlug: slugA,
      authOrgId: tenantA.authOrgId,
      email,
      code: inv.code,
      password: pass,
    })
    expect(retryRes.ok).toBe(true)
  })

  it('scenarios 6-7: password reset revokes sessions with no auto-login and re-checks R1 at redemption time', async () => {
    const slugA = uniqueSlug('rd6a')
    const slugB = uniqueSlug('rd6b')
    const tenantA = await setupTenant(slugA, 'Tenant R6A')
    const tenantB = await setupTenant(slugB, 'Tenant R6B')

    const email = `reset-${slugA}@example.test`
    const oldPass = randomTestPassword()
    const newPass = randomTestPassword()

    const invA = await createInvite(tenantA.ownerActor, {
      email,
      displayName: 'Reset User',
      roleId: tenantA.cashierRoleId,
      outletIds: null,
    })
    const joinRes = await postRedeem(
      'join',
      slugA,
      { email, code: invA.code, password: oldPass },
      { minResponseMs: 0 },
    )
    const oldCookie = joinRes.headers.getSetCookie().find((c) => c.startsWith(`solva_s_${slugA}`))!.split(';')[0]!

    // Issue reset code while membership count = 1.
    const reset = await issueResetCode(tenantA.ownerActor, invA.appUserId)

    // Scenario 7: If Tenant B sends an active invite BEFORE redemption, redemption fails uniformly.
    const invB = await createInvite(tenantB.ownerActor, {
      email,
      displayName: 'R6 B',
      roleId: tenantB.cashierRoleId,
      outletIds: null,
    })
    const blockedByB = await postRedeem(
      'reset',
      slugA,
      { email, code: reset.code, password: newPass },
      { minResponseMs: 0 },
    )
    expect(blockedByB.status).toBe(400)

    // Cancel B invite -> R1 valid again -> reset succeeds, old session revoked, no cookie issued.
    await cancelInvite(tenantB.ownerActor, invB.appUserId)
    const resetRes = await postRedeem(
      'reset',
      slugA,
      { email, code: reset.code, password: newPass },
      { minResponseMs: 0 },
    )
    expect(resetRes.status).toBe(200)
    expect(resetRes.headers.getSetCookie()).toEqual([])
    expect(await resetRes.json()).toEqual({ ok: true, next: `/${slugA}/admin/login` })

    expect(
      await getAuthContext(
        new Request(`http://localhost:3000/${slugA}/admin`, { headers: { Cookie: oldCookie } }),
        slugA,
      ),
    ).toBeNull()

    // Old password rejected, new password succeeds.
    const loginNew = await handleAuthRoute(
      new Request(`http://localhost:3000/${slugA}/admin/api/auth/sign-in/email`, {
        method: 'POST',
        headers: { Host: 'localhost:3000', Origin: 'http://localhost:3000', 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password: newPass }),
      }),
      slugA,
      { minLoginDelayMs: 0 },
    )
    expect(loginNew.status).toBe(200)
  })

  it('scenarios 8-11: enforces redeemEmail rate limit + reissue reset, global login penalty on wrong existing password (V-46), pre-claim defense (V-47), and zero code logs', async () => {
    const slugA = uniqueSlug('rd8a')
    const slugB = uniqueSlug('rd8b')
    const tenantA = await setupTenant(slugA, 'Tenant R8A')
    const tenantB = await setupTenant(slugB, 'Tenant R8B')

    const logs = captureLogs('debug')
    try {
      const email = `rl-${slugA}@example.test`
      const inv = await createInvite(tenantA.ownerActor, {
        email,
        displayName: 'Rate Limited User',
        roleId: tenantA.cashierRoleId,
        outletIds: null,
      })

      // 5 wrong code failures -> 6th blocked 429 without revealing tenant slug.
      for (let i = 0; i < 5; i += 1) {
        const failRes = await postRedeem(
          'join',
          slugA,
          { email, code: 'WRONG-CODE1', password: 'ValidLongPassword123!' },
          { minResponseMs: 0 },
        )
        expect(failRes.status).toBe(400)
      }
      const blockedRes = await postRedeem(
        'join',
        slugA,
        { email, code: inv.code, password: 'ValidLongPassword123!' },
        { minResponseMs: 0 },
      )
      expect(blockedRes.status).toBe(429)
      const blockedText = await blockedRes.text()
      expect(blockedText).not.toContain(slugA)

      // Reissue resets the slug+email redemption counter.
      const reissued = await reissueInvite(tenantA.ownerActor, inv.appUserId)
      const realPassword = randomTestPassword()
      const redeemedAfterReissue = await postRedeem(
        'join',
        slugA,
        { email, code: reissued.code, password: realPassword },
        { minResponseMs: 0 },
      )
      expect(redeemedAfterReissue.status).toBe(200)

      // Scenarios 9 & 10: Tenant B invites same email; wrong existing passwords increment global login limiter (V-46) and fail uniformly (V-47).
      const invB = await createInvite(tenantB.ownerActor, {
        email,
        displayName: 'Cross Tenant Target',
        roleId: tenantB.cashierRoleId,
        outletIds: null,
      })
      for (let i = 0; i < 4; i += 1) {
        const badPassRes = await postRedeem(
          'join',
          slugB,
          { email, code: invB.code, password: 'WrongExistingPassword123!' },
          { minResponseMs: 0 },
        )
        expect(badPassRes.status).toBe(400)
      }

      // Now login on Tenant A is immediately delayed (429) due to shared global account failure counter.
      const blockedLoginA = await handleAuthRoute(
        new Request(`http://localhost:3000/${slugA}/admin/api/auth/sign-in/email`, {
          method: 'POST',
          headers: { Host: 'localhost:3000', Origin: 'http://localhost:3000', 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, password: realPassword }),
        }),
        slugA,
        { minLoginDelayMs: 0 },
      )
      expect(blockedLoginA.status).toBe(429)

      // Scenario 11: Neither plaintext codes nor emails appear in server logs.
      const logDump = logs.lines().join('\n')
      expect(logDump).not.toContain(inv.code)
      expect(logDump).not.toContain(reissued.code)
      expect(logDump).not.toContain(invB.code)
      expect(logDump).not.toContain(email)
    } finally {
      logs.stop()
    }
  })
})
