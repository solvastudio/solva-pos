import { describe, expect, it } from 'vitest'
import { resolveOutletConfigSnapshot } from './config-snapshot'

const BASE_OUTLET = {
  id: 'out-1',
  legal_entity_id: 'le-1',
  code: 'OUT01',
  name: 'Main',
  timezone: 'Asia/Jakarta',
  day_cutoff_time: '00:00',
  price_tax_mode: 'EXCLUSIVE' as const,
  tax_profile: 'PPN' as const,
  cash_rounding_unit: 100,
  service_charge_enabled: true,
  service_charge_rate: '5.0000',
  service_charge_taxable: true,
  deleted_at: null,
}

describe('pos/domain/config-snapshot', () => {
  it('picks outlet-specific rate over tenant default per businessDate', () => {
    const res = resolveOutletConfigSnapshot({
      outlet: BASE_OUTLET,
      businessDate: '2026-11-20',
      taxRates: [
        {
          id: 'tr-def',
          tax_code: 'PPN',
          outlet_id: null,
          outlet_key: '*',
          effective_from: '2026-01-01',
          rate: '11.0000',
        },
        {
          id: 'tr-out',
          tax_code: 'PPN',
          outlet_id: 'out-1',
          outlet_key: 'out-1',
          effective_from: '2026-11-01',
          rate: '12.0000',
        },
      ],
    })

    expect(res).toEqual({
      ok: true,
      cashRoundingUnit: 100,
      taxRateId: 'tr-out',
      config: {
        priceTaxMode: 'EXCLUSIVE',
        taxProfile: 'PPN',
        taxRate: '12.0000',
        serviceChargeEnabled: true,
        serviceChargeRate: '5.0000',
        serviceChargeTaxable: true,
      },
    })
  })

  it('blocks cart creation when PPN/PB1 outlet has no matching rate by businessDate', () => {
    const res = resolveOutletConfigSnapshot({
      outlet: BASE_OUTLET,
      businessDate: '2025-12-31',
      taxRates: [
        {
          id: 'tr-future',
          tax_code: 'PPN',
          outlet_id: null,
          outlet_key: '*',
          effective_from: '2026-01-01',
          rate: '11.0000',
        },
      ],
    })

    expect(res).toEqual({ ok: false, reason: 'TAX_RATE_NOT_CONFIGURED' })
  })
})
