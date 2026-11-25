import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

const rootAlias = {
  '~': fileURLToPath(new URL('./src', import.meta.url)),
  '@tanstack/react-start/server-only': fileURLToPath(new URL('./tests/empty-module.ts', import.meta.url)),
}

export default defineConfig({
  test: {
    projects: [
      {
        resolve: { alias: rootAlias },
        test: {
          name: 'unit',
          include: [
            'src/**/*.test.ts',
            'src/**/*.test.tsx',
            'scripts/**/*.test.ts',
            'scripts/**/*.test.mjs',
            'tests/arch/**/*.test.ts',
          ],
          environment: 'node',
          // jsdom + axe screen tests take 3-7 s when 100+ files run in parallel; the 5 s default made
          // them flaky (they pass alone), so give the whole project a realistic budget.
          testTimeout: 30_000,
          setupFiles: ['./tests/setup-ui.ts', 'fake-indexeddb/auto'],
        },
      },
      {
        resolve: { alias: rootAlias },
        test: {
          name: 'db',
          include: [
            'tests/integration/**/*.int.test.ts',
            'tests/property/**/*.prop.test.ts',
          ],
          globalSetup: ['./tests/integration/global-setup.ts'],
          setupFiles: ['fake-indexeddb/auto'],
          environment: 'node',
          testTimeout: 60_000,
          hookTimeout: 60_000,
          pool: 'forks',
          maxWorkers: 1,
          fileParallelism: false,
        },
      },
    ],
  },
})
