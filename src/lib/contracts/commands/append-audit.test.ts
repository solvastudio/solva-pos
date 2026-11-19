import { describe, expect, it } from 'vitest'
import { AppendAuditPayloadV1 } from './append-audit'

describe('contracts/commands/append-audit', () => {
  it('parses a complete AppendAudit v1 payload and defaults omitted nullable fields to null', () => {
    const parsed = AppendAuditPayloadV1.parse({
      entry: {
        id: '01950000-0000-7000-8000-000000000010',
        action: 'drawer.opened',
        entity_type: 'register',
        entity_id: '01950000-0000-7000-8000-000000000020',
        occurred_at: '2026-11-20T10:00:00.000Z',
        after_data: { reason: 'check' },
      },
    })

    expect(parsed.entry.before_data).toBeNull()
    expect(parsed.entry.actor_user_id).toBeNull()
    expect(parsed.entry.after_data).toEqual({ reason: 'check' })
  })

  it('rejects missing entry id or invalid business_date', () => {
    expect(() =>
      AppendAuditPayloadV1.parse({
        entry: {
          action: 'drawer.opened',
          entity_type: 'register',
          occurred_at: '2026-11-20T10:00:00.000Z',
        },
      }),
    ).toThrow()

    expect(() =>
      AppendAuditPayloadV1.parse({
        entry: {
          id: '01950000-0000-7000-8000-000000000010',
          action: 'drawer.opened',
          entity_type: 'register',
          occurred_at: '2026-11-20T10:00:00.000Z',
          business_date: '20-11-2026',
        },
      }),
    ).toThrow()
  })
})
