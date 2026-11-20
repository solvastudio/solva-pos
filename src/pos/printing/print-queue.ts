import type { LocaleId } from '~/lib/kernel'
import { getCachedAsset } from '../data/asset-cache.repo'
import { getCreditNoteWithDetails } from '../data/credit-note.repo'
import {
  getOutlet,
  getOutletReceiptSetting,
  listActiveStaff,
  listRegisters,
} from '../data/master.repo'
import { getMeta } from '../data/meta.repo'
import {
  claimNextPrintJob,
  markPrintJobDone,
  markPrintJobFailed,
  recoverStalePrintingJobs,
  requeuePrintJobForRetry,
} from '../data/print-job.repo'
import { getSaleWithDetails } from '../data/sale.repo'
import type { SolvaDb } from '../db/solva-db'
import type { PrintJobRecord } from '../db/types'
import { withResourceLock } from '../locks/resource-lock'
import { logDevice } from '../maintenance/device-log'
import { PrinterAdapterError, type PrinterAdapter } from './adapters/types'
import { encodeEscPos } from './escpos/encoder'
import { findPrinterProfile } from './printer-profiles'
import { buildCreditNoteReceipt, buildReceipt, buildTestPage } from './receipt-builder'
import type { RasterAsset, ReceiptDoc } from './receipt-doc'

const RETRY_DELAYS_MS = [1_000, 3_000, 5_000] as const

export interface PrintQueueDeps {
  readonly db: SolvaDb
  readonly getAdapter: () => PrinterAdapter | null
  readonly isActiveInstance?: () => boolean
  readonly sleep?: (ms: number) => Promise<void>
  readonly nowIso?: () => string
  readonly retryDelaysMs?: readonly number[]
}

async function acquirePrintLock(
  printerId: string,
  fn: () => Promise<void>,
): Promise<void> {
  await withResourceLock({
    tenantId: '',
    deviceId: '',
    name: `print:${printerId}`,
    fn,
  })
}

async function resolveReceiptDocForJob(
  db: SolvaDb,
  job: PrintJobRecord,
  columns: 32 | 48,
): Promise<ReceiptDoc | null> {
  if (job.kind === 'CASH_DRAWER') {
    return null
  }
  const deviceMeta = await getMeta(db, 'device')
  const locale: LocaleId = job.receipt_locale === 'en-US' ? 'en-US' : 'id-ID'

  if (job.kind === 'TEST') {
    const outlet = deviceMeta ? await getOutlet(db, deviceMeta.outlet_id) : null
    const regs = deviceMeta ? await listRegisters(db, deviceMeta.outlet_id) : []
    const reg = regs.find((r) => r.id === deviceMeta?.register_id)
    const paperWidthMm: 58 | 80 = columns === 48 ? 80 : 58
    return buildTestPage({
      locale,
      paperWidthMm,
      columns,
      outletName: outlet?.name,
      registerCode: reg?.code,
    })
  }

  if (!deviceMeta) return null
  const [outlet, receiptSetting, staffList, regs] = await Promise.all([
    getOutlet(db, deviceMeta.outlet_id),
    getOutletReceiptSetting(db, deviceMeta.outlet_id),
    listActiveStaff(db),
    listRegisters(db, deviceMeta.outlet_id),
  ])
  if (!outlet) return null

  const reg = regs.find((r) => r.id === deviceMeta.register_id)
  const staffMap = new Map(staffList.map((s) => [s.id, s.display_name]))

  if (job.kind === 'CREDIT_NOTE' || job.entity_type === 'CREDIT_NOTE') {
    const cnDetails = await getCreditNoteWithDetails(db, job.entity_id)
    if (!cnDetails) return null
    const origSale = await getSaleWithDetails(db, cnDetails.creditNote.original_sale_id)
    const saleLineMap = new Map((origSale?.lines ?? []).map((l) => [l.id, l]))
    return buildCreditNoteReceipt({
      creditNote: cnDetails.creditNote,
      lines: cnDetails.lines.map((l) => {
        const orig = saleLineMap.get(l.sale_line_id)
        return {
          ...l,
          item_name: orig?.item_name ?? l.sale_line_id,
          uom_code: orig?.uom_code ?? '',
        }
      }),
      refunds: cnDetails.refunds,
      outlet,
      receiptSetting,
      cashierName: staffMap.get(cnDetails.creditNote.created_by) ?? cnDetails.creditNote.created_by,
      isReprint: job.kind === 'REPRINT',
    })
  }

  const saleDetails = await getSaleWithDetails(db, job.entity_id)
  if (!saleDetails) return null

  return buildReceipt({
    kind: job.kind === 'REPRINT' ? 'REPRINT' : job.kind === 'PREBILL' ? 'PREBILL' : 'RECEIPT',
    sale: saleDetails.sale,
    lines: saleDetails.lines,
    payments: saleDetails.payments,
    outlet,
    receiptSetting,
    registerCode: reg?.code,
    cashierName: staffMap.get(saleDetails.sale.created_by) ?? saleDetails.sale.created_by,
    locale,
    columns,
  })
}

