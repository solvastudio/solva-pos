import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import appendAuditFixture from '../../../../tests/fixtures/contracts/v1/AppendAudit.json'
import closeShiftFixture from '../../../../tests/fixtures/contracts/v1/CloseShift.json'
import finalizeCreditNoteFixture from '../../../../tests/fixtures/contracts/v1/FinalizeCreditNote.json'
import finalizeSaleFixture from '../../../../tests/fixtures/contracts/v1/FinalizeSale.json'
import openShiftFixture from '../../../../tests/fixtures/contracts/v1/OpenShift.json'
import recordCashMovementFixture from '../../../../tests/fixtures/contracts/v1/RecordCashMovement.json'
import voidSaleFixture from '../../../../tests/fixtures/contracts/v1/VoidSale.json'
import {
  COMMAND_PAYLOAD_SCHEMAS,
  ContractError,
  getLatestSchemaVersion,
  parseCommandPayload,
} from './index'

const FIXTURES = {
  FinalizeSale: finalizeSaleFixture,
  VoidSale: voidSaleFixture,
  FinalizeCreditNote: finalizeCreditNoteFixture,
  OpenShift: openShiftFixture,
  RecordCashMovement: recordCashMovementFixture,
  CloseShift: closeShiftFixture,
  AppendAudit: appendAuditFixture,
} as const

describe('contracts/commands registry & parseCommandPayload', () => {
  it('registers all F3 v1 schemas plus AppendAudit and validates their golden fixtures', () => {
    for (const [type, fixture] of Object.entries(FIXTURES) as Array<
      [keyof typeof FIXTURES, unknown]
    >) {
      expect(getLatestSchemaVersion(type)).toBe(1)
      expect(COMMAND_PAYLOAD_SCHEMAS[type][1]).toBeDefined()
      const parsed = parseCommandPayload(type, 1, fixture)
      expect(parsed).toBeDefined()
    }
  })

  it('throws UPDATE_REQUIRED when version is below minimum supported and VALIDATION_FAILED otherwise', () => {
    const syntheticV2Only = {
      OpenShift: {
        2: z.object({ shift: z.object({ opening_cash: z.number() }) }),
      },
    }

    try {
      parseCommandPayload('OpenShift', 1, {}, { schemas: syntheticV2Only })
      expect.unreachable('should throw ContractError')
    } catch (err) {
      expect(err).toBeInstanceOf(ContractError)
      expect((err as ContractError).code).toBe('UPDATE_REQUIRED')
    }

    try {
      parseCommandPayload('OpenShift', 99, {}, { schemas: syntheticV2Only })
      expect.unreachable('should throw ContractError')
    } catch (err) {
      expect(err).toBeInstanceOf(ContractError)
      expect((err as ContractError).code).toBe('VALIDATION_FAILED')
    }

    try {
      parseCommandPayload('AppendBillEvents', 1, {}, {
        schemas: { ...COMMAND_PAYLOAD_SCHEMAS, AppendBillEvents: {} },
      })
      expect.unreachable('should throw ContractError')
    } catch (err) {
      expect(err).toBeInstanceOf(ContractError)
      expect((err as ContractError).code).toBe('VALIDATION_FAILED')
    }
  })
})
