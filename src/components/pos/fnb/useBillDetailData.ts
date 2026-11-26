import { useEffect, useState } from 'react'
import { businessDate, type OutletTimezone } from '~/lib/kernel'
import type { SellCatalogItem, SellSkuUomOption } from '~/components/pos/sell/types'
import type { usePosShellActions } from '~/components/pos/shell/use-pos-shell-actions'
import type { PriceResolution } from '~/modules/catalog/shared'
import {
  getLocalBillWithItems,
  observeChildBillsByParent,
  observeLocalBillWithItems,
  type LocalBillWithItems,
} from '~/pos/data/bill.repo'
import { getBillSnapshotById, observeBillSnapshots } from '~/pos/data/bill-snapshot.repo'
import {
  getStockSnapshotsMap,
  listAllSkuUoms,
  listAllVisibleProducts,
  listOutletPricesForProducts,
} from '~/pos/data/catalog.repo'
import {
  getOutlet,
  getRoleForUserAtOutlet,
  listCategories,
  listRegisters,
  listUoms,
} from '~/pos/data/master.repo'
import { getEstimatesBulk } from '~/pos/data/stock.repo'
import { countPendingBillOutbox, listActiveTables } from '~/pos/data/table.repo'
import type {
  BillRecord,
  BillSnapshotRecord,
  CashMasterRecord,
  CategoryRecord,
  FnbTableRecord,
} from '~/pos/db/types'
import { buildConfigSnapshot } from '~/pos/domain/config-snapshot'

type PosShell = ReturnType<typeof usePosShellActions>

