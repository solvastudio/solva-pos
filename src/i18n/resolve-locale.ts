export type Locale = 'id-ID' | 'en-US'

export function isLocale(s: unknown): s is Locale {
  return s === 'id-ID' || s === 'en-US'
}

/**
 * Resolves the effective UI locale following BR-I18N-002 precedence (highest to lowest):
 * 1. Signed-in user preference (`user.locale`)
 * 2. Register default locale (`register.locale`)
 * 3. Tenant default locale (`tenant.default_locale`)
 * 4. Application default `'id-ID'`
 */
export function resolveLocale(p: {
  user?: string | null
  register?: string | null
  tenant?: string | null
}): Locale {
  if (isLocale(p.user)) return p.user
  if (isLocale(p.register)) return p.register
  if (isLocale(p.tenant)) return p.tenant
  return 'id-ID'
}
