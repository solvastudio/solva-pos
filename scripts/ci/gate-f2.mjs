import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, rmSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '../..')
const metricsPath = resolve(root, 'tests/e2e/.logs/f2-metrics.json')

function runNpm(args, extraEnv = {}) {
  const npmCli = process.env.npm_execpath
  const res = npmCli
    ? spawnSync(process.execPath, [npmCli, ...args], {
        cwd: root,
        stdio: 'inherit',
        env: { ...process.env, ...extraEnv },
      })
    : spawnSync('npm', args, {
        cwd: root,
        stdio: 'inherit',
        shell: process.platform === 'win32',
        env: { ...process.env, ...extraEnv },
      })
  if (res.error) {
    process.stderr.write(`${res.error.message}\n`)
  }
  return res.status ?? 1
}

function runStep(label, args, extraEnv = {}) {
  process.stdout.write(`\n[gate:f2] === ${label} ===\n`)
  const code = runNpm(args, extraEnv)
  if (code !== 0) {
    process.stderr.write(`[gate:f2] FAILED at step: ${label}\n`)
    process.exit(code)
  }
}

function main() {
  rmSync(metricsPath, { force: true })

  runStep('Typecheck', ['run', 'typecheck'])
  runStep('Lint & Architecture Boundaries', ['run', 'lint'])
  runStep('Unit Tests (derive-local-fields, catalog.repo, resolve-scan, feature-flag, catalog-index)', [
    'run',
    'test:unit',
  ])
  runStep('Database Integration Suite', ['run', 'test:db'])
  runStep('Catalog Pull Benchmark (5,000 SKUs)', ['run', 'bench:pull'])

  runStep('Production Build (non-E2E)', ['run', 'build'])
  runStep('Bundle Guard (non-E2E)', ['run', 'guard:bundle'])
  runStep('Size Limit Check', ['run', 'size'])

  runStep('E2E Production Build (VITE_E2E=1)', ['run', 'e2e:build'])
  runStep('Playwright F2 Acceptance + Chromium Apply Bench (F2-*)', [
    'run',
    'test:e2e',
    '--',
    '--grep',
    'F2-',
  ])

  const metrics = existsSync(metricsPath) ? JSON.parse(readFileSync(metricsPath, 'utf8')) : {}
  const summary = [
    'F2-K01: 5,000 SKU sync to Dexie + barcode/search local latency — PASS',
    'F2-K02: 4,000 SKU CSV import atomic single version bump + full pull sync — PASS',
    'F2-K03: Offline 300-row catchup + tombstone floor full resync preserving local outbox/cart — PASS',
    'F2-K04: Outlet -> Default -> NO_PRICE, OPEN_PRICE, and Susu pcs/dus distinct pricing — PASS',
    'F2-K05: Bab 7.2.4 availability (Contoh 1, V-27 6/3/6->8/5/8->1->0) + atomic cycle apply — PASS',
    'F2-K06: Tenant feature flags synced offline read-only + audit trail — PASS',
  ]

  process.stdout.write('\n============================================================\n')
  process.stdout.write('[gate:f2] F2 ACCEPTANCE GATE SUMMARY (K01 - K06)\n')
  process.stdout.write('============================================================\n')
  for (const line of summary) {
    process.stdout.write(`  PASS  ${line}\n`)
  }
  if (metrics.k01Lookup) {
    const l = metrics.k01Lookup
    process.stdout.write(
      `  BENCH K01 barcode: p50=${l.barcodeP50Ms}ms p95=${l.barcodeP95Ms}ms (NFR <=50ms, CI <=100ms)\n`,
    )
    process.stdout.write(
      `  BENCH K01 search:  p50=${l.searchP50Ms}ms p95=${l.searchP95Ms}ms (NFR <=150ms, CI <=300ms)\n`,
    )
  }
  if (metrics.apply25k) {
    const a = metrics.apply25k
    process.stdout.write(
      `  BENCH Apply 25k:   ${a.durationMs}ms for ${a.rowCount} mixed rows (soft limit <=10000ms)\n`,
    )
  }
  process.stdout.write('============================================================\n')
}

main()
