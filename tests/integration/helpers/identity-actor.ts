import { webcrypto } from 'node:crypto'
import { createIdGenerator } from '~/lib/kernel'
import {
  createTenant,
  getTenantAuthMetadataBySlug,
  redeemInvite,
  type IdentityAuthActor,
} from '~/modules/identity/public'
import { PERMISSION_CODES } from '~/modules/identity/shared'

const idGen = createIdGenerator({
  nowMs: () => Date.now(),
  nextUint32: () => {
    const buf = new Uint32Array(1)
    webcrypto.getRandomValues(buf)
    return buf[0]!
  },
})

const operator = { platformUserId: idGen.newId(), email: 'op-roles@example.test' }

/** Creates a tenant, redeems the owner invite, and returns an OWNER actor holding every catalog permission. */
export async function bootstrapIdentityTenant(slug: string) {
  const email = `owner-${slug}@example.test`
  const created = await createTenant(operator, {
    name: `Tenant ${slug}`,
    slug,
    ownerEmail: email,
    ownerDisplayName: 'Owner',
  })
  const meta = await getTenantAuthMetadataBySlug(slug)
  await redeemInvite({
    tenantId: created.tenantId,
    tenantSlug: slug,
    authOrgId: meta!.authOrgId,
    email,
    code: created.ownerInvite.code,
    password: 'OwnerPassword123!',
  })
  const actor: IdentityAuthActor = {
    tenantId: created.tenantId,
    tenantSlug: slug,
    authOrgId: meta!.authOrgId,
    appUserId: created.ownerInvite.appUserId,
    permissions: new Set(PERMISSION_CODES),
    outletIds: null,
    roleCodes: ['OWNER'],
  }
  return { tenantId: created.tenantId, slug, authOrgId: meta!.authOrgId, ownerEmail: email, actor }
}
