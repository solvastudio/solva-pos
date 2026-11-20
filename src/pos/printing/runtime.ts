import { getOutletReceiptSetting } from '../data/master.repo'
import { getMeta } from '../data/meta.repo'
import type { SolvaDb } from '../db/solva-db'
import type { MetaValueMap } from '../db/types'
import { onPosEvent } from '../state/events'
import { BrowserPrintAdapter } from './adapters/browser-print'
import type { PrinterAdapter, PrinterState } from './adapters/types'
import { VirtualPrinterAdapter } from './adapters/virtual'
import { WebBluetoothPrinterAdapter } from './adapters/webbluetooth'
import { WebUsbPrinterAdapter } from './adapters/webusb'
import { ensureLogo } from './logo'
import { findPrinterProfile } from './printer-profiles'
import { PrintQueueWorker } from './print-queue'

export type PrinterConfig = NonNullable<MetaValueMap['printer']>

let activeAdapter: PrinterAdapter | null = null
let activeWorker: PrintQueueWorker | null = null
let activeDb: SolvaDb | null = null
let unsubFinalized: (() => void) | null = null
const stateListeners = new Set<(state: PrinterState) => void>()

export function notifyPrinterStateListeners(): void {
  const s: PrinterState = activeAdapter ? activeAdapter.state() : 'UNPAIRED'
  for (const fn of stateListeners) fn(s)
}

export function subscribePrinterState(listener: (state: PrinterState) => void): () => void {
  stateListeners.add(listener)
  listener(activeAdapter ? activeAdapter.state() : 'UNPAIRED')
  return () => {
    stateListeners.delete(listener)
  }
}

export function createAdapterFromConfig(
  cfg: PrinterConfig | null,
  fallbackPaperWidthMm: 58 | 80 = 80,
): PrinterAdapter {
  const widthMm = cfg?.paperWidthMm ?? cfg?.width_mm ?? fallbackPaperWidthMm
  const adapterKind = cfg?.adapter ?? (cfg?.mode === 'escpos' ? 'webusb' : 'browser-print')
  const defaultProfile = widthMm === 80 ? 'escpos-80' : 'escpos-58'
  const profileId = cfg?.profileId ?? defaultProfile

  if (adapterKind === 'webusb') {
    return new WebUsbPrinterAdapter({ profileId })
  }
  if (adapterKind === 'webbluetooth') {
    const profile = findPrinterProfile(profileId || 'ble-generic')
    return new WebBluetoothPrinterAdapter({
      profileId: profile.id,
      serviceUuid: cfg?.serviceUuid ?? profile.bleServiceUuid,
      characteristicUuid: cfg?.characteristicUuid ?? profile.bleCharacteristicUuid,
    })
  }
  if (adapterKind === 'virtual') {
    return new VirtualPrinterAdapter({ profileId })
  }
  return new BrowserPrintAdapter({ paperWidthMm: widthMm })
}

export function getActivePrinterAdapter(): PrinterAdapter | null {
  return activeAdapter
}

export function setActivePrinterAdapter(adapter: PrinterAdapter | null): void {
  activeAdapter = adapter
  notifyPrinterStateListeners()
}

export function getActivePrintWorker(): PrintQueueWorker | null {
  return activeWorker
}

export async function kickActivePrintQueue(): Promise<void> {
  if (activeWorker) {
    await activeWorker.kick()
  }
}

export async function startPrintRuntime(
  db: SolvaDb,
  opts: { isActiveInstance?: () => boolean } = {},
): Promise<() => void> {
  if (activeDb === db && activeWorker) {
    return () => stopPrintRuntime()
  }
  stopPrintRuntime()
  activeDb = db

  const printerCfg = await getMeta(db, 'printer')
  if (!activeAdapter) {
    activeAdapter = createAdapterFromConfig(printerCfg)
    if (printerCfg?.adapter === 'webusb' || printerCfg?.adapter === 'webbluetooth') {
      void activeAdapter.connect({ userGesture: false }).catch(() => {}).finally(() => {
        notifyPrinterStateListeners()
        void activeWorker?.kick()
      })
    } else {
      notifyPrinterStateListeners()
    }
  }

  const worker = new PrintQueueWorker({
    db,
    getAdapter: () => activeAdapter,
    isActiveInstance: opts.isActiveInstance,
  })
  activeWorker = worker

  await worker.recoverAtBoot()
  void worker.kick()

  const deviceMeta = await getMeta(db, 'device')
  if (deviceMeta) {
    void getOutletReceiptSetting(db, deviceMeta.outlet_id)
      .then((setting) => {
        const dots = activeAdapter?.capabilities.paperWidthMm === 80 ? 576 : 384
        return ensureLogo(db, setting, dots)
      })
      .catch(() => {})
  }

  unsubFinalized = onPosEvent('finalized', () => {
    void worker.kick()
  })

  return () => {
    stopPrintRuntime()
  }
}

export function stopPrintRuntime(): void {
  unsubFinalized?.()
  unsubFinalized = null
  activeWorker = null
  activeDb = null
}
