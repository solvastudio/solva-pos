export const BRAND_NAME = 'Solva POS' as const
export const BRAND_ADMIN_NAME = 'Solva Admin' as const

export function formatAppTitle(app: 'admin' | 'pos', tenantName?: string | null): string {
  const cleanName = tenantName?.trim()
  if (app === 'admin') {
    return cleanName ? `Admin · ${cleanName}` : BRAND_ADMIN_NAME
  }
  return cleanName ? `POS · ${cleanName}` : BRAND_NAME
}
