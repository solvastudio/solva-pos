import { createStart } from '@tanstack/react-start'
import { normalizeSlug, RESERVED_SLUGS, SLUG_PATTERN } from '~/lib/kernel'

const RESERVED_SET = new Set<string>(RESERVED_SLUGS)
const SERVER_FN_RE = /^\/_serverfn(\/|$)/i

function currentWindowTenantSlug(): string | null {
  if (typeof window === 'undefined') {
    return null
  }
  const firstSegment = window.location.pathname.split('/')[1]
  if (!firstSegment) {
    return null
  }
  const normalized = normalizeSlug(firstSegment)
  if (!SLUG_PATTERN.test(normalized) || RESERVED_SET.has(normalized)) {
    return null
  }
  return normalized
}

function rewriteServerFnPath(pathname: string, slug: string): string | null {
  if (!SERVER_FN_RE.test(pathname)) {
    return null
  }
  return `/${slug}${pathname}`
}

/**
 * Rewrites `/_serverFn/...` RPC requests under a tenant URL to `/<slug>/_serverFn/...`
 * so per-slug `Path=/<slug>` session cookies are sent by the browser (Q7).
 */
const tenantScopedServerFnFetch: typeof fetch = (input, init) => {
  const slug = currentWindowTenantSlug()
  if (!slug) {
    return fetch(input, init)
  }

  if (typeof input === 'string') {
    if (input.startsWith('/')) {
      const rewritten = rewriteServerFnPath(input, slug)
      if (rewritten) {
        return fetch(rewritten, init)
      }
    } else {
      try {
        const parsed = new URL(input)
        const rewrittenPath = rewriteServerFnPath(parsed.pathname, slug)
        if (rewrittenPath) {
          parsed.pathname = rewrittenPath
          return fetch(parsed.toString(), init)
        }
      } catch {
        // Leave unparseable relative URLs untouched.
      }
    }
    return fetch(input, init)
  }

  if (input instanceof URL) {
    const rewrittenPath = rewriteServerFnPath(input.pathname, slug)
    if (rewrittenPath) {
      const nextUrl = new URL(input.toString())
      nextUrl.pathname = rewrittenPath
      return fetch(nextUrl, init)
    }
    return fetch(input, init)
  }

  if (input instanceof Request) {
    const parsed = new URL(input.url)
    const rewrittenPath = rewriteServerFnPath(parsed.pathname, slug)
    if (rewrittenPath) {
      parsed.pathname = rewrittenPath
      const nextReq = new Request(parsed.toString(), input)
      return fetch(nextReq, init)
    }
    return fetch(input, init)
  }

  return fetch(input, init)
}

export const startInstance = createStart(() => ({
  serverFns: {
    fetch: tenantScopedServerFnFetch,
  },
}))
