import { webcrypto } from 'node:crypto'
import { hashPassword } from 'better-auth/crypto'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { createIdGenerator } from '~/lib/kernel'
import * as authFactory from '~/server/auth/auth-factory'
import { handleAuthRoute } from '~/server/auth/login-handler'
import { resetLimitersForTests } from '~/server/auth/rate-limit/limiters'
import {
  __setLoginLimiterClockForTests,
  resetLoginLimiterForTests,
} from '~/server/auth/rate-limit/login-limiter'
import { closePools } from '~/server/db'
import { resetEnvForTests } from '~/server/env'
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

async function setupTenantWithUser(
  slug: string,
  email: string,
  password: string,
): Promise<{ tenantId: string }> {
  const tenant = await createTestTenant(slug, `RL ${slug}`)
  const authOrgId = testIdGen.newId()
  const authUserId = testIdGen.newId()
  const appUserId = testIdGen.newId()
  const roleId = testIdGen.newId()
  const passwordHash = await hashPassword(password)

  await withClient(ownerClient, async (client) => {
    await client.query('BEGIN')
    try {
      await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenant.id])
      await client.query(
        'INSERT INTO organization (id, name, slug, created_at) VALUES ($1, $2, $3, now())',
        [authOrgId, `RL ${slug}`, slug],
      )
      await client.query('UPDATE tenant SET auth_org_id = $1 WHERE id = $2', [authOrgId, tenant.id])

      await client.query(
        'INSERT INTO "user" (id, name, email, email_verified, created_at, updated_at) VALUES ($1, $2, $3, true, now(), now())',
        [authUserId, 'RL User', email.toLowerCase()],
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
        [tenant.id, roleId, version],
      )
      await client.query(
        `INSERT INTO app_user (tenant_id, id, auth_user_id, display_name, is_active, membership_status, version)
         VALUES ($1, $2, $3, 'RL User', true, 'ACTIVE', $4)`,
        [tenant.id, appUserId, authUserId, version],
      )
      await client.query(
        `INSERT INTO user_outlet (tenant_id, id, user_id, outlet_id, role_id, version)
         VALUES ($1, $2, $3, NULL, $4, $5)`,
        [tenant.id, testIdGen.newId(), appUserId, roleId, version],
      )
      await client.query('COMMIT')
    } catch (err) {
      await client.query('ROLLBACK')
      throw err
    }
  })

  return { tenantId: tenant.id }
}

function postLogin(
  slug: string,
  email: string,
  password: string,
  nowMs?: () => number,
) {
  return handleAuthRoute(
    new Request(`http://localhost:3000/${slug}/admin/api/auth/sign-in/email`, {
      method: 'POST',
      headers: {
        Host: 'localhost:3000',
        Origin: 'http://localhost:3000',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ email, password }),
    }),
    slug,
    { minLoginDelayMs: 0, nowMs },
  )
}