export class PrintQueueWorker {
  private readonly deps: PrintQueueDeps
  private draining = false
  private kickRequested = false

  constructor(deps: PrintQueueDeps) {
    this.deps = deps
  }

  async recoverAtBoot(): Promise<number> {
    if (this.deps.isActiveInstance && !this.deps.isActiveInstance()) {
      return 0
    }
    const nowIso = this.deps.nowIso?.() ?? new Date().toISOString()
    return recoverStalePrintingJobs(this.deps.db, nowIso)
  }

  async kick(): Promise<void> {
    if (this.deps.isActiveInstance && !this.deps.isActiveInstance()) {
      return
    }
    if (this.draining) {
      this.kickRequested = true
      return
    }
    this.draining = true
    try {
      do {
        this.kickRequested = false
        await this.drainLoop()
      } while (this.kickRequested)
    } finally {
      this.draining = false
    }
  }

  private async drainLoop(): Promise<void> {
    const printerMeta = await getMeta(this.deps.db, 'printer')
    const printerId = printerMeta?.deviceId ?? printerMeta?.printer_id ?? 'default'

    await acquirePrintLock(printerId, async () => {
      while (!this.deps.isActiveInstance || this.deps.isActiveInstance()) {
        const nowIso = this.deps.nowIso?.() ?? new Date().toISOString()
        const job = await claimNextPrintJob(this.deps.db, nowIso)
        if (!job) break

        await this.processSingleJob(job)
      }
    })
  }

  private async processSingleJob(job: PrintJobRecord): Promise<void> {
    const nowIso = () => this.deps.nowIso?.() ?? new Date().toISOString()
    const adapter = this.deps.getAdapter()
    if (!adapter) {
      await this.failJob(job, 'NO_PRINTER: No printer adapter configured', nowIso())
      return
    }

    try {
      if (job.kind === 'CASH_DRAWER') {
        if (adapter.capabilities.canOpenDrawer) {
          const ts = nowIso()
          await adapter.openDrawer()
          await markPrintJobDone(this.deps.db, job.id, {
            firstByteAt: ts,
            doneAt: nowIso(),
          })
        } else {
          await markPrintJobDone(this.deps.db, job.id, {
            firstByteAt: nowIso(),
            doneAt: nowIso(),
          })
        }
        return
      }

      const doc = await resolveReceiptDocForJob(
        this.deps.db,
        job,
        adapter.capabilities.columns,
      )
      if (!doc) {
        await this.failJob(job, 'ENCODE_ERROR: Source document missing for print job', nowIso())
        return
      }

      const printerMeta = await getMeta(this.deps.db, 'printer')
      const profile = findPrinterProfile(printerMeta?.profileId)
      const cachedLogo = await getCachedAsset(this.deps.db, 'logo')
      const logoAsset: RasterAsset | null = cachedLogo
        ? { width: cachedLogo.width, height: cachedLogo.height, bits: cachedLogo.bits }
        : null

      const bytes =
        adapter.kind === 'browser-print'
          ? undefined
          : encodeEscPos(doc, {
              ...profile,
              capabilities: adapter.capabilities,
            }, { logo: logoAsset })

      const res = await adapter.print({
        doc,
        bytes,
        paperWidthMm: adapter.capabilities.paperWidthMm,
      })

      await markPrintJobDone(this.deps.db, job.id, {
        firstByteAt: res.firstByteAtIso,
        doneAt: res.doneAtIso,
      })
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Print failed'
      const code = err instanceof PrinterAdapterError ? err.code : 'DISCONNECTED'
      const transient = code === 'DISCONNECTED' || code === 'TIMEOUT'
      const delays = this.deps.retryDelaysMs ?? RETRY_DELAYS_MS

      if (transient && job.attempts <= delays.length) {
        const delayMs = delays[job.attempts - 1] ?? delays[delays.length - 1] ?? 1000
        if (this.deps.sleep) {
          await this.deps.sleep(delayMs)
        } else {
          await new Promise((resolve) => setTimeout(resolve, delayMs))
        }
        await requeuePrintJobForRetry(this.deps.db, job.id, msg, nowIso())
        return
      }

      await this.failJob(job, `${code}: ${msg}`, nowIso())
    }
  }

  private async failJob(job: PrintJobRecord, errorMsg: string, ts: string): Promise<void> {
    await markPrintJobFailed(this.deps.db, job.id, errorMsg, ts)
    try {
      const clock = await getMeta(this.deps.db, 'clock')
      await logDevice(this.deps.db, {
        level: 'error',
        code: 'PRINT_FAILED',
        route: '/pos/print',
        ctx: {
          job_id: job.id,
          kind: job.kind,
          entity_id: job.entity_id,
          attempts: job.attempts,
        },
        clockOffsetMs: clock?.offset_ms ?? null,
      })
    } catch {
      // Never throw from failure telemetry.
    }
  }
}
