import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { changeLocale, type Locale } from '~/i18n'
import { isLocale } from '~/i18n/resolve-locale'

export function useLang(): { locale: Locale; setLocale: (locale: Locale) => Promise<void> } {
  const { i18n } = useTranslation()
  const locale: Locale = isLocale(i18n.language) ? i18n.language : 'id-ID'

  const setLocale = useCallback(async (nextLocale: Locale) => {
    await changeLocale(nextLocale)
  }, [])

  return { locale, setLocale }
}
