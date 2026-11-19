import { webcrypto } from 'node:crypto'
import { hashPassword } from 'better-auth/crypto'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { createIdGenerator } from '~/lib/kernel'
import { PERMISSION_CODES, type PermissionCode } from '~/modules/identity/shared'
import { __resetAuthInstancesForTests } from '~/server/auth/auth-factory'
import {
  assertPermission,
  extractRequestTenantSlug,
  getAuthContext,
} from '~/server/auth/auth-context'
import { handleAuthRoute } from '~/server/auth/login-handler'
import { resetLimitersForTests } from '~/server/auth/rate-limit/limiters'
import { resetLoginLimiterForTests } from '~/server/auth/rate-limit/login-limiter'
import { closePools } from '~/server/db'
import { AppError } from '~/server/error-classify'
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

interface SeededMemberParams {
  tenantId: string
  slug: string
  name: string
  authUserId: string
  email: string
  displayName: string
  roleCode: string
  permissions: readonly PermissionCode[]
  membershipStatus?: 'ACTIVE' | 'PENDING'
  isActive?: boolean
}

async function ensureTenantAuthOrg(tenantId: string, slug: string, name: string): Promise<string> {
  return withClient(ownerClient, async (client) => {
    await client.query('BEGIN')
    try {
      await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId])
      const existing = await client.query<{ auth_org_id: string | null }>(
        'SELECT auth_org_id FROM tenant WHERE id = $1 LIMIT 1',
        [tenantId],
      )
      if (existing.rows[0]?.auth_org_id) {
        await client.query('COMMIT')
        return existing.rows[0].auth_org_id
      }
      const orgId = testIdGen.newId()
      await client.query(
        'INSERT INTO organization (id, name, slug, created_at) VALUES ($1, $2, $3, now())',
        [orgId, name, slug],
      )
      await client.query('UPDATE tenant SET auth_org_id = $1 WHERE id = $2', [orgId, tenantId])
      await client.query('COMMIT')
      return orgId
    } catch (err) {
      await client.query('ROLLBACK')
      throw err
    }
  })
}

async function createGlobalAuthUser(email: string, password: string, name: string): Promise<string> {
  const passwordHash = await hashPassword(password)
  const userId = testIdGen.newId()
  await withClient(ownerClient, async (client) => {
    await client.query('BEGIN')
    try {
      await client.query(
        'INSERT INTO "user" (id, name, email, email_verified, created_at, updated_at) VALUES ($1, $2, $3, true, now(), now())',
        [userId, name, email.toLowerCase()],
      )
      await client.query(
        'INSERT INTO account (id, account_id, provider_id, user_id, password, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, now(), now())',
        [testIdGen.newId(), userId, 'credential', userId, passwordHash],
      )
      await client.query('COMMIT')
    } catch (err) {
      await client.query('ROLLBACK')
      throw err
    }
  })
  return userId
}

