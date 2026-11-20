import { describe, expect, it } from 'vitest'
import { ReleaseBlockSchema, ReleaseResponseSchema } from './release'

describe('release contracts', () => {
  it('validates release block and response payloads', () => {
    const block = ReleaseBlockSchema.parse({
      latest: 'v1.8.0',
      min_supported_app_version: 'v1.6.0',
      min_supported_schema_version: 7,
      is_mandatory: false,
      accept_previous_until: '2026-12-31T00:00:00.000Z',
      max_schema_version: 8,
    })

    expect(ReleaseResponseSchema.parse({ release: block })).toEqual({ release: block })
  })
})
