import { useEffect, useState } from 'react'
import { createIdGenerator, type LocaleId } from '~/lib/kernel'
import { listRegisters } from '../data/master.repo'
import { getMeta, setMeta } from '../data/meta.repo'
import { addPrintJob } from '../data/print-job.repo'
import type { SolvaDb } from '../db/solva-db'
import type { MetaValueMap, PrintJobRecord } from '../db/types'
import {
  createAdapterFromConfig,
  getActivePrinterAdapter,
  kickActivePrintQueue,
  notifyPrinterStateListeners,
  setActivePrinterAdapter,
  subscribePrinterState,
} from '../printing/runtime'
import { openDrawerManual } from '../usecases/print/open-drawer'
import type { PrinterState } from '../printing/adapters/types'
import type { PrinterCapabilities } from '../printing/printer-profiles'

export type PrinterConfig = NonNullable<MetaValueMap['printer']>

const idGen = createIdGenerator({
  nowMs: () => Date.now(),
  nextUint32: () => {
    const buf = new Uint32Array(1)
    globalThis.crypto.getRandomValues(buf)
    return buf[0]!
  },
})

export function usePrinter(db: SolvaDb | null, outletId: string | null, registerId: string | null) {
  const [config, setConfig] = useState<PrinterConfig | null>(null)
  const [defaultPaperWidthMm, setDefaultPaperWidthMm] = useState<58 | 80>(80)
  const [printerState, setPrinterState] = useState<PrinterState>('UNPAIRED')
  const [connecting, setConnecting] = useState(false)

  useEffect(() => {
    return subscribePrinterState(setPrinterState)
  }, [])

  useEffect(() => {
    if (!db) return
    let cancelled = false
    void Promise.all([
      getMeta(db, 'printer'),
      outletId ? listRegisters(db, outletId) : Promise.resolve([]),
    ]).then(([cfg, regs]) => {
      if (cancelled) return
      const reg = regs.find((r) => r.id === registerId)
      const masterWidth: 58 | 80 = reg?.paper_width_mm === 58 ? 58 : 80
      setDefaultPaperWidthMm(masterWidth)
      setConfig(cfg)
      if (!getActivePrinterAdapter()) {
        setActivePrinterAdapter(createAdapterFromConfig(cfg, masterWidth))
      }
    })
    return () => {
      cancelled = true
    }
  }, [db, outletId, registerId])

  const activeAdapter = getActivePrinterAdapter()
  const capabilities: PrinterCapabilities = activeAdapter?.capabilities ?? {
    paperWidthMm: config?.paperWidthMm ?? defaultPaperWidthMm,
    columns: (config?.paperWidthMm ?? defaultPaperWidthMm) === 58 ? 32 : 48,
    canCut: false,
    canOpenDrawer: false,
    supportsNvLogo: false,
    maxWriteBytes: 64,
    writePacingMs: 5,
    codePage: 'CP437',
  }

  async function saveConfig(next: PrinterConfig): Promise<void> {
    if (!db) return
    await setMeta(db, 'printer', next)
    setConfig(next)
    const adapter = createAdapterFromConfig(next, defaultPaperWidthMm)
    setActivePrinterAdapter(adapter)
    notifyPrinterStateListeners()
  }

  async function connect(): Promise<void> {
    const adapter = getActivePrinterAdapter() ?? createAdapterFromConfig(config, defaultPaperWidthMm)
    setActivePrinterAdapter(adapter)
    setConnecting(true)
    try {
      await adapter.connect({ userGesture: true })
      notifyPrinterStateListeners()
      await kickActivePrintQueue()
    } finally {
      setConnecting(false)
      notifyPrinterStateListeners()
    }
  }

  async function disconnect(): Promise<void> {
    const adapter = getActivePrinterAdapter()
    if (!adapter) return
    await adapter.disconnect()
    notifyPrinterStateListeners()
  }

  async function printTestPage(locale: LocaleId): Promise<void> {
    if (!db) return
    const nowIso = new Date().toISOString()
    const job: PrintJobRecord = {
      id: idGen.newId(),
      kind: 'TEST',
      status: 'QUEUED',
      entity_id: registerId ?? 'test',
      entity_type: 'DEVICE',
      receipt_locale: locale,
      attempts: 0,
      last_error: null,
      created_at: nowIso,
      updated_at: nowIso,
    }
    await addPrintJob(db, job)
    await kickActivePrintQueue()
  }

  async function triggerOpenDrawer(staffId?: string): Promise<void> {
    if (!db) return
    await openDrawerManual(db, { staffId })
    await kickActivePrintQueue()
  }

  return {
    config,
    defaultPaperWidthMm,
    printerState,
    capabilities,
    connecting,
    saveConfig,
    connect,
    disconnect,
    printTestPage,
    openDrawer: triggerOpenDrawer,
  }
}
