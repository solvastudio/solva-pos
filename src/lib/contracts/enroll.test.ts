import { describe, expect, it } from 'vitest'
import { EnrollRequest, EnrollResponse } from './enroll'

describe('contracts/enroll (EnrollRequest & EnrollResponse)', () => {
  it('validates EnrollRequest and rejects overlong fields', () => {
    expect(
      EnrollRequest.parse({
        slug: 'acme',
        code: 'K7Q2-M9XD',
        device_name: 'Cashier Tablet 1',
      }),
    ).toEqual({
      slug: 'acme',
      code: 'K7Q2-M9XD',
      device_name: 'Cashier Tablet 1',
    })

    expect(() =>
      EnrollRequest.parse({
        slug: 'acme',
        code: 'K7Q2-M9XD',
        device_name: 'X'.repeat(81),
      }),
    ).toThrow()

    expect(() =>
      EnrollRequest.parse({
        slug: 'acme',
        code: '12345678901234567',
        device_name: 'Tablet',
      }),
    ).toThrow()
  })

  it('validates EnrollResponse shape with millisecond server_time', () => {
    const sample = {
      device_id: '01950000-0000-7000-8000-000000000001',
      credential: 'abc123tokenvalue',
      credential_expires_at: '2027-05-19T12:00:00.000Z',
      tenant: {
        id: '01950000-0000-7000-8000-000000000002',
        slug: 'acme',
        name: 'Acme Store',
        default_locale: 'id-ID',
      },
      outlet: {
        id: '01950000-0000-7000-8000-000000000003',
        code: 'OUT01',
        name: 'Main Outlet',
        timezone: 'Asia/Jakarta',
        day_cutoff_time: '00:00',
      },
      register: {
        id: '01950000-0000-7000-8000-000000000004',
        code: 'POS01',
        name: 'Front Cashier',
        register_type: 'CASHIER',
        paper_width_mm: 80,
      },
      server_time: 1795000000000,
    }
    expect(EnrollResponse.parse(sample)).toEqual(sample)
  })
})
