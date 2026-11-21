import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative, resolve } from 'node:path'

/**
 * Gerbang F3 (K01–K12). Status tiap K dihitung dari hasil tes nyata (JSON reporter),
 * bukan diketik tangan. Berhenti pada langkah pertama yang gagal.
 */

const root = resolve(import.meta.dirname, '../..')
// Laporan JSON disimpan di luar folder yang dibersihkan oleh setup E2E (tests/e2e/.logs).
const reportDir = join(tmpdir(), 'solva-gate-f3')
const unitJson = join(reportDir, 'unit.json')
const dbJson = join(reportDir, 'db.json')
const e2eJson = join(reportDir, 'e2e.json')

/** Daftar ID vektor uji F3 (PRD Lampiran D) yang harus muncul di tes sumber. */
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
    process.stderr.write(`[gate:f3] GAGAL pada langkah: ${label} (exit ${code})\n`)
    process.exit(code)
  }
}

/** Mengumpulkan {title, ok} dari laporan JSON Vitest. */
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

/** Memastikan setiap ID vektor F3 muncul di setidaknya satu berkas tes (sisi sumber). */
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
  if (items.length === 0) return 'TIDAK ADA'
  if (!items.every((i) => i.ok)) return 'GAGAL'
  return partial ? 'PARSIAL' : 'LULUS'
}

function main() {
  rmSync(reportDir, { recursive: true, force: true })
  mkdirSync(reportDir, { recursive: true })

  runStep('Typecheck', ['run', 'typecheck'])
  runStep('Lint & Architecture Boundaries', ['run', 'lint'])
  runStep('Unit Tests (termasuk F3-K06, F3-K09)', ['run', 'test:unit', '--', '--reporter=default', '--reporter=json', `--outputFile.json=${unitJson}`])
  runStep('Database Suite: acceptance F3-K* + properti (FC_NUM_RUNS=200)', [
    'run',
    'test:db',
    '--',
    '--reporter=default',
    '--reporter=json',
    `--outputFile.json=${dbJson}`,
  ], { FC_NUM_RUNS: '200' })
  // Pemeriksaan Nginx membutuhkan Docker. Di mesin tanpa Docker dilewati dengan peringatan (sama dengan gate:f1);
  // CI wajib menjalankannya.
  if (dockerReady()) {
    runStep('Nginx Rate-Limit Check', ['run', 'test:nginx'])
  } else {
    process.stdout.write('\n[gate:f3] PERINGATAN: Docker tidak tersedia; Nginx Rate-Limit Check dilewati di mesin ini (wajib di CI).\n')
  }
  runStep('Production Build (non-E2E)', ['run', 'build'])
  runStep('Bundle Guard', ['run', 'guard:bundle'])
  runStep('E2E Production Build (VITE_E2E=1)', ['run', 'e2e:build'])
  runStep('Regresi F2 (gate:f2 ringkas)', ['run', 'gate:f2'])

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
    { id: 'K01', desc: 'Skenario penuh offline (login PIN → shift → jual → cetak → retur → tutup shift)', status: statusOf(byK(e2e, 'K01')), note: 'E2E saja; cetak memakai adapter virtual' },
    { id: 'K02', desc: 'Vektor V-04..V-11, V-18, V-21, V-30 (calc + verifySale)', status: missingVectors.length ? 'GAGAL' : statusOf(byK(db, 'K02')), note: missingVectors.length ? `vektor tanpa tes: ${missingVectors.join(', ')}` : 'sumber: acceptance + tes unit per vektor' },
    { id: 'K03', desc: 'Properti idempotensi, konvergensi, nomor tanpa celah', status: statusOf(inFile(db, '.prop.test.ts')), note: 'FC_NUM_RUNS=200' },
    { id: 'K04', desc: 'Cetak: checkout tetap selesai saat cetak gagal; cetak ulang berhasil', status: statusOf(byK(e2e, 'K04'), true), note: 'MANUAL: NFR-PERF-002 di perangkat nyata (docs/spikes/F3-bukti-perangkat.md)' },
    { id: 'K05', desc: 'Gap & pemulihan register (BR-INV-008)', status: statusOf(byK(db, 'K05')), note: 'acceptance + register-recovery.int.test.ts' },
    { id: 'K06', desc: 'Locale struk per outlet; angka per locale', status: statusOf(byK(unit, 'K06')), note: 'tes unit receipt-builder' },
    { id: 'K07', desc: 'Item tidak tersedia: flag ITEM_TIDAK_TERSEDIA pada penjualan offline', status: statusOf(byK(db, 'K07'), true), note: 'sisi server; UI sembunyi-item di tes F2' },
    { id: 'K08', desc: 'Log sync: commandId pada perintah gagal', status: statusOf(byK(db, 'K08'), true), note: 'attention_item; log device E2E belum otomatis' },
    { id: 'K09', desc: 'Kunci layar 10 menit; timer berhenti saat pembayaran/dialog', status: statusOf(byK(unit, 'K09'), true), note: 'tes unit controller; E2E page.clock belum ada' },
    { id: 'K10', desc: 'Evaluasi rilis (REQUIRED/SOFT/SERVER_BEHIND)', status: statusOf(byK(db, 'K10'), true), note: 'SW update di momen aman belum otomatis' },
    { id: 'K11', desc: 'Pemulihan error: boundary per area, banner cetak gagal', status: statusOf(inFile(unit, 'ErrorBoundaryArea.test.tsx').concat(byK(e2e, 'K04')), true), note: 'Reset aplikasi & retry harga (V-37) belum otomatis' },
    { id: 'K12', desc: 'Rate limit sync/device (429, attempts tidak naik)', status: statusOf(inFile(unit, 'pusher.test.ts').concat(inFile(db, 'push-http.int.test.ts')), true), note: 'full resync 429 & report.busy belum otomatis' },
  ]

  process.stdout.write('\n============================================================\n')
  process.stdout.write('[gate:f3] RINGKASAN F3 (K01 - K12)\n')
  process.stdout.write('============================================================\n')
  for (const r of rows) {
    process.stdout.write(`  ${r.status.padEnd(9)} ${r.id}  ${r.desc}\n      catatan: ${r.note}\n`)
  }
  process.stdout.write('============================================================\n')

  const failed = rows.filter((r) => r.status === 'GAGAL' || r.status === 'TIDAK ADA')
  if (failed.length > 0) {
    process.stderr.write(`[gate:f3] GAGAL: ${failed.map((r) => r.id).join(', ')}\n`)
    process.exit(1)
  }
  if (!existsSync(join(root, 'docs/spikes/F3-bukti-perangkat.md'))) {
    process.stderr.write('[gate:f3] GAGAL: templat docs/spikes/F3-bukti-perangkat.md tidak ada\n')
    process.exit(1)
  }
  process.stdout.write('[gate:f3] Selesai. Bagian perangkat (K04, matriks printer) tetap MANUAL.\n')
}

main()
