import '@tanstack/react-start/server-only'

export const PWA_THEME_COLOR = '#46780D'

export interface WebManifestIcon {
  src: string
  sizes: string
  type: string
  purpose: string
}

export interface WebManifest {
  id: string
  name: string
  short_name: string
  start_url: string
  scope: string
  display: 'standalone'
  theme_color: string
  background_color: string
  icons: WebManifestIcon[]
  lang: 'id'
}

export function truncateShortName(name: string, maxLength: number = 12): string {
  const cleaned = name.trim()
  if (cleaned.length <= maxLength) {
    return cleaned
  }
  return cleaned.slice(0, maxLength).trimEnd()
}

/**
 * Builds the tenant-scoped PWA manifest using the fixed brand primary token color
 * (zero tenant custom colors/logos per T-16).
 */
export function buildManifest(tenant: { slug: string; name: string }): WebManifest {
  const scope = `/${tenant.slug}/pos/`
  return {
    id: scope,
    name: tenant.name,
    short_name: truncateShortName(tenant.name, 12),
    start_url: scope,
    scope,
    display: 'standalone',
    theme_color: PWA_THEME_COLOR,
    background_color: PWA_THEME_COLOR,
    icons: [
      {
        src: '/icons/icon.svg',
        sizes: 'any',
        type: 'image/svg+xml',
        purpose: 'any',
      },
      {
        src: '/icons/icon-maskable.svg',
        sizes: 'any',
        type: 'image/svg+xml',
        purpose: 'maskable',
      },
    ],
    lang: 'id',
  }
}
