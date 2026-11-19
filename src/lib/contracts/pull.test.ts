import { describe, expect, it } from 'vitest'
import { FullPageRequest, FullStartRequest, PullRequest, PullResponse } from './pull'

const SAMPLE_UUID = '01950000-0000-7000-8000-000000000001'

describe('pull contracts', () => {
  it('applies defaults and coerces invalid report error fields to null without failing', () => {
    const parsed = PullRequest.parse({
      cursor: null,
      cycle: null,
      report: {
        push_ok: true,
        pending_count: 2,
        oldest_pending_at: '2026-11-20T00:00:00.000Z',
        attention_count: 0,
        storage_persist: 'GRANTED',
        storage_used_pct: 42,
        last_error_code: 'not_valid_lowercase',
        last_error_ref: 'bad ref with spaces & !',
        clock_offset_ms: -15,
        app_version: 'v0.1.0',
        schema_version: 1,
        sync_protocol_version: 1,
      },
    })

    expect(parsed.page_size).toBe(500)
    expect(parsed.attention_ids).toEqual([])
    expect(parsed.report?.last_error_code).toBeNull()
    expect(parsed.report?.last_error_ref).toBeNull()
  })

  it('rejects strict client-injected scope fields and invalid page_size', () => {
    expect(
      PullRequest.safeParse({
        cursor: null,
        cycle: null,
        outlet_id: SAMPLE_UUID,
      }).success,
    ).toBe(false)

    expect(
      PullRequest.safeParse({
        cursor: null,
        cycle: null,
        page_size: 501,
      }).success,
    ).toBe(false)

    expect(
      FullStartRequest.safeParse({
        outlet_id: SAMPLE_UUID,
      }).success,
    ).toBe(false)

    expect(
      FullPageRequest.safeParse({
        snapshot_token: 'tok',
        entity: 'outlet',
        after_id: null,
        page_size: 0,
      }).success,
    ).toBe(false)
  })

  it('validates both PullResponse union variants', () => {
    expect(
      PullResponse.parse({
        full_resync_required: true,
        reason: 'CURSOR_BELOW_FLOOR',
      }),
    ).toEqual({
      full_resync_required: true,
      reason: 'CURSOR_BELOW_FLOOR',
    })

    expect(
      PullResponse.parse({
        server_time: '2026-11-20T00:00:00.000Z',
        upper: 10,
        tombstone_floor: 0,
        rows: [],
        next_cursor: { version: 10, id: SAMPLE_UUID },
        has_more: false,
        max_schema_version: 1,
        release: null,
        command_updates: [{ id: SAMPLE_UUID, status: 'ACKED' }],
        manifest: { counts: { outlet: 1 } },
      }),
    ).toMatchObject({
      upper: 10,
      has_more: false,
      release: null,
    })
  })
})
