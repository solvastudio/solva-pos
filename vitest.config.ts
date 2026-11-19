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
          include: ['src/**/*.test.ts', 'src/**/*.test.tsx', 'scripts/**/*.test.ts', 'tests/arch/**/*.test.ts'],
          environment: 'node',
          setupFiles: ['./tests/setup-ui.ts'],
        },
      },
      {
        resolve: { alias: rootAlias },
        test: {
          name: 'db',
          include: ['tests/integration/**/*.int.test.ts'],
          globalSetup: ['./tests/integration/global-setup.ts'],
          environment: 'node',
          testTimeout: 30_000,
          hookTimeout: 60_000,
          pool: 'forks',
          maxWorkers: 1,
          fileParallelism: false,
        },
      },
    ],
  },
})