export function useBillDetailData(params: {
  billId: string
  db: PosShell['db']
  device: PosShell['device']
  sessionStaff: PosShell['sessionStaff']
  pendingQueueCount: number
}) {
  const { billId, db, device, sessionStaff, pendingQueueCount } = params

  const [localBill, setLocalBill] = useState<LocalBillWithItems | null>(null)
  const [snapshotBill, setSnapshotBill] = useState<BillSnapshotRecord | null>(null)
  const [parentLocalBill, setParentLocalBill] = useState<LocalBillWithItems | null>(null)
  const [siblingBills, setSiblingBills] = useState<BillRecord[]>([])
  const [loaded, setLoaded] = useState(false)

  const [tables, setTables] = useState<FnbTableRecord[]>([])
  const [registers, setRegisters] = useState<CashMasterRecord[]>([])
  const [categories, setCategories] = useState<CategoryRecord[]>([])
  const [catalogItems, setCatalogItems] = useState<SellCatalogItem[]>([])
  const [uomOptionsBySku, setUomOptionsBySku] = useState<Map<string, SellSkuUomOption[]>>(new Map())
  const [priceMap, setPriceMap] = useState<Map<string, PriceResolution>>(new Map())
  const [roleLimitPct, setRoleLimitPct] = useState('0')
  const [configState, setConfigState] = useState<Awaited<ReturnType<typeof buildConfigSnapshot>> | null>(
    null,
  )
  const [pendingOutboxCount, setPendingOutboxCount] = useState(0)

  useEffect(() => {
    if (!db || !device || !sessionStaff) return
    let cancelled = false

    void Promise.all([
      getLocalBillWithItems(db, billId),
      getBillSnapshotById(db, billId),
      getOutlet(db, device.outlet_id),
      listActiveTables(db, device.outlet_id),
      listRegisters(db, device.outlet_id),
      getRoleForUserAtOutlet(db, sessionStaff.staffId, device.outlet_id),
      listCategories(db),
      listUoms(db),
      listAllVisibleProducts(db, device.outlet_id),
      listAllSkuUoms(db),
      listOutletPricesForProducts(db, device.outlet_id),
      getStockSnapshotsMap(db),
      countPendingBillOutbox(db, billId),
    ]).then(
      async ([
        local,
        snap,
        outlet,
        tbls,
        regs,
        role,
        cats,
        uoms,
        entries,
        skuUoms,
        prices,
        stocks,
        pendingCnt,
      ]) => {
        if (cancelled) return
        setLocalBill(local)
        setSnapshotBill(snap)
        setTables(tbls)
        setRegisters(regs)
        setCategories(cats)
        setRoleLimitPct(role?.discount_limit_pct !== undefined ? String(role.discount_limit_pct) : '0')
        setPendingOutboxCount(pendingCnt)

        if (outlet) {
          const bDate = businessDate(
            new Date().toISOString(),
            outlet.timezone as OutletTimezone,
            outlet.day_cutoff_time.slice(0, 5),
          )
          const cfg = await buildConfigSnapshot(db, { outletId: outlet.id, businessDate: bDate })
          if (!cancelled) setConfigState(cfg)
        }

        const estimates = await getEstimatesBulk(db, [...stocks.keys()])
        if (cancelled) return

        const uomMap = new Map(uoms.map((u) => [u.id, u]))
        const nextUomOpts = new Map<string, SellSkuUomOption[]>()
        for (const su of skuUoms) {
          const uom = uomMap.get(su.uom_id)
          if (!uom) continue
          const arr = nextUomOpts.get(su.sku_id) ?? []
          arr.push({ skuUom: su, uom, price: prices.get(`${su.sku_id}::${su.uom_id}`) ?? { kind: 'NO_PRICE' } })
          nextUomOpts.set(su.sku_id, arr)
        }

        const items: SellCatalogItem[] = entries
          .filter((entry) => entry.product.product_type !== 'INGREDIENT' && Boolean(entry.product.name))
          .map((entry) => {
            const defSku = entry.skus.find((s) => s.is_default) ?? entry.skus[0]!
            const baseUom = uomMap.get(entry.product.base_uom_id) ?? {
              id: entry.product.base_uom_id,
              code: 'pcs',
              name: 'pcs',
              allow_fraction: false,
            }
            const price = prices.get(`${defSku.id}::${baseUom.id}`) ?? { kind: 'NO_PRICE' }
            return {
              product: entry.product,
              defaultSku: defSku,
              skus: entry.skus,
              baseUom,
              price,
              stockQty: entry.product.track_stock ? (estimates.get(defSku.id) ?? null) : null,
            }
          })

        setPriceMap(prices)
        setUomOptionsBySku(nextUomOpts)
        setCatalogItems(items)
        setLoaded(true)
      },
    )

    const subLocal = observeLocalBillWithItems(db, billId).subscribe({
      next: (val) => {
        if (!cancelled) setLocalBill(val)
      },
    })
    const subSnap = observeBillSnapshots(db).subscribe({
      next: (rows) => {
        if (!cancelled) setSnapshotBill(rows.find((r) => r.bill_id === billId) ?? null)
      },
    })

    return () => {
      cancelled = true
      subLocal.unsubscribe()
      subSnap.unsubscribe()
    }
  }, [billId, db, device, sessionStaff])

  useEffect(() => {
    if (!db) return
    void countPendingBillOutbox(db, billId).then(setPendingOutboxCount)
  }, [db, billId, pendingQueueCount, localBill?.bill.last_event_seq])

  const familyParentId =
    localBill?.bill.parent_bill_id ??
    (localBill?.bill.status === 'SPLIT' ? localBill.bill.id : null)

  useEffect(() => {
    if (!db || !familyParentId) {
      setParentLocalBill(null)
      setSiblingBills([])
      return
    }
    let cancelled = false
    if (localBill?.bill.parent_bill_id) {
      void getLocalBillWithItems(db, localBill.bill.parent_bill_id).then((pb) => {
        if (!cancelled) setParentLocalBill(pb)
      })
    } else {
      setParentLocalBill(null)
    }
    const subSib = observeChildBillsByParent(db, familyParentId).subscribe({
      next: (rows) => {
        if (!cancelled) setSiblingBills(rows)
      },
    })
    return () => {
      cancelled = true
      subSib.unsubscribe()
    }
  }, [db, familyParentId, localBill?.bill.parent_bill_id])

  return {
    localBill,
    snapshotBill,
    parentLocalBill,
    siblingBills,
    loaded,
    tables,
    registers,
    categories,
    catalogItems,
    uomOptionsBySku,
    priceMap,
    roleLimitPct,
    configState,
    pendingOutboxCount,
  }
}
