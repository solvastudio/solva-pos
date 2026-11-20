import { readFileSync } from 'node:fs'
import { fileURLToPath, URL } from 'node:url'
import tailwindcss from '@tailwindcss/vite'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import viteReact from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

function readMigrationCount(): number {
  try {
    const journalPath = fileURLToPath(new URL('./drizzle/meta/_journal.json', import.meta.url))
    const raw = JSON.parse(readFileSync(journalPath, 'utf8')) as { entries?: unknown[] }
    return Array.isArray(raw.entries) ? raw.entries.length : 0
  } catch {
    return 0
  }
}

export default defineConfig({
  resolve: {
    alias: {
      '~': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  define: {
    __APP_VERSION__: JSON.stringify(process.env.APP_VERSION ?? 'dev'),
    __MIGRATION_COUNT__: JSON.stringify(readMigrationCount()),
  },
  build: {
    sourcemap: 'hidden',
  },
  server: {
    port: 3000,
  },
  plugins: [tanstackStart(), viteReact(), tailwindcss()],
})
