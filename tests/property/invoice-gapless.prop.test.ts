import 'fake-indexeddb/auto'
import { webcrypto } from 'node:crypto'
import * as fc from 'fast-check'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { createIdGenerator, formatInvoiceNo } from '~/lib/kernel'
import {
  __clearDeviceAuthCacheForTests,
  __clearTenantCacheForTests,
  createLegalEntity,
  createOutlet,
  createRegister,
  createTenant,
  getTenantAuthMetadataBySlug,
  redeemInvite,
  type IdentityAuthActor,
} from '~/modules/identity/public'
import { PERMISSION_CODES } from '~/modules/identity/shared'
import {
  listActiveInvoiceGaps,
} from '~/modules/sales/server/invoice-series.repo'
import {
  registerReceivedNumber,
} from '~/modules/sales/server/invoice-series.service'
import { invoiceCounterKey, nextSeq } from '~/pos/data/counter.repo'
import { closeTenantDb, deleteTenantDbForTests, openTenantDb, type SolvaDb } from '~/pos/db/solva-db'
import { composeServer, resetCompositionForTests } from '~/server/composition'
import { resetLimitersForTests } from '~/server/auth/rate-limit/limiters'
import { closePools, withTenant } from '~/server/db'
import { resetEnvForTests } from '~/server/env'
import { uniqueSlug } from '../integration/helpers/tenants'

const idGen = createIdGenerator({
  nowMs: () => Date.now(),
  nextUint32: () => {
    const buf = new Uint32Array(1)
    webcrypto.getRandomValues(buf)
    return buf[0]!
  },
})

const NUM_RUNS = Number(process.env.FC_NUM_RUNS ?? (process.env.CI ? 200 : 100))

