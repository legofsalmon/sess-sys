import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { buildApp } from '../src/app.ts'
import { pgliteDb } from '../src/db.ts'

/**
 * Serving the built app beside the API. The app routes its own addresses,
 * so an address the server doesn't know gets the page; but a file under
 * /assets/ that isn't there any more (a deploy replaced it) is a plain 404,
 * never the page dressed up as a script.
 */

let cleanup: (() => Promise<void>)[] = []
afterEach(async () => {
  for (const fn of cleanup.reverse()) await fn()
  cleanup = []
})

/** The app, with a stand-in for web/dist that holds only the page. */
async function serving() {
  const webRoot = mkdtempSync(join(tmpdir(), 'sh-web-'))
  writeFileSync(join(webRoot, 'index.html'), '<!doctype html><title>Session Hire</title>')
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
