export type Locale = 'id-ID' | 'en-US'

export function isLocale(s: unknown): s is Locale {
  return s === 'id-ID' || s === 'en-US'
}

/**
 * Menentukan bahasa UI efektif sesuai prioritas BR-I18N-002 (tertinggi -> terendah):
 * 1. Pilihan pengguna login (`user.locale`)
 * 2. Bahasa bawaan register (`register.locale`)
 * 3. Bahasa bawaan tenant (`tenant.default_locale`)
 * 4. Bawaan aplikasi `'id-ID'`
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
