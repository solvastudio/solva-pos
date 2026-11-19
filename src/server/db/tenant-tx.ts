import '@tanstack/react-start/server-only'
import type { NodePgDatabase } from 'drizzle-orm/node-postgres'

export type RawDrizzleTx = Parameters<Parameters<NodePgDatabase['transaction']>[0]>[0]

declare const TenantTxBrand: unique symbol
declare const NoTenantTxBrand: unique symbol

export type TenantTx = RawDrizzleTx & { readonly [TenantTxBrand]: true }
export type NoTenantTx = RawDrizzleTx & { readonly [NoTenantTxBrand]: true }
