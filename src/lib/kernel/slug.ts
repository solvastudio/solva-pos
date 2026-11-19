export const SLUG_PATTERN: RegExp = /^[a-z0-9][a-z0-9-]{1,28}[a-z0-9]$/

/**
 * Reserved tenant slug deny-list (ARCHITECTURE §1.7 + top-level static route segments).
 */
export const RESERVED_SLUGS: readonly string[] = [
  'platform',
  'admin',
  'pos',
  'api',
  'health',
  'assets',
  'static',
  'login',
  'logout',
  'signin',
  'signup',
  'register',
  'auth',
  'oauth',
  'callback',
  'www',
  'app',
  'root',
  'system',
  'sw',
  'manifest',
  'favicon',
  'robots',
  'sitemap',
  'public',
  'docs',
  'help',
  'support',
  'status',
  'billing',
  'settings',
  'dashboard',
  'tenant',
  'tenants',
  'org',
  'internal',
  'cron',
  'metrics',
  'ping',
  'signals',
  'release',
  'enroll',
  'push',
  'pull',
  'webhook',
  'webhooks',
  'mail',
  'cdn',
  'files',
  'uploads',
  'download',
  'v1',
  'null',
  'undefined',
  'solva',
  'shell',
  'offline',
  'staging',
  'dev',
  '_serverfn',
  '_build',
]

const RESERVED_SET = new Set<string>(RESERVED_SLUGS)

export function normalizeSlug(raw: string): string {
  return raw.trim().toLowerCase()
}

export function validateSlug(
  raw: string,
): { ok: true; slug: string } | { ok: false; reason: 'FORMAT' | 'RESERVED' | 'UPPERCASE' } {
  if (typeof raw !== 'string' || raw.trim() !== raw) {
    return { ok: false, reason: 'FORMAT' }
  }
  const slug = normalizeSlug(raw)
  if (!SLUG_PATTERN.test(slug)) {
    return { ok: false, reason: 'FORMAT' }
  }
  if (RESERVED_SET.has(slug)) {
    return { ok: false, reason: 'RESERVED' }
  }
  if (raw !== slug) {
    return { ok: false, reason: 'UPPERCASE' }
  }
  return { ok: true, slug }
}
