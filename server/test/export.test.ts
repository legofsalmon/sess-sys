import { type HistoryPage, type Person } from '@sh/shared'
import { unzipSync } from 'fflate'
import type { FastifyInstance } from 'fastify'
import { describe, expect, it } from 'vitest'
import { irishTime, spreadsheetSafe } from '../src/export.ts'
import { IPHONE, onLink, server, staff } from './people.ts'

/**
 * "Download everything" (ADR 0006): one file the company can open without
 * the app, with nothing in it that would let its holder act as someone else.
 */

/** A small company: a member of staff, some stock, a freelancer who has answered on their link. */
async function company() {
  const { app, db } = await server()
  const colly = await staff(app, db, 'Colly Hewson', IPHONE, 'phone-c0ffee')
  await colly.send('product.upsert', { id: 'y10p', name: 'd&b Y10P', quantity: 4 })
  await colly.send('booking.create', { id: 'b1', productId: 'y10p', project: 'Electric Picnic', qty: 2, start: '2026-10-02', end: '2026-10-04' })
  await colly.send('person.upsert', {
    id: 'p1',
    name: 'Seán Ó Briain',
    kind: 'freelancer',
    email: 'sean@example.ie',
    phone: '+353 87 123 4567',
    skills: ['audio', 'rf'],
    dayRateCents: 25000,
    notes: 'Prefers "in-ears", not wedges\nVegetarian',
  })
  const firstLink = (await colly.record<Person>('person', 'p1')).linkToken
  await colly.send('person.newLink', { id: 'p1' })
  const seán = await colly.record<Person>('person', 'p1')
  await colly.send('call.create', {
    id: 'c1',
    project: 'Electric Picnic',
    phase: 'Build',
    venue: 'Stradbally Hall',
    role: 'Audio tech',
    start: '2026-10-02',
    end: '2026-10-04',
    callTime: '08:00',
    needed: 1,
    dayRateCents: 25000,
    details: '',
    replyBy: null,
  })
  await colly.send('offer.send', { id: 'o1', callId: 'c1', personId: 'p1', override: false })
  // Text a freelancer typed, which Excel would run as a formula.
  await onLink(app, `/f/${seán.linkToken}/offers/o1`, { answer: 'accept', note: '=HYPERLINK("http://evil.example","Click")' })
  return { app, colly, links: [firstLink, seán.linkToken] }
}

async function download(app: FastifyInstance, cookies: Record<string, string>) {
  const res = await app.inject({ url: '/api/export.zip?client=phonec0ffee', cookies, headers: { 'user-agent': IPHONE } })
  expect(res.statusCode).toBe(200)
  // Keeping the mark at the start of each spreadsheet that tells Excel it is UTF-8, which decoding would otherwise drop.
  const text = new TextDecoder('utf-8', { ignoreBOM: true })
  const files = Object.fromEntries(Object.entries(unzipSync(new Uint8Array(res.rawPayload))).map(([name, data]) => [name, text.decode(data)]))
  return { res, files }
}

/** Rows of a CSV file, as a spreadsheet would read them. */
function readCsv(text: string): string[][] {
  expect(text.startsWith('﻿')).toBe(true)
  const rows: string[][] = [[]]
  let cell = ''
  let quoted = false
  for (let i = 1; i < text.length; i++) {
    const ch = text[i]!
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') (cell += '"'), i++
      else if (ch === '"') quoted = false
      else cell += ch
    } else if (ch === '"') quoted = true
    else if (ch === ',') rows.at(-1)!.push(cell), (cell = '')
    else if (ch === '\r' && text[i + 1] === '\n') rows.at(-1)!.push(cell), (cell = ''), rows.push([]), i++
    else cell += ch
  }
  rows.pop()
  return rows
}

/** A CSV's rows as objects by column name. */
function table(text: string): Record<string, string>[] {
  const [header, ...rows] = readCsv(text)
  return rows.map((r) => Object.fromEntries(header!.map((h, i) => [h, r[i]!])))
}

