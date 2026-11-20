import { createStore } from 'zustand/vanilla'
import type { CashRoundingUnit } from '~/lib/kernel'
import { createIdGenerator } from '~/lib/kernel'
import type { SaleConfigSnapshot } from '~/lib/sales-calc'
import type { SolvaDb } from '../db/solva-db'
import {
  buildCartDraftId,
  deleteDraft,
  getActiveDraft,
  saveActiveDraft,
} from '../data/cart-draft.repo'
import {
  addItem,
  changeUom,
  createEmptyCart,
  removeLine,
  setBillDiscount,
  setCustomer,
  setLineDiscount,
  setOpenPrice,
  setQty,
  type CartCustomer,
  type CartDiscount,
  type CartMutationErrorCode,
  type CartResult,
  type CartState,
  type ResolvedCartItem,
} from '../domain/cart'

const DEBOUNCE_MS = 150

const DEFAULT_CONFIG: SaleConfigSnapshot = {
  priceTaxMode: 'EXCLUSIVE',
  taxProfile: 'NONE',
  taxRate: '0',
  serviceChargeEnabled: false,
  serviceChargeRate: '0',
  serviceChargeTaxable: true,
}

const idGen = createIdGenerator({
  nowMs: () => Date.now(),
  nextUint32: () => {
    const buf = new Uint32Array(1)
    globalThis.crypto.getRandomValues(buf)
    return buf[0]!
  },
})

export interface CartContext {
  registerId: string
  staffId: string
  shiftId: string | null
  config: SaleConfigSnapshot
  cashRoundingUnit: CashRoundingUnit
  taxRateId: string | null
}

export interface CartStoreState {
  cart: CartState
  selectedLineId: string | null
  isHydrated: boolean
  lastError: CartMutationErrorCode | null
  context: CartContext | null
  hydrate: (db: SolvaDb, ctx: CartContext) => Promise<void>
  updateConfig: (ctx: Partial<Pick<CartContext, 'shiftId' | 'config' | 'cashRoundingUnit' | 'taxRateId'>>) => void
  addItem: (
    item: ResolvedCartItem,
    opts?: { qtyInput?: string; openPriceOverride?: number },
  ) => CartResult & { touchedLineId?: string }
  setQty: (lineId: string, qtyInput: string) => CartResult
  incrementLine: (lineId: string) => CartResult
  decrementLine: (lineId: string) => CartResult
  changeUom: (
    lineId: string,
    newUom: Parameters<typeof changeUom>[2],
  ) => CartResult
  setLineDiscount: (lineId: string, discount: CartDiscount | null) => CartResult
  setBillDiscount: (discount: CartDiscount | null) => CartResult
  setOpenPrice: (lineId: string, price: number) => CartResult
  setCustomer: (customer: CartCustomer | undefined) => CartResult
  removeLine: (lineId: string) => void
  selectLine: (lineId: string | null) => void
  clearCart: () => Promise<void>
  flushDraft: () => Promise<void>
  clearError: () => void
}

function isPersistedCartState(raw: unknown): raw is CartState {
  if (!raw || typeof raw !== 'object') return false
  const obj = raw as Partial<CartState>
  return typeof obj.finalizeId === 'string' && Array.isArray(obj.lines) && typeof obj.config === 'object'
}

function makeFreshCart(ctx: CartContext): CartState {
  return createEmptyCart({
    finalizeId: idGen.newId(),
    config: ctx.config,
    cashRoundingUnit: ctx.cashRoundingUnit,
    taxRateId: ctx.taxRateId,
    createdAt: new Date().toISOString(),
    shiftId: ctx.shiftId,
  })
}

