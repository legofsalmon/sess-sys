import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { brotliCompressSync, brotliDecompressSync, gunzipSync, gzipSync } from 'node:zlib'
import { afterEach, describe, expect, it } from 'vitest'
import { buildApp, REQUEST_TIMEOUT_MS } from '../src/app.ts'
import { pgliteDb } from '../src/db.ts'

/**
 * Serving the built app beside the API. The app routes its own addresses,
 * so an address the server doesn't know gets the page; but a file under
 * /assets/ that isn't there any more (a deploy replaced it) is a plain 404,
 * never the page dressed up as a script. Browsers may keep a hashed file for
 * a year but must check the page, the service worker and the manifest every
 * time; every answer carries the headers that keep a browser honest; and
 * the API is for the app itself, not for other sites (audit finding 20).
 */

let cleanup: (() => Promise<void>)[] = []
afterEach(async () => {
  for (const fn of cleanup.reverse()) await fn()
  cleanup = []
})

/** A stand-in for the page's inline theme script, which its content security policy lets in by its hash. */
const THEME = "document.documentElement.dataset.theme = 'dark'"

/** The app, with a stand-in for web/dist that holds the page and whatever else a test needs. */
async function serving(files: Record<string, string | Buffer> = {}) {
  const webRoot = mkdtempSync(join(tmpdir(), 'sh-web-'))
  writeFileSync(join(webRoot, 'index.html'), `<!doctype html><title>Session Hire</title><script>${THEME}</script>`)
  for (const [name, text] of Object.entries(files)) {
    mkdirSync(dirname(join(webRoot, name)), { recursive: true })
    writeFileSync(join(webRoot, name), text)
  }
  const db = await pgliteDb()
  const app = await buildApp({ db, webRoot })
  cleanup.push(async () => {
    await app.close()
    await db.close()
    rmSync(webRoot, { recursive: true, force: true })
  })
  return app
}

describe('serving the app', () => {
  it('answers an address it does not know with the page, for the app to route', async () => {
    const app = await serving()
    const res = await app.inject({ method: 'GET', url: '/nothing-here' })
    expect(res.statusCode).toBe(200)
    expect(res.headers['content-type']).toContain('text/html')
    expect(res.body).toContain('Session Hire')
  })

  it('answers a missing file under /assets/ with 404, not the page', async () => {
    const app = await serving()
    const res = await app.inject({ method: 'GET', url: '/assets/missing.js' })
    expect(res.statusCode).toBe(404)
    expect(res.json()).toEqual({ error: 'Not found' })
  })
})

describe('what browsers may keep', () => {
  it('keeps a hashed file for a year, and checks the page, the service worker and the manifest every time', async () => {
    // Proves: each kind of file is served with the right cache header, the page served for the app's own addresses included.
    const app = await serving({ 'assets/index-BkQx1zL2.js': 'console.log(1)', 'sw.js': 'self.skipWaiting()', 'manifest.webmanifest': '{}' })
    const cache = async (url: string) => (await app.inject({ method: 'GET', url })).headers['cache-control']
    expect(await cache('/assets/index-BkQx1zL2.js')).toBe('public, max-age=31536000, immutable')
    expect(await cache('/index.html')).toBe('no-cache')
    expect(await cache('/sw.js')).toBe('no-cache')
    expect(await cache('/manifest.webmanifest')).toBe('no-cache')
    // The page served for an address the app routes, likewise.
    expect(await cache('/jobs/j1')).toBe('no-cache')
  })
})

