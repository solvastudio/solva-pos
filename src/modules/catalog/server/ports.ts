import '@tanstack/react-start/server-only'
import type { TenantTx } from '~/server/db'

export interface HasTransactionsPort {
  hasTransactions(productIdOrSkuId: string, tx?: TenantTx): Promise<boolean>
}

const defaultPort: HasTransactionsPort = {
  async hasTransactions() {
    return false
  },
}

let activePort: HasTransactionsPort = defaultPort

export function registerHasTransactionsPort(port: HasTransactionsPort): void {
  activePort = port
}

export function getHasTransactionsPort(): HasTransactionsPort {
  return activePort
}

export function __clearHasTransactionsPortForTests(): void {
  activePort = defaultPort
}