describe('Invoice gapless and conflict property suite (K03, BR-INV-008/009)', () => {
  beforeEach(() => {
    resetEnvForTests()
    __clearTenantCacheForTests()
    __clearDeviceAuthCacheForTests()
    resetLimitersForTests()
    resetCompositionForTests()
    composeServer()
  })

  afterAll(async () => {
    await closePools()
  })

  describe('Client-side invoice allocator properties', () => {
    it('produces strictly contiguous 1..N sequences without gaps across crashes and restarts', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.array(
            fc.oneof(
              fc.constant({ kind: 'ALLOCATE' as const }),
              fc.constant({ kind: 'ALLOCATE' as const }),
              fc.constant({ kind: 'ALLOCATE' as const }),
              fc.constant({ kind: 'CRASH' as const }),
              fc.constant({ kind: 'REOPEN' as const }),
            ),
            { minLength: 5, maxLength: 50 },
          ),
          async (ops) => {
            const tenantId = idGen.newId()
            let db: SolvaDb = await openTenantDb(tenantId)
            const regId = 'reg-prop-01'
            const period = '1126'
            const key = invoiceCounterKey(regId, period)
            const successfulSeqs: number[] = []

            try {
              for (const op of ops) {
                if (op.kind === 'ALLOCATE') {
                  const seq = await db.transaction('rw', db.local_counter, async (tx) => {
                    return nextSeq(tx, key, {
                      registerId: regId,
                      docType: 'INVOICE',
                      period,
                    })
                  })
                  successfulSeqs.push(seq)
                } else if (op.kind === 'CRASH') {
                  // Transaction fails and rolls back -> sequence must NOT advance
                  await expect(
                    db.transaction('rw', db.local_counter, async (tx) => {
                      await nextSeq(tx, key, {
                        registerId: regId,
                        docType: 'INVOICE',
                        period,
                      })
                      throw new Error('SIMULATED_POWER_CUT')
                    }),
                  ).rejects.toThrow('SIMULATED_POWER_CUT')
                } else if (op.kind === 'REOPEN') {
                  // Close and reopen database
                  closeTenantDb(tenantId)
                  db = await openTenantDb(tenantId)
                }
              }

              // Invariant 1: If any allocations succeeded, they must be [1, 2, 3, ..., N]
              if (successfulSeqs.length > 0) {
                expect(successfulSeqs[0]).toBe(1)
                for (let i = 0; i < successfulSeqs.length; i += 1) {
                  expect(successfulSeqs[i]).toBe(i + 1)
                }
              }

              // Invariant 2: Final stored last_seq matches exact count of successful allocations
              const finalCounter = await db.local_counter.get(key)
              expect(finalCounter?.last_seq ?? 0).toBe(successfulSeqs.length)
            } finally {
              db.close()
              await deleteTenantDbForTests(tenantId)
            }
          },
        ),
        { numRuns: NUM_RUNS },
      )
    })
  })

  describe('Server-side invoice gap detector and conflict handling properties', () => {
    it('accurately identifies missing sequence numbers as gaps and assigns -Dn on collision without data loss', async () => {
      const slug = uniqueSlug('prop-gap')
      const testOp = { platformUserId: idGen.newId(), email: `${slug}@example.test` }
      const email = `owner-${slug}@example.test`
      const created = await createTenant(testOp, {
        name: `Prop ${slug}`,
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
        password: 'Password123!',
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
      const le = await createLegalEntity(actor, { name: 'PT Prop Gap', isPkp: false })
      const outlet = await createOutlet(actor, {
        legalEntityId: le.id,
        code: 'OUT01',
        name: 'Outlet 01',
        timezone: 'Asia/Jakarta',
        dayCutoffTime: '00:00',
        priceTaxMode: 'EXCLUSIVE',
      })
      const tenantId = created.tenantId
      const outletId = outlet.id
      let testIteration = 0

      // Property test: For arbitrary subsets of missing numbers and arrival orderings
      await fc.assert(
        fc.asyncProperty(
          // Array of boolean flags for which of seqs 1..10 arrive
          fc.tuple(
            fc.boolean(),
            fc.boolean(),
            fc.boolean(),
            fc.boolean(),
            fc.boolean(),
            fc.boolean(),
            fc.boolean(),
            fc.boolean(),
          ),
          async (arrivalFlags) => {
            testIteration += 1
            const runReg = await createRegister(actor, {
              outletId,
              code: `P${String(testIteration).padStart(4, '0')}`,
              name: `Reg ${testIteration}`,
              registerType: 'CASHIER',
              invoicePrefix: `OUT01-P${testIteration}`,
            })
            const registerId = runReg.id
            const period = '1126'
            const prefix = `OUT01-P${testIteration}`

            // At least the highest sequence must arrive so there is a maxSeqReceived
            const seqCount = arrivalFlags.length
            const arrivingSeqs: number[] = []
            const droppedSeqs: number[] = []

            for (let i = 0; i < seqCount - 1; i += 1) {
              const seq = i + 1
              if (arrivalFlags[i]) {
                arrivingSeqs.push(seq)
              } else {
                droppedSeqs.push(seq)
              }
            }
            // Always include last seq so gaps before it are detectable
            arrivingSeqs.push(seqCount)

            // Shuffle arriving sequences
            const shuffledArrivals = [...arrivingSeqs].sort(() => Math.random() - 0.5)

            // Execute registration inside tenant transaction
            await withTenant(tenantId, async (tx) => {
              for (const seq of shuffledArrivals) {
                const docId = idGen.newId()
                const res = await registerReceivedNumber(tx, {
                  tenantId,
                  outletId,
                  registerId,
                  docType: 'INVOICE',
                  docId,
                  prefix,
                  period,
                  seq,
                  receivedAtIso: new Date().toISOString(),
                })
                expect(res.isConflict).toBe(false)
                expect(res.finalNo).toBe(
                  formatInvoiceNo({ prefix, kind: 'INVOICE', period, seq }),
                )
              }

              // Verify active gaps match exactly the dropped sequences < seqCount
              const activeGaps = await listActiveInvoiceGaps(tx, {
                tenantId,
                registerId,
                docType: 'INVOICE',
                period,
              })

              const coveredMissing = new Set<number>()
              for (const g of activeGaps) {
                for (let s = g.seqFrom; s <= g.seqTo; s += 1) {
                  coveredMissing.add(s)
                }
              }

              // Invariant 1: Every dropped seq must be covered by an active gap
              for (const dropped of droppedSeqs) {
                expect(coveredMissing.has(dropped)).toBe(true)
              }

              // Invariant 2: No arriving seq should be in active gaps
              for (const arrived of arrivingSeqs) {
                expect(coveredMissing.has(arrived)).toBe(false)
              }

              // Invariant 3: Sequence collision triggers -D1 conflict without failure
              const conflictDocId = idGen.newId()
              const conflictRes = await registerReceivedNumber(tx, {
                tenantId,
                outletId,
                registerId,
                docType: 'INVOICE',
                docId: conflictDocId,
                prefix,
                period,
                seq: seqCount, // Collides with existing max seq
                receivedAtIso: new Date().toISOString(),
              })

              expect(conflictRes.isConflict).toBe(true)
              expect(conflictRes.conflictIdx).toBe(1)
              expect(conflictRes.finalNo).toBe(
                formatInvoiceNo({
                  prefix,
                  kind: 'INVOICE',
                  period,
                  seq: seqCount,
                  conflictIdx: 1,
                }),
              )
            })
          },
        ),
        { numRuns: Math.min(NUM_RUNS, 30) }, // DB transactions per run, 30 runs is comprehensive & fast
      )
    })
  })
})
