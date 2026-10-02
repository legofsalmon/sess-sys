import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { buildApp } from '../src/app.ts'
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

/** The app, with a stand-in for web/dist that holds the page and whatever else a test needs. */
async function serving(files: Record<string, string> = {}) {
  const webRoot = mkdtempSync(join(tmpdir(), 'sh-web-'))
  writeFileSync(join(webRoot, 'index.html'), '<!doctype html><title>Session Hire</title>')
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
      expect(res.headers['content-security-policy'], url).toBe("frame-ancestors 'none'")
      expect(res.headers['referrer-policy'], url).toBe('strict-origin-when-cross-origin')
      expect(res.headers['strict-transport-security'], url).toBeUndefined()
    }
    // Railway says which protocol the request came in on.
    const https = await app.inject({ method: 'GET', url: '/api/health', headers: { 'x-forwarded-proto': 'https' } })
    expect(https.headers['strict-transport-security']).toBe('max-age=31536000; includeSubDomains')
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
