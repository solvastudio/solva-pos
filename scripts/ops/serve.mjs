import { createReadStream, existsSync, statSync } from 'node:fs'
import { createServer } from 'node:http'
import { extname, join, resolve } from 'node:path'
import { Readable } from 'node:stream'
import { pathToFileURL } from 'node:url'

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.webp': 'image/webp',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
}

async function readIncomingBody(req) {
  if (req.method === 'GET' || req.method === 'HEAD') return undefined
  const chunks = []
  for await (const chunk of req) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk)
  }
  return Buffer.concat(chunks)
}

function tryServeStatic(req, res, clientRoot) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return false
  const rawUrl = new URL(req.url ?? '/', 'http://127.0.0.1')
  let relPath
  try {
    relPath = decodeURIComponent(rawUrl.pathname).replace(/^\/+/, '')
  } catch {
    return false
  }
  if (!relPath || relPath.endsWith('/') || relPath.endsWith('.map')) return false

  const absPath = resolve(clientRoot, relPath)
  if (!absPath.startsWith(clientRoot + '/') && !absPath.startsWith(clientRoot + '\\')) {
    return false
  }
  if (!existsSync(absPath)) return false
  const st = statSync(absPath)
  if (!st.isFile()) return false

  const ext = extname(absPath).toLowerCase()
  const mime = MIME_TYPES[ext] ?? 'application/octet-stream'
  const headers = {
    'Content-Type': mime,
    'Content-Length': String(st.size),
  }
  if (rawUrl.pathname.startsWith('/assets/')) {
    headers['Cache-Control'] = 'public, max-age=31536000, immutable'
  } else if (rawUrl.pathname === '/sw.js') {
    headers['Cache-Control'] = 'no-cache'
  }
  res.writeHead(200, headers)
  if (req.method === 'HEAD') {
    res.end()
    return true
  }
  createReadStream(absPath).pipe(res)
  return true
}

export async function startProductionServer(rootDir = resolve('.')) {
  const serverEntryPath = pathToFileURL(join(rootDir, 'dist', 'server', 'server.js')).href
  const serverMod = await import(serverEntryPath)
  const appHandler = serverMod.default
  if (!appHandler || typeof appHandler.fetch !== 'function') {
    throw new Error('dist/server/server.js does not export default.fetch')
  }

  const clientRoot = resolve(join(rootDir, 'dist', 'client'))
  const port = Number(process.env.PORT ?? '3000')
  const host = process.env.HOST ?? '0.0.0.0'

  const server = createServer(async (req, res) => {
    try {
      if (tryServeStatic(req, res, clientRoot)) return

      const proto = req.headers['x-forwarded-proto'] ?? 'http'
      const reqHost = req.headers.host ?? `${host}:${port}`
      const fullUrl = `${proto}://${reqHost}${req.url ?? '/'}`

      const headers = new Headers()
      for (const [k, v] of Object.entries(req.headers)) {
        if (v === undefined) continue
        if (Array.isArray(v)) {
          for (const item of v) headers.append(k, item)
        } else {
          headers.set(k, v)
        }
      }

      const body = await readIncomingBody(req)
      const webReq = new Request(fullUrl, {
        method: req.method ?? 'GET',
        headers,
        ...(body !== undefined ? { body } : {}),
      })

      const webRes = await appHandler.fetch(webReq)
      res.statusCode = webRes.status
      webRes.headers.forEach((value, key) => {
        res.setHeader(key, value)
      })
      if (!webRes.body) {
        res.end()
        return
      }
      Readable.fromWeb(webRes.body).pipe(res)
    } catch {
      if (!res.headersSent) {
        res.statusCode = 500
        res.end('Internal Server Error')
      }
    }
  })

  await new Promise((resolveListen) => {
    server.listen(port, host, resolveListen)
  })
  return server
}

const isEntrypoint =
  process.argv[1] &&
  resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'))

if (isEntrypoint) {
  startProductionServer().catch((err) => {
    process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`)
    process.exitCode = 1
  })
}
