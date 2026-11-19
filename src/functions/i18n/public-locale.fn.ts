import { createServerFn } from '@tanstack/react-start'
import { getRequestHeader } from '@tanstack/react-start/server'
import type { Locale } from '~/i18n/resolve-locale'

export function detectLocaleFromAcceptLanguage(header: string | undefined | null): Locale {
  if (!header) return 'id-ID'
  const firstTag = header.split(',')[0]?.trim().toLowerCase() ?? ''
  return firstTag.startsWith('en') ? 'en-US' : 'id-ID'
}

export const getPublicLocaleFn = createServerFn({ method: 'GET' }).handler(
  async (): Promise<Locale> => {
    const header = getRequestHeader('accept-language')
    return detectLocaleFromAcceptLanguage(header)
  },
)
