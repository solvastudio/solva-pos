import { resolve } from 'node:path'

export async function probeHealth(url, opts = {}) {
  const fetchImpl = opts.fetch ?? globalThis.fetch
  const expectedVersion = opts.expectedVersion ?? null

  try {
    const res = await fetchImpl(url, { method: 'GET' })
    const body = await res.json().catch(() => null)
    const okStatus = res.status === 200 && body && body.status === 'ok'
    const versionMatches =
      expectedVersion === null || (body && typeof body.version === 'string' && body.version === expectedVersion)

    return {
      ok: Boolean(okStatus && versionMatches),
      status: res.status,
      version: body && typeof body.version === 'string' ? body.version : null,
      body,
    }
  } catch (err) {
    return {
      ok: false,
      status: 0,
      version: null,
      error: err instanceof Error ? err.message : String(err),
    }
  }
}

const isEntrypoint =
  process.argv[1] &&
  resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'))

if (isEntrypoint) {
  const port = process.env.PORT || '3000'
  const url = process.argv[2] || `http://127.0.0.1:${port}/health`
  probeHealth(url)
    .then((res) => {
      if (!res.ok) {
        process.stderr.write(`Health check failed (${res.status})\n`)
        process.exitCode = 1
      }
    })
    .catch((err) => {
      process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`)
      process.exitCode = 1
    })
}
