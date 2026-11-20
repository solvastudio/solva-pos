import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildManifest, PWA_THEME_COLOR } from './manifest'

describe('server/pwa/manifest', () => {
  it('matches --color-primary-700 token in src/styles/tokens.css', () => {
    const tokensCss = readFileSync(resolve(import.meta.dirname, '../../styles/tokens.css'), 'utf8')
    const match = /--color-primary-700:\s*(#[0-9A-Fa-f]{6})/i.exec(tokensCss)
    expect(match).not.toBeNull()
    expect(match![1]!.toUpperCase()).toBe(PWA_THEME_COLOR.toUpperCase())
  })

  it('builds tenant-scoped manifest without custom tenant color or logo fields', () => {
    const m = buildManifest({ slug: 'acme-kopi', name: 'Kopi Nusantara Sejahtera' })
    expect(m.id).toBe('/acme-kopi/pos/')
    expect(m.scope).toBe('/acme-kopi/pos/')
    expect(m.start_url).toBe('/acme-kopi/pos/')
    expect(m.display).toBe('standalone')
    expect(m.name).toBe('Kopi Nusantara Sejahtera')
    expect(m.short_name).toBe('Kopi Nusanta')
    expect(m.short_name.length).toBeLessThanOrEqual(12)
    expect(m.theme_color).toBe(PWA_THEME_COLOR)
    expect(m.background_color).toBe(PWA_THEME_COLOR)
    expect(m.icons.every((i) => i.src.startsWith('/icons/'))).toBe(true)
    expect('color' in m).toBe(false)
    expect('logo' in m).toBe(false)
  })
})
