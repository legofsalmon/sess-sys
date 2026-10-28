import { afterEach, describe, expect, it } from 'vitest'
import { buildApp } from '../src/app.ts'
import { pgliteDb } from '../src/db.ts'
import { aaFuel, readAaPage } from '../src/finance/fuel.ts'

/**
 * The fuel price from AA Ireland's monthly survey (ADR 0086): read from
 * their page's table, offered only when the page reads as the survey, and
 * said plainly when it can't be read.
 */

/** The survey's table as AA Ireland's page had it on 28 October 2026, trimmed. */
const PAGE = `<h2><strong>Irish Fuel Prices: October 2026</strong></h2>
<table class="table table-striped"><thead><tr><td></td><td><strong>Petrol</strong></td><td><strong>Diesel</strong></td></tr></thead>
<tbody><tr><td><strong>Pump price</strong></td><td><strong>198.16c</strong></td><td><strong>214.76c</strong></td></tr>
<tr><td>Price before taxes, levies and charges</td><td>160.59c</td><td>174.22c</td></tr></tbody></table>`

const cleanup: (() => Promise<void>)[] = []
afterEach(async () => {
  for (const c of cleanup.splice(0)) await c()
})

describe("the AA's fuel price (ADR 0086)", () => {
  it('takes the diesel pump price and the month from the survey table', () => {
    expect(readAaPage(PAGE)).toEqual({ centsPerLitre: 214.8, month: 'October 2026', source: 'https://www.theaa.ie/aa-membership/fuel-prices/' })
  })

  it("offers nothing from a page that doesn't read as the survey", () => {
    expect(readAaPage('<h1>Fuel prices</h1><p>Coming soon</p>')).toBeUndefined()
    expect(readAaPage(PAGE.replace('214.76c', '2147.6c'))).toBeUndefined()
  })

  it('reads the page once an hour at most, and says so when it fails', async () => {
    let asked = 0
    const lookup = aaFuel({ fetch: (async () => (asked++, new Response(PAGE))) as typeof fetch })
    expect((await lookup()).centsPerLitre).toBe(214.8)
    await lookup()
    expect(asked).toBe(1)
    await expect(aaFuel({ fetch: (async () => new Response('nope', { status: 503 })) as typeof fetch })()).rejects.toThrow(/503/)
  })

  it('answers Admin, or says to type it in', async () => {
    const db = await pgliteDb()
    const good = await buildApp({ db, fuel: async () => ({ centsPerLitre: 214.8, month: 'October 2026', source: 'aa' }) })
    const bad = await buildApp({ db, fuel: async () => Promise.reject(new Error('down')) })
    cleanup.push(async () => {
      await good.close()
      await bad.close()
      await db.close()
    })
    expect((await good.inject({ url: '/api/fuel-price' })).json()).toMatchObject({ centsPerLitre: 214.8 })
    const res = await bad.inject({ url: '/api/fuel-price' })
    expect(res.statusCode).toBe(502)
    expect(res.json().error).toMatch(/type the diesel price in/)
  })
})
