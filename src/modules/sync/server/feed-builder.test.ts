import { pgTable, text } from 'drizzle-orm/pg-core'
import { describe, expect, it } from 'vitest'
import { isoTimestamptz, moneyBigint, uuidId } from '~/server/db/columns'
import type { TenantTx } from '~/server/db'
import { buildFeedSource, omitWireColumns } from './feed-builder'

const mockTable = pgTable('mock_entity', {
  id: uuidId('id').primaryKey(),
  tenantId: uuidId('tenant_id').notNull(),
  version: moneyBigint('version').notNull(),
  code: text('code').notNull(),
  secretKey: text('secret_key'),
  createdBy: uuidId('created_by'),
  updatedBy: uuidId('updated_by'),
  deletedAt: isoTimestamptz('deleted_at'),
})

describe('feed-builder helpers', () => {
  it('omitWireColumns strips excluded columns immutably', () => {
    const input = {
      id: '01950000-0000-7000-8000-000000000001',
      code: 'A',
      secret_key: 'hidden',
      created_by: 'u1',
    }
    const stripped = omitWireColumns(input, ['secret_key', 'created_by'])
    expect(stripped).toEqual({
      id: '01950000-0000-7000-8000-000000000001',
      code: 'A',
    })
    expect(input.secret_key).toBe('hidden')
  })

  it('hydrates live, deleted, and out-of-scope rows while stripping created_by/updated_by and custom fields', async () => {
    const sampleRows = [
      {
        id: '01950000-0000-7000-8000-000000000001',
        tenantId: 't1',
        version: 2,
        code: 'LIVE',
        secretKey: 'internal-1',
        createdBy: 'u1',
        updatedBy: 'u2',
        deletedAt: null,
      },
      {
        id: '01950000-0000-7000-8000-000000000002',
        tenantId: 't1',
        version: 3,
        code: 'OUT_OF_SCOPE',
        secretKey: 'internal-2',
        createdBy: 'u1',
        updatedBy: 'u2',
        deletedAt: null,
      },
      {
        id: '01950000-0000-7000-8000-000000000003',
        tenantId: 't1',
        version: 4,
        code: 'DELETED',
        secretKey: 'internal-3',
        createdBy: 'u1',
        updatedBy: 'u2',
        deletedAt: '2026-11-20T00:00:00.000Z',
      },
    ]

    const fakeTx = {
      select: () => ({
        from: () => ({
          where: async () => sampleRows,
        }),
      }),
    } as unknown as TenantTx

    const source = buildFeedSource({
      entity: 'mock_entity',
      table: mockTable,
      columns: {
        id: mockTable.id,
        tenantId: mockTable.tenantId,
        version: mockTable.version,
        deletedAt: mockTable.deletedAt,
      },
      inScope: (row) => row.code !== 'OUT_OF_SCOPE',
      project: (row) => omitWireColumns(row, ['secret_key']),
    })

    const hydrated = await source.hydrate(
      fakeTx,
      sampleRows.map((r) => r.id),
      { tenantId: 't1', outletId: 'o1', registerId: 'r1', deviceId: 'd1' },
    )

    expect(hydrated).toEqual([
      {
        entity: 'mock_entity',
        op: 'upsert',
        id: '01950000-0000-7000-8000-000000000001',
        version: 2,
        row: {
          id: '01950000-0000-7000-8000-000000000001',
          tenant_id: 't1',
          version: 2,
          code: 'LIVE',
          deleted_at: null,
        },
      },
      {
        entity: 'mock_entity',
        op: 'delete',
        id: '01950000-0000-7000-8000-000000000002',
        version: 3,
      },
      {
        entity: 'mock_entity',
        op: 'delete',
        id: '01950000-0000-7000-8000-000000000003',
        version: 4,
      },
    ])
  })
})
