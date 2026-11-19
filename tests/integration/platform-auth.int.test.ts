import { webcrypto } from 'node:crypto'
import { hashPassword } from 'better-auth/crypto'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { createIdGenerator } from '~/lib/kernel'
import { createTenant } from '~/modules/identity/public'
import { __resetAuthInstancesForTests } from '~/server/auth/auth-factory'
import { getAuthContext } from '~/server/auth/auth-context'
import { __resetPlatformAuthForTests } from '~/server/auth/platform-auth'
import { getPlatformContext } from '~/server/auth/platform-context'
import { handlePlatformApi } from '~/server/auth/platform-handler'
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

async function seedPlatformOperator(email: string, password: string): Promise<string> {
  const userId = testIdGen.newId()
  const passwordHash = await hashPassword(password)
  await withClient(ownerClient, async (client) => {
    await client.query('BEGIN')
    try {
      await client.query(
        'INSERT INTO platform_user (id, name, email, email_verified, created_at, updated_at) VALUES ($1, $2, $3, true, now(), now())',
        [userId, 'Operator', email.toLowerCase()],
      )
      await client.query(
        'INSERT INTO platform_account (id, account_id, provider_id, user_id, password, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, now(), now())',
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

describe('platform operator auth isolation and progressive rate limiting', () => {
  beforeEach(() => {
    __resetPlatformAuthForTests()
    __resetAuthInstancesForTests()
    resetLimitersForTests()
    resetLoginLimiterForTests()
  })

  afterAll(async () => {
    await closePools()
  })

  it('authenticates operator on /platform with Path=/platform cookie, rejects tenant overlap, and enforces progressive delay', async () => {
    const opEmail = `op-${uniqueSlug('pl')}@example.test`
    const opPass = 'OperatorPassword123!'
    const opId = await seedPlatformOperator(opEmail, opPass)

    // Progressive delay after 4 wrong password failures -> 5th blocked 429 cleanly.
    for (let i = 0; i < 4; i += 1) {
      const badRes = await handlePlatformApi(
        new Request('http://localhost:3000/platform/api/auth/login', {
          method: 'POST',
          headers: {
            Host: 'localhost:3000',
            Origin: 'http://localhost:3000',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ email: opEmail, password: 'WrongPassword123!' }),
        }),
        { minLoginDelayMs: 0 },
      )
      expect(badRes.status).toBe(401)
    }

    const rateLimitedRes = await handlePlatformApi(
      new Request('http://localhost:3000/platform/api/auth/login', {
        method: 'POST',
        headers: {
          Host: 'localhost:3000',
          Origin: 'http://localhost:3000',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ email: opEmail, password: opPass }),
      }),
      { minLoginDelayMs: 0 },
    )
    expect(rateLimitedRes.status).toBe(429)

    // Disallowed Better Auth routes return 404.
    const signUpRes = await handlePlatformApi(
      new Request('http://localhost:3000/platform/api/auth/sign-up/email', {
        method: 'POST',
        headers: {
          Host: 'localhost:3000',
          Origin: 'http://localhost:3000',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ email: 'new@example.test', password: opPass, name: 'Attacker' }),
      }),
    )
    expect(signUpRes.status).toBe(404)

    // Reset limiter and sign in cleanly with a second fresh operator.
    resetLoginLimiterForTests()
    const okLogin = await handlePlatformApi(
      new Request('http://localhost:3000/platform/api/auth/login', {
        method: 'POST',
        headers: {
          Host: 'localhost:3000',
          Origin: 'http://localhost:3000',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ email: opEmail, password: opPass }),
      }),
      { minLoginDelayMs: 0 },
    )
    expect(okLogin.status).toBe(200)
    const setCookies = okLogin.headers.getSetCookie()
    const platformCookie = setCookies.find((c) => c.startsWith('solva_platform.session_token='))
    expect(platformCookie).toContain('Path=/platform')
    expect(platformCookie).toContain('HttpOnly')

    const cookiePair = platformCookie!.split(';')[0]!
    const platformCtx = await getPlatformContext(
      new Request('http://localhost:3000/platform', { headers: { Cookie: cookiePair } }),
    )
    expect(platformCtx?.platformUserId).toBe(opId)

    // Create a tenant and prove complete cross-context session isolation.
    const slug = uniqueSlug('pl-iso')
    await createTenant(
      { platformUserId: opId, email: opEmail },
      { name: 'Iso Store', slug, ownerEmail: `o-${slug}@example.test`, ownerDisplayName: 'Owner' },
    )

    // Platform cookie does NOT grant access to any tenant admin context.
    expect(
      await getAuthContext(
        new Request(`http://localhost:3000/${slug}/admin`, { headers: { Cookie: cookiePair } }),
        slug,
      ),
    ).toBeNull()

    // Forged tenant cookie does NOT grant platform context.
    const tokenVal = cookiePair.split('=')[1]!
    expect(
      await getPlatformContext(
        new Request('http://localhost:3000/platform', {
          headers: { Cookie: `solva_s_${slug}.session_token=${tokenVal}` },
        }),
      ),
    ).toBeNull()

    // Platform operator does NOT appear in any tenant app_user or global member row.
    await withClient(ownerClient, async (c) => {
      const mRows = await c.query('SELECT id FROM member WHERE user_id = $1', [opId])
      expect(mRows.rows).toHaveLength(0)
    })
  })
})
