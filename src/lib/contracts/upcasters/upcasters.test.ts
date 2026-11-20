import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { parseCommandPayload } from '../commands'
import { upcastStoredPayload } from './index'

describe('contracts/upcasters framework', () => {
  const VoidSaleV1 = z
    .object({
      sale_id: z.string(),
      reason_text: z.string().min(1),
    })
    .strict()

  const VoidSaleV2 = z
    .object({
      sale_id: z.string(),
      reason_code: z.string().min(1),
      reason_text: z.string().min(1),
    })
    .strict()

  const syntheticUpcasters = {
    VoidSale: {
      1: (raw: unknown) => {
        const v1 = raw as z.infer<typeof VoidSaleV1>
        return { ...v1, reason_code: 'LEGACY_UNSPECIFIED' }
      },
    },
  }

  it('upcasts stored v1 payload cleanly to synthetic v2 via parseCommandPayload', () => {
    const parsed = parseCommandPayload(
      'VoidSale',
      1,
      { sale_id: 's-1', reason_text: 'wrong item' },
      {
        schemas: { VoidSale: { 1: VoidSaleV1, 2: VoidSaleV2 } },
        upcasters: syntheticUpcasters,
      },
    )

    expect(VoidSaleV2.parse(parsed)).toEqual({
      sale_id: 's-1',
      reason_code: 'LEGACY_UNSPECIFIED',
      reason_text: 'wrong item',
    })

    expect(() => upcastStoredPayload('VoidSale', 2, parsed, { upcasters: syntheticUpcasters, targetVersion: 1 })).toThrow()
  })

  it('always produces valid v2 payloads when upcasting arbitrary valid v1 payloads', () => {
    fc.assert(
      fc.property(fc.uuid(), fc.string({ minLength: 1, maxLength: 60 }), (saleId, reasonText) => {
        const upcasted = parseCommandPayload(
          'VoidSale',
          1,
          { sale_id: saleId, reason_text: reasonText },
          {
            schemas: { VoidSale: { 1: VoidSaleV1, 2: VoidSaleV2 } },
            upcasters: syntheticUpcasters,
          },
        )
        expect(VoidSaleV2.safeParse(upcasted).success).toBe(true)
      }),
      { numRuns: 200 },
    )
  })
})
