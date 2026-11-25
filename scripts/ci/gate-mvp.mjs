import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative, resolve } from 'node:path'

/**
 * Full MVP Gate (F1–F5): executes all static checks, unit/property suites, Postgres integration
 * suites, nginx config check, bundle & size guards, and full Playwright E2E acceptance suite once.
 */

const root = resolve(import.meta.dirname, '../..')
const reportDir = join(tmpdir(), 'solva-gate-mvp')
const unitJson = join(reportDir, 'unit.json')
const dbJson = join(reportDir, 'db.json')
const e2eJson = join(reportDir, 'e2e.json')

const REQUIRED_VECTORS = [
  'V-01', 'V-02', 'V-03', 'V-04', 'V-05', 'V-06', 'V-07', 'V-08', 'V-09', 'V-10',
  'V-11', 'V-12', 'V-13', 'V-14', 'V-15', 'V-16', 'V-17', 'V-18', 'V-19', 'V-20', 'V-30',
]

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
  process.stdout.write(`\n[gate:mvp] === ${label} ===\n`)
  const code = runNpm(args, extraEnv)
  if (code !== 0) {
    process.stderr.write(`[gate:mvp] FAILED at step: ${label} (exit ${code})\n`)
    process.exit(code)
  }
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

function checkAllVectors() {
  const files = [...listTestFiles(join(root, 'src')), ...listTestFiles(join(root, 'tests'))]
  const missing = []
  const lines = files.flatMap((f) => readFileSync(f, 'utf8').split(/\r?\n/))
  // The ID must appear in a describe/it/test title line; a mention in a comment is not coverage.
  const titleLines = lines.filter((l) => /\b(describe|it|test)(\.\w+)?\(/.test(l))
  for (const id of REQUIRED_VECTORS) {
    const re = new RegExp(`\\b${id}\\b`)
    if (!titleLines.some((l) => re.test(l))) missing.push(id)
  }
  return missing
}

function readVitestSummary(path) {
  if (!existsSync(path)) return { total: 0, passed: 0, failed: 0 }
  const data = JSON.parse(readFileSync(path, 'utf8'))
  let total = 0
  let passed = 0
  let failed = 0
  for (const f of data.testResults ?? []) {
    for (const a of f.assertionResults ?? []) {
      total += 1
      if (a.status === 'passed') passed += 1
      else failed += 1
    }
  }
  return { total, passed, failed }
}

function readPlaywrightSummary(path) {
  if (!existsSync(path)) return { total: 0, passed: 0, failed: 0 }
  const data = JSON.parse(readFileSync(path, 'utf8'))
  let total = 0
  let passed = 0
  let failed = 0
  const walk = (suite) => {
    for (const spec of suite.specs ?? []) {
      total += 1
      if (spec.ok === true) passed += 1
      else failed += 1
    }
    for (const child of suite.suites ?? []) walk(child)
  }
  for (const s of data.suites ?? []) walk(s)
  return { total, passed, failed }
}

function main() {
  rmSync(reportDir, { recursive: true, force: true })
  mkdirSync(reportDir, { recursive: true })

  const missingVectors = checkAllVectors()
  if (missingVectors.length > 0) {
    process.stderr.write(`[gate:mvp] FAIL: vectors without test coverage: ${missingVectors.join(', ')}\n`)
    process.exit(1)
  }

  runStep('Typecheck', ['run', 'typecheck'])
  runStep('Lint & Architecture Boundaries', ['run', 'lint'])
  runStep('Unit & Arch Tests', [
    'run',
    'test:unit',
    '--',
    '--reporter=default',
    '--reporter=json',
    `--outputFile.json=${unitJson}`,
  ])
  runStep('Postgres Integration Tests', [
    'run',
    'test:db',
    '--',
    '--reporter=default',
    '--reporter=json',
    `--outputFile.json=${dbJson}`,
  ])
  runStep('Nginx Security Config Check', ['run', 'test:nginx'])
  runStep('Production Build', ['run', 'build'])
  runStep('Bundle Budget Guard', ['run', 'guard:bundle'])
  runStep('Size Limit Check', ['run', 'size'])
  runStep('E2E Production Build (VITE_E2E=1)', ['run', 'e2e:build'])
  runStep('Full Playwright E2E Suite (F1–F5)', ['run', 'test:e2e', '--', '--reporter=list,json'], {
    PLAYWRIGHT_JSON_OUTPUT_NAME: e2eJson,
  })

  const u = readVitestSummary(unitJson)
  const d = readVitestSummary(dbJson)
  const e = readPlaywrightSummary(e2eJson)

  process.stdout.write('\n============================================================\n')
  process.stdout.write(`[gate:mvp] PASSED ALL GATES (F1–F5)\n`)
  process.stdout.write(`  Vectors verified : ${REQUIRED_VECTORS.join(', ')}\n`)
  process.stdout.write(`  Unit assertions  : ${u.passed}/${u.total} passed\n`)
  process.stdout.write(`  DB assertions    : ${d.passed}/${d.total} passed\n`)
  process.stdout.write(`  E2E specs        : ${e.passed}/${e.total} passed\n`)
  process.stdout.write('============================================================\n')
  void relative
}

main()
