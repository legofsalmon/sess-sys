import type { RmsOpportunityPage, RmsOpportunityWithLines, RmsStatus } from '@sh/shared'
import { describe, expect, it } from 'vitest'
import { RmsApi } from '../src/rms/api.ts'
import { IPHONE, server, staff } from './people.ts'

/**
 * Reading Current RMS through its API (ADR 0078). Nothing here reaches the
 * real Current RMS: a stand-in answers as its documentation says it does,
 * 25 opportunities a page and an opportunity's lines on their own. The
 * reader only ever asks (GET), with the subdomain and key in the headers;
 * a second read reads the lines again only of what changed; a "too many"
 * answer is waited out; a refused key is said in words and what was read
 * stays.
 */

interface Asked {
  method: string
  path: string
  query: URLSearchParams
  headers: Record<string, string>
}

const opportunity = (id: number, updated = '2026-05-01T10:00:00.000Z') => ({
  id,
  number: `OP-${1000 + id}`,
  subject: `Job ${id}`,
  state_name: id % 3 === 0 ? 'Quotation' : 'Order',
  status_name: id % 3 === 0 ? 'Lost' : 'Active',
  starts_at: `2026-0${(id % 9) + 1}-10T08:00:00.000Z`,
  ends_at: `2026-0${(id % 9) + 1}-12T18:00:00.000Z`,
  charge_excluding_tax_total: '1000.0',
  charge_including_tax_total: '1230.0',
  rental_charge_total: '800.0',
  sale_charge_total: '0.0',
  service_charge_total: '200.0',
  surcharge_total: '0.0',
  tax_total: '230.0',
  original_rental_charge_total: '900.0',
  original_sale_charge_total: '0.0',
  original_service_charge_total: '200.0',
  original_surcharge_total: '0.0',
  chargeable_days: '2.0',
  tag_list: ['Corporate'],
  created_at: '2026-04-01T10:00:00.000Z',
  updated_at: updated,
  member: { name: id === 7 ? 'Bralton Industries' : 'Acme Events', membership: { discount_category_name: 'Trade 10%', price_category_name: 'Standard' } },
  venue: { name: 'City Conference Hall' },
})

const lines = (id: number) => [
  { id: id * 100, path: '0001', opportunity_item_type_name: 'Group', name: 'Audio', quantity: '0', price: '0' },
  {
    id: id * 100 + 1,
    path: '00010001',
    opportunity_item_type_name: 'Principal',
    transaction_type_name: 'Rental',
    item_type: 'Product',
    item_id: 151,
    name: 'd&b Y10P',
    quantity: '4',
    price: '60.0',
    discount_percent: '10.0',
    chargeable_days: '3.0',
    rate_definition: { name: '3 Day Week Rate' },
    lead_charging_period_name: 'Weekly',
    unit_charge: '54.0',
    charge_total: '648.0',
    tax_total: '149.04',
    sub_rent: false,
  },
  { id: id * 100 + 2, path: '0002', opportunity_item_type_name: 'Principal', transaction_type_name: 'Service', item_type: 'Service', name: 'Audio tech', quantity: '1', price: '250.0', charge_total: '250.0', sub_rent: false },
]

/** A stand-in for Current RMS holding `count` opportunities, with every request it was asked, in order. */
function fakeRms(count: number, opts: { refuse?: boolean; tooManyOnce?: boolean; updated?: (id: number) => string } = {}) {
  const asked: Asked[] = []
  let tooMany = opts.tooManyOnce ?? false
  const fetch = (async (input: URL | string, init?: RequestInit) => {
    const url = new URL(String(input))
    asked.push({ method: init?.method ?? 'GET', path: url.pathname.replace('/api/v1', ''), query: url.searchParams, headers: init?.headers as Record<string, string> })
    if (opts.refuse) return new Response(JSON.stringify({ errors: ['Unauthorized'] }), { status: 401 })
    if (tooMany) {
      tooMany = false
      return new Response('{}', { status: 429, headers: { 'x-ratelimit-reset': String(Math.ceil(Date.now() / 1000)) } })
    }
    const path = url.pathname.replace('/api/v1', '')
    if (path === '/opportunities') {
      const page = Number(url.searchParams.get('page'))
      const per = Number(url.searchParams.get('per_page'))
      const ids = Array.from({ length: count }, (_, i) => i + 1).slice((page - 1) * per, page * per)
      return Response.json({ opportunities: ids.map((id) => opportunity(id, opts.updated?.(id))), meta: { total_row_count: count, row_count: ids.length, page, per_page: per } })
    }
    const m = /^\/opportunities\/(\d+)\/opportunity_items$/.exec(path)
    if (m) return Response.json({ opportunity_items: lines(Number(m[1])) })
    return new Response('{}', { status: 404 })
  }) as typeof globalThis.fetch
  return { fetch, asked }
}

