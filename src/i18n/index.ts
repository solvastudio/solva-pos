import i18next from 'i18next'
import { initReactI18next } from 'react-i18next'
import en from './locales/en.json'
import id from './locales/id.json'
import { isLocale, type Locale } from './resolve-locale'

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
