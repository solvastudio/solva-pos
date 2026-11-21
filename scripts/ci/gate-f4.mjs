import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative, resolve } from 'node:path'

/**
 * Gerbang F4 (K01–K04). Status tiap K dihitung dari hasil tes nyata (JSON reporter),
 * bukan diketik tangan. Berhenti pada langkah pertama yang gagal.
 */

const root = resolve(import.meta.dirname, '../..')
// Laporan JSON disimpan di luar folder yang dibersihkan oleh setup E2E (tests/e2e/.logs).
const reportDir = join(tmpdir(), 'solva-gate-f4')
const unitJson = join(reportDir, 'unit.json')
const dbJson = join(reportDir, 'db.json')
const e2eJson = join(reportDir, 'e2e.json')

/** Vektor uji F4 (PRD Lampiran D) yang harus muncul di tes sumber. */
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
    process.stderr.write(`[gate:f4] GAGAL pada langkah: ${label} (exit ${code})\n`)
    process.exit(code)
  }
}

/** Mengumpulkan {file, title, ok} dari laporan JSON Vitest. */
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

/** Mengumpulkan {title, ok} dari laporan JSON Playwright (suite bersarang). */
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

/** Memastikan setiap ID vektor F4 muncul di setidaknya satu berkas tes (sisi sumber). */
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
  if (items.length === 0) return 'TIDAK ADA'
  if (!items.every((i) => i.ok)) return 'GAGAL'
  return 'LULUS'
}

function main() {
  rmSync(reportDir, { recursive: true, force: true })
  mkdirSync(reportDir, { recursive: true })

  const missingVectors = checkVectorCoverage()
  if (missingVectors.length > 0) {
    process.stderr.write(`[gate:f4] GAGAL: vektor tanpa tes: ${missingVectors.join(', ')}\n`)
    process.exit(1)
  }

  runStep('Typecheck', ['run', 'typecheck'])
  runStep('Lint & Architecture Boundaries', ['run', 'lint'])
  runStep('Unit Tests (termasuk V-12..V-14 costing)', ['run', 'test:unit', '--', '--reporter=default', '--reporter=json', `--outputFile.json=${unitJson}`])
  runStep('Database Suite (V-15, V-16, R-02, dokumen, konkurensi)', [
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

  runStep('Playwright F4-* (E2E, termasuk estimasi stok F4-EST)', ['run', 'test:e2e', '--', '--grep', 'F4-', '--reporter=list,json'], {
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
      desc: 'Contoh BR-HPP-003 reproduksi persis; V-12..V-16 (BR-HPP-004/005, BR-TRF, BR-STK-032)',
      status: statusOf([...byVector(unit, /V-1[2-4]/), ...byVector(db, /V-1[56]/)]),
      note: 'costing.test.ts (V-12..14), transfer.int.test.ts (V-15), stocktake.int.test.ts (V-16)',
    },
    {
      id: 'K02',
      desc: 'Penjualan offline yang tiba telat memakai biaya saat server memproses (82.083, bukan 80.000)',
      status: statusOf(byK(e2e, 'K02')),
      note: 'E2E f4-late-sale.spec.ts',
    },
    {
      id: 'K03',
      desc: 'Penjualan paralel pada SKU yang sama tidak merusak saldo (row lock, konservasi nilai)',
      status: statusOf(inFile(db, 'sale-stock-concurrency')),
      note: 'sale-stock-concurrency.int.test.ts (Fase 53); E2E ringan 2 device belum ada',
    },
    {
      id: 'K04',
      desc: 'Laporan stok sesuai ledger; stok minus dan in-transit tampil',
      status: statusOf([...inFile(db, 'report-r02'), ...byK(e2e, 'K04')]),
      note: 'report-r02.int.test.ts + E2E f4-r02.spec.ts (rekonsiliasi Σ value_delta = saldo)',
    },
  ]

  process.stdout.write('\n============================================================\n')
  process.stdout.write('[gate:f4] RINGKASAN F4 (K01 - K04)\n')
  process.stdout.write('============================================================\n')
  for (const r of rows) {
    process.stdout.write(`  ${r.status.padEnd(9)} ${r.id}  ${r.desc}\n      catatan: ${r.note}\n`)
  }
  process.stdout.write('============================================================\n')

  const failed = rows.filter((r) => r.status !== 'LULUS')
  if (failed.length > 0) {
    process.stderr.write(`[gate:f4] GAGAL: ${failed.map((r) => `${r.id}=${r.status}`).join(', ')}\n`)
    process.exit(1)
  }
  process.stdout.write('[gate:f4] Selesai. F4 memenuhi kriteria gerbang.\n')
}

main()
