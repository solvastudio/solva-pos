import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { migrateCommandPayload } from './index'

describe('contracts/migrators framework', () => {
  const OpenShiftV1 = z
    .object({
      shift: z.object({
        id: z.string(),
        opening_cash: z.number().int().min(0),
      }),
    })
    .strict()

  const OpenShiftV2 = z
    .object({
      shift: z.object({
        id: z.string(),
        opening_cash: z.number().int().min(0),
        float_verified: z.boolean(),
      }),
    })
    .strict()

  const OpenShiftV3 = z
    .object({
      shift: z.object({
        id: z.string(),
        opening_cash: z.number().int().min(0),
        float_verified: z.boolean(),
        currency: z.literal('IDR'),
      }),
    })
    .strict()

  const syntheticSchemas = {
    OpenShift: { 1: OpenShiftV1, 2: OpenShiftV2, 3: OpenShiftV3 },
  }

  const syntheticMigrators = {
    OpenShift: {
      1: (raw: unknown) => {
        const p = OpenShiftV1.parse(raw)
        return { shift: { ...p.shift, float_verified: p.shift.opening_cash >= 0 } }
      },
      2: (raw: unknown) => {
        const p = OpenShiftV2.parse(raw)
        return { shift: { ...p.shift, currency: 'IDR' as const } }
      },
    },
  }

  it('chains forward migrators across synthetic v1 -> v2 -> v3 and validates golden pairs', () => {
    const goldenV1 = { shift: { id: 'shift-1', opening_cash: 300000 } }
    const expectedV3 = { shift: { id: 'shift-1', opening_cash: 300000, float_verified: true, currency: 'IDR' } }

    const migrated = migrateCommandPayload('OpenShift', 1, 3, goldenV1, {
      migrators: syntheticMigrators,
      schemas: syntheticSchemas,
    })
    expect(migrated).toEqual(expectedV3)

    expect(() =>
      migrateCommandPayload('OpenShift', 3, 2, migrated, {
        migrators: syntheticMigrators,
        schemas: syntheticSchemas,
      }),
    ).toThrow()
  })

  it('preserves validity across random valid v1 payloads migrated forward to synthetic v2', () => {
    fc.assert(
      fc.property(
        fc.uuid(),
        fc.integer({ min: 0, max: 50_000_000 }),
        (id, openingCash) => {
          const v1Payload = { shift: { id, opening_cash: openingCash } }
          const v2Payload = migrateCommandPayload('OpenShift', 1, 2, v1Payload, {
            migrators: syntheticMigrators,
            schemas: syntheticSchemas,
          })
          expect(OpenShiftV2.safeParse(v2Payload).success).toBe(true)
        },
      ),
      { numRuns: 200 },
    )
  })
})
