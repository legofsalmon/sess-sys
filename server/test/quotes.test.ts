import { addDays, irishToday, newId, type CommandInput, type CommandName, type HistoryPage, type Mutation, type MutationResult, type Quote, type QuoteLine } from '@sh/shared'
import type { FastifyInstance } from 'fastify'
import { afterEach, describe, expect, it } from 'vitest'
import { buildApp } from '../src/app.ts'
import { pgliteDb } from '../src/db.ts'

/**
 * Quotes and prices (ADR 0042), on the server, whatever the device sends:
 * one draft a job at a time, versions numbered in turn, a version that went
 * to the client kept as it went, the answer, invoice and payment on the one
 * that counts and in order, a job settled once invoiced, and a freelancer
 * marked paid only on an approved timesheet, which then stays approved.
 */

let cleanup: (() => Promise<void>)[] = []
afterEach(async () => {
  for (const fn of cleanup.reverse()) await fn()
  cleanup = []
})

const today = irishToday()
const day = (n: number) => addDays(today, n)

function m<N extends CommandName>(name: N, args: CommandInput<N>): Mutation {
  return { id: newId(), name, args, createdAt: new Date().toISOString() } as Mutation
}

async function send(app: FastifyInstance, ...mutations: Mutation[]): Promise<MutationResult[]> {
  const res = await app.inject({ method: 'POST', url: '/api/sync/push', payload: { clientId: 'office', mutations } })
  return res.json().results
}
async function ok(app: FastifyInstance, ...mutations: Mutation[]) {
  for (const r of await send(app, ...mutations)) expect(r, JSON.stringify(r)).toMatchObject({ status: 'applied' })
}
async function refused(app: FastifyInstance, mutation: Mutation) {
  const [r] = await send(app, mutation)
  expect(r!.status).toBe('rejected')
  return r!.status === 'rejected' ? r!.reason.message : ''
}

const line = (l: Partial<QuoteLine> = {}): QuoteLine => ({ id: newId(), kind: 'kit', what: 'd&b Y10P', ref: null, group: 'Audio', qty: 8, days: 2, unitCents: 4500, vat: '23', ...l })
const save = (id: string, lines: QuoteLine[] = [line()], discountPct = 0) => m('quote.save', { id, projectId: 'gala', lines, discountPct, notes: '' })

async function gala() {
  const db = await pgliteDb()
  const app = await buildApp({ db })
  cleanup.push(async () => {
    await app.close()
    await db.close()
  })
  await ok(
    app,
    m('client.upsert', { id: 'bw', name: 'Brightwater Events', contacts: [], notes: '' }),
    m('project.create', { id: 'gala', name: 'Autumn Gala', clientId: 'bw', venueId: null, status: 'confirmed', notes: '' }),
    m('phase.add', { id: 'show', projectId: 'gala', name: 'Show', start: day(-3), end: day(-1), venueId: null, notes: '' })
  )
  const quote = async (id: string): Promise<Quote> => (await app.inject({ url: '/api/sync/pull?after=0' })).json().changes.filter((c: { entity: string; id: string }) => c.entity === 'quote' && c.id === id).at(-1).data
  return { app, db, quote }
}

