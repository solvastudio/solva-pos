import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative, resolve } from 'node:path'

/**
 * F3 gate (K01–K12). The status of each K is computed from real test results (JSON reporter),
 * not typed by hand. Stops at the first failing step.
 */

const root = resolve(import.meta.dirname, '../..')
// JSON reports are stored outside the folder that the E2E setup cleans (tests/e2e/.logs).
const reportDir = join(tmpdir(), 'solva-gate-f3')
const unitJson = join(reportDir, 'unit.json')
const dbJson = join(reportDir, 'db.json')
const e2eJson = join(reportDir, 'e2e.json')

/** F3 test-vector IDs (PRD Appendix D) that must appear in the source tests. */
const F3_VECTOR_IDS = ['V-04', 'V-05', 'V-06', 'V-07', 'V-08', 'V-09', 'V-10', 'V-11', 'V-18', 'V-21', 'V-30']

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
  process.stdout.write(`\n[gate:f3] === ${label} ===\n`)
  const code = runNpm(args, extraEnv)
  if (code !== 0) {
    process.stderr.write(`[gate:f3] FAILED at step: ${label} (exit ${code})\n`)
    process.exit(code)
  }
}

/** Collects {title, ok} from the Vitest JSON report. */
function readVitestJson(path) {
  if (!existsSync(path)) return []
  const data = JSON.parse(readFileSync(path, 'utf8'))
  const out = []
  for (const file of data.testResults ?? []) {
    for (const a of file.assertionResults ?? []) {
      out.push({ file: relative(root, file.name).replace(/\\/g, '/'), title: a.fullName ?? a.title, ok: a.status === 'passed' })
    }
  }
  return out
}

/** Collects {title, ok} from the Playwright JSON report (nested suites). */
function readPlaywrightJson(path) {
  if (!existsSync(path)) return []
  const data = JSON.parse(readFileSync(path, 'utf8'))
  const out = []
  const walk = (suite) => {
    for (const spec of suite.specs ?? []) {
      out.push({ title: spec.title, ok: spec.ok === true })
    }
    for (const child of suite.suites ?? []) walk(child)
  }
  for (const s of data.suites ?? []) walk(s)
  return out
}

function listFiles(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) {
      if (name === 'node_modules' || name === '.git' || name === 'dist' || name === '.output') continue
      listFiles(full, out)
    } else if (/\.test\.(ts|tsx)$/.test(name)) {
      out.push(full)
    }
  }
  return out
}

/** Ensures every F3 vector ID appears in at least one test file (source side). */
function checkVectorCoverage() {
  const files = [...listFiles(join(root, 'src')), ...listFiles(join(root, 'tests'))]
  const missing = []
  for (const id of F3_VECTOR_IDS) {
    const re = new RegExp(`\\b${id}\\b`)
    const found = files.some((f) => re.test(readFileSync(f, 'utf8')))
    if (!found) missing.push(id)
  }
  return missing
}

function dockerReady() {
  return spawnSync('docker', ['info'], { stdio: 'ignore' }).status === 0
}

function statusOf(items, partial = false) {
  if (items.length === 0) return 'MISSING'
  if (!items.every((i) => i.ok)) return 'FAIL'
  return partial ? 'PARTIAL' : 'PASS'
}