export function createCartStore() {
  let boundDb: SolvaDb | null = null
  let debounceTimer: ReturnType<typeof setTimeout> | null = null

  const cancelDebounce = () => {
    if (debounceTimer !== null) {
      clearTimeout(debounceTimer)
      debounceTimer = null
    }
  }

  const persistNow = async (): Promise<void> => {
    cancelDebounce()
    const db = boundDb
    const state = store.getState()
    const ctx = state.context
    if (!db || !ctx) return

    const draftId = buildCartDraftId(ctx.registerId, ctx.staffId)
    if (state.cart.lines.length === 0 && !state.cart.customer && !state.cart.billDiscount) {
      await deleteDraft(db, draftId)
      return
    }
    await saveActiveDraft(db, {
      id: draftId,
      kind: 'CART',
      register_id: ctx.registerId,
      staff_id: ctx.staffId,
      status: 'ACTIVE',
      bill_key: 'CURRENT',
      payload: state.cart,
      updated_at: new Date().toISOString(),
    })
  }

  const schedulePersist = () => {
    cancelDebounce()
    debounceTimer = setTimeout(() => {
      debounceTimer = null
      void persistNow()
    }, DEBOUNCE_MS)
  }

  const initialContext: CartContext = {
    registerId: '',
    staffId: '',
    shiftId: null,
    config: DEFAULT_CONFIG,
    cashRoundingUnit: 100,
    taxRateId: null,
  }

  const store = createStore<CartStoreState>((set, get) => ({
    cart: makeFreshCart(initialContext),
    selectedLineId: null,
    isHydrated: false,
    lastError: null,
    context: null,

    async hydrate(db, ctx) {
      boundDb = db
      cancelDebounce()
      const existing = await getActiveDraft(db, ctx.registerId, ctx.staffId)
      let cart: CartState
      if (existing && isPersistedCartState(existing.payload)) {
        cart = {
          ...existing.payload,
          shiftId: ctx.shiftId,
          config: ctx.config,
          cashRoundingUnit: ctx.cashRoundingUnit,
          taxRateId: ctx.taxRateId,
        }
      } else {
        cart = makeFreshCart(ctx)
      }
      set({
        context: ctx,
        cart,
        selectedLineId: cart.lines[cart.lines.length - 1]?.id ?? null,
        isHydrated: true,
        lastError: null,
      })
    },

    updateConfig(patch) {
      const state = get()
      if (!state.context) return
      const nextCtx: CartContext = { ...state.context, ...patch }
      set({
        context: nextCtx,
        cart: {
          ...state.cart,
          shiftId: nextCtx.shiftId,
          config: nextCtx.config,
          cashRoundingUnit: nextCtx.cashRoundingUnit,
          taxRateId: nextCtx.taxRateId,
        },
      })
    },

    addItem(item, opts) {
      const state = get()
      const res = addItem(state.cart, item, {
        newId: idGen.newId(),
        qtyInput: opts?.qtyInput,
        openPriceOverride: opts?.openPriceOverride,
      })
      if (!res.ok) {
        set({ lastError: res.error })
        return res
      }
      set({
        cart: res.cart,
        selectedLineId: res.touchedLineId,
        lastError: null,
      })
      void persistNow()
      return { ok: true, cart: res.cart, touchedLineId: res.touchedLineId }
    },

    setQty(lineId, qtyInput) {
      const res = setQty(get().cart, lineId, qtyInput)
      if (!res.ok) {
        set({ lastError: res.error })
        return res
      }
      set({ cart: res.cart, lastError: null })
      schedulePersist()
      return res
    },

    incrementLine(lineId) {
      const line = get().cart.lines.find((l) => l.id === lineId)
      if (!line) return { ok: false, error: 'LINE_NOT_FOUND' }
      const nextNum = Number(line.qty) + 1
      return get().setQty(lineId, String(nextNum))
    },

    decrementLine(lineId) {
      const line = get().cart.lines.find((l) => l.id === lineId)
      if (!line) return { ok: false, error: 'LINE_NOT_FOUND' }
      const cur = Number(line.qty)
      if (cur <= 1) {
        get().removeLine(lineId)
        return { ok: true, cart: get().cart }
      }
      return get().setQty(lineId, String(cur - 1))
    },

    changeUom(lineId, newUom) {
      const res = changeUom(get().cart, lineId, newUom)
      if (!res.ok) {
        set({ lastError: res.error })
        return res
      }
      set({ cart: res.cart, lastError: null })
      schedulePersist()
      return res
    },

    setLineDiscount(lineId, discount) {
      const res = setLineDiscount(get().cart, lineId, discount)
      if (!res.ok) {
        set({ lastError: res.error })
        return res
      }
      set({ cart: res.cart, lastError: null })
      schedulePersist()
      return res
    },

    setBillDiscount(discount) {
      const res = setBillDiscount(get().cart, discount)
      if (!res.ok) {
        set({ lastError: res.error })
        return res
      }
      set({ cart: res.cart, lastError: null })
      schedulePersist()
      return res
    },

    setOpenPrice(lineId, price) {
      const res = setOpenPrice(get().cart, lineId, price)
      if (!res.ok) {
        set({ lastError: res.error })
        return res
      }
      set({ cart: res.cart, lastError: null })
      schedulePersist()
      return res
    },

    setCustomer(customer) {
      const res = setCustomer(get().cart, customer ?? null)
      if (!res.ok) {
        set({ lastError: res.error })
        return res
      }
      set({ cart: res.cart, lastError: null })
      schedulePersist()
      return res
    },

    removeLine(lineId) {
      const state = get()
      const nextCart = removeLine(state.cart, lineId)
      const remaining = nextCart.lines
      const nextSelected =
        state.selectedLineId === lineId
          ? remaining[remaining.length - 1]?.id ?? null
          : state.selectedLineId
      set({ cart: nextCart, selectedLineId: nextSelected, lastError: null })
      void persistNow()
    },

    selectLine(lineId) {
      set({ selectedLineId: lineId })
    },

    async clearCart() {
      const ctx = get().context ?? initialContext
      set({
        cart: makeFreshCart(ctx),
        selectedLineId: null,
        lastError: null,
      })
      await persistNow()
    },

    async flushDraft() {
      await persistNow()
    },

    clearError() {
      set({ lastError: null })
    },
  }))

  return store
}

export type CartStoreApi = ReturnType<typeof createCartStore>

export const posCartStore = createCartStore()
