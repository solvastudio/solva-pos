import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative, resolve } from 'node:path'

/**
 * F4 gate (K01–K04). The status of each K is computed from real test results (JSON reporter),
 * not typed by hand. Stops at the first failing step.
 */

const root = resolve(import.meta.dirname, '../..')
// JSON reports are stored outside the folder that the E2E setup cleans (tests/e2e/.logs).
const reportDir = join(tmpdir(), 'solva-gate-f4')
const unitJson = join(reportDir, 'unit.json')
const dbJson = join(reportDir, 'db.json')
const e2eJson = join(reportDir, 'e2e.json')

/** F4 test-vector IDs (PRD Appendix D) that must appear in the source tests. */
const F4_VECTOR_IDS = ['V-12', 'V-13', 'V-14', 'V-15', 'V-16']

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
  process.stdout.write(`\n[gate:f4] === ${label} ===\n`)
  const code = runNpm(args, extraEnv)
  if (code !== 0) {
    process.stderr.write(`[gate:f4] FAILED at step: ${label} (exit ${code})\n`)
    process.exit(code)
  }
}

/** Collects {file, title, ok} from the Vitest JSON report. */
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

/** Ensures every F4 vector ID appears in at least one test file (source side). */
function checkVectorCoverage() {
  const files = [...listFiles(join(root, 'src')), ...listFiles(join(root, 'tests'))]
  const missing = []
  for (const id of F4_VECTOR_IDS) {
    const re = new RegExp(`\\b${id}\\b`)
    const found = files.some((f) => re.test(readFileSync(f, 'utf8')))
    if (!found) missing.push(id)
  }
  return missing
}

function statusOf(items) {
  if (items.length === 0) return 'MISSING'
  if (!items.every((i) => i.ok)) return 'FAIL'
  return 'PASS'
}

function main() {
  rmSync(reportDir, { recursive: true, force: true })
  mkdirSync(reportDir, { recursive: true })

  const missingVectors = checkVectorCoverage()
  if (missingVectors.length > 0) {
    process.stderr.write(`[gate:f4] FAIL: vectors without tests: ${missingVectors.join(', ')}\n`)
    process.exit(1)
  }

  runStep('Typecheck', ['run', 'typecheck'])
  runStep('Lint & Architecture Boundaries', ['run', 'lint'])
  runStep('Unit Tests (including V-12..V-14 costing)', ['run', 'test:unit', '--', '--reporter=default', '--reporter=json', `--outputFile.json=${unitJson}`])
  runStep('Database Suite (V-15, V-16, R-02, documents, concurrency)', [
    'run',
    'test:db',
    '--',
    '--reporter=default',
    '--reporter=json',
    `--outputFile.json=${dbJson}`,
  ])
  runStep('Production Build (non-E2E)', ['run', 'build'])
  runStep('Bundle Guard', ['run', 'guard:bundle'])
  runStep('E2E Production Build (VITE_E2E=1)', ['run', 'e2e:build'])

  runStep('Playwright F4-* (E2E, including the F4-EST stock estimate)', ['run', 'test:e2e', '--', '--grep', 'F4-', '--reporter=list,json'], {
    PLAYWRIGHT_JSON_OUTPUT_NAME: e2eJson,
  })

  const unit = readVitestJson(unitJson)
  const db = readVitestJson(dbJson)
  const e2e = readPlaywrightJson(e2eJson)

  const byVector = (list, re) => list.filter((i) => re.test(i.title ?? ''))
  const inFile = (list, fragment) => list.filter((i) => (i.file ?? '').includes(fragment))
  const byK = (list, id) => list.filter((i) => (i.title ?? '').includes(`F4-${id}`))

  const rows = [
    {
      id: 'K01',
      desc: 'BR-HPP-003 example reproduced exactly; V-12..V-16 (BR-HPP-004/005, BR-TRF, BR-STK-032)',
      status: statusOf([...byVector(unit, /V-1[2-4]/), ...byVector(db, /V-1[56]/)]),
      note: 'costing.test.ts (V-12..14), transfer.int.test.ts (V-15), stocktake.int.test.ts (V-16)',
    },
    {
      id: 'K02',
      desc: 'Late-arriving offline sales use the cost when the server processes them (82.083, not 80.000)',
      status: statusOf(byK(e2e, 'K02')),
      note: 'E2E f4-late-sale.spec.ts',
    },
    {
      id: 'K03',
      desc: 'Parallel sales on the same SKU do not corrupt the balance (row lock, value conservation)',
      status: statusOf(inFile(db, 'sale-stock-concurrency')),
      note: 'sale-stock-concurrency.int.test.ts; light 2-device E2E not yet automated',
    },
    {
      id: 'K04',
      desc: 'Stock report matches the ledger; negative stock and in-transit are shown',
      status: statusOf([...inFile(db, 'report-r02'), ...byK(e2e, 'K04')]),
      note: 'report-r02.int.test.ts + E2E f4-r02.spec.ts (reconciliation Σ value_delta = balance)',
    },
  ]

  process.stdout.write('\n============================================================\n')
  process.stdout.write('[gate:f4] SUMMARY F4 (K01 - K04)\n')
  process.stdout.write('============================================================\n')
  for (const r of rows) {
    process.stdout.write(`  ${r.status.padEnd(9)} ${r.id}  ${r.desc}\n      note: ${r.note}\n`)
  }
  process.stdout.write('============================================================\n')

  const failed = rows.filter((r) => r.status !== 'PASS')
  if (failed.length > 0) {
    process.stderr.write(`[gate:f4] FAIL: ${failed.map((r) => `${r.id}=${r.status}`).join(', ')}\n`)
    process.exit(1)
  }
  process.stdout.write('[gate:f4] Done. F4 meets the gate criteria.\n')
}

main()
