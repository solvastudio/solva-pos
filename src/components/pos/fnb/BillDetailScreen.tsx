import { lazy, Suspense, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { BillItemModifierInput } from '~/lib/contracts'
import { roundCashDue } from '~/lib/kernel'
import { calcEqualSplit, type CartLineInput } from '~/lib/sales-calc'
import { BillPanel } from '~/components/pos/fnb/BillPanel'
import type { BillPanelItemView } from '~/components/pos/fnb/BillItemRow'
import { ChildBillList } from '~/components/pos/fnb/ChildBillList'
import { HandoverDialog } from '~/components/pos/fnb/HandoverDialog'
import { ModifierSheet } from '~/components/pos/fnb/ModifierSheet'
import { VoidItemDialog } from '~/components/pos/fnb/VoidItemDialog'
import { CategoryTabs } from '~/components/pos/sell/CategoryTabs'
import { ProductGrid } from '~/components/pos/sell/ProductGrid'
import { SearchBar } from '~/components/pos/sell/SearchBar'
import type { SellCatalogItem } from '~/components/pos/sell/types'
import { PosWorkspaceShell } from '~/components/pos/shell/PosWorkspaceShell'
import { usePosShellActions } from '~/components/pos/shell/use-pos-shell-actions'
import { Button } from '~/components/ui/Button'
import { Dialog } from '~/components/ui/Dialog'
import { useToast } from '~/components/ui/Toast'
import { CircleAlert } from '~/components/ui/icons'
import type { PriceResolution } from '~/modules/catalog/shared'
import type { BootResult } from '~/pos/boot/boot'
import {
  addBillItem,
  BillRepoError,
  cancelBill,
  changeBillItemQty,
  printPrebill,
  setBillCustomer,
  setBillDiscount,
  setBillItemModifiers,
  setBillTable,
  voidBillItem,
} from '~/pos/data/bill.repo'
import {
  listProductModifierGroupsWithOptions,
  type ProductModifierGroupWithOptions,
} from '~/pos/data/table.repo'
import type { ProductRecord } from '~/pos/db/types'
import { canAddItem, canEditBill, canHandOver, canPay } from '~/pos/domain/bill-guards'
import { computeBillTotals } from '~/pos/domain/bill-totals'
import type { CartDiscount, CartState, ResolvedCartItem } from '~/pos/domain/cart'
import { useSyncState } from '~/pos/hooks/use-sync-state'
import { kickActivePrintQueue } from '~/pos/printing/runtime'
import { cancelBillHandoverClient, handOverBillClient } from '~/pos/sync/handover-client'
import { useBillDetailData } from './useBillDetailData'

const LazyCustomerDialog = lazy(() =>
  import('~/components/pos/sell/CustomerDialog').then((m) => ({ default: m.CustomerDialog })),
)
const LazyDiscountDialog = lazy(() =>
  import('~/components/pos/sell/DiscountDialog').then((m) => ({ default: m.DiscountDialog })),
)
const LazyOpenPriceDialog = lazy(() =>
  import('~/components/pos/sell/OpenPriceDialog').then((m) => ({ default: m.OpenPriceDialog })),
)
const LazyVariantPickerDialog = lazy(() =>
  import('~/components/pos/sell/VariantPickerDialog').then((m) => ({
    default: m.VariantPickerDialog,
  })),
)

export interface BillDetailScreenProps {
  tenant: string
  billId: string
  bootResult: BootResult
}

export function BillDetailScreen({ tenant, billId, bootResult }: BillDetailScreenProps) {
  const { t } = useTranslation()
  const { show: showToast } = useToast()
  const shell = usePosShellActions(tenant, bootResult)
  const { syncState } = useSyncState()

  const db = shell.db
  const device = shell.device
  const sessionStaff = shell.sessionStaff
  const isOnline = syncState.conn !== 'OFFLINE'

  const {
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
  } = useBillDetailData({
    billId,
    db,
    device,
    sessionStaff,
    pendingQueueCount: syncState.queue.pending,
  })

  const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [errorBanner, setErrorBanner] = useState<string | null>(null)
  const [busyAction, setBusyAction] = useState(false)

  // Modal states
  const [variantModal, setVariantModal] = useState<{
    product: ProductRecord
    options: Array<{ sku: SellCatalogItem['defaultSku']; price: PriceResolution }>
  } | null>(null)
  const [openPriceItem, setOpenPriceItem] = useState<ResolvedCartItem | null>(null)
  const [modModal, setModModal] = useState<
    | {
        mode: 'ADD'
        resolved: ResolvedCartItem
        openPriceOverride?: number
        groups: ProductModifierGroupWithOptions[]
      }
    | {
        mode: 'EDIT'
        billItemId: string
        itemName: string
        baseUnitPrice: number
        groups: ProductModifierGroupWithOptions[]
        initialSelected: BillItemModifierInput[]
      }
    | null
  >(null)
  const [voidModalItem, setVoidModalItem] = useState<BillPanelItemView | null>(null)
  const [customerOpen, setCustomerOpen] = useState(false)
  const [tableModalOpen, setTableModalOpen] = useState(false)
  const [discountModalTarget, setDiscountModalTarget] = useState<
    { kind: 'BILL' } | { kind: 'ITEM'; item: BillPanelItemView } | null
  >(null)
  const [handoverOpen, setHandoverOpen] = useState(false)
  const [handoverError, setHandoverError] = useState<string | null>(null)

  const activeSource = useMemo(() => {
    if (localBill && (!snapshotBill || localBill.bill.last_event_seq >= snapshotBill.last_event_seq)) {
      return { kind: 'local' as const, data: localBill }
    }
    if (snapshotBill) {
      return { kind: 'snapshot' as const, data: snapshotBill }
    }
    if (localBill) return { kind: 'local' as const, data: localBill }
    return null
  }, [localBill, snapshotBill])

  const viewBill = activeSource?.kind === 'local' ? activeSource.data.bill : activeSource?.data
  const editCheck = useMemo(() => {
    if (!viewBill || !device) return { ok: false as const, reason: 'CLOSED' as const }
    return canEditBill(
      {
        status: viewBill.status,
        lease_device_id: viewBill.lease_device_id,
        handover_status: viewBill.handover_status,
      },
      device.device_id,
    )
  }, [device, viewBill])

  const isEqualShare =
    viewBill?.split_mode === 'EQUAL' &&
    Boolean(localBill?.bill.share_index) &&
    Boolean(localBill?.bill.share_count)

  const panelItems: BillPanelItemView[] = useMemo(() => {
    if (isEqualShare && parentLocalBill) {
      return parentLocalBill.items.map((it) => ({
        id: it.id,
        lineNo: it.line_no,
        itemName: it.item_name,
        uomCode: it.uom_code,
        qty: it.qty,
        unitPrice: it.unit_price,
        discountType: it.discount_type,
        discountPct: it.discount_pct,
        discountInput: it.discount_input,
        note: it.note,
        status: it.status,
        voidReasonText: it.void_reason_text ?? null,
        modifiers: it.modifiers.map((m) => ({
          modifierId: m.modifier_id,
          name: m.name,
          priceDelta: m.price_delta,
          qty: m.qty,
        })),
      }))
    }
    if (!activeSource) return []
    if (activeSource.kind === 'local') {
      return activeSource.data.items.map((it) => ({
        id: it.id,
        lineNo: it.line_no,
        itemName: it.item_name,
        uomCode: it.uom_code,
        qty: it.qty,
        unitPrice: it.unit_price,
        discountType: it.discount_type,
        discountPct: it.discount_pct,
        discountInput: it.discount_input,
        note: it.note,
        status: it.status,
        voidReasonText: it.void_reason_text ?? null,
        modifiers: it.modifiers.map((m) => ({
          modifierId: m.modifier_id,
          name: m.name,
          priceDelta: m.price_delta,
          qty: m.qty,
        })),
      }))
    }
    return activeSource.data.items.map((it) => ({
      id: it.id,
      lineNo: it.line_no,
      itemName: it.item_name,
      uomCode: it.uom_code,
      qty: it.qty,
      unitPrice: it.unit_price,
      discountType: it.discount_type,
      discountPct: it.discount_pct,
      discountInput: it.discount_input,
      note: it.note,
      status: it.status,
      voidReasonText: it.void_reason_text ?? null,
      modifiers: it.modifiers.map((m) => ({
        modifierId: m.modifier_id,
        name: m.name,
        priceDelta: m.price_delta,
        qty: m.qty,
      })),
    }))
  }, [activeSource, isEqualShare, parentLocalBill])

  const effectiveConfig = useMemo(() => {
    if (configState?.ok) {
      return { config: configState.config, cashRoundingUnit: configState.cashRoundingUnit }
    }
    return {
      config: {
        priceTaxMode: 'EXCLUSIVE' as const,
        taxProfile: 'NONE' as const,
        taxRate: '0',
        serviceChargeEnabled: false,
        serviceChargeRate: '0',
        serviceChargeTaxable: true,
      },
      cashRoundingUnit: 100 as const,
    }
  }, [configState])

  const totals = useMemo(() => {
    if (
      isEqualShare &&
      parentLocalBill &&
      localBill?.bill.share_index &&
      localBill?.bill.share_count
    ) {
      const activeParent = parentLocalBill.items.filter((i) => i.status === 'ACTIVE')
      if (activeParent.length > 0) {
        const lines: CartLineInput[] = activeParent.map((it, idx) => ({
          lineNo: idx + 1,
          skuId: it.sku_id,
          uomId: it.uom_id,
          qty: it.qty as CartLineInput['qty'],
          unitPrice: it.unit_price as CartLineInput['unitPrice'],
          taxable: it.taxable,
          discount:
            it.discount_type === 'PERCENT' && it.discount_pct
              ? { kind: 'PERCENT', percent: it.discount_pct }
              : it.discount_type === 'NOMINAL' && it.discount_input !== null
                ? { kind: 'NOMINAL', amount: it.discount_input as CartLineInput['unitPrice'] }
                : undefined,
        }))
        const pBill = parentLocalBill.bill
        const eq = calcEqualSplit(
          {
            lines,
            billDiscount:
              pBill.bill_discount_type === 'PERCENT' && pBill.bill_discount_pct
                ? { kind: 'PERCENT', percent: pBill.bill_discount_pct }
                : pBill.bill_discount_type === 'NOMINAL' && pBill.bill_discount_input !== null
                  ? { kind: 'NOMINAL', amount: pBill.bill_discount_input as CartLineInput['unitPrice'] }
                  : undefined,
            config: effectiveConfig.config,
          },
          localBill.bill.share_count,
        )
        const share = eq.shares[localBill.bill.share_index - 1]
        if (share) {
          const cashTotal = roundCashDue(share.calc.grandTotal, effectiveConfig.cashRoundingUnit)
          return {
            calc: { ...share.calc, lines: [] },
            cashTotal,
            roundingDelta: (cashTotal - share.calc.grandTotal) as typeof share.calc.grandTotal,
            activeItemCount: activeParent.length,
          }
        }
      }
    }
    if (!viewBill) {
      return computeBillTotals({
        bill: { bill_discount_type: null, bill_discount_pct: null, bill_discount_input: null },
        items: [],
        config: effectiveConfig.config,
        cashRoundingUnit: effectiveConfig.cashRoundingUnit,
      })
    }
    return computeBillTotals({
      bill: viewBill,
      items: activeSource?.kind === 'local' ? activeSource.data.items : activeSource!.data.items,
      config: effectiveConfig.config,
      cashRoundingUnit: effectiveConfig.cashRoundingUnit,
    })
  }, [
    activeSource,
    effectiveConfig,
    isEqualShare,
    localBill?.bill.share_count,
    localBill?.bill.share_index,
    parentLocalBill,
    viewBill,
  ])

  const cashierRegisters = useMemo(
    () =>
      registers.filter(
        (r) => r.register_type === 'CASHIER' && r.id !== device?.register_id && !r.deleted_at,
      ),
    [device?.register_id, registers],
  )

  const handoverCheck = useMemo(() => {
    if (!viewBill || !device) {
      return { ok: false as const, reason: 'CLOSED' as const }
    }
    return canHandOver(
      {
        status: viewBill.status,
        lease_device_id: viewBill.lease_device_id,
        handover_status: viewBill.handover_status,
      },
      {
        deviceId: device.device_id,
        isOnline,
        pendingOutboxCount,
        hasOtherActiveCashier: cashierRegisters.length > 0,
      },
    )
  }, [cashierRegisters.length, device, isOnline, pendingOutboxCount, viewBill])

  const canPayBill = useMemo(() => {
    if (!viewBill || !device) return false
    return canPay(
      {
        status: viewBill.status,
        lease_device_id: viewBill.lease_device_id,
        lease_register_id: viewBill.lease_register_id,
        handover_status: viewBill.handover_status,
        split_mode: viewBill.split_mode ?? null,
      },
      {
        deviceId: device.device_id,
        registerId: device.register_id,
        registerType: device.register_type,
        hasOpenShift: Boolean(shell.openShift),
        activeItemCount: totals.activeItemCount,
      },
    )
  }, [device, shell.openShift, totals.activeItemCount, viewBill])

  const visibleGridItems = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    return catalogItems.filter((item) => {
      if (selectedCategoryId && item.product.category_id !== selectedCategoryId) return false
      if (q) {
        const hay = `${item.product.name} ${item.product.code} ${item.defaultSku.sku_code}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [catalogItems, searchQuery, selectedCategoryId])

  async function addResolvedToBill(
    resolved: ResolvedCartItem,
    opts?: { openPriceOverride?: number; modifiers?: BillItemModifierInput[]; qtyInput?: string; note?: string },
  ) {
    if (!db || !sessionStaff) return
    setErrorBanner(null)
    try {
      await addBillItem(db, {
        billId,
        item: resolved,
        isAvailable: canAddItem(true).ok,
        qtyInput: opts?.qtyInput ?? '1',
        openPriceOverride: opts?.openPriceOverride,
        modifiers: opts?.modifiers ?? [],
        note: opts?.note,
        staffId: sessionStaff.staffId,
      })
    } catch (err) {
      if (err instanceof BillRepoError && err.code === 'ITEM_UNAVAILABLE') {
        setErrorBanner(t('pos.bill.itemUnavailable'))
      } else {
        setErrorBanner(t('pos.pay.errorGeneric'))
      }
    }
  }

  async function handleSelectProduct(item: SellCatalogItem) {
    if (!editCheck.ok || !db) return
    const uomId = item.baseUom?.id ?? item.product.base_uom_id
    if (item.skus.length > 1) {
      setVariantModal({
        product: item.product,
        options: item.skus.map((s) => ({
          sku: s,
          price: priceMap.get(`${s.id}::${uomId}`) ?? { kind: 'NO_PRICE' },
        })),
      })
      return
    }
    const opts = uomOptionsBySku.get(item.defaultSku.id) ?? []
    const baseOpt = opts.find((o) => o.uom.id === uomId) ?? opts[0]
    const resolved: ResolvedCartItem = {
      skuId: item.defaultSku.id,
      productId: item.product.id,
      uomId: baseOpt?.uom.id ?? uomId,
      skuCode: item.defaultSku.sku_code,
      itemName: item.product.name,
      variantLabel: item.defaultSku.variant_label ?? undefined,
      uomCode: baseOpt?.uom.code ?? item.baseUom?.code ?? 'pcs',
      conversionFactor: baseOpt?.skuUom.conversion_factor ?? '1',
      taxable: item.product.taxable,
      allowFraction: item.baseUom?.allow_fraction ?? false,
      price: item.price,
    }
    if (item.price.kind === 'OPEN_PRICE') {
      setOpenPriceItem(resolved)
      return
    }
    const groups = await listProductModifierGroupsWithOptions(db, item.product.id)
    if (groups.length > 0) {
      setModModal({ mode: 'ADD', resolved, groups })
      return
    }
    await addResolvedToBill(resolved)
  }

  async function handleEditModifiers(item: BillPanelItemView) {
    if (!db || activeSource?.kind !== 'local') return
    const localIt = activeSource.data.items.find((i) => i.id === item.id)
    if (!localIt?.product_id) return
    const groups = await listProductModifierGroupsWithOptions(db, localIt.product_id)
    if (groups.length === 0) return
    const oldDelta = localIt.modifiers.reduce((s, m) => s + m.price_delta * m.qty, 0)
    setModModal({
      mode: 'EDIT',
      billItemId: localIt.id,
      itemName: localIt.item_name,
      baseUnitPrice: Math.max(0, localIt.unit_price - oldDelta),
      groups,
      initialSelected: localIt.modifiers.map((m) => ({
        modifier_id: m.modifier_id,
        name: m.name,
        price_delta: m.price_delta,
        qty: m.qty,
      })),
    })
  }

  async function handleConfirmHandover(targetRegisterId: string) {
    if (!db || !sessionStaff || !viewBill) return
    setHandoverError(null)
    setBusyAction(true)
    try {
      const res = await handOverBillClient(
        db,
        {
          billId,
          targetRegisterId,
          clientLastEventSeq: viewBill.last_event_seq,
          staffId: sessionStaff.staffId,
        },
        { isOnline: () => isOnline },
      )
      if (!res.ok) {
        setHandoverError(
          res.code === 'EVENTS_PENDING'
            ? t('pos.handover.errorPendingEvents')
            : res.code === 'HANDOVER_NOT_PENDING'
              ? t('pos.handover.errorNotPending')
              : t('pos.handover.errorGeneric'),
        )
        return
      }
      setHandoverOpen(false)
      shell.handleSyncNow()
    } finally {
      setBusyAction(false)
    }
  }

  async function handleCancelHandover() {
    if (!db || !sessionStaff) return
    setBusyAction(true)
    try {
      const res = await cancelBillHandoverClient(
        db,
        { billId, staffId: sessionStaff.staffId },
        { isOnline: () => isOnline },
      )
      if (!res.ok) {
        showToast({
          tone: 'danger',
          message:
            res.code === 'HANDOVER_NOT_PENDING'
              ? t('pos.handover.errorNotPending')
              : t('pos.handover.errorGeneric'),
        })
        shell.handleSyncNow()
        return
      }
      showToast({ tone: 'success', message: t('pos.handover.canceledToast') })
      shell.handleSyncNow()
    } finally {
      setBusyAction(false)
    }
  }

  const dummyCartForDiscount: CartState = {
    finalizeId: billId,
    lines: panelItems
      .filter((i) => i.status === 'ACTIVE')
      .map((i, idx) => ({
        id: i.id,
        lineNo: idx + 1,
        skuId: i.id,
        productId: i.id,
        uomId: i.id,
        skuCode: i.id,
        itemName: i.itemName,
        uomCode: i.uomCode,
        qty: i.qty as CartState['lines'][number]['qty'],
        conversionFactor: '1' as CartState['lines'][number]['conversionFactor'],
        qtyBase: i.qty as CartState['lines'][number]['qtyBase'],
        unitPrice: i.unitPrice as CartState['lines'][number]['unitPrice'],
        priceSource: 'TENANT_DEFAULT',
        isOpenPrice: false,
        taxable: true,
        allowFraction: true,
      })),
    config: effectiveConfig.config,
    cashRoundingUnit: effectiveConfig.cashRoundingUnit,
    taxRateId: null,
    createdAt: new Date().toISOString(),
    shiftId: null,
  }

  const tableObj = tables.find((tbl) => tbl.id === viewBill?.table_id)
  const targetRegObj = registers.find((r) => r.id === viewBill?.handover_target_register_id)

  return (
    <PosWorkspaceShell
      tenantName={shell.tenantName}
      tenantSlug={shell.cleanSlug}
      outletLabel={shell.outletLabel}
      staffName={shell.staffName}
      shiftOpen={Boolean(shell.openShift)}
      registerType={device?.register_type}
      activeNav="tables"
      onSyncNow={shell.handleSyncNow}
      onLocaleChange={shell.handleLocaleChange}
      onLockScreen={() => void shell.handleLockScreen()}
      onSwitchStaff={shell.handleSwitchStaff}
    >
      {loaded && !viewBill ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6">
          <p className="text-body text-ink-soft">{t('pos.bill.billNotFound')}</p>
          <Button
            type="button"
            variant="secondary"
            size="md"
            onClick={() => void shell.navigate({ href: `/${shell.cleanSlug}/pos/tables` })}
          >
            {t('pos.bill.backToTables')}
          </Button>
        </div>
      ) : viewBill ? (
        <div className="flex min-h-0 flex-1 flex-col md:flex-row">
          <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-3 p-3">
            {errorBanner ? (
              <div
                role="alert"
                className="flex items-center gap-2 rounded-card bg-warning-soft px-3 py-2 text-body-sm font-medium text-warning-ink"
              >
                <CircleAlert className="size-4 shrink-0" aria-hidden="true" />
                <span>{errorBanner}</span>
              </div>
            ) : null}

            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => void shell.navigate({ href: `/${shell.cleanSlug}/pos/tables` })}
              >
                {t('pos.bill.backToTables')}
              </Button>
              <div className="min-w-0 flex-1">
                <SearchBar
                  value={searchQuery}
                  onChange={setSearchQuery}
                  onSubmitSearch={() => {}}
                />
              </div>
            </div>

            <CategoryTabs
              categories={categories}
              selectedCategoryId={selectedCategoryId}
              onSelect={setSelectedCategoryId}
            />

            <div className="min-h-0 flex-1 overflow-y-auto">
              <ProductGrid
                items={visibleGridItems}
                searchQuery={searchQuery}
                onSelectItem={(it) => void handleSelectProduct(it)}
              />
            </div>
          </div>

          <BillPanel
            billRef={viewBill.bill_ref}
            tableLabel={tableObj ? (tableObj.area ? `${tableObj.code} — ${tableObj.area}` : tableObj.code) : viewBill.table_id}
            customerName={viewBill.customer_name}
            isAwaitingPayment={viewBill.is_awaiting_payment}
            handoverStatus={viewBill.handover_status}
            handoverTargetLabel={targetRegObj?.name ?? targetRegObj?.code ?? null}
            editable={editCheck.ok}
            itemsEditable={editCheck.ok && !isEqualShare}
            readOnlyReason={editCheck.ok ? null : editCheck.reason}
            shareBadge={
              isEqualShare && localBill?.bill.share_index && localBill?.bill.share_count
                ? t('pos.bill.shareBadge', {
                    index: localBill.bill.share_index,
                    count: localBill.bill.share_count,
                  })
                : null
            }
            siblingListNode={
              siblingBills.length > 0 ? (
                <ChildBillList
                  currentBillId={billId}
                  childrenBills={siblingBills}
                  onSelectBill={(id) =>
                    void shell.navigate({ href: `/${shell.cleanSlug}/pos/bill/${id}` })
                  }
                />
              ) : null
            }
            updatedAt={viewBill.last_event_at}
            canCancelHandover={
              viewBill.handover_status === 'PENDING' &&
              viewBill.lease_device_id === device?.device_id
            }
            canSplit={editCheck.ok && !isEqualShare && totals.activeItemCount > 0}
            canMerge={editCheck.ok && !localBill?.bill.parent_bill_id && !isEqualShare}
            items={panelItems}
            totals={totals}
            taxProfile={effectiveConfig.config.taxProfile}
            taxRate={effectiveConfig.config.taxRate}
            pendingOutboxCount={pendingOutboxCount}
            isWaiter={device?.register_type === 'WAITER'}
            canPayBill={canPayBill}
            handoverCheck={handoverCheck}
            busyAction={busyAction}
            onOpenCustomer={() => setCustomerOpen(true)}
            onOpenBillDiscount={() => setDiscountModalTarget({ kind: 'BILL' })}
            onOpenChangeTable={() => setTableModalOpen(true)}
            onOpenSplit={() =>
              void shell.navigate({ href: `/${shell.cleanSlug}/pos/bill/${billId}/split` })
            }
            onOpenMerge={() =>
              void shell.navigate({ href: `/${shell.cleanSlug}/pos/bill/${billId}/merge` })
            }
            onChangeQty={(itemId, qty) => {
              if (!db || !sessionStaff) return
              void changeBillItemQty(db, {
                billId,
                itemId,
                qtyInput: qty,
                staffId: sessionStaff.staffId,
              })
            }}
            onEditModifiers={(it) => void handleEditModifiers(it)}
            onOpenLineDiscount={(it) => setDiscountModalTarget({ kind: 'ITEM', item: it })}
            onRequestVoid={(it) => setVoidModalItem(it)}
            onPrintPrebill={() => {
              if (!db || !sessionStaff) return
              void printPrebill(db, { billId, staffId: sessionStaff.staffId }).then(() => {
                void kickActivePrintQueue()
                showToast({ tone: 'success', message: t('pos.bill.prebillSent') })
              })
            }}
            onOpenHandover={() => {
              setHandoverError(null)
              setHandoverOpen(true)
            }}
            onCancelHandover={() => void handleCancelHandover()}
            onCancelBill={() => {
              if (!db || !sessionStaff) return
              void cancelBill(db, { billId, staffId: sessionStaff.staffId }).then(() =>
                shell.navigate({ href: `/${shell.cleanSlug}/pos/tables` }),
              )
            }}
            onPayBill={() => {
              void shell.navigate({ href: `/${shell.cleanSlug}/pos/pay?billId=${billId}` })
            }}
          />
        </div>
      ) : null}

      <Suspense fallback={null}>
        {variantModal ? (
          <LazyVariantPickerDialog
            open={true}
            product={variantModal.product}
            options={variantModal.options}
            onOpenChange={(o) => {
              if (!o) setVariantModal(null)
            }}
            onSelectSku={async (opt) => {
              const parentItem = catalogItems.find((c) => c.product.id === variantModal.product.id)
              setVariantModal(null)
              if (!parentItem || !db) return
              const baseUomId = parentItem.baseUom?.id ?? parentItem.product.base_uom_id
              const resolved: ResolvedCartItem = {
                skuId: opt.sku.id,
                productId: parentItem.product.id,
                uomId: baseUomId,
                skuCode: opt.sku.sku_code,
                itemName: parentItem.product.name,
                variantLabel: opt.sku.variant_label ?? undefined,
                uomCode: parentItem.baseUom?.code ?? 'pcs',
                conversionFactor: '1',
                taxable: parentItem.product.taxable,
                allowFraction: parentItem.baseUom?.allow_fraction ?? false,
                price: opt.price,
              }
              const groups = await listProductModifierGroupsWithOptions(db, parentItem.product.id)
              if (groups.length > 0) {
                setModModal({ mode: 'ADD', resolved, groups })
              } else {
                await addResolvedToBill(resolved)
              }
            }}
          />
        ) : null}

        {openPriceItem ? (
          <LazyOpenPriceDialog
            open={true}
            productName={openPriceItem.itemName}
            initialPrice={null}
            onOpenChange={(o) => {
              if (!o) setOpenPriceItem(null)
            }}
            onConfirm={async (price) => {
              const target = openPriceItem
              setOpenPriceItem(null)
              await addResolvedToBill(target, { openPriceOverride: price })
            }}
          />
        ) : null}

        {customerOpen ? (
          <LazyCustomerDialog
            open={true}
            initialCustomer={{
              ...(viewBill?.customer_name ? { name: viewBill.customer_name } : {}),
              ...(localBill?.bill.customer_phone ? { phone: localBill.bill.customer_phone } : {}),
            }}
            onOpenChange={setCustomerOpen}
            onSave={(cust) => {
              if (!db || !sessionStaff) return
              void setBillCustomer(db, {
                billId,
                customerName: cust?.name ?? null,
                customerPhone: cust?.phone ?? null,
                staffId: sessionStaff.staffId,
              })
            }}
          />
        ) : null}

        {discountModalTarget && device && sessionStaff ? (
          <LazyDiscountDialog
            open={true}
            target={
              discountModalTarget.kind === 'BILL'
                ? { kind: 'BILL' }
                : {
                    kind: 'LINE',
                    line: dummyCartForDiscount.lines.find(
                      (l) => l.id === discountModalTarget.item.id,
                    ) ?? dummyCartForDiscount.lines[0]!,
                  }
            }
            cart={dummyCartForDiscount}
            roleLimitPct={roleLimitPct}
            db={db}
            outletId={device.outlet_id}
            deviceId={device.device_id}
            registerId={device.register_id}
            requesterId={sessionStaff.staffId}
            trustedNowMs={shell.clockBounds.trustedNowMs}
            maxSeenMs={shell.clockBounds.maxSeenMs}
            onOpenChange={(o) => {
              if (!o) setDiscountModalTarget(null)
            }}
            onApply={(disc: CartDiscount | null, approval) => {
              if (!db || !sessionStaff || !discountModalTarget) return
              const payloadDisc =
                disc === null
                  ? null
                  : disc.type === 'PERCENT'
                    ? { type: 'PERCENT' as const, pct: disc.pct ?? '0' }
                    : { type: 'NOMINAL' as const, input: disc.input ?? 0 }
              void setBillDiscount(db, {
                billId,
                itemId: discountModalTarget.kind === 'ITEM' ? discountModalTarget.item.id : null,
                discount: payloadDisc,
                staffId: sessionStaff.staffId,
                approval,
              })
            }}
          />
        ) : null}
      </Suspense>

      {modModal ? (
        <ModifierSheet
          open={true}
          mode={modModal.mode}
          itemName={modModal.mode === 'ADD' ? modModal.resolved.itemName : modModal.itemName}
          baseUnitPrice={
            modModal.mode === 'ADD'
              ? modModal.resolved.price.kind === 'PRICE'
                ? modModal.resolved.price.price
                : (modModal.openPriceOverride ?? 0)
              : modModal.baseUnitPrice
          }
          groups={modModal.groups}
          initialSelected={modModal.mode === 'EDIT' ? modModal.initialSelected : []}
          onOpenChange={(o) => {
            if (!o) setModModal(null)
          }}
          onSubmit={async ({ modifiers, qtyInput, note }) => {
            if (!db || !sessionStaff) return
            const snapModal = modModal
            setModModal(null)
            if (snapModal.mode === 'ADD') {
              await addResolvedToBill(snapModal.resolved, {
                modifiers,
                qtyInput,
                note,
                openPriceOverride: snapModal.openPriceOverride,
              })
            } else {
              await setBillItemModifiers(db, {
                billId,
                itemId: snapModal.billItemId,
                modifiers,
                staffId: sessionStaff.staffId,
              })
            }
          }}
        />
      ) : null}

      {voidModalItem ? (
        <VoidItemDialog
          open={true}
          itemName={voidModalItem.itemName}
          onOpenChange={(o) => {
            if (!o) setVoidModalItem(null)
          }}
          onConfirm={async (reasonText) => {
            if (!db || !sessionStaff) return
            const item = voidModalItem
            setVoidModalItem(null)
            await voidBillItem(db, {
              billId,
              itemId: item.id,
              reasonText,
              staffId: sessionStaff.staffId,
            })
          }}
        />
      ) : null}

      <Dialog
        open={tableModalOpen}
        onOpenChange={setTableModalOpen}
        title={t('pos.bill.changeTableTitle')}
        size="sm"
      >
        <div className="grid max-h-80 grid-cols-2 gap-2 overflow-y-auto">
          {tables.map((tbl) => (
            <Button
              key={tbl.id}
              type="button"
              variant={tbl.id === viewBill?.table_id ? 'primary' : 'secondary'}
              size="md"
              onClick={() => {
                setTableModalOpen(false)
                if (!db || !sessionStaff || tbl.id === viewBill?.table_id) return
                void setBillTable(db, { billId, tableId: tbl.id, staffId: sessionStaff.staffId })
              }}
            >
              {tbl.code}{tbl.area ? ` — ${tbl.area}` : ''}
            </Button>
          ))}
        </div>
      </Dialog>

      <HandoverDialog
        open={handoverOpen}
        billRef={viewBill?.bill_ref ?? ''}
        cashierRegisters={cashierRegisters}
        submitting={busyAction}
        errorMessage={handoverError}
        onOpenChange={setHandoverOpen}
        onConfirm={handleConfirmHandover}
      />
    </PosWorkspaceShell>
  )
}
