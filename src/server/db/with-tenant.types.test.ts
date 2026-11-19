import { describe, expect, it } from 'vitest'
import { getDb } from './pool'
import type { RawDrizzleTx, TenantTx } from './tenant-tx'
import { withNoTenant, withTenant, withTenantReadOnly } from './with-tenant'

function needsTx(_tx: TenantTx): string {
  return 'ok'
}

describe('server/db/with-tenant type branding', () => {
  it('enforces TenantTx branding at compile time without running DB queries', () => {
    const checkTypes = () => {
      // @ts-expect-error plain Database must not be assignable to TenantTx
      needsTx(getDb())

      const checkRaw = (raw: RawDrizzleTx) => {
        // @ts-expect-error raw Drizzle transaction must not be assignable to TenantTx
        needsTx(raw)
      }
      void checkRaw

      void withNoTenant(async (noTenantTx) => {
        // @ts-expect-error NoTenantTx must not be assignable to TenantTx
        return needsTx(noTenantTx)
      })

      void withTenant('019a0000-0000-7000-8000-000000000001', async (tx) => {
        return needsTx(tx)
      })

      void withTenantReadOnly('019a0000-0000-7000-8000-000000000001', async (tx) => {
        return needsTx(tx)
      })
    }

    expect(typeof checkTypes).toBe('function')
  })
})
