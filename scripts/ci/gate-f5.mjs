import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative, resolve } from 'node:path'

/**
 * F5 gate (L01–L08). The status of each criterion is computed from actual test results,
 * not hard-coded. Fails at the first failing step.
 */

const root = resolve(import.meta.dirname, '../..')
const reportDir = join(tmpdir(), 'solva-gate-f5')
const unitJson = join(reportDir, 'unit.json')
const dbJson = join(reportDir, 'db.json')
const e2eJson = join(reportDir, 'e2e.json')

const F5_VECTOR_IDS = ['V-17', 'V-19', 'V-20']

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
  process.stdout.write(`\n[gate:f5] === ${label} ===\n`)
  const code = runNpm(args, extraEnv)
  if (code !== 0) {
    process.stderr.write(`[gate:f5] FAILED at step: ${label} (exit ${code})\n`)
    process.exit(code)
  }
}

function readVitestJson(path) {
  if (!existsSync(path)) return []
  const data = JSON.parse(readFileSync(path, 'utf8'))
  const out = []
  for (const file of data.testResults ?? []) {
    for (const a of file.assertionResults ?? []) {
      out.push({
        file: relative(root, file.name).replace(/\\/g, '/'),
        title: a.fullName ?? a.title,
        ok: a.status === 'passed',
      })
    }
  }
  return out
}

function readPlaywrightJson(path) {
  if (!existsSync(path)) return []
  const data = JSON.parse(readFileSync(path, 'utf8'))
  const out = []
  const walk = (suite) => {
    for (const spec of suite.specs ?? []) {
      out.push({ title: spec.title, file: spec.file ?? '', ok: spec.ok === true })
    }
    for (const child of suite.suites ?? []) walk(child)
  }
  for (const s of data.suites ?? []) walk(s)
  return out
}

function listTestFiles(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) {
      if (name === 'node_modules' || name === '.git' || name === 'dist' || name === '.output') continue
      listTestFiles(full, out)
    } else if (/\.test\.(ts|tsx)$/.test(name)) {
      out.push(full)
    }
  }
  return out
}

function checkVectorCoverage() {
  const files = [...listTestFiles(join(root, 'src')), ...listTestFiles(join(root, 'tests'))]
  const missing = []
  for (const id of F5_VECTOR_IDS) {
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
    process.stderr.write(`[gate:f5] FAIL: F5 vectors missing test coverage: ${missingVectors.join(', ')}\n`)
    process.exit(1)
  }

  runStep('Typecheck', ['run', 'typecheck'])
  runStep('Lint & Architecture Boundaries', ['run', 'lint'])
  runStep('Unit Tests (V-19, V-20, bill projection, bill.repo, UI, no-takeover)', [
    'run',
    'test:unit',
    '--',
    '--reporter=default',
    '--reporter=json',
    `--outputFile.json=${unitJson}`,
  ])
  runStep('Database Suite (V-17, bills-snapshot, bill-split-merge, bill-report)', [
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
  runStep('Playwright F5-* E2E Suite', ['run', 'test:e2e', '--', '--grep', 'F5-', '--reporter=list,json'], {
    PLAYWRIGHT_JSON_OUTPUT_NAME: e2eJson,
  })

  const unit = readVitestJson(unitJson)
  const db = readVitestJson(dbJson)
  const e2e = readPlaywrightJson(e2eJson)

  const inFile = (list, frag) => list.filter((i) => (i.file ?? '').includes(frag))
  const byTitle = (list, re) => list.filter((i) => re.test(i.title ?? ''))

  const rows = [
    {
      id: 'L01',
      desc: 'Modifier delta price & effective ingredient recipe consumption (V-17)',
      status: statusOf([...inFile(unit, 'recipe-consumption'), ...inFile(db, 'recipe-consumption')]),
      note: 'recipe-consumption.test.ts + recipe-consumption.int.test.ts (V-17)',
    },
    {
      id: 'L02',
      desc: 'VOID Sale reverses recipe ingredient consumption cleanly (no orphaned stock)',
      status: statusOf(byTitle(db, /V-17/)),
      note: 'recipe-consumption.int.test.ts VoidSale reversal',
    },
    {
      id: 'L03',
      desc: 'Offline open bill edits, modifier sheet, pre-bill awaiting-payment lifecycle & zero stock pre-pay',
      status: statusOf(byTitle(e2e, /f5-bill-offline/)),
      note: 'E2E f5-bill-offline.spec.ts + bill.repo.test.ts',
    },
    {
      id: 'L04',
      desc: 'Waiter register restriction + online handover -> cashier accept & pay',
      status: statusOf([...inFile(unit, 'pos/session/nav'), ...byTitle(e2e, /f5-(handover|pelayan)/)]),
      note: 'E2E f5-handover.spec.ts + f5-pelayan.spec.ts + nav.test.ts',
    },
    {
      id: 'L05',
      desc: 'Split bill (ITEM/QTY/EQUAL, V-19, V-20), SHARE & once-per-parent STOCK_BASIS, and Merge bill',
      status: statusOf([
        ...inFile(unit, 'sales-calc/split'),
        ...inFile(db, 'bill-split-merge'),
        ...byTitle(e2e, /f5-split-merge/),
      ]),
      note: 'split.test.ts + bill-split-merge.int.test.ts + E2E f5-split-merge.spec.ts',
    },
    {
      id: 'L06',
      desc: 'Zero bill takeover or force-close routes, actions, or i18n keys',
      status: statusOf(inFile(unit, 'no-takeover')),
      note: 'tests/arch/no-takeover.test.ts',
    },
    {
      id: 'L07',
      desc: 'R-04 orphan bills (RSK-04 revoked device & >24h) and BILL_GANDA_MEJA excluding split siblings',
      status: statusOf([...inFile(db, 'bill-report'), ...byTitle(e2e, /f5-rsk04/)]),
      note: 'bill-report.int.test.ts + E2E f5-rsk04.spec.ts',
    },
    {
      id: 'L08',
      desc: 'Bills snapshot without customer_phone, stable ETag, and cross-outlet/tenant 404 isolation',
      status: statusOf([...inFile(unit, 'bills-snapshot'), ...inFile(db, 'bills-snapshot')]),
      note: 'bills-snapshot.service.test.ts + bills-snapshot.int.test.ts',
    },
  ]

  process.stdout.write('\n============================================================\n')
  process.stdout.write('[gate:f5] SUMMARY F5 (L01 - L08)\n')
  process.stdout.write('============================================================\n')
  for (const r of rows) {
    process.stdout.write(`  ${r.status.padEnd(9)} ${r.id}  ${r.desc}\n      note: ${r.note}\n`)
  }
  process.stdout.write('============================================================\n')

  const failed = rows.filter((r) => r.status !== 'PASS')
  if (failed.length > 0) {
    process.stderr.write(`[gate:f5] FAIL: ${failed.map((r) => `${r.id}=${r.status}`).join(', ')}\n`)
    process.exit(1)
  }
  process.stdout.write('[gate:f5] Done. F5 meets all acceptance criteria.\n')
}

main()
