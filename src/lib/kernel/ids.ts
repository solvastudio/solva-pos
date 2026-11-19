import { V7Generator } from 'uuidv7'

export type Uuid = string & { readonly __uuid: true }

export interface IdDeps {
  nowMs: () => number
  nextUint32: () => number
}

const LOWERCASE_UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

export function createIdGenerator(deps: IdDeps): { newId(): Uuid } {
  const gen = new V7Generator({ nextUint32: deps.nextUint32 })
  return {
    newId(): Uuid {
      return gen.generateOrResetWithTs(deps.nowMs()).toString().toLowerCase() as Uuid
    },
  }
}

export function isUuid(s: string): s is Uuid {
  return typeof s === 'string' && LOWERCASE_UUID_PATTERN.test(s)
}