describe('login progressive rate limit integration', () => {
  const prevAlertThreshold = process.env.RL_LOGIN_SLUG_ALERT_THRESHOLD
  const prevTarpitMs = process.env.RL_LOGIN_SLUG_TARPIT_MS

  beforeEach(() => {
    vi.restoreAllMocks()
    resetEnvForTests()
    resetLimitersForTests()
    resetLoginLimiterForTests()
    authFactory.__resetAuthInstancesForTests()
  })

  afterAll(async () => {
    if (prevAlertThreshold === undefined) {
      delete process.env.RL_LOGIN_SLUG_ALERT_THRESHOLD
    } else {
      process.env.RL_LOGIN_SLUG_ALERT_THRESHOLD = prevAlertThreshold
    }
    if (prevTarpitMs === undefined) {
      delete process.env.RL_LOGIN_SLUG_TARPIT_MS
    } else {
      process.env.RL_LOGIN_SLUG_TARPIT_MS = prevTarpitMs
    }
    resetEnvForTests()
    await closePools()
  })

  it('triggers 30s delay on 4th failure and rejects subsequent attempts (even valid password) with 429 without verifying password', async () => {
    const slug = uniqueSlug('rl1')
    const email = `${slug}@example.test`
    const otherEmail = `${slug}-other@example.test`
    const password = 'CorrectPassword123!'
    await setupTenantWithUser(slug, email, password)
    await setupTenantWithUser(uniqueSlug('rl1b'), otherEmail, password)

    let fakeNow = 1_760_000_000_000
    __setLoginLimiterClockForTests(() => fakeNow)

    // Failures 1..3 allow attempt & return 401; failure 4 initiates 30s delay.
    for (let i = 1; i <= 4; i += 1) {
      const res = await postLogin(slug, email, 'WrongPass!', () => fakeNow)
      expect(res.status).toBe(401)
      fakeNow += 100
    }

    // Attempt 5 with CORRECT password is rejected 429 WITHOUT verifying password.
    const authSpy = vi.spyOn(authFactory, 'createTenantAuth')
    const blockedRes = await postLogin(slug, email, password, () => fakeNow)
    expect(blockedRes.status).toBe(429)
    expect(blockedRes.headers.get('Retry-After')).toBe('30')
    expect(await blockedRes.json()).toMatchObject({
      error: { code: 'RATE_LIMITED', class: 'authorization' },
      retry_after_minutes: 1,
    })
    expect(authSpy).not.toHaveBeenCalled()

    // Nonexistent email gets identical 429 shape after 4 failures (anti-enumeration).
    const ghostEmail = `ghost-${slug}@example.test`
    for (let i = 1; i <= 4; i += 1) {
      expect((await postLogin(slug, ghostEmail, 'WrongPass!', () => fakeNow)).status).toBe(401)
    }
    const ghostBlocked = await postLogin(slug, ghostEmail, 'WrongPass!', () => fakeNow)
    expect(ghostBlocked.status).toBe(429)
    expect(await ghostBlocked.json()).toMatchObject({
      error: { code: 'RATE_LIMITED', class: 'authorization' },
      retry_after_minutes: 1,
    })

    // A different email on the same tenant is NOT blocked.
    const otherSlug = uniqueSlug('rl1c')
    await setupTenantWithUser(otherSlug, `clean-${otherSlug}@example.test`, password)
    const cleanRes = await postLogin(otherSlug, `clean-${otherSlug}@example.test`, password, () => fakeNow)
    expect(cleanRes.status).toBe(200)

    // After 30s passes, valid login on original account succeeds and clears failure count.
    fakeNow += 30_000
    const recoveredRes = await postLogin(slug, email, password, () => fakeNow)
    expect(recoveredRes.status).toBe(200)
  })

  it('activates slug alert mode after threshold failures, shortening delay onset to 2nd failure', async () => {
    process.env.RL_LOGIN_SLUG_ALERT_THRESHOLD = '5'
    process.env.RL_LOGIN_SLUG_TARPIT_MS = '5'
    resetEnvForTests()
    resetLimitersForTests()
    resetLoginLimiterForTests()

    const slug = uniqueSlug('rl2')
    const password = 'AlertPassword123!'
    const targetEmail = `target-${slug}@example.test`
    await setupTenantWithUser(slug, targetEmail, password)

    let fakeNow = 1_760_100_000_000
    __setLoginLimiterClockForTests(() => fakeNow)

    // 5 failures across distinct emails trip slug alert mode.
    for (let i = 0; i < 5; i += 1) {
      const res = await postLogin(slug, `spray-${i}@example.test`, 'BadPass!', () => fakeNow)
      expect(res.status).toBe(401)
      fakeNow += 50
    }

    // Now on a fresh account in that slug, delay triggers on the 2nd failure instead of 4th.
    expect((await postLogin(slug, targetEmail, 'BadPass!', () => fakeNow)).status).toBe(401)
    expect((await postLogin(slug, targetEmail, 'BadPass!', () => fakeNow)).status).toBe(401)
    const blockedOn3rd = await postLogin(slug, targetEmail, password, () => fakeNow)
    expect(blockedOn3rd.status).toBe(429)
  })
})