describe('every answer', () => {
  it('carries the headers that keep a browser honest, and the https rule only over https', async () => {
    // Proves: pages, API answers, files, private links, feeds and not-founds all carry the security headers, and HSTS goes out only over https.
    const app = await serving({ 'sw.js': 'self.skipWaiting()' })
    for (const url of ['/', '/api/health', '/sw.js', '/assets/missing.js', '/nothing-here', '/f/a-link-nobody-was-given', '/cal/aaaaaaaaaaaaaaaaaaaaaaaa.ics']) {
      const res = await app.inject({ method: 'GET', url })
      expect(res.headers['x-content-type-options'], url).toBe('nosniff')
      expect(res.headers['content-security-policy'], url).toContain("frame-ancestors 'none'")
      expect(res.headers['referrer-policy'], url).toBe('strict-origin-when-cross-origin')
      expect(res.headers['strict-transport-security'], url).toBeUndefined()
    }
    // Railway says which protocol the request came in on.
    const https = await app.inject({ method: 'GET', url: '/api/health', headers: { 'x-forwarded-proto': 'https' } })
    expect(https.headers['strict-transport-security']).toBe('max-age=31536000; includeSubDomains')
  })

  it('has a strict content security policy on the app and on the server’s own pages, and frames kept out of the rest', async () => {
    // Proves: the app shell lets in its own files, its theme script by hash, the map's tiles and Sentry, and nothing else
    // inline but style; a freelancer's page lets in nothing but itself, its style and its one script (audit finding 24).
    const app = await serving({ 'sw.js': 'self.skipWaiting()' })
    const policy = async (url: string) => String((await app.inject({ method: 'GET', url })).headers['content-security-policy'])
    const theme = `'sha256-${createHash('sha256').update(THEME).digest('base64')}'`
    for (const url of ['/', '/index.html', '/jobs/j1']) {
      const shell = await policy(url)
      expect(shell, url).toContain("default-src 'self'")
      expect(shell, url).toContain(`script-src 'self' ${theme};`)
      expect(shell, url).toContain("style-src 'self' 'unsafe-inline'")
      expect(shell, url).toContain('img-src \'self\' data: blob: https://tile.openstreetmap.org')
      expect(shell, url).toContain('https://*.ingest.de.sentry.io')
      expect(shell, url).toContain("object-src 'none'")
    }
    const page = await policy('/f/a-link-nobody-was-given')
    expect(page).toContain("default-src 'none'")
    expect(page).toMatch(/script-src 'sha256-[A-Za-z0-9+/=]+';/)
    expect(page).toContain("form-action 'self'")
    for (const url of ['/api/health', '/sw.js', '/assets/missing.js', '/cal/aaaaaaaaaaaaaaaaaaaaaaaa.ics']) expect(await policy(url), url).toBe("frame-ancestors 'none'")
  })

  it('is not waited for for ever: the server has a time limit for a whole request to arrive', async () => {
    // Proves: someone sending a post to a private link a byte at a time can't hold a connection open for ever, as Node's
    // own default would let them. The limit reaches the server itself, and it is five minutes, long enough for a 10 MB
    // photo on a poor signal. (Node looks for overdue requests every 30 seconds, so one is cut off within 5½ minutes.)
    expect(REQUEST_TIMEOUT_MS).toBe(5 * 60 * 1000)
    const app = await serving()
    expect(app.server.requestTimeout).toBe(REQUEST_TIMEOUT_MS)
    const db = await pgliteDb()
    const shorter = await buildApp({ db, requestTimeoutMs: 300 })
    cleanup.push(async () => {
      await shorter.close()
      await db.close()
    })
    expect(shorter.server.requestTimeout).toBe(300)
  })

  it('is for the app itself: another site asking from a browser is given no leave to read it', async () => {
    // Proves: with the CORS plugin gone, neither an answer nor a preflight lets another site read the API.
    const app = await serving()
    const res = await app.inject({ method: 'GET', url: '/api/health', headers: { origin: 'https://another.example' } })
    expect(res.statusCode).toBe(200)
    expect(res.headers['access-control-allow-origin']).toBeUndefined()
    const asked = await app.inject({ method: 'OPTIONS', url: '/api/sync/push', headers: { origin: 'https://another.example', 'access-control-request-method': 'POST' } })
    expect(asked.headers['access-control-allow-origin']).toBeUndefined()
    expect(asked.headers['access-control-allow-methods']).toBeUndefined()
  })
})

