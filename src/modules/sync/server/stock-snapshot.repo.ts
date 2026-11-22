import '@tanstack/react-start/server-only'
import { sql } from 'drizzle-orm'
import type { TenantTx } from '~/server/db'

/** `acked_device_seq`: highest command seq the device has ACKed (SCHEMA §6.2). 0 when none. */
export async function readAckedDeviceSeq(tx: TenantTx, tenantId: string, deviceId: string): Promise<number> {
  const res = await tx.execute<{ seq: string | number }>(sql`
    SELECT COALESCE(MAX(device_seq), 0)::bigint AS seq
    FROM idempotency_command
    WHERE tenant_id = ${tenantId}::uuid AND device_id = ${deviceId}::uuid AND status = 'ACKED'
  `)
  return Number(res.rows[0]?.seq ?? 0)
}
