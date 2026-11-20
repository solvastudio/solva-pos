import { useStore } from 'zustand'
import { posCartStore, type CartStoreState } from '../state/cart-store'

export function useCart<T>(selector: (state: CartStoreState) => T): T {
  return useStore(posCartStore, selector)
}

export function useCartLines() {
  return useStore(posCartStore, (s) => s.cart.lines)
}

export function useSelectedCartLineId() {
  return useStore(posCartStore, (s) => s.selectedLineId)
}