describe('what goes compressed (audit finding 6)', () => {
  it('serves the .br or .gz made when the app was built to a browser that takes it, and the file itself to one that does not', async () => {
    // Proves: the built app's files go pre-compressed, chosen by what the browser says it takes, with the same cache rules
    // as the file itself and a Vary so no cache hands one to a browser that asked for the other; a file with no
    // compressed copy, and the page served for the app's own addresses, still go.
    const script = 'console.log("Session Hire");'.repeat(100)
    const page = '<!doctype html><title>Session Hire</title>'
    const app = await serving({
      'assets/index-BkQx1zL2.js': script,
      'assets/index-BkQx1zL2.js.br': brotliCompressSync(script),
      'assets/index-BkQx1zL2.js.gz': gzipSync(script),
      'sw.js': 'self.skipWaiting()',
      'index.html.br': brotliCompressSync(page),
    })
    const get = (url: string, encoding?: string) => app.inject({ method: 'GET', url, headers: encoding ? { 'accept-encoding': encoding } : {} })

    const br = await get('/assets/index-BkQx1zL2.js', 'gzip, deflate, br')
    expect(br.headers['content-encoding']).toBe('br')
    expect(br.headers['content-type']).toContain('javascript')
    expect(br.headers['cache-control']).toBe('public, max-age=31536000, immutable')
    expect(br.headers.vary).toContain('accept-encoding')
    expect(brotliDecompressSync(br.rawPayload).toString()).toBe(script)

    const gz = await get('/assets/index-BkQx1zL2.js', 'gzip')
    expect(gz.headers['content-encoding']).toBe('gzip')
    expect(gunzipSync(gz.rawPayload).toString()).toBe(script)

    const plain = await get('/assets/index-BkQx1zL2.js')
    expect(plain.headers['content-encoding']).toBeUndefined()
    expect(plain.body).toBe(script)

    // No compressed copy: the file as it is, still checked every time.
    const sw = await get('/sw.js', 'br')
    expect(sw.headers['content-encoding']).toBeUndefined()
    expect(sw.headers['cache-control']).toBe('no-cache')
    expect(sw.body).toBe('self.skipWaiting()')

    // The page, for an address the app routes, compressed too and checked every time.
    const routed = await get('/jobs/j1', 'br')
    expect(routed.headers['content-encoding']).toBe('br')
    expect(routed.headers['content-type']).toContain('text/html')
    expect(routed.headers['cache-control']).toBe('no-cache')
    expect(brotliDecompressSync(routed.rawPayload).toString()).toBe(page)

    // A missing file under /assets/ is still a plain 404.
    expect((await get('/assets/missing.js', 'br')).statusCode).toBe(404)
  })

  it('compresses the API’s JSON, the pull above all, but not the export’s zip or a small answer', async () => {
    // Proves: a JSON answer over a kilobyte goes compressed to a device that takes it, and reads back the same; one that
    // doesn't say so gets it plain; the zip, compressed already, and a small answer go as they are.
    const app = await serving()
    const mutations = Array.from({ length: 40 }, (_, i) => ({ id: `m${i}`, name: 'place.upsert', args: { id: `p${i}`, name: `Bay ${i}`, notes: '' }, createdAt: new Date().toISOString() }))
    await app.inject({ method: 'POST', url: '/api/sync/push', payload: { clientId: 'phone', mutations } })

    const plain = await app.inject({ method: 'GET', url: '/api/sync/pull?after=0' })
    expect(plain.headers['content-encoding']).toBeUndefined()
    expect(plain.json().changes).toHaveLength(40)

    const br = await app.inject({ method: 'GET', url: '/api/sync/pull?after=0', headers: { 'accept-encoding': 'gzip, deflate, br' } })
    expect(br.headers['content-encoding']).toBe('br')
    expect(br.headers.vary).toContain('accept-encoding')
    expect(br.rawPayload.length).toBeLessThan(plain.rawPayload.length / 3)
    expect(JSON.parse(brotliDecompressSync(br.rawPayload).toString())).toEqual(plain.json())

    const gz = await app.inject({ method: 'GET', url: '/api/sync/pull?after=0', headers: { 'accept-encoding': 'gzip' } })
    expect(gz.headers['content-encoding']).toBe('gzip')
    expect(JSON.parse(gunzipSync(gz.rawPayload).toString())).toEqual(plain.json())

    const zip = await app.inject({ method: 'GET', url: '/api/export.zip', headers: { 'accept-encoding': 'br, gzip' } })
    expect(zip.statusCode).toBe(200)
    expect(zip.headers['content-type']).toBe('application/zip')
    expect(zip.headers['content-encoding']).toBeUndefined()

    const small = await app.inject({ method: 'GET', url: '/api/up', headers: { 'accept-encoding': 'br' } })
    expect(small.headers['content-encoding']).toBeUndefined()
    expect(small.json()).toEqual({ ok: true })
  })
})