describe('download everything', () => {
  it('holds every table as a spreadsheet and as JSON, the history, and a README', async () => {
    const { app, colly } = await company()
    const { res, files } = await download(app, colly.cookies)
    expect(res.headers['content-type']).toBe('application/zip')
    expect(res.headers['content-disposition']).toBe(`attachment; filename="session-hire-${irishTime(new Date()).slice(0, 10)}.zip"`)
    expect(res.headers['cache-control']).toBe('no-store')

    const tables = [
      'assets',
      'backup_runs',
      'bookings',
      'calendar_days',
      'calendar_guests',
      'calendar_imports',
      'calendar_link',
      'changes',
      'clients',
      'crew_calls',
      'faults',
      'identifiers',
      'inspections',
      'issues',
      'kit_lines',
      'label_runs',
      'models',
      'movements',
      'mutations',
      'offers',
      'people',
      'phases',
      'places',
      'products',
      'projects',
      'scans',
      'stock',
      'unavailability',
      'users',
      'venues',
    ]
    expect(Object.keys(files).sort()).toEqual(['README.txt', 'everything.json', 'history.csv', ...tables.map((t) => `tables/${t}.csv`)].sort())

    const json = JSON.parse(files['everything.json']!)
    expect(Object.keys(json).sort()).toEqual(['exportedAt', ...tables].sort())
    expect(json.people).toEqual([expect.objectContaining({ name: 'Seán Ó Briain', phone: '+353 87 123 4567', skills: ['audio', 'rf'] })])
    expect(json.offers).toEqual([expect.objectContaining({ status: 'accepted', note: '=HYPERLINK("http://evil.example","Click")' })])
    // Exactly as the database has them: UTC, to the microsecond.
    expect(json.mutations[0].received_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d+\+00:00$/)

    const readme = files['README.txt']!
    expect(readme).toContain(`Made ${irishTime(new Date()).slice(0, 10)}`)
    expect(readme).toContain('by Colly Hewson (colly@sessionhire.com)')
    expect(readme).toMatch(/people +1 row +Staff and freelancers/)
    expect(readme).toMatch(/offers +1 row /)
    expect(readme).toContain('Left out on purpose')
  })

  it("leaves out freelancers' link secrets, old and new, and sign-in sessions", async () => {
    const { app, colly, links } = await company()
    const { files } = await download(app, colly.cookies)
    for (const [name, text] of Object.entries(files)) {
      for (const secret of [...links, colly.session]) expect(text, name).not.toContain(secret)
      expect(text, name).not.toMatch(/link_?token/i)
    }
    expect(Object.keys(files)).not.toContain('tables/sessions.csv')
    expect(Object.keys(files).filter((f) => /schema_version|server_meta/.test(f))).toEqual([])
    // The JSON for scripts leaves out the same.
    const res = await app.inject({ url: '/api/export', cookies: colly.cookies })
    for (const secret of [...links, colly.session]) expect(res.body).not.toContain(secret)
    expect(res.json()).not.toHaveProperty('sessions')
  })

  it('makes spreadsheets that open cleanly in Excel', async () => {
    const { app, colly } = await company()
    const { files } = await download(app, colly.cookies)
    const people = table(files['tables/people.csv']!)
    expect(Object.keys(people[0]!)).toEqual(['id', 'name', 'kind', 'email', 'phone', 'skills', 'day_rate_cents', 'notes'])
    expect(people[0]).toMatchObject({
      name: 'Seán Ó Briain',
      phone: '+353 87 123 4567',
      skills: '["audio","rf"]',
      day_rate_cents: '25000',
      notes: 'Prefers "in-ears", not wedges\nVegetarian',
    })
    const [offer] = table(files['tables/offers.csv']!)
    expect(offer).toMatchObject({ note: `'=HYPERLINK("http://evil.example","Click")`, override: 'no', days: '["2026-10-02","2026-10-03","2026-10-04"]' })

    // Times in Irish time, as Excel reads them.
    const json = JSON.parse(files['everything.json']!)
    const mutations = table(files['tables/mutations.csv']!)
    expect(mutations[0]!.received_at).toBe(irishTime(json.mutations.find((m: { id: string }) => m.id === mutations[0]!.id).received_at))
    expect(mutations[0]!.received_at).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/)
  })

  it('writes the history out in words, and puts each download in it', async () => {
    const { app, colly } = await company()
    const { files } = await download(app, colly.cookies)
    const history = table(files['history.csv']!)
    expect(history.map((h) => [h.Who, h.How, h.What])).toEqual([
      ['Colly Hewson', 'App, device c0ffee', 'Set d&b Y10P to 4 in stock'],
      ['Colly Hewson', 'App, device c0ffee', 'Booked 2 × d&b Y10P for Electric Picnic, Fri 2 Oct to Sun 4 Oct'],
      ['Colly Hewson', 'App, device c0ffee', "Saved Seán Ó Briain's details"],
      ['Colly Hewson', 'App, device c0ffee', 'Gave Seán Ó Briain a new private link; the old one stopped working'],
      ['Colly Hewson', 'App, device c0ffee', 'Asked for 1 × Audio tech for Electric Picnic (Build), Fri 2 Oct to Sun 4 Oct'],
      ['Colly Hewson', 'App, device c0ffee', 'Offered Audio tech on Electric Picnic to Seán Ó Briain'],
      ['Seán Ó Briain', 'Private link', 'Seán Ó Briain accepted Audio tech on Electric Picnic'],
    ])
    expect(history[0]).toMatchObject({ Device: 'Safari on iPhone', Outcome: 'Done', 'Made offline': 'no', 'Waited on the device': 'under a minute' })
    expect(history[6]).toMatchObject({ Device: 'Chrome on Android', 'Made offline': '' })

    // The download itself is now in the history, and in the next download.
    const json = JSON.parse(files['everything.json']!) as Record<string, unknown[]>
    const rows = Object.entries(json).reduce((n, [key, value]) => (key === 'exportedAt' ? n : n + value.length), 0)
    const page: HistoryPage = await colly.history()
    expect(page.entries[0]).toMatchObject({
      what: `Downloaded everything (${rows} rows)`,
      who: { name: 'Colly Hewson' },
      device: 'Safari on iPhone',
      deviceCode: 'c0ffee',
    })
    const again = await download(app, colly.cookies)
    expect(table(again.files['history.csv']!).at(-1)).toMatchObject({ Who: 'Colly Hewson', What: expect.stringMatching(/^Downloaded everything \(\d+ rows\)$/) })

    await app.inject({ url: '/api/export', cookies: colly.cookies })
    expect((await colly.history()).entries[0]!.what).toMatch(/^Downloaded everything as JSON \(\d+ rows\)$/)
  })

  it('is for signed-in staff only', async () => {
    const { app } = await server()
    expect((await app.inject('/api/export.zip')).statusCode).toBe(401)
    expect((await app.inject('/api/export')).statusCode).toBe(401)
  })
})

describe('spreadsheet cells', () => {
  it("get a ' in front when Excel would run them as a formula", () => {
    for (const risky of ['=1+1', '@SUM(A1:A9)', '+IE', '-2+3+cmd|\' /C calc\'!A0', '- bring boots', '\t=1']) expect(spreadsheetSafe(risky)).toBe(`'${risky}`)
    for (const fine of ['+353 87 123 4567', '-5', '-12.50', '(01) 234 5678', 'Bring boots', 'a=b', '']) expect(spreadsheetSafe(fine)).toBe(fine)
  })

  it('show times in Irish time, summer and winter', () => {
    expect(irishTime('2026-07-01T12:00:00.123456+00:00')).toBe('2026-07-01 13:00:00')
    expect(irishTime('2026-12-01T12:00:00Z')).toBe('2026-12-01 12:00:00')
  })
})