describe('a quote', () => {
  it('has one draft at a time, changed until it goes to the client, then kept as it went', async () => {
    const { app, quote } = await gala()
    await ok(app, save('v1', [line(), line({ kind: 'other', what: 'Delivery', qty: 1, days: 1, unitCents: 15000, vat: '13.5' })], 10))
    expect(await quote('v1')).toMatchObject({ version: 1, status: 'draft', discountPct: 10 })
    expect(await refused(app, save('other'))).toBe("There's already a draft of this quote, version 1: change that one.")

    await ok(app, save('v1', [line({ qty: 10 })]))
    expect((await quote('v1')).lines).toHaveLength(1)
    await ok(app, m('quote.sent', { id: 'v1', on: day(-10) }))
    expect(await quote('v1')).toMatchObject({ status: 'sent', sentOn: day(-10) })
    expect(await refused(app, save('v1'))).toBe('Version 1 has gone to the client, so it stays as it was. Start a new version to change it.')

    // A new version, numbered after it; the old one is still there to read.
    await ok(app, save('v2', [line({ days: 3 })]))
    expect(await quote('v2')).toMatchObject({ version: 2, status: 'draft' })
    expect((await quote('v1')).lines[0]).toMatchObject({ qty: 10 })
  })

  it("takes the client's answer, the invoice and the payment in turn, and on the version that counts", async () => {
    const { app, quote } = await gala()
    await ok(app, save('v1'), m('quote.sent', { id: 'v1', on: day(-10) }), save('v2'), m('quote.sent', { id: 'v2', on: day(-8) }))
    expect(await refused(app, m('quote.answer', { id: 'v1', answer: 'accepted', on: day(-7) }))).toBe('Version 1 has been replaced by version 2, so this goes on that one.')
    expect(await refused(app, m('quote.invoiced', { id: 'v2', on: day(-1), ref: 'SH-1' }))).toBe('Only a quote the client accepted is invoiced. Record their answer first.')
    await ok(app, m('quote.answer', { id: 'v2', answer: 'accepted', on: day(-7) }))
    expect(await refused(app, m('quote.paid', { id: 'v2', on: day(0) }))).toBe('Mark it invoiced first: a payment is for an invoice.')
    await ok(app, m('quote.invoiced', { id: 'v2', on: day(-1), ref: ' SH-1042 ' }))
    await ok(app, m('quote.paid', { id: 'v2', on: day(0) }))
    expect(await quote('v2')).toMatchObject({ status: 'accepted', answeredOn: day(-7), invoicedOn: day(-1), invoiceRef: 'SH-1042', paidOn: day(0) })

    // Settled: no new version, and the records come off only in the opposite order.
    expect(await refused(app, save('v3'))).toBe('Version 2 is invoiced, so the quote for Autumn Gala is settled.')
    expect(await refused(app, m('quote.invoiced', { id: 'v2', on: null, ref: '' }))).toBe('This invoice is marked paid. Take the payment back first.')
    expect(await refused(app, m('quote.answer', { id: 'v2', answer: 'none', on: day(0) }))).toContain('Take the invoice back first.')
    await ok(app, m('quote.paid', { id: 'v2', on: null }), m('quote.invoiced', { id: 'v2', on: null, ref: '' }), m('quote.answer', { id: 'v2', answer: 'none', on: day(0) }))
    expect(await quote('v2')).toMatchObject({ status: 'sent', answeredOn: null, invoicedOn: null, invoiceRef: '', paidOn: null })

    // The same change twice, as a phone may send it, changes nothing more.
    await ok(app, m('quote.answer', { id: 'v2', answer: 'declined', on: day(0) }), m('quote.answer', { id: 'v2', answer: 'declined', on: day(0) }))
    const history: HistoryPage = (await app.inject({ url: '/api/history' })).json()
    expect(history.entries.map((e) => e.what).join('\n')).not.toMatch(/€/)
  })

  it("won't go to the client with nothing on it, or onto another job", async () => {
    const { app } = await gala()
    await ok(app, save('v1', []))
    expect(await refused(app, m('quote.sent', { id: 'v1', on: day(0) }))).toBe('This quote has no lines yet. Add what it is for first.')
    await ok(app, m('project.create', { id: 'other', name: 'Other', clientId: null, venueId: null, status: 'enquiry', notes: '' }))
    expect(await refused(app, m('quote.save', { id: 'v1', projectId: 'other', lines: [], discountPct: 0, notes: '' }))).toBe('That quote belongs to another job.')
  })
})

describe('a quote number (ADR 0084)', () => {
  it('is given when a quote first goes, kept on every version, and carries on from the number Admin sets', async () => {
    const { app, quote } = await gala()
    await ok(
      app,
      m('project.create', { id: 'ball', name: 'Winter Ball', clientId: 'bw', venueId: null, status: 'enquiry', notes: '' }),
      m('quoting.update', { nextNumber: 1115, terms: 'Half up front, the rest within 30 days.', bank: 'IBAN IE00 BANK 0000 0000 0000 00' }),
      save('v1')
    )
    expect(await quote('v1')).toMatchObject({ number: null, validDays: 30, depositPct: null })
    await ok(app, m('quote.save', { id: 'v1', projectId: 'gala', lines: [line()], discountPct: 0, notes: '', validDays: 14, depositPct: 50 }), m('quote.sent', { id: 'v1', on: today }))
    expect(await quote('v1')).toMatchObject({ number: 1115, validDays: 14, depositPct: 50 })

    // A second version keeps the number, and the days and deposit unless it says otherwise; a save that doesn't say them leaves them.
    await ok(app, save('v2', [line({ qty: 9 })]), save('v2', [line({ qty: 10 })]), m('quote.sent', { id: 'v2', on: today }))
    expect(await quote('v2')).toMatchObject({ version: 2, number: 1115, validDays: 14, depositPct: 50 })

    // Another job's, answered straight from its draft, takes the next.
    await ok(app, m('quote.save', { id: 'b1', projectId: 'ball', lines: [line()], discountPct: 0, notes: '' }), m('quote.answer', { id: 'b1', answer: 'accepted', on: today }))
    expect(await quote('b1')).toMatchObject({ number: 1116 })

    // The next number can't go back over one given.
    expect(await refused(app, m('quoting.update', { nextNumber: 1116, terms: '', bank: '' }))).toBe('Quote 1116 has been given already, so the next number is 1117 or more.')
    await ok(app, m('quoting.update', { nextNumber: null, terms: '', bank: '' }))
  })

  it("goes to the client's address, which a save from an older app leaves as it was", async () => {
    const { app } = await gala()
    const client = async () => (await app.inject({ url: '/api/sync/pull?after=0' })).json().changes.filter((c: { entity: string; id: string }) => c.entity === 'client' && c.id === 'bw').at(-1).data
    await ok(app, m('client.upsert', { id: 'bw', name: 'Brightwater Events', contacts: [], notes: '', address: '1 Quay Street\nGalway' }))
    expect(await client()).toMatchObject({ address: '1 Quay Street\nGalway' })
    await ok(app, m('client.upsert', { id: 'bw', name: 'Brightwater Events Ltd', contacts: [], notes: '' }))
    expect(await client()).toMatchObject({ name: 'Brightwater Events Ltd', address: '1 Quay Street\nGalway' })
    await ok(app, m('client.upsert', { id: 'bw', name: 'Brightwater Events Ltd', contacts: [], notes: '', address: '' }))
    expect(await client()).not.toHaveProperty('address')
  })
})

