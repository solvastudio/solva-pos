import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { CartPanel } from '~/components/pos/sell/CartPanel'
import { CategoryTabs } from '~/components/pos/sell/CategoryTabs'
import type { DiscountTarget } from '~/components/pos/sell/DiscountDialog'
import { NoShiftBanner } from '~/components/pos/sell/NoShiftBanner'
import { ProductGrid } from '~/components/pos/sell/ProductGrid'
import { SearchBar } from '~/components/pos/sell/SearchBar'
import type { SellCatalogItem, SellSkuUomOption } from '~/components/pos/sell/types'
import type { VariantPickerOption } from '~/components/pos/sell/VariantPickerDialog'
import { PosWorkspaceShell } from '~/components/pos/shell/PosWorkspaceShell'
import { CircleAlert, TriangleAlert } from '~/components/ui/icons'
import { businessDate, toMoney, type OutletTimezone } from '~/lib/kernel'
import type { PriceResolution } from '~/modules/catalog/shared'
import type { BootResult } from '~/pos/boot/boot'
import {
  createCatalogScanDeps,
  getStockSnapshotsMap,
  listAllSkuUoms,
  listAllVisibleProducts,
  listOutletPricesForProducts,
} from '~/pos/data/catalog.repo'
import {
  getOutlet,
  getRoleForUserAtOutlet,
  listActiveStaff,
  listCategories,
  listRegisters,
  listUoms,
} from '~/pos/data/master.repo'
import { getMeta, setMeta } from '~/pos/data/meta.repo'
import type { ProductRecord, SkuRecord } from '~/pos/db/types'
import type { CartDiscount, CartLine, ResolvedCartItem } from '~/pos/domain/cart'
import { buildConfigSnapshot } from '~/pos/domain/config-snapshot'
import { useCart, useCartLines, useSelectedCartLineId } from '~/pos/hooks/use-cart'
import { useCartTotals } from '~/pos/hooks/use-cart-totals'
import { useSellShortcuts } from '~/pos/hooks/use-shortcuts'
import { useShift } from '~/pos/hooks/use-shift'
import { isWedgeIgnoredTarget, WedgeBuffer } from '~/pos/scanner/wedge-buffer'
import { clearSession, getSessionState } from '~/pos/session/session'
import { posCartStore } from '~/pos/state/cart-store'
import { enqueueAudit } from '~/pos/usecases/audit/enqueue-audit'
import { resolveScan } from '~/pos/usecases/catalog/resolve-scan'

const LazyOpenPriceDialog = lazy(() =>
  import('~/components/pos/sell/OpenPriceDialog').then((m) => ({
    default: m.OpenPriceDialog,
  })),
)
const LazyDiscountDialog = lazy(() =>
  import('~/components/pos/sell/DiscountDialog').then((m) => ({
    default: m.DiscountDialog,
  })),
)
const LazyCustomerDialog = lazy(() =>
  import('~/components/pos/sell/CustomerDialog').then((m) => ({
    default: m.CustomerDialog,
  })),
)
const LazyVariantPickerDialog = lazy(() =>
  import('~/components/pos/sell/VariantPickerDialog').then((m) => ({
    default: m.VariantPickerDialog,
  })),
)
const LazyShortcutsDialog = lazy(() =>
  import('~/components/pos/sell/ShortcutsDialog').then((m) => ({
    default: m.ShortcutsDialog,
  })),
)

export interface SellScreenProps {
  tenant: string
  bootResult: BootResult
}

