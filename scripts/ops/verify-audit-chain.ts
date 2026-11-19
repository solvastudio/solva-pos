import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'
import { sql } from 'drizzle-orm'
import { isUuid } from '~/lib/kernel'
import { verifyAuditChain } from '~/modules/audit/public'
import { closePools, withNoTenant, withTenantReadOnly } from '~/server/db'

export async function verifyTenantsAudit(tenantIds?: readonly string[]): Promise<boolean> {
  const targets =
    tenantIds && tenantIds.length > 0
      ? [...tenantIds]
      : await withNoTenant(async (tx) => {
          const res = await tx.execute(sql`SELECT id FROM list_active_tenants()`)
          return res.rows.map((r) => String((r as { id: unknown }).id).toLowerCase())
        })

  let allOk = true
  for (const tenantId of targets) {
    if (!isUuid(tenantId)) {
      process.stderr.write(`Invalid tenant UUID: ${tenantId}\n`)
      allOk = false
      continue
    }
    const result = await withTenantReadOnly(tenantId, (tx) => verifyAuditChain(tx))
    if (result.ok) {
      process.stdout.write(`${tenantId} ok checked=${result.checked}\n`)
    } else {
      process.stdout.write(
        `${tenantId} BROKEN seq=${result.brokenAtSeq} reason=${result.reason}\n`,
      )
      allOk = false
    }
  }
  return allOk
}

async function main(): Promise<number> {
  const { values } = parseArgs({
    options: {
      tenant: { type: 'string' },
    },
  })

  try {
    const ok = await verifyTenantsAudit(values.tenant ? [values.tenant] : undefined)
    return ok ? 0 : 1
  } finally {
    await closePools()
  }
}

const isEntrypoint =
  typeof process.argv[1] === 'string' &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url

if (isEntrypoint) {
  main()
    .then((code) => {
      process.exitCode = code
    })
    .catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err)
      process.stderr.write(`Audit verification failed: ${msg}\n`)
      process.exitCode = 1
    })
}