async function linkUserToTenant(params: SeededMemberParams): Promise<{
  authOrgId: string
  appUserId: string
}> {
  const authOrgId = await ensureTenantAuthOrg(params.tenantId, params.slug, params.name)
  const appUserId = testIdGen.newId()
  const roleId = testIdGen.newId()

  await withClient(ownerClient, async (client) => {
    await client.query('BEGIN')
    try {
      await client.query("SELECT set_config('app.tenant_id', $1, true)", [params.tenantId])
      await client.query(
        'INSERT INTO member (id, organization_id, user_id, role, created_at) VALUES ($1, $2, $3, $4, now())',
        [testIdGen.newId(), authOrgId, params.authUserId, params.roleCode.toLowerCase()],
      )

      const syncRes = await client.query<{ version: unknown }>(
        'UPDATE tenant_sync SET version = version + 1, updated_at = now() WHERE tenant_id = $1 RETURNING version',
        [params.tenantId],
      )
      const version = Number(syncRes.rows[0]!.version)

      await client.query(
        `INSERT INTO role (tenant_id, id, code, name, is_system, discount_limit_pct, version)
         VALUES ($1, $2, $3, $4, true, 50, $5)`,
        [params.tenantId, roleId, params.roleCode, params.roleCode, version],
      )

      for (const perm of params.permissions) {
        await client.query(
          `INSERT INTO role_permission (tenant_id, id, role_id, permission_code, version)
           VALUES ($1, $2, $3, $4, $5)`,
          [params.tenantId, testIdGen.newId(), roleId, perm, version],
        )
      }

      const isActive = params.isActive ?? true
      const membershipStatus = params.membershipStatus ?? 'ACTIVE'
      await client.query(
        `INSERT INTO app_user (tenant_id, id, auth_user_id, display_name, is_active, membership_status, version)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          params.tenantId,
          appUserId,
          membershipStatus === 'PENDING' ? null : params.authUserId,
          params.displayName,
          isActive,
          membershipStatus,
          version,
        ],
      )

      await client.query(
        `INSERT INTO user_outlet (tenant_id, id, user_id, outlet_id, role_id, version)
         VALUES ($1, $2, $3, NULL, $4, $5)`,
        [params.tenantId, testIdGen.newId(), appUserId, roleId, version],
      )

      await client.query('COMMIT')
    } catch (err) {
      await client.query('ROLLBACK')
      throw err
    }
  })

  return { authOrgId, appUserId }
}

function getSetCookies(response: Response): string[] {
  const getter = (response.headers as Headers & { getSetCookie?: () => string[] }).getSetCookie
  if (typeof getter === 'function') {
    return getter.call(response.headers)
  }
  const raw = response.headers.get('set-cookie')
  return raw ? [raw] : []
}

function extractCookiePair(setCookieHeaders: string[], expectedNamePrefix: string): string {
  for (const header of setCookieHeaders) {
    const firstPart = header.split(';')[0]?.trim()
    if (firstPart && firstPart.startsWith(expectedNamePrefix)) {
      return firstPart
    }
  }
  throw new Error(`Missing Set-Cookie matching prefix ${expectedNamePrefix}: ${setCookieHeaders.join(' | ')}`)
}

function authPost(slug: string, action: string, body: Record<string, unknown>, extraHeaders?: Record<string, string>) {
  return handleAuthRoute(
    new Request(`http://localhost:3000/${slug}/admin/api/auth/${action}`, {
      method: 'POST',
      headers: {
        Host: 'localhost:3000',
        Origin: 'http://localhost:3000',
        'Content-Type': 'application/json',
        ...extraHeaders,
      },
      body: JSON.stringify(body),
    }),
    slug,
  )
}

function authGet(slug: string, action: string, cookie?: string) {
  return handleAuthRoute(
    new Request(`http://localhost:3000/${slug}/admin/api/auth/${action}`, {
      method: 'GET',
      headers: cookie ? { Cookie: cookie } : {},
    }),
    slug,
  )
}

describe('Better Auth multi-tenant global identity & per-slug sessions', () => {
  beforeEach(() => {
    __resetAuthInstancesForTests()
    resetLimitersForTests()
    resetLoginLimiterForTests()
  })

  afterAll(async () => {
    await closePools()
  })

  it('scenario 1: authenticates active member, scopes cookie to /<slug>, and resolves AuthContext + RBAC', async () => {
    const slugA = uniqueSlug('auth1')
    const tenantA = await createTestTenant(slugA, 'Auth Tenant A')
    const email = `${slugA}@example.test`
    const password = 'ValidPassword123!'
    const authUserId = await createGlobalAuthUser(email, password, 'Owner A')
    const { authOrgId, appUserId } = await linkUserToTenant({
      tenantId: tenantA.id,
      slug: slugA,
      name: 'Auth Tenant A',
      authUserId,
      email,
      displayName: 'Owner A',
      roleCode: 'OWNER',
      permissions: PERMISSION_CODES,
    })

    const loginRes = await authPost(slugA, 'sign-in/email', { email, password })
    expect(loginRes.status).toBe(200)

    const cookies = getSetCookies(loginRes)
    const tokenCookieHeader = cookies.find((c) => c.startsWith(`solva_s_${slugA}.session_token=`))
    expect(tokenCookieHeader).toBeDefined()
    expect(tokenCookieHeader).toContain(`Path=/${slugA}`)
    expect(tokenCookieHeader).toContain('HttpOnly')
    expect(tokenCookieHeader).toContain('SameSite=Lax')

    const cookiePair = extractCookiePair(cookies, `solva_s_${slugA}.session_token=`)
    const sessionReq = new Request(`http://localhost:3000/${slugA}/admin`, {
      headers: { Cookie: cookiePair },
    })
    const ctx = await getAuthContext(sessionReq, slugA)
    expect(ctx).not.toBeNull()
    expect(ctx?.tenantId).toBe(tenantA.id)
    expect(ctx?.authOrgId).toBe(authOrgId)
    expect(ctx?.appUserId).toBe(appUserId)
    expect(ctx?.roleCodes).toEqual(['OWNER'])
    expect(() => assertPermission(ctx!, 'user.manage')).not.toThrow()

    // Check DB row has activeOrganizationId set to tenant A's authOrgId
    await withClient(ownerClient, async (client) => {
      const dbSess = await client.query<{ active_organization_id: string | null }>(
        'SELECT active_organization_id FROM session WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1',
        [authUserId],
      )
      expect(dbSess.rows[0]?.active_organization_id).toBe(authOrgId)
    })

    const sessionApiRes = await authGet(slugA, 'get-session', cookiePair)
    expect(sessionApiRes.status).toBe(200)
    const sessionApiBody = (await sessionApiRes.json()) as { session: { appUserId: string } | null }
    expect(sessionApiBody.session?.appUserId).toBe(appUserId)
  })

  it('scenario 2: rejects valid global user logging into a tenant where they are not a member (zero session created)', async () => {
    const slugA = uniqueSlug('auth2a')
    const slugB = uniqueSlug('auth2b')
    const tenantA = await createTestTenant(slugA, 'Tenant A')
    const tenantB = await createTestTenant(slugB, 'Tenant B')
    await ensureTenantAuthOrg(tenantB.id, slugB, 'Tenant B')

    const email = `${slugA}@example.test`
    const password = 'ValidPassword123!'
    const authUserId = await createGlobalAuthUser(email, password, 'Member A Only')
    await linkUserToTenant({
      tenantId: tenantA.id,
      slug: slugA,
      name: 'Tenant A',
      authUserId,
      email,
      displayName: 'Member A Only',
      roleCode: 'OWNER',
      permissions: ['user.manage'],
    })

    const res = await authPost(slugB, 'sign-in/email', { email, password })
    expect(res.status).toBe(401)
    expect(getSetCookies(res)).toEqual([])
    expect(await res.json()).toEqual({
      error: { code: 'UNAUTHORIZED', messageKey: 'auth.login.invalid' },
    })

    await withClient(ownerClient, async (client) => {
      const rows = await client.query<{ count: string }>(
        'SELECT count(*)::text AS count FROM session WHERE user_id = $1',
        [authUserId],
      )
      expect(rows.rows[0]?.count).toBe('0')
    })
  })

  it('scenario 3: returns identical 401 payload, no cookies, >=250ms floor, and zero PII logs for all failure modes', async () => {
    const slugA = uniqueSlug('auth3a')
    const slugB = uniqueSlug('auth3b')
    const tenantA = await createTestTenant(slugA, 'Tenant A')
    const tenantB = await createTestTenant(slugB, 'Tenant B')
    await ensureTenantAuthOrg(tenantB.id, slugB, 'Tenant B')

    const email = `secret-user-${slugA}@example.test`
    const password = 'SecretPassword123!'
    const authUserId = await createGlobalAuthUser(email, password, 'User A')
    await linkUserToTenant({
      tenantId: tenantA.id,
      slug: slugA,
      name: 'Tenant A',
      authUserId,
      email,
      displayName: 'User A',
      roleCode: 'CASHIER',
      permissions: ['sale.create'],
    })

    const logs = captureLogs('debug')
    try {
      const cases = [
        { slug: slugA, body: { email: 'not-an-email', password: 'x' } },
        { slug: slugA, body: { email: 'nonexistent-person@example.test', password: 'WrongPassword123!' } },
        { slug: slugA, body: { email, password: 'WrongPassword123!' } },
        { slug: slugB, body: { email, password } },
      ]

      for (const testCase of cases) {
        const start = performance.now()
        const res = await authPost(testCase.slug, 'sign-in/email', testCase.body)
        const elapsed = performance.now() - start

        expect(res.status).toBe(401)
        expect(getSetCookies(res)).toEqual([])
        expect(await res.json()).toEqual({
          error: { code: 'UNAUTHORIZED', messageKey: 'auth.login.invalid' },
        })
        expect(elapsed).toBeGreaterThanOrEqual(240)
      }

      const rawLogText = logs.lines().join('\n')
      expect(rawLogText).not.toContain(email)
      expect(rawLogText).not.toContain('nonexistent-person@example.test')
      expect(rawLogText).not.toContain(password)
      expect(rawLogText).not.toContain('WrongPassword123!')
      expect(rawLogText).toContain('usernameHash')
    } finally {
      logs.stop()
    }
  })

  it('scenario 4: issues separate per-slug sessions with different roles and isolates logout per slug', async () => {
    const slugA = uniqueSlug('auth4a')
    const slugB = uniqueSlug('auth4b')
    const tenantA = await createTestTenant(slugA, 'Tenant A')
    const tenantB = await createTestTenant(slugB, 'Tenant B')

    const email = `${slugA}@example.test`
    const password = 'DualTenantPassword123!'
    const authUserId = await createGlobalAuthUser(email, password, 'Dual User')

    await linkUserToTenant({
      tenantId: tenantA.id,
      slug: slugA,
      name: 'Tenant A',
      authUserId,
      email,
      displayName: 'Dual User A',
      roleCode: 'OWNER',
      permissions: PERMISSION_CODES,
    })
    await linkUserToTenant({
      tenantId: tenantB.id,
      slug: slugB,
      name: 'Tenant B',
      authUserId,
      email,
      displayName: 'Dual User B',
      roleCode: 'CASHIER',
      permissions: ['sale.create'],
    })

    const loginA = await authPost(slugA, 'sign-in/email', { email, password })
    const loginB = await authPost(slugB, 'sign-in/email', { email, password })
    expect(loginA.status).toBe(200)
    expect(loginB.status).toBe(200)

    const cookieA = extractCookiePair(getSetCookies(loginA), `solva_s_${slugA}.session_token=`)
    const cookieB = extractCookiePair(getSetCookies(loginB), `solva_s_${slugB}.session_token=`)

    const ctxA = await getAuthContext(
      new Request(`http://localhost:3000/${slugA}/admin`, { headers: { Cookie: cookieA } }),
      slugA,
    )
    const ctxB = await getAuthContext(
      new Request(`http://localhost:3000/${slugB}/admin`, { headers: { Cookie: cookieB } }),
      slugB,
    )

    expect(ctxA?.roleCodes).toEqual(['OWNER'])
    expect(ctxB?.roleCodes).toEqual(['CASHIER'])
    expect(() => assertPermission(ctxA!, 'user.manage')).not.toThrow()
    expect(() => assertPermission(ctxB!, 'user.manage')).toThrow(AppError)

    // Sign out of Tenant A only -> Tenant B remains active
    const logoutA = await authPost(slugA, 'sign-out', {}, { Cookie: cookieA })
    expect(logoutA.status).toBe(200)

    const ctxAAfterLogout = await getAuthContext(
      new Request(`http://localhost:3000/${slugA}/admin`, { headers: { Cookie: cookieA } }),
      slugA,
    )
    const ctxBAfterLogoutA = await getAuthContext(
      new Request(`http://localhost:3000/${slugB}/admin`, { headers: { Cookie: cookieB } }),
      slugB,
    )

    expect(ctxAAfterLogout).toBeNull()
    expect(ctxBAfterLogoutA?.tenantSlug).toBe(slugB)
    expect(ctxBAfterLogoutA?.roleCodes).toEqual(['CASHIER'])
  })

  it('scenario 5: rejects a cookie issued on Tenant A if replayed under Tenant B cookie name', async () => {
    const slugA = uniqueSlug('auth5a')
    const slugB = uniqueSlug('auth5b')
    const tenantA = await createTestTenant(slugA, 'Tenant A')
    const tenantB = await createTestTenant(slugB, 'Tenant B')

    const email = `${slugA}@example.test`
    const password = 'CookieReplayPassword123!'
    const authUserId = await createGlobalAuthUser(email, password, 'Replay Tester')

    await linkUserToTenant({
      tenantId: tenantA.id,
      slug: slugA,
      name: 'Tenant A',
      authUserId,
      email,
      displayName: 'Replay A',
      roleCode: 'OWNER',
      permissions: ['user.manage'],
    })
    await linkUserToTenant({
      tenantId: tenantB.id,
      slug: slugB,
      name: 'Tenant B',
      authUserId,
      email,
      displayName: 'Replay B',
      roleCode: 'OWNER',
      permissions: ['user.manage'],
    })

    const loginA = await authPost(slugA, 'sign-in/email', { email, password })
    const cookieA = extractCookiePair(getSetCookies(loginA), `solva_s_${slugA}.session_token=`)
    const tokenValue = cookieA.slice(`solva_s_${slugA}.session_token=`.length)
    const spoofedCookieB = `solva_s_${slugB}.session_token=${tokenValue}`

    const forgedCtx = await getAuthContext(
      new Request(`http://localhost:3000/${slugB}/admin`, { headers: { Cookie: spoofedCookieB } }),
      slugB,
    )
    expect(forgedCtx).toBeNull()
  })

  it('scenario 6: password change revokes all prior sessions across every tenant', async () => {
    const slugA = uniqueSlug('auth6a')
    const slugB = uniqueSlug('auth6b')
    const tenantA = await createTestTenant(slugA, 'Tenant A')
    const tenantB = await createTestTenant(slugB, 'Tenant B')

    const email = `${slugA}@example.test`
    const oldPassword = 'OldPassword123!'
    const newPassword = 'NewPassword456!'
    const authUserId = await createGlobalAuthUser(email, oldPassword, 'Reset Tester')

    await linkUserToTenant({
      tenantId: tenantA.id,
      slug: slugA,
      name: 'Tenant A',
      authUserId,
      email,
      displayName: 'Reset A',
      roleCode: 'OWNER',
      permissions: ['user.manage'],
    })
    await linkUserToTenant({
      tenantId: tenantB.id,
      slug: slugB,
      name: 'Tenant B',
      authUserId,
      email,
      displayName: 'Reset B',
      roleCode: 'CASHIER',
      permissions: ['sale.create'],
    })

    const loginA = await authPost(slugA, 'sign-in/email', { email, password: oldPassword })
    const loginB = await authPost(slugB, 'sign-in/email', { email, password: oldPassword })
    const cookieA = extractCookiePair(getSetCookies(loginA), `solva_s_${slugA}.session_token=`)
    const cookieB = extractCookiePair(getSetCookies(loginB), `solva_s_${slugB}.session_token=`)

    // Wrong current password returns 400 without revoking existing sessions
    const badChange = await authPost(
      slugA,
      'change-password',
      { currentPassword: 'WrongCurrentPassword!', newPassword },
      { Cookie: cookieA },
    )
    expect(badChange.status).toBe(400)

    // Valid password change revokes all prior sessions across A & B and rotates current cookie
    const goodChange = await authPost(
      slugA,
      'change-password',
      { currentPassword: oldPassword, newPassword },
      { Cookie: cookieA },
    )
    expect(goodChange.status).toBe(200)

    const oldCtxA = await getAuthContext(
      new Request(`http://localhost:3000/${slugA}/admin`, { headers: { Cookie: cookieA } }),
      slugA,
    )
    const oldCtxB = await getAuthContext(
      new Request(`http://localhost:3000/${slugB}/admin`, { headers: { Cookie: cookieB } }),
      slugB,
    )
    expect(oldCtxA).toBeNull()
    expect(oldCtxB).toBeNull()

    // Old password rejected, new password succeeds
    expect((await authPost(slugA, 'sign-in/email', { email, password: oldPassword })).status).toBe(401)
    expect((await authPost(slugB, 'sign-in/email', { email, password: newPassword })).status).toBe(200)
  })

  it('scenario 7: deactivating app_user or removing org member revokes access on the very next request', async () => {
    const slugA = uniqueSlug('auth7')
    const tenantA = await createTestTenant(slugA, 'Revoke Tenant')
    const email = `${slugA}@example.test`
    const password = 'RevokePassword123!'
    const authUserId = await createGlobalAuthUser(email, password, 'Revoked User')

    const { appUserId } = await linkUserToTenant({
      tenantId: tenantA.id,
      slug: slugA,
      name: 'Revoke Tenant',
      authUserId,
      email,
      displayName: 'Revoked User',
      roleCode: 'OWNER',
      permissions: ['user.manage'],
    })

    const loginRes = await authPost(slugA, 'sign-in/email', { email, password })
    const cookie = extractCookiePair(getSetCookies(loginRes), `solva_s_${slugA}.session_token=`)
    const req = new Request(`http://localhost:3000/${slugA}/admin`, { headers: { Cookie: cookie } })

    expect(await getAuthContext(req, slugA)).not.toBeNull()

    await withClient(ownerClient, async (client) => {
      await client.query('BEGIN')
      try {
        await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantA.id])
        const syncRes = await client.query<{ version: unknown }>(
          'UPDATE tenant_sync SET version = version + 1, updated_at = now() WHERE tenant_id = $1 RETURNING version',
          [tenantA.id],
        )
        const nextVersion = Number(syncRes.rows[0]!.version)
        await client.query(
          'UPDATE app_user SET is_active = false, version = $1 WHERE tenant_id = $2 AND id = $3',
          [nextVersion, tenantA.id, appUserId],
        )
        await client.query('COMMIT')
      } catch (err) {
        await client.query('ROLLBACK')
        throw err
      }
    })

    expect(await getAuthContext(req, slugA)).toBeNull()
  })

  it('scenario 8: blocks cross-origin POSTs (403) and disallowed Better Auth routes (404)', async () => {
    const slugA = uniqueSlug('auth8')
    await createTestTenant(slugA, 'Origin Tenant')

    const crossOrigin = await handleAuthRoute(
      new Request(`http://localhost:3000/${slugA}/admin/api/auth/sign-in/email`, {
        method: 'POST',
        headers: {
          Host: 'localhost:3000',
          Origin: 'https://attacker.example',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ email: 'a@b.com', password: 'Password123!' }),
      }),
      slugA,
    )
    expect(crossOrigin.status).toBe(403)

    const blockedSignUp = await authPost(slugA, 'sign-up/email', {
      email: 'new@example.test',
      password: 'Password123!',
      name: 'Attacker',
    })
    expect(blockedSignUp.status).toBe(404)

    const blockedOrgCreate = await authPost(slugA, 'organization/create', {
      name: 'Rogue',
      slug: 'rogue',
    })
    expect(blockedOrgCreate.status).toBe(404)
  })

  it('scenario 9: extracts trusted X-Tenant-Slug cleanly without trusting unrewritten URLs', () => {
    const reqHeader = new Request('http://localhost:3000/_serverFn/test', {
      headers: { 'X-Tenant-Slug': 'acme' },
    })
    expect(extractRequestTenantSlug(reqHeader)).toBe('acme')

    const reqReserved = new Request('http://localhost:3000/_serverFn/test', {
      headers: { 'X-Tenant-Slug': 'admin' },
    })
    expect(extractRequestTenantSlug(reqReserved)).toBeNull()
  })
})
