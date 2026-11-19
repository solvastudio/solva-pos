import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { resolve } from 'node:path'

function runDocker(args) {
  return execFileSync('docker', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
}

function tryDocker(args) {
  spawnSync('docker', args, { stdio: 'ignore' })
}

function checkDockerAvailable() {
  const probe = spawnSync('docker', ['info'], { stdio: 'ignore' })
  return probe.status === 0
}

const UPSTREAM_SCRIPT = `
const http = require('node:http');
const server = http.createServer((req, res) => {
  const urlObj = new URL(req.url, 'http://app:3000');
  if (urlObj.pathname === '/api/slow') {
    setTimeout(() => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    }, 1500);
    return;
  }
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify({
    url: req.url,
    xRealIp: req.headers['x-real-ip'] || null,
    xForwardedFor: req.headers['x-forwarded-for'] || null,
    xTenantSlug: req.headers['x-tenant-slug'] ?? null,
  }));
});
server.listen(3000, '0.0.0.0');
`

async function waitForProxy(baseUrl) {
  for (let i = 0; i < 40; i += 1) {
    try {
      const r = await fetch(`${baseUrl}/health`)
      if (r.status === 200) return
    } catch {
      // still booting
    }
    await new Promise((r) => setTimeout(r, 250))
  }
  throw new Error('Nginx container failed to become reachable')
}

async function main() {
  if (!checkDockerAvailable()) {
    process.stderr.write('Docker daemon is not available; cannot run nginx-check.\n')
    process.exit(1)
  }

  const suffix = randomUUID().slice(0, 8)
  const networkName = `solva-nginx-test-${suffix}`
  const appName = `solva-nginx-app-${suffix}`
  const nginxName = `solva-nginx-proxy-${suffix}`
  const hostPort = 18080 + (Number.parseInt(suffix.slice(0, 2), 16) % 1000)
  const baseUrl = `http://127.0.0.1:${hostPort}`
  const confPath = resolve('docker/nginx.conf')

  try {
    runDocker(['network', 'create', networkName])
    runDocker([
      'run',
      '-d',
      '--name',
      appName,
      '--network',
      networkName,
      '--network-alias',
      'app',
      'node:22-alpine',
      'node',
      '-e',
      UPSTREAM_SCRIPT,
    ])
    runDocker([
      'run',
      '-d',
      '--name',
      nginxName,
      '--network',
      networkName,
      '-p',
      `${hostPort}:80`,
      '-v',
      `${confPath}:/etc/nginx/nginx.conf:ro`,
      'nginx:stable',
    ])

    await waitForProxy(baseUrl)

    // 1. Root returns 404
    const rootRes = await fetch(`${baseUrl}/`)
    assert.equal(rootRes.status, 404, 'GET / must return 404')

    // 2. Source maps return 404 (both top-level and inside /assets/)
    const rootMapRes = await fetch(`${baseUrl}/app.js.map`)
    assert.equal(rootMapRes.status, 404, 'Top-level *.map must return 404')
    const mapRes = await fetch(`${baseUrl}/assets/main.js.map`)
    assert.equal(mapRes.status, 404, '*.map inside /assets/ must return 404')

    // 3. Spoofed X-Forwarded-For, X-Real-IP, and X-Tenant-Slug are overwritten/cleared on /acme
    const acmeRes = await fetch(`${baseUrl}/acme`, {
      headers: {
        'X-Forwarded-For': '1.2.3.4',
        'X-Real-IP': '9.9.9.9',
        'X-Tenant-Slug': 'evil',
      },
    })
    assert.equal(acmeRes.status, 200, 'GET /acme must proxy to upstream')
    const acmeBody = await acmeRes.json()
    assert.notEqual(acmeBody.xRealIp, '9.9.9.9', 'Spoofed X-Real-IP must be overwritten')
    assert.notEqual(acmeBody.xForwardedFor, '1.2.3.4', 'Spoofed X-Forwarded-For must be overwritten')
    assert.equal(acmeBody.xRealIp, acmeBody.xForwardedFor, 'XFF must be overwritten with remote addr')
    assert.equal(acmeBody.xTenantSlug, null, 'Spoofed X-Tenant-Slug must be cleared')

    // 4. Tenant _serverFn rewrite strips /<slug> and injects trusted X-Tenant-Slug
    const fnRes = await fetch(`${baseUrl}/acme/_serverFn/abc`, {
      headers: { 'X-Tenant-Slug': 'evil' },
    })
    assert.equal(fnRes.status, 200, '/acme/_serverFn/abc must return 200')
    const fnBody = await fnRes.json()
    assert.equal(fnBody.url, '/_serverFn/abc', 'Nginx must rewrite /<slug>/_serverFn/* -> /_serverFn/*')
    assert.equal(fnBody.xTenantSlug, 'acme', 'Nginx must inject captured slug into X-Tenant-Slug')

    // 5. Rate limiting on anonymous /<slug>/join and /<slug>/api/join triggers 429 on bursts
    const burstResponses = await Promise.all(
      Array.from({ length: 40 }, () => fetch(`${baseUrl}/acme/api/join`, { method: 'POST' })),
    )
    const rateLimitedCount = burstResponses.filter((r) => r.status === 429).length
    assert.ok(rateLimitedCount > 0, `Expected some 429 responses on 40x /acme/api/join burst, got ${rateLimitedCount}`)

    // 6. SSE /api/pos/v1/signals remains 200 even when 60 parallel /api/slow saturate limit_conn (50)
    const slowControllers = []
    const slowPromises = Array.from({ length: 60 }, () => {
      const ac = new AbortController()
      slowControllers.push(ac)
      return fetch(`${baseUrl}/api/slow`, { signal: ac.signal }).catch(() => null)
    })
    await new Promise((r) => setTimeout(r, 250))
    const signalsRes = await fetch(`${baseUrl}/api/pos/v1/signals`)
    assert.equal(signalsRes.status, 200, 'SSE endpoint must remain unaffected by general limit_conn')
    await Promise.all(slowPromises)

    process.stdout.write(
      `nginx-check passed: root=404 map=404 ip-overwrite=ok serverFn-rewrite=ok join-429=${rateLimitedCount} sse=200\n`,
    )
  } finally {
    tryDocker(['rm', '-f', nginxName, appName])
    tryDocker(['network', 'rm', networkName])
  }
}

main().catch((err) => {
  process.stderr.write(`nginx-check failed: ${err instanceof Error ? err.stack || err.message : String(err)}\n`)
  process.exit(1)
})
