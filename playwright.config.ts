import { resolve } from 'node:path'
import { defineConfig, devices } from '@playwright/test'

function deriveE2eDatabaseUrls(): { appUrl: string; ownerUrl: string } {
  const adminUrl =
    process.env.TEST_ADMIN_URL ?? 'postgres://postgres:postgres@localhost:5432/postgres'
  const parsed = new URL(adminUrl)
  const host = parsed.hostname.includes(':') ? `[${parsed.hostname}]` : parsed.hostname || 'localhost'
  const port = parsed.port || '5432'
  return {
    appUrl: `postgres://solva_app_login:solva_app_dev@${host}:${port}/solva_e2e`,
    ownerUrl: `postgres://solva_owner:solva_owner_dev@${host}:${port}/solva_e2e`,
  }
}

const { appUrl, ownerUrl } = deriveE2eDatabaseUrls()
const e2ePort = Number(process.env.E2E_PORT ?? '3100')
const e2eLogDir = resolve('tests/e2e/.logs')
const e2eAuthSecret =
  process.env.E2E_BETTER_AUTH_SECRET || 'solva-e2e-staging-better-auth-secret-32chars'

// Ensure Playwright test workers also target isolated solva_e2e rather than dev .env.local.
process.env.APP_ENV = 'staging'
process.env.DATABASE_URL = appUrl
process.env.DATABASE_OWNER_URL = ownerUrl
process.env.BETTER_AUTH_SECRET = e2eAuthSecret
process.env.TRUSTED_PROXY_CIDR = '127.0.0.0/8'
process.env.AUTH_COOKIE_SECURE = 'false'
process.env.PUBLIC_BASE_URL = `http://localhost:${e2ePort}`

export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  timeout: 60_000,
  expect: {
    timeout: 10_000,
  },
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: `http://localhost:${e2ePort}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    serviceWorkers: 'allow',
  },
  projects: [
    {
      name: 'chromium',
      testIgnore: /f1-viewport\.spec\.ts/,
      use: {
        ...devices['Desktop Chrome'],
      },
    },
    {
      name: 'chromium-tablet',
      testMatch: /f1-viewport\.spec\.ts/,
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 800, height: 1280 },
      },
    },
  ],
  webServer: {
    command: 'node scripts/ci/e2e-webserver.mjs',
    url: `http://localhost:${e2ePort}/health`,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
    env: {
      ...process.env,
      APP_ENV: 'staging',
      PORT: String(e2ePort),
      DATABASE_URL: appUrl,
      DATABASE_OWNER_URL: ownerUrl,
      BETTER_AUTH_SECRET: e2eAuthSecret,
      AUTH_COOKIE_SECURE: 'false',
      TRUSTED_PROXY_CIDR: '127.0.0.0/8',
      PUBLIC_BASE_URL: `http://localhost:${e2ePort}`,
      LOG_DIR: e2eLogDir,
      LOG_LEVEL: 'info',
    },
  },
})
