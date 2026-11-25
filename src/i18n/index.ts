import i18next from 'i18next'
import { initReactI18next } from 'react-i18next'
import en from './locales/en.json'
import id from './locales/id.json'
import { isLocale, type Locale } from './resolve-locale'

// Eager dictionary = everything except the back-office namespaces, which live in `locales/*.admin.json`
// and are loaded on demand by `ensureAdminI18n` so the precached POS shell does not carry them.
if (!i18next.isInitialized) {
  void i18next.use(initReactI18next).init({
    lng: 'id-ID',
    fallbackLng: 'id-ID',
    resources: {
      'id-ID': { translation: id },
      'en-US': { translation: en },
    },
    interpolation: { escapeValue: false },
    returnNull: false,
    initAsync: false,
  })
}

/** Back-office surfaces (`/<slug>/admin/**`, `/platform/**`) need the admin dictionary. */
export function needsAdminI18n(pathname: string): boolean {
  return /^\/[^/]+\/admin(\/|$)/.test(pathname) || /^\/platform(\/|$)/.test(pathname)
}

let adminLoad: Promise<void> | null = null

/**
 * Loads the back-office dictionary (both locales) once. Admin and platform routes await this before
 * rendering; the POS never calls it.
 */
export function ensureAdminI18n(): Promise<void> {
  adminLoad ??= import('./admin-resources').then(({ adminResources }) => {
    for (const [lng, bundle] of Object.entries(adminResources)) {
      i18next.addResourceBundle(lng, 'translation', bundle, true, false)
    }
  })
  return adminLoad
}

export async function changeLocale(locale: Locale): Promise<void> {
  await i18next.changeLanguage(locale)
  if (typeof document !== 'undefined') {
    document.documentElement.lang = locale === 'id-ID' ? 'id' : 'en'
  }
}

export function getLocale(): Locale {
  return isLocale(i18next.language) ? i18next.language : 'id-ID'
}

export { i18next }
export type { Locale } from './resolve-locale'