describe('the price list', () => {
  it('sets and clears a day price for a product, a role and a discount for a client', async () => {
    const { app } = await gala()
    await ok(app, m('model.create', { id: 'y10p', name: 'd&b Y10P', department: 'audio', category: 'Speakers', tracking: 'bulk', isCase: false, valueCents: 0, notes: '' }))
    await ok(app, m('price.product', { modelId: 'y10p', dayCents: 4500 }), m('price.role', { role: '  Sound   No.1 ', dayCents: 42000 }), m('price.client', { clientId: 'bw', pct: 12.5 }))
    const changes = (await app.inject({ url: '/api/sync/pull?after=0' })).json().changes as { entity: string; op: string; data: unknown }[]
    expect(changes.filter((c) => ['productPrice', 'rolePrice', 'clientDiscount'].includes(c.entity)).map((c) => c.data)).toEqual([
      { id: 'y10p', dayCents: 4500 },
      { id: 'sound no.1', role: 'Sound No.1', dayCents: 42000 },
      { id: 'bw', pct: 12.5 },
    ])
    await ok(app, m('price.role', { role: 'sound no.1', dayCents: null }))
    const after = (await app.inject({ url: '/api/sync/pull?after=0' })).json().changes as { entity: string; op: string }[]
    expect(after.filter((c) => c.entity === 'rolePrice').map((c) => c.op)).toEqual(['put', 'delete'])
    expect(await refused(app, m('price.product', { modelId: 'gone', dayCents: 100 }))).toBe('That product is no longer in the stock list.')
  })
})

describe("a freelancer's cost", () => {
  it('is marked paid only once approved, and the timesheet then stays approved', async () => {
    const { app } = await gala()
    await ok(
      app,
      m('person.upsert', { id: 'dara', name: 'Dara Quinn', kind: 'freelancer', email: 'dara@example.com', phone: null, skills: [], dayRateCents: 30000, notes: '' }),
      m('call.create', { id: 'sound', projectId: 'gala', phaseId: 'show', project: 'Autumn Gala', phase: 'Show', venue: '', role: 'Sound No.1', start: day(-2), end: day(-1), callTime: '08:00', needed: 1, dayRateCents: 32000, details: '', replyBy: null }),
      m('offer.send', { id: 'dara-sound', callId: 'sound', personId: 'dara', override: false }),
      m('offer.respond', { id: 'dara-sound', answer: 'accept', days: null, note: '' }),
      m('offer.confirm', { id: 'dara-sound' })
    )
    expect(await refused(app, m('cost.paid', { id: 'dara-sound', on: day(0) }))).toBe('Only an approved timesheet is marked paid. Approve it first.')
    await ok(app, m('timesheet.send', { id: 'dara-sound', days: [day(-2), day(-1)], extras: [], note: '' }))
    await ok(app, m('timesheet.approve', { id: 'dara-sound', days: [day(-2), day(-1)], dayRateCents: 32000, extras: [], officeNote: '' }))
    await ok(app, m('cost.paid', { id: 'dara-sound', on: day(0) }))
    expect(await refused(app, m('timesheet.reopen', { id: 'dara-sound' }))).toBe('This timesheet is marked paid, so it stays as approved. Take the payment back on Money first.')
    await ok(app, m('cost.paid', { id: 'dara-sound', on: null }), m('timesheet.reopen', { id: 'dara-sound' }))
  })
})
