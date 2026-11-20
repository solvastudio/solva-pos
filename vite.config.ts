/**
 * PWA Shell Strategy — Option A (Spike F1 recommendation approved by user):
 * Uses TanStack Start `spa` prerendering (`maskPath: '/_shell/pos'`, `outputPath: '/pos-shell'`)
 * together with `vite-plugin-pwa` (`strategies: 'injectManifest'`, `registerType: 'prompt'`)
 * and `pwaAfterStartBuild()` so Vite 8 Environment API `buildApp` triggers Workbox manifest
 * injection after `/pos-shell.html` is prerendered, avoiding custom shell HTML duplication.
 */
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath, URL } from 'node:url'
import tailwindcss from '@tailwindcss/vite'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import viteReact from '@vitejs/plugin-react'
import { defineConfig, type PluginOption } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

function readMigrationCount(): number {
  try {
    const journalPath = fileURLToPath(new URL('./drizzle/meta/_journal.json', import.meta.url))
    const raw = JSON.parse(readFileSync(journalPath, 'utf8')) as { entries?: unknown[] }
    return Array.isArray(raw.entries) ? raw.entries.length : 0
  } catch {
    return 0
  }
}

function relocateClientSourcemaps(clientDir: string, archiveDir: string): void {
  if (!existsSync(clientDir)) return
  mkdirSync(archiveDir, { recursive: true })
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) {
        walk(full)
      } else if (entry.name.endsWith('.map')) {
        const rel = relative(clientDir, full)
        const dest = join(archiveDir, rel)
        mkdirSync(join(dest, '..'), { recursive: true })
        cpSync(full, dest)
        rmSync(full)
      }
    }
  }
  walk(clientDir)
}

function pwaAfterStartBuild(): PluginOption {
  let pwaApi: { generateSW: () => Promise<unknown> } | undefined
  const clientOutDir = fileURLToPath(new URL('./dist/client', import.meta.url))
  const clientMapArchive = fileURLToPath(new URL('./sourcemaps/client', import.meta.url))

  return {
    name: 'solva:pwa-after-start',
    apply: 'build',
    enforce: 'post',
    configResolved(config) {
      const pwa = config.plugins.find((p) => p.name === 'vite-plugin-pwa')
      pwaApi = pwa?.api as typeof pwaApi
    },
    buildApp: {
      order: 'post',
      async handler() {
        if (pwaApi) {
          await pwaApi.generateSW()
        }
        // Remove hidden .map files from public dist/client after SW manifest generation.
        relocateClientSourcemaps(clientOutDir, clientMapArchive)
      },
    },
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
    manifest: true,
  },
  server: {
    port: 3000,
  },
  plugins: [
    tanstackStart({
      spa: {
        enabled: true,
        maskPath: '/_shell/pos',
        prerender: {
          outputPath: '/pos-shell',
        },
      },
    }),
    viteReact(),
    tailwindcss(),
    VitePWA({
      strategies: 'injectManifest',
      srcDir: 'src/pwa',
      filename: 'sw.ts',
      outDir: 'dist/client',
      registerType: 'prompt',
      injectRegister: false,
      manifest: false,
      devOptions: {
        enabled: false,
      },
      injectManifest: {
        rollupFormat: 'iife',
        globDirectory: 'dist/client',
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        globIgnores: [
          '**/*.map',
          '**/admin*.js',
          '**/join*.js',
          '**/reset*.js',
          '**/platform*.js',
          '**/tenants.*.js',
          '**/_dev*',
          '**/PlatformShell*.js',
        ],
        maximumFileSizeToCacheInBytes: 3_000_000,
      },
    }),
    pwaAfterStartBuild(),
  ],
})