export function SellScreen({ tenant, bootResult }: SellScreenProps) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const cleanSlug = tenant.toLowerCase()

  const searchInputRef = useRef<HTMLInputElement | null>(null)
  const sessionStaff = getSessionState().staff

  const db = bootResult.kind === 'READY' ? bootResult.db : null
  const device = bootResult.kind === 'READY' ? bootResult.device : null
  const tenantName =
    bootResult.kind === 'READY' && bootResult.tenant?.name ? bootResult.tenant.name : tenant

  const { openShift } = useShift(db, device?.register_id ?? null)

  const cart = useCart((s) => s.cart)
  const lines = useCartLines()
  const selectedLineId = useSelectedCartLineId()
  const totals = useCartTotals()

  const [staffName, setStaffName] = useState('')
  const [outletLabel, setOutletLabel] = useState<string | undefined>(undefined)
  const [roleLimitPct, setRoleLimitPct] = useState('0')
  const [categories, setCategories] = useState<Awaited<ReturnType<typeof listCategories>>>([])
  const [catalogItems, setCatalogItems] = useState<SellCatalogItem[]>([])
  const [uomOptionsBySku, setUomOptionsBySku] = useState<Map<string, SellSkuUomOption[]>>(new Map())
  const [priceMap, setPriceMap] = useState<Map<string, PriceResolution>>(new Map())
  const [configBlocked, setConfigBlocked] = useState(false)
  const [clockState, setClockState] = useState<{ trustedNowMs: number; maxSeenMs: number }>({
    trustedNowMs: Date.now(),
    maxSeenMs: Date.now(),
  })

  const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [feedbackError, setFeedbackError] = useState<string | null>(null)

  const [variantModal, setVariantModal] = useState<{
    product: ProductRecord
    options: VariantPickerOption[]
  } | null>(null)
  const [openPriceModal, setOpenPriceModal] = useState<
    | { mode: 'ADD'; item: ResolvedCartItem; suggested: number | null }
    | { mode: 'EDIT'; line: CartLine }
    | null
  >(null)
  const [discountModal, setDiscountModal] = useState<DiscountTarget | null>(null)
  const [customerModalOpen, setCustomerModalOpen] = useState(false)
  const [shortcutsOpen, setShortcutsOpen] = useState(false)

  useEffect(() => {
    if (!db || !device || !sessionStaff) return
    let cancelled = false

    void Promise.all([
      getOutlet(db, device.outlet_id),
      listRegisters(db, device.outlet_id),
      listActiveStaff(db),
      getRoleForUserAtOutlet(db, sessionStaff.staffId, device.outlet_id),
      getMeta(db, 'clock'),
      listCategories(db),
      listUoms(db),
      listAllVisibleProducts(db, device.outlet_id),
      listAllSkuUoms(db),
      listOutletPricesForProducts(db, device.outlet_id),
      getStockSnapshotsMap(db),
    ]).then(
      async ([
        outlet,
        regs,
        staffList,
        role,
        clock,
        cats,
        uoms,
        entries,
        skuUoms,
        prices,
        stocks,
      ]) => {
        if (cancelled) return

        const staffRec = staffList.find((s) => s.id === sessionStaff.staffId)
        setStaffName(staffRec?.display_name ?? '')
        const reg = regs.find((r) => r.id === device.register_id)
        if (outlet && reg) setOutletLabel(`${outlet.code} · ${reg.code}`)
        if (role?.discount_limit_pct !== undefined) {
          setRoleLimitPct(String(role.discount_limit_pct))
        }

        const now = Date.now()
        const trustedNow = now + (clock?.offset_ms ?? 0)
        const parsedMax = clock?.max_seen_time ? Date.parse(clock.max_seen_time) : Number.NaN
        const maxSeen = Number.isFinite(parsedMax) ? Math.max(parsedMax, trustedNow) : trustedNow
        setClockState({ trustedNowMs: trustedNow, maxSeenMs: maxSeen })

        const bDate = outlet
          ? businessDate(
              new Date(trustedNow).toISOString(),
              outlet.timezone as OutletTimezone,
              outlet.day_cutoff_time,
            )
          : new Date(trustedNow).toISOString().slice(0, 10)

        const cfgRes = await buildConfigSnapshot(db, {
          outletId: device.outlet_id,
          businessDate: bDate,
        })

        if (!cancelled) {
          if (cfgRes.ok) {
            setConfigBlocked(false)
            await posCartStore.getState().hydrate(db, {
              registerId: device.register_id,
              staffId: sessionStaff.staffId,
              shiftId: openShift?.id ?? null,
              config: cfgRes.config,
              cashRoundingUnit: cfgRes.cashRoundingUnit,
              taxRateId: cfgRes.taxRateId,
            })
          } else {
            setConfigBlocked(true)
          }

          const uomById = new Map(uoms.map((u) => [u.id, u]))
          const uomOpts = new Map<string, SellSkuUomOption[]>()
          for (const su of skuUoms) {
            const uom = uomById.get(su.uom_id)
            if (!uom) continue
            const pKey = `${su.sku_id}::${su.uom_id}`
            const price = prices.get(pKey) ?? { kind: 'NO_PRICE' as const }
            const opt: SellSkuUomOption = { skuUom: su, uom, price }
            const list = uomOpts.get(su.sku_id)
            if (list) list.push(opt)
            else uomOpts.set(su.sku_id, [opt])
          }

          const builtItems: SellCatalogItem[] = entries
            .map((entry): SellCatalogItem | null => {
              const defaultSku =
                entry.skus.find((s) => s.is_default) ?? entry.skus[0]
              if (!defaultSku) return null
              const baseUom = uomById.get(entry.product.base_uom_id) ?? null
              const pKey = `${defaultSku.id}::${entry.product.base_uom_id}`
              const rawPrice = prices.get(pKey)
              const price: PriceResolution = entry.product.is_open_price
                ? {
                    kind: 'OPEN_PRICE',
                    suggested: rawPrice?.kind === 'PRICE' ? rawPrice.price : null,
                  }
                : rawPrice ?? { kind: 'NO_PRICE' }
              const stock = stocks.get(defaultSku.id)
              return {
                product: entry.product,
                defaultSku,
                skus: entry.skus,
                baseUom,
                price,
                stockQty: stock?.qty_on_hand ?? null,
              }
            })
            .filter((x): x is SellCatalogItem => x !== null)

          setCategories(cats)
          setUomOptionsBySku(uomOpts)
          setPriceMap(prices)
          setCatalogItems(builtItems)
        }
      },
    )

    return () => {
      cancelled = true
    }
  }, [db, device, openShift?.id, sessionStaff])

  useEffect(() => {
    posCartStore.getState().updateConfig({ shiftId: openShift?.id ?? null })
  }, [openShift?.id])

  const filteredItems = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    return catalogItems.filter((item) => {
      if (selectedCategoryId && item.product.category_id !== selectedCategoryId) {
        return false
      }
      if (!q) return true
      if (item.product.name.toLowerCase().includes(q)) return true
      if (item.product.code.toLowerCase().includes(q)) return true
      if (item.product.search_tokens.some((tok) => tok.includes(q))) return true
      return item.skus.some((s) => s.sku_code.toLowerCase().includes(q))
    })
  }, [catalogItems, searchQuery, selectedCategoryId])

  const handleResolvedAdd = useCallback(
    (resolved: ResolvedCartItem) => {
      setFeedbackError(null)
      if (resolved.price.kind === 'OPEN_PRICE') {
        setOpenPriceModal({
          mode: 'ADD',
          item: resolved,
          suggested: resolved.price.suggested,
        })
        return
      }
      const res = posCartStore.getState().addItem(resolved)
      if (!res.ok) {
        setFeedbackError(
          res.error === 'NO_PRICE'
            ? t('pos.scan.noPrice', { name: resolved.itemName })
            : t('pos.cart.qtyErrorInvalid'),
        )
      }
    },
    [t],
  )

  const handleBarcodeScan = useCallback(
    async (barcode: string) => {
      if (!db || !device) return
      window.dispatchEvent(new CustomEvent('solva:scan'))
      const scanRes = await resolveScan(barcode, device.outlet_id, createCatalogScanDeps(db))

      if (scanRes.kind === 'UNKNOWN_BARCODE') {
        setFeedbackError(t('pos.scan.unknownBarcode'))
        return
      }
      if (scanRes.kind === 'UNAVAILABLE_AT_OUTLET') {
        setFeedbackError(t('pos.scan.unavailable', { name: scanRes.productName }))
        return
      }
      if (scanRes.kind === 'INACTIVE') {
        setFeedbackError(t('pos.scan.inactive', { name: scanRes.productName }))
        return
      }
      if (scanRes.kind === 'NO_PRICE') {
        setFeedbackError(t('pos.scan.noPrice', { name: scanRes.productName }))
        return
      }

      const uomOpts = uomOptionsBySku.get(scanRes.skuId)
      const matchedOpt = uomOpts?.find((o) => o.uom.id === scanRes.uomId)
      const matchedItem = catalogItems.find((i) => i.product.id === scanRes.productId)
      handleResolvedAdd({
        skuId: scanRes.skuId,
        productId: scanRes.productId,
        uomId: scanRes.uomId,
        skuCode: barcode,
        itemName: scanRes.name,
        variantLabel: scanRes.variantLabel ?? undefined,
        uomCode: matchedOpt?.uom.code ?? scanRes.uomId,
        conversionFactor: scanRes.conversionFactor,
        taxable: matchedItem?.product.taxable ?? true,
        allowFraction: matchedOpt?.uom.allow_fraction ?? false,
        price: scanRes.price,
      })
    },
    [catalogItems, db, device, handleResolvedAdd, t, uomOptionsBySku],
  )

  useEffect(() => {
    const wedge = new WedgeBuffer()
    const onKeyDown = (e: KeyboardEvent) => {
      if (isWedgeIgnoredTarget(e.target)) {
        wedge.reset()
        return
      }
      const res = wedge.push({
        key: e.key,
        ctrlKey: e.ctrlKey,
        altKey: e.altKey,
        metaKey: e.metaKey,
      })
      if (res.matched) {
        e.preventDefault()
        if (
          e.target &&
          (e.target as HTMLElement).dataset?.scannerSearch === 'true'
        ) {
          setSearchQuery('')
        }
        void handleBarcodeScan(res.matched)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [handleBarcodeScan])

  function buildItemForSku(
    product: ProductRecord,
    sku: SkuRecord,
    price: PriceResolution,
  ): ResolvedCartItem {
    const uomOpts = uomOptionsBySku.get(sku.id) ?? []
    const baseOpt = uomOpts.find((o) => o.uom.id === product.base_uom_id) ?? uomOpts[0]
    return {
      skuId: sku.id,
      productId: product.id,
      uomId: product.base_uom_id,
      skuCode: sku.sku_code,
      itemName: product.name,
      variantLabel: sku.variant_label ?? undefined,
      uomCode: baseOpt?.uom.code ?? 'pcs',
      conversionFactor: baseOpt?.skuUom.conversion_factor ?? '1',
      taxable: product.taxable,
      allowFraction: baseOpt?.uom.allow_fraction ?? false,
      price,
    }
  }

  function handleSelectProduct(item: SellCatalogItem) {
    if (item.skus.length > 1) {
      const options: VariantPickerOption[] = item.skus.map((sku) => {
        const key = `${sku.id}::${item.product.base_uom_id}`
        const raw = priceMap.get(key)
        const price: PriceResolution = item.product.is_open_price
          ? { kind: 'OPEN_PRICE', suggested: raw?.kind === 'PRICE' ? raw.price : null }
          : raw ?? { kind: 'NO_PRICE' }
        return { sku, price }
      })
      setVariantModal({ product: item.product, options })
      return
    }
    handleResolvedAdd(buildItemForSku(item.product, item.defaultSku, item.price))
  }

  const handlePay = useCallback(() => {
    if (!openShift || configBlocked || lines.length === 0) return
    void posCartStore.getState().flushDraft().then(() => {
      void navigate({ href: `/${cleanSlug}/pos/pay` })
    })
  }, [cleanSlug, configBlocked, lines.length, navigate, openShift])

  useSellShortcuts({
    onFocusSearch: () => searchInputRef.current?.focus(),
    onPay: handlePay,
    onSelectPrevLine: () => {
      if (lines.length === 0) return
      const curIdx = lines.findIndex((l) => l.id === selectedLineId)
      const prevIdx = curIdx <= 0 ? lines.length - 1 : curIdx - 1
      posCartStore.getState().selectLine(lines[prevIdx]!.id)
    },
    onSelectNextLine: () => {
      if (lines.length === 0) return
      const curIdx = lines.findIndex((l) => l.id === selectedLineId)
      const nextIdx = curIdx < 0 || curIdx >= lines.length - 1 ? 0 : curIdx + 1
      posCartStore.getState().selectLine(lines[nextIdx]!.id)
    },
    onIncrementSelected: () => {
      if (selectedLineId) posCartStore.getState().incrementLine(selectedLineId)
    },
    onDecrementSelected: () => {
      if (selectedLineId) posCartStore.getState().decrementLine(selectedLineId)
    },
    onRemoveSelected: () => {
      if (selectedLineId) posCartStore.getState().removeLine(selectedLineId)
    },
    onConfirm: () => {},
    onEscape: () => {
      if (openPriceModal) setOpenPriceModal(null)
      else if (discountModal) setDiscountModal(null)
      else if (customerModalOpen) setCustomerModalOpen(false)
      else if (variantModal) setVariantModal(null)
      else if (shortcutsOpen) setShortcutsOpen(false)
      else setSearchQuery('')
    },
    onOpenShortcuts: () => setShortcutsOpen(true),
  })

  async function handleLockScreen() {
    if (db && sessionStaff) {
      await setMeta(db, 'idle_lock', {
        locked: true,
        locked_staff_id: sessionStaff.staffId,
        locked_at: new Date().toISOString(),
      })
    }
    clearSession()
    void navigate({ href: `/${cleanSlug}/pos/login` })
  }

  function handleSwitchStaff() {
    clearSession()
    void navigate({ href: `/${cleanSlug}/pos/login` })
  }

  async function handleApplyDiscount(
    discount: CartDiscount | null,
    approval?: { approverId: string; reason: string },
  ) {
    if (!discountModal) return
    const nextDiscount: CartDiscount | null =
      discount && approval
        ? { ...discount, approvedBy: approval.approverId, reason: approval.reason }
        : discount

    if (discountModal.kind === 'LINE') {
      posCartStore.getState().setLineDiscount(discountModal.line.id, nextDiscount)
    } else {
      posCartStore.getState().setBillDiscount(nextDiscount)
    }

    if (approval && db && device && sessionStaff) {
      await enqueueAudit(db, {
        action: 'discount.approve',
        entityType: 'sale_draft',
        entityId: cart.finalizeId,
        registerId: device.register_id,
        actorUserId: sessionStaff.staffId,
        approverUserId: approval.approverId,
        reasonCode: 'SUPERVISOR_OVERRIDE',
        reasonText: approval.reason,
        occurredAtIso: new Date(clockState.trustedNowMs).toISOString(),
      })
    }
  }

  return (
    <PosWorkspaceShell
      tenantName={tenantName}
      tenantSlug={cleanSlug}
      outletLabel={outletLabel}
      staffName={staffName || sessionStaff?.staffId}
      shiftOpen={Boolean(openShift)}
      activeNav="sell"
      onLocaleChange={(next) => {
        if (db) void setMeta(db, 'locale', next)
      }}
      onLockScreen={() => void handleLockScreen()}
      onSwitchStaff={handleSwitchStaff}
      onOpenShortcuts={() => setShortcutsOpen(true)}
    >
      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        <section className="flex min-h-0 min-w-0 flex-1 flex-col gap-3 p-3 sm:p-4">
          {!openShift ? <NoShiftBanner tenantSlug={cleanSlug} /> : null}

          {configBlocked ? (
            <div
              role="alert"
              className="flex items-start gap-2.5 rounded-card border border-danger-line bg-danger-soft px-4 py-3 text-danger-ink"
            >
              <TriangleAlert className="mt-0.5 size-5 shrink-0" aria-hidden="true" />
              <div className="flex flex-col gap-0.5">
                <span className="text-label font-semibold">{t('pos.sell.taxMissingTitle')}</span>
                <span className="text-caption">{t('pos.sell.taxMissingBody')}</span>
              </div>
            </div>
          ) : null}

          {feedbackError ? (
            <div
              role="alert"
              className="flex items-center gap-2 rounded-card border border-danger-line bg-danger-soft px-3 py-2 text-body text-danger-ink"
            >
              <CircleAlert className="size-4 shrink-0" aria-hidden="true" />
              <span>{feedbackError}</span>
            </div>
          ) : null}

          <SearchBar
            ref={searchInputRef}
            value={searchQuery}
            onChange={(val) => {
              setFeedbackError(null)
              setSearchQuery(val)
            }}
            onSubmitSearch={() => {
              if (filteredItems.length === 1) {
                handleSelectProduct(filteredItems[0]!)
              }
            }}
            onCameraScanned={(code) => {
              void handleBarcodeScan(code)
            }}
          />

          <CategoryTabs
            categories={categories}
            selectedCategoryId={selectedCategoryId}
            onSelect={setSelectedCategoryId}
          />

          <ProductGrid
            items={filteredItems}
            searchQuery={searchQuery}
            onSelectItem={handleSelectProduct}
          />
        </section>

        <CartPanel
          cart={cart}
          totals={totals}
          selectedLineId={selectedLineId}
          shiftOpen={Boolean(openShift)}
          configBlocked={configBlocked}
          uomOptionsBySku={uomOptionsBySku}
          onSelectLine={(id) => posCartStore.getState().selectLine(id)}
          onIncrementLine={(id) => {
            posCartStore.getState().incrementLine(id)
          }}
          onDecrementLine={(id) => {
            posCartStore.getState().decrementLine(id)
          }}
          onSetQty={(id, q) => {
            const res = posCartStore.getState().setQty(id, q)
            return res.ok ? null : res.error
          }}
          onChangeUom={(id, opt) => {
            const res = posCartStore.getState().changeUom(id, {
              uomId: opt.uom.id,
              code: opt.uom.code,
              factor: opt.skuUom.conversion_factor,
              allowFraction: opt.uom.allow_fraction,
              price: opt.price,
            })
            return res.ok ? null : res.error
          }}
          onOpenPriceEdit={(line) => setOpenPriceModal({ mode: 'EDIT', line })}
          onOpenLineDiscount={(line) => setDiscountModal({ kind: 'LINE', line })}
          onOpenBillDiscount={() => setDiscountModal({ kind: 'BILL' })}
          onOpenCustomer={() => setCustomerModalOpen(true)}
          onRemoveLine={(id) => posCartStore.getState().removeLine(id)}
          onPay={handlePay}
        />
      </div>

      {variantModal ? (
        <Suspense fallback={null}>
          <LazyVariantPickerDialog
            open={Boolean(variantModal)}
            product={variantModal.product}
            options={variantModal.options}
            onOpenChange={(open) => {
              if (!open) setVariantModal(null)
            }}
            onSelectSku={(opt) => {
              handleResolvedAdd(buildItemForSku(variantModal.product, opt.sku, opt.price))
            }}
          />
        </Suspense>
      ) : null}

      {openPriceModal ? (
        <Suspense fallback={null}>
          <LazyOpenPriceDialog
            open={Boolean(openPriceModal)}
            productName={
              openPriceModal.mode === 'ADD'
                ? openPriceModal.item.itemName
                : openPriceModal.line.itemName
            }
            initialPrice={
              openPriceModal.mode === 'ADD'
                ? openPriceModal.suggested
                : openPriceModal.line.unitPrice
            }
            onOpenChange={(open) => {
              if (!open) setOpenPriceModal(null)
            }}
            onConfirm={(price) => {
              if (openPriceModal.mode === 'ADD') {
                posCartStore.getState().addItem(openPriceModal.item, {
                  openPriceOverride: price,
                })
              } else {
                posCartStore.getState().setOpenPrice(openPriceModal.line.id, toMoney(price))
              }
            }}
          />
        </Suspense>
      ) : null}

      {discountModal ? (
        <Suspense fallback={null}>
          <LazyDiscountDialog
            open={Boolean(discountModal)}
            target={discountModal}
            cart={cart}
            roleLimitPct={roleLimitPct}
            db={db}
            outletId={device?.outlet_id ?? ''}
            deviceId={device?.device_id ?? ''}
            registerId={device?.register_id ?? ''}
            requesterId={sessionStaff?.staffId ?? ''}
            trustedNowMs={clockState.trustedNowMs}
            maxSeenMs={clockState.maxSeenMs}
            onOpenChange={(open) => {
              if (!open) setDiscountModal(null)
            }}
            onApply={(disc, approval) => {
              void handleApplyDiscount(disc, approval)
            }}
          />
        </Suspense>
      ) : null}

      {customerModalOpen ? (
        <Suspense fallback={null}>
          <LazyCustomerDialog
            open={customerModalOpen}
            initialCustomer={cart.customer}
            onOpenChange={setCustomerModalOpen}
            onSave={(cust) => {
              posCartStore.getState().setCustomer(cust)
            }}
          />
        </Suspense>
      ) : null}

      {shortcutsOpen ? (
        <Suspense fallback={null}>
          <LazyShortcutsDialog open={shortcutsOpen} onOpenChange={setShortcutsOpen} />
        </Suspense>
      ) : null}
    </PosWorkspaceShell>
  )
}
