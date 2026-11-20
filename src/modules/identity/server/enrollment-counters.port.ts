import '@tanstack/react-start/server-only'
import type { TenantTx } from '~/server/db'

export interface EnrollmentInvoiceCounter {
  readonly doc_type: 'INVOICE' | 'CREDIT_NOTE'
  readonly period: string
  readonly next_seq: number
}

export interface EnrollmentCounterProvider {
  getCountersAndBindDevice(
    tx: TenantTx,
    tenantId: string,
    registerId: string,
    newDeviceId: string,
  ): Promise<EnrollmentInvoiceCounter[]>
}

const defaultProvider: EnrollmentCounterProvider = {
  async getCountersAndBindDevice() {
    return []
  },
}

let activeProvider: EnrollmentCounterProvider = defaultProvider

export function registerEnrollmentCounterProvider(provider: EnrollmentCounterProvider): void {
  activeProvider = provider
}

export function getEnrollmentCounterProvider(): EnrollmentCounterProvider {
  return activeProvider
}

export function __clearEnrollmentCounterProviderForTests(): void {
  activeProvider = defaultProvider
}