function main() {
  rmSync(reportDir, { recursive: true, force: true })
  mkdirSync(reportDir, { recursive: true })

  runStep('Typecheck', ['run', 'typecheck'])
  runStep('Lint & Architecture Boundaries', ['run', 'lint'])
  runStep('Unit Tests (including F3-K06, F3-K09)', ['run', 'test:unit', '--', '--reporter=default', '--reporter=json', `--outputFile.json=${unitJson}`])
  runStep('Database Suite: acceptance F3-K* + properties (FC_NUM_RUNS=200)', [
    'run',
    'test:db',
    '--',
    '--reporter=default',
    '--reporter=json',
    `--outputFile.json=${dbJson}`,
  ], { FC_NUM_RUNS: '200' })
  // The Nginx check needs Docker. On machines without Docker it is skipped with a warning (same as gate:f1);
  // CI must run it.
  if (dockerReady()) {
    runStep('Nginx Rate-Limit Check', ['run', 'test:nginx'])
  } else {
    process.stdout.write('\n[gate:f3] WARNING: Docker is not available; the Nginx Rate-Limit Check is skipped on this machine (required in CI).\n')
  }
  runStep('Production Build (non-E2E)', ['run', 'build'])
  runStep('Bundle Guard', ['run', 'guard:bundle'])
  runStep('E2E Production Build (VITE_E2E=1)', ['run', 'e2e:build'])
  runStep('F2 regression (gate:f2 summary)', ['run', 'gate:f2'])

  process.env.PLAYWRIGHT_JSON_OUTPUT_NAME = e2eJson
  runStep('Playwright F3-K* (E2E)', ['run', 'test:e2e', '--', '--grep', 'F3-K', '--reporter=list,json'], {
    PLAYWRIGHT_JSON_OUTPUT_NAME: e2eJson,
  })

  const unit = readVitestJson(unitJson)
  const db = readVitestJson(dbJson)
  const e2e = readPlaywrightJson(e2eJson)

  const byK = (list, id) => list.filter((i) => (i.title ?? '').includes(`F3-${id}`))
  const inFile = (list, fragment) => list.filter((i) => (i.file ?? '').includes(fragment))
  const missingVectors = checkVectorCoverage()

  const rows = [
    { id: 'K01', desc: 'Full offline scenario (PIN login → shift → sell → print → return → close shift)', status: statusOf(byK(e2e, 'K01')), note: 'E2E only; printing uses the virtual adapter' },
    { id: 'K02', desc: 'Vektor V-04..V-11, V-18, V-21, V-30 (calc + verifySale)', status: missingVectors.length ? 'FAIL' : statusOf(byK(db, 'K02')), note: missingVectors.length ? `vectors without tests: ${missingVectors.join(', ')}` : 'source: acceptance + unit tests per vector' },
    { id: 'K03', desc: 'Idempotency, convergence, and gapless-number properties', status: statusOf(inFile(db, '.prop.test.ts')), note: 'FC_NUM_RUNS=200' },
    { id: 'K04', desc: 'Printing: checkout still completes when printing fails; reprint succeeds', status: statusOf(byK(e2e, 'K04'), true), note: 'MANUAL: NFR-PERF-002 on real devices (docs/spikes/F3-bukti-perangkat.md)' },
    { id: 'K05', desc: 'Gap & register recovery (BR-INV-008)', status: statusOf(byK(db, 'K05')), note: 'acceptance + register-recovery.int.test.ts' },
    { id: 'K06', desc: 'Receipt locale per outlet; numbers per locale', status: statusOf(byK(unit, 'K06')), note: 'unit test receipt-builder' },
    { id: 'K07', desc: 'Unavailable item: ITEM_TIDAK_TERSEDIA flag on offline sales', status: statusOf(byK(db, 'K07'), true), note: 'server side; UI item hiding is covered by the F2 tests' },
    { id: 'K08', desc: 'Sync log: commandId on failed commands', status: statusOf(byK(db, 'K08'), true), note: 'attention_item; device E2E log not yet automated' },
    { id: 'K09', desc: '10-minute screen lock; timer stops during payment/dialog', status: statusOf(byK(unit, 'K09'), true), note: 'unit tests of the controller; no E2E page.clock yet' },
    { id: 'K10', desc: 'Evaluasi rilis (REQUIRED/SOFT/SERVER_BEHIND)', status: statusOf(byK(db, 'K10'), true), note: 'SW update at a safe moment is not yet automated' },
    { id: 'K11', desc: 'Error recovery: per-area boundary, print-failed banner', status: statusOf(inFile(unit, 'ErrorBoundaryArea.test.tsx').concat(byK(e2e, 'K04')), true), note: 'App reset & price retry (V-37) not yet automated' },
    { id: 'K12', desc: 'Sync/device rate limit (429, attempts do not increase)', status: statusOf(inFile(unit, 'pusher.test.ts').concat(inFile(db, 'push-http.int.test.ts')), true), note: 'full resync 429 & report.busy not yet automated' },
  ]

  process.stdout.write('\n============================================================\n')
  process.stdout.write('[gate:f3] SUMMARY F3 (K01 - K12)\n')
  process.stdout.write('============================================================\n')
  for (const r of rows) {
    process.stdout.write(`  ${r.status.padEnd(9)} ${r.id}  ${r.desc}\n      note: ${r.note}\n`)
  }
  process.stdout.write('============================================================\n')

  const failed = rows.filter((r) => r.status === 'FAIL' || r.status === 'MISSING')
  if (failed.length > 0) {
    process.stderr.write(`[gate:f3] FAIL: ${failed.map((r) => r.id).join(', ')}\n`)
    process.exit(1)
  }
  if (!existsSync(join(root, 'docs/spikes/F3-bukti-perangkat.md'))) {
    process.stderr.write('[gate:f3] FAIL: template docs/spikes/F3-bukti-perangkat.md is missing\n')
    process.exit(1)
  }
  process.stdout.write('[gate:f3] Done. Device items (K04, printer matrix) remain MANUAL.\n')
}

main()
