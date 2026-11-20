export const REGISTRY_DB_NAME = 'solva-registry'

export function tenantDbName(tenantId: string): string {
  return `solva-pos:${tenantId}`
}

export function lockName(tenantId: string, deviceId: string): string {
  return `solva:${tenantId}:instance:${deviceId}`
}

export function resourceLockName(tenantId: string, deviceId: string, name: string): string {
  return `solva:${tenantId}:res:${deviceId}:${name}`
}

export function channelName(tenantId: string, deviceId: string): string {
  return `solva:${tenantId}:${deviceId}`
}

export function storageKey(tenantId: string, ...parts: readonly string[]): string {
  return `solva:${tenantId}:${parts.join(':')}`
}

/**
 * Physical printers are shared per browser origin across tabs/tenants (ARCH §3.7 exception).
 */
export function printLockName(printerId: string): string {
  return `print:${printerId}`
}