const noWait = { gapMs: 0, sleep: async () => {} }

async function office(rms?: ReturnType<typeof fakeRms>) {
  const { app, db } = await server(rms ? { currentRms: { subdomain: 'sessionhire', apiKey: 'key-123', fetch: rms.fetch, ...noWait } } : {})
  const colly = await staff(app, db, 'Colly Hewson', IPHONE, 'phone-c0ffee')
  const get = async <T>(url: string) => {
    const res = await app.inject({ url, cookies: colly.cookies })
    expect(res.statusCode).toBe(200)
    return res.json() as T
  }
  const post = (url: string) => app.inject({ method: 'POST', url, cookies: colly.cookies })
  return { app, get, post, cookies: colly.cookies }
}

describe('reading Current RMS', () => {
  it('says it is not set up without a key, and reads nothing', async () => {
    // Proves: without CURRENT_RMS settings the status says so and a read is turned down in words.
    const { get, post } = await office()
    expect(await get<RmsStatus>('/api/rms')).toMatchObject({ configured: false, subdomain: null, running: null, last: null, opportunities: 0 })
    const res = await post('/api/rms/read')
    expect(res.statusCode).toBe(409)
    expect(res.json().error).toMatch(/isn’t set up/)
  })

  it('reads every opportunity and its lines, only ever asking, and keeps them in cents', async () => {
    // Proves: pages of 25 until all 30 are read, in id order, with every state; one lines request each; GET only, key in the header not the address.
    const rms = fakeRms(30)
    const { app, get, post } = await office(rms)
    expect((await post('/api/rms/check')).json()).toEqual({ opportunities: 30 })
    expect((await post('/api/rms/read')).statusCode).toBe(202)
    await app.rms.done

    const status = await get<RmsStatus>('/api/rms')
    expect(status).toMatchObject({ configured: true, subdomain: 'sessionhire', running: null, opportunities: 30, lines: 90 })
    expect(status.last).toMatchObject({ opportunities: 30, lines: 90, error: null, stopped: false })

    expect(rms.asked.every((a) => a.method === 'GET')).toBe(true)
    expect(rms.asked.every((a) => a.headers['X-SUBDOMAIN'] === 'sessionhire' && a.headers['X-AUTH-TOKEN'] === 'key-123')).toBe(true)
    expect(rms.asked.some((a) => a.query.has('apikey'))).toBe(false)
    const lists = rms.asked.filter((a) => a.path === '/opportunities' && a.query.get('per_page') === '25')
    expect(lists.map((a) => a.query.get('page'))).toEqual(['1', '2'])
    expect(lists[0]!.query.get('filtermode')).toBe('all')
    expect(lists[0]!.query.getAll('q[s][]')).toEqual(['id asc'])
    expect(rms.asked.filter((a) => a.path.endsWith('/opportunity_items'))).toHaveLength(30)

    const found = await get<RmsOpportunityPage>('/api/rms/opportunities?q=bralton')
    expect(found.total).toBe(1)
    expect(found.opportunities[0]).toMatchObject({
      id: 7,
      number: 'OP-1007',
      client: 'Bralton Industries',
      venue: 'City Conference Hall',
      netCents: 100000,
      grossCents: 123000,
      undiscountedCents: 110000,
      discountCategory: 'Trade 10%',
      chargeableDays: 2,
      tags: ['Corporate'],
    })

    const one = await get<RmsOpportunityWithLines>('/api/rms/opportunities/7')
    expect(one.lines.map((l) => [l.path, l.kind, l.name])).toEqual([
      ['0001', 'Group', 'Audio'],
      ['00010001', 'Principal', 'd&b Y10P'],
      ['0002', 'Principal', 'Audio tech'],
    ])
    expect(one.lines[1]).toMatchObject({ quantity: 4, priceCents: 6000, discountPct: 10, chargeableDays: 3, rateDefinition: '3 Day Week Rate', period: 'Weekly', unitCents: 5400, totalCents: 64800, taxCents: 14904 })
  })

  it('reads the lines again only of the opportunities that changed', async () => {
    // Proves: a second read lists every opportunity but asks for lines only where Current RMS's updated time moved.
    let changedId = 0
    const rms = fakeRms(5, { updated: (id) => (id === changedId ? '2026-06-01T10:00:00.000Z' : '2026-05-01T10:00:00.000Z') })
    const { app, post, get } = await office(rms)
    await post('/api/rms/read')
    await app.rms.done
    changedId = 3
    rms.asked.length = 0
    await post('/api/rms/read')
    await app.rms.done
    expect(rms.asked.filter((a) => a.path.endsWith('/opportunity_items')).map((a) => a.path)).toEqual(['/opportunities/3/opportunity_items'])
    expect((await get<RmsStatus>('/api/rms')).last).toMatchObject({ opportunities: 5, lines: 3 })
  })

  it('waits out "too many" and carries on', async () => {
    // Proves: a 429 is waited for (the stand-in's sleep) and the same request asked again.
    const rms = fakeRms(2, { tooManyOnce: true })
    const { app, post, get } = await office(rms)
    await post('/api/rms/read')
    await app.rms.done
    expect((await get<RmsStatus>('/api/rms')).last).toMatchObject({ opportunities: 2, error: null })
    expect(rms.asked[0]!.query.get('page')).toBe('1')
    expect(rms.asked[1]!.query.get('page')).toBe('1')
  })

  it('says in words when Current RMS turns the key down', async () => {
    // Proves: a 401 ends the read with a reason for the office, and the check says the same.
    const rms = fakeRms(3, { refuse: true })
    const { app, post, get } = await office(rms)
    const check = await post('/api/rms/check')
    expect(check.statusCode).toBe(502)
    expect(check.json().error).toMatch(/turned the key down/)
    await post('/api/rms/read')
    await app.rms.done
    expect((await get<RmsStatus>('/api/rms')).last).toMatchObject({ opportunities: 0, error: expect.stringMatching(/turned the key down/) })
  })

  it('gives what came in as two spreadsheets', async () => {
    // Proves: one row an opportunity, one row a line, euros to the cent, Excel's mark first.
    const rms = fakeRms(2)
    const { app, post, cookies } = await office(rms)
    await post('/api/rms/read')
    await app.rms.done
    const opps = await app.inject({ url: '/api/rms/download/opportunities.csv', cookies })
    expect(opps.headers['content-disposition']).toMatch(/current-rms-opportunities-/)
    const rows = opps.body.replace(/^﻿/, '').trim().split('\r\n')
    expect(rows).toHaveLength(3)
    expect(rows[1]).toContain('OP-1001')
    expect(rows[1]).toContain('1000.00')
    const lines = await app.inject({ url: '/api/rms/download/lines.csv', cookies })
    expect(lines.body.trim().split('\r\n')).toHaveLength(7)
    expect(lines.body).toContain('3 Day Week Rate')
  })
})

describe('the Current RMS client', () => {
  it('has no way to send anything but a read', () => {
    // Proves: the only way to ask is read(), which always sends GET (ADR 0078: the key could change anything).
    const methods = Object.getOwnPropertyNames(RmsApi.prototype).filter((m) => m !== 'constructor')
    expect(methods.sort()).toEqual(['ask', 'read', 'subdomain'])
  })
})
