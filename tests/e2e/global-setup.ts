import { randomBytes, webcrypto } from 'node:crypto'
import { mkdirSync, readFileSync, rmSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { hashPassword } from 'better-auth/crypto'
import { Client } from 'pg'
import { createIdGenerator } from '../../src/lib/kernel'
import {
  __clearTenantCacheForTests,
  createInvite,
  createLegalEntity,
  createOutlet,
  createRegister,
  createTenant,
  getTenantAuthMetadataBySlug,
  listRolesWithPermissions,
  redeemInvite,
  type IdentityAuthActor,
  type PlatformOperatorActor,
} from '../../src/modules/identity/public'
import { PERMISSION_CODES } from '../../src/modules/identity/shared'
import { __resetAuthInstancesForTests } from '../../src/server/auth/auth-factory'
import { resetLimitersForTests } from '../../src/server/auth/rate-limit/limiters'
import { resetLoginLimiterForTests } from '../../src/server/auth/rate-limit/login-limiter'
import { closePools } from '../../src/server/db'
import { runMigrations } from '../../scripts/db-migrate'
import { E2E_LOG_DIR, writeE2eState } from './helpers/seed'

const setupIdGen = createIdGenerator({
  nowMs: () => Date.now(),
  nextUint32: () => {
    const buf = new Uint32Array(1)
    webcrypto.getRandomValues(buf)
    return buf[0]!
  },
})

function randomTestPassword(): string {
  return `S0lva-${randomBytes(12).toString('base64url')}!`
}

export default async function globalSetup(): Promise<void> {
  const adminUrl =
    process.env.TEST_ADMIN_URL ?? 'postgres://postgres:postgres@localhost:5432/postgres'
  const rolesSql = readFileSync(resolve('docker/init-roles.sql'), 'utf8')

  const parsed = new URL(adminUrl)
  const host = parsed.hostname.includes(':') ? `[${parsed.hostname}]` : parsed.hostname || 'localhost'
  const port = parsed.port || '5432'
  const e2ePort = Number(process.env.E2E_PORT ?? '3100')
  const baseUrl = `http://localhost:${e2ePort}`

  const appUrl = `postgres://solva_app_login:solva_app_dev@${host}:${port}/solva_e2e`
  const ownerUrl = `postgres://solva_owner:solva_owner_dev@${host}:${port}/solva_e2e`

  const admin = new Client({ connectionString: adminUrl })
  await admin.connect()
  try {
    await admin.query(rolesSql)
    await admin.query('DROP DATABASE IF EXISTS solva_e2e WITH (FORCE)')
    await admin.query('CREATE DATABASE solva_e2e OWNER solva_owner')
  } finally {
    await admin.end()
  }

  rmSync(E2E_LOG_DIR, { recursive: true, force: true })
  mkdirSync(E2E_LOG_DIR, { recursive: true })

  process.env.APP_ENV = 'staging'
  process.env.DATABASE_URL = appUrl
  process.env.DATABASE_OWNER_URL = ownerUrl
  process.env.BETTER_AUTH_SECRET =
    process.env.E2E_BETTER_AUTH_SECRET || 'solva-e2e-staging-better-auth-secret-32chars'
  process.env.AUTH_COOKIE_SECURE = 'false'
  process.env.TRUSTED_PROXY_CIDR = '127.0.0.0/8'
  process.env.PUBLIC_BASE_URL = baseUrl
  process.env.LOG_DIR = E2E_LOG_DIR
  process.env.LOG_LEVEL = 'info'

  __clearTenantCacheForTests()
  __resetAuthInstancesForTests()
  resetLimitersForTests()
  resetLoginLimiterForTests()

  await runMigrations(ownerUrl)

  const platformEmail = 'operator@solva.example'
  const platformPassword = randomTestPassword()
  const budiPassword = randomTestPassword()
  const aniPassword = randomTestPassword()
  const citraPassword = randomTestPassword()

  // Seed Platform Operator directly into platform_user / platform_account.
  const operatorUserId = setupIdGen.newId()
  const operatorAccountId = setupIdGen.newId()
  const opClient = new Client({ connectionString: ownerUrl })
  await opClient.connect()
  try {
    await opClient.query(
      'INSERT INTO platform_user (id, name, email, email_verified, created_at, updated_at) VALUES ($1, $2, $3, true, now(), now())',
      [operatorUserId, 'Platform Operator', platformEmail],
    )
    await opClient.query(
      'INSERT INTO platform_account (id, account_id, provider_id, user_id, password, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, now(), now())',
      [operatorAccountId, operatorUserId, 'credential', operatorUserId, await hashPassword(platformPassword)],
    )
  } finally {
    await opClient.end()
  }

  const opActor: PlatformOperatorActor = {
    platformUserId: operatorUserId,
    email: platformEmail,
  }

  // Create acme ("Acme Coffee", Owner budi) & beta ("Beta", Owner ani) via official createTenant service.
  const acmeCreated = await createTenant(opActor, {
    name: 'Acme Coffee',
    slug: 'acme',
    ownerEmail: 'budi@example.test',
    ownerDisplayName: 'Budi Owner',
  })
  const acmeMeta = (await getTenantAuthMetadataBySlug('acme'))!
  await redeemInvite({
    tenantId: acmeCreated.tenantId,
    tenantSlug: 'acme',
    authOrgId: acmeMeta.authOrgId,
    email: 'budi@example.test',
    code: acmeCreated.ownerInvite.code,
    password: budiPassword,
  })

  const betaCreated = await createTenant(opActor, {
    name: 'Beta',
    slug: 'beta',
    ownerEmail: 'ani@example.test',
    ownerDisplayName: 'Ani Owner',
  })
  const betaMeta = (await getTenantAuthMetadataBySlug('beta'))!
  await redeemInvite({
    tenantId: betaCreated.tenantId,
    tenantSlug: 'beta',
    authOrgId: betaMeta.authOrgId,
    email: 'ani@example.test',
    code: betaCreated.ownerInvite.code,
    password: aniPassword,
  })

  const budiActor: IdentityAuthActor = {
    tenantId: acmeCreated.tenantId,
    tenantSlug: 'acme',
    authOrgId: acmeMeta.authOrgId,
    appUserId: acmeCreated.ownerInvite.appUserId,
    permissions: new Set(PERMISSION_CODES),
    outletIds: null,
    roleCodes: ['OWNER'],
  }

  const aniBetaActor: IdentityAuthActor = {
    tenantId: betaCreated.tenantId,
    tenantSlug: 'beta',
    authOrgId: betaMeta.authOrgId,
    appUserId: betaCreated.ownerInvite.appUserId,
    permissions: new Set(PERMISSION_CODES),
    outletIds: null,
    roleCodes: ['OWNER'],
  }

  // Provision Legal Entity, Outlet OUT01, and Register POS01 in acme & beta via identity services.
  const acmeLe = await createLegalEntity(budiActor, {
    name: 'PT Acme Coffee Indonesia',
    npwp: null,
    isPkp: false,
  })
  const acmeOutlet = await createOutlet(budiActor, {
    legalEntityId: acmeLe.id,
    code: 'OUT01',
    name: 'Outlet 01',
    timezone: 'Asia/Jakarta',
    dayCutoffTime: '00:00',
    priceTaxMode: 'INCLUSIVE',
    taxProfile: 'NONE',
  })
  const acmeRegister = await createRegister(budiActor, {
    outletId: acmeOutlet.id,
    code: 'POS01',
    name: 'POS 01',
    registerType: 'CASHIER',
    invoicePrefix: 'OUT01-POS01',
    paperWidthMm: 80,
  })

  const betaLe = await createLegalEntity(aniBetaActor, {
    name: 'PT Beta Retail',
    npwp: null,
    isPkp: false,
  })
  const betaOutlet = await createOutlet(aniBetaActor, {
    legalEntityId: betaLe.id,
    code: 'OUT01',
    name: 'Beta Outlet 01',
    timezone: 'Asia/Jakarta',
    dayCutoffTime: '00:00',
    priceTaxMode: 'INCLUSIVE',
    taxProfile: 'NONE',
  })
  const betaRegister = await createRegister(aniBetaActor, {
    outletId: betaOutlet.id,
    code: 'POS01',
    name: 'Beta POS 01',
    registerType: 'CASHIER',
    invoicePrefix: 'BETA-POS01',
    paperWidthMm: 80,
  })

  // Invite ani@ and citra@ into acme cleanly.
  const acmeRoles = await listRolesWithPermissions(budiActor)
  const cashierRole = acmeRoles.find((r) => r.code === 'CASHIER') ?? acmeRoles[0]!

  const aniAcmeInvite = await createInvite(budiActor, {
    email: 'ani@example.test',
    displayName: 'Ani Cashier',
    roleId: cashierRole.id,
    outletIds: null,
  })
  const aniAcmeRedeem = await redeemInvite({
    tenantId: acmeCreated.tenantId,
    tenantSlug: 'acme',
    authOrgId: acmeMeta.authOrgId,
    email: 'ani@example.test',
    code: aniAcmeInvite.code,
    password: aniPassword,
  })
  if (!aniAcmeRedeem.ok) {
    throw new Error('Failed to redeem ani@ invite for acme in globalSetup')
  }

  const citraInvite = await createInvite(budiActor, {
    email: 'citra@example.test',
    displayName: 'Citra Kasir',
    roleId: cashierRole.id,
    outletIds: [acmeOutlet.id],
  })
  const citraRedeem = await redeemInvite({
    tenantId: acmeCreated.tenantId,
    tenantSlug: 'acme',
    authOrgId: acmeMeta.authOrgId,
    email: 'citra@example.test',
    code: citraInvite.code,
    password: citraPassword,
  })
  if (!citraRedeem.ok) {
    throw new Error('Failed to redeem citra@ invite for acme in globalSetup')
  }

  writeE2eState({
    baseUrl,
    e2eDbAppUrl: appUrl,
    e2eDbOwnerUrl: ownerUrl,
    logDir: E2E_LOG_DIR,
    platformAdmin: {
      email: platformEmail,
      password: platformPassword,
    },
    users: {
      budi: {
        email: 'budi@example.test',
        password: budiPassword,
        displayName: 'Budi Owner',
        acmeAppUserId: acmeCreated.ownerInvite.appUserId,
      },
      ani: {
        email: 'ani@example.test',
        password: aniPassword,
        displayName: 'Ani Owner',
        acmeAppUserId: aniAcmeRedeem.appUserId,
        betaAppUserId: betaCreated.ownerInvite.appUserId,
      },
      citra: {
        email: 'citra@example.test',
        password: citraPassword,
        displayName: 'Citra Kasir',
        acmeAppUserId: citraRedeem.appUserId,
      },
    },
    tenants: {
      acme: {
        id: acmeCreated.tenantId,
        slug: 'acme',
        name: 'Acme Coffee',
        authOrgId: acmeMeta.authOrgId,
        legalEntityId: acmeLe.id,
        outletId: acmeOutlet.id,
        registerId: acmeRegister.id,
      },
      beta: {
        id: betaCreated.tenantId,
        slug: 'beta',
        name: 'Beta',
        authOrgId: betaMeta.authOrgId,
        legalEntityId: betaLe.id,
        outletId: betaOutlet.id,
        registerId: betaRegister.id,
      },
    },
  })

  await closePools()
}

const isEntrypoint =
  typeof process.argv[1] === 'string' &&
  resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))

if (isEntrypoint) {
  globalSetup().catch((err) => {
    process.stderr.write(`${err instanceof Error ? err.stack ?? err.message : String(err)}\n`)
    process.exitCode = 1
  })
}
