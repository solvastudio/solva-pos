import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

export const E2E_STATE_PATH = resolve('tests/e2e/.state.json')
export const E2E_LOG_DIR = resolve('tests/e2e/.logs')

export interface E2EState {
  baseUrl: string
  e2eDbAppUrl: string
  e2eDbOwnerUrl: string
  logDir: string
  platformAdmin: {
    email: string
    password: string
  }
  users: {
    budi: {
      email: string
      password: string
      displayName: string
      acmeAppUserId: string
    }
    ani: {
      email: string
      password: string
      displayName: string
      acmeAppUserId: string
      betaAppUserId: string
    }
    citra: {
      email: string
      password: string
      displayName: string
      acmeAppUserId: string
    }
  }
  tenants: {
    acme: {
      id: string
      slug: string
      name: string
      authOrgId: string
      legalEntityId: string
      outletId: string
      registerId: string
    }
    beta: {
      id: string
      slug: string
      name: string
      authOrgId: string
      legalEntityId: string
      outletId: string
      registerId: string
    }
  }
}

export function writeE2eState(state: E2EState): void {
  mkdirSync(dirname(E2E_STATE_PATH), { recursive: true })
  writeFileSync(E2E_STATE_PATH, JSON.stringify(state, null, 2), 'utf8')
}

export function readE2eState(): E2EState {
  if (!existsSync(E2E_STATE_PATH)) {
    throw new Error(`Missing E2E state file at ${E2E_STATE_PATH}. Run global-setup first.`)
  }
  return JSON.parse(readFileSync(E2E_STATE_PATH, 'utf8')) as E2EState
}
