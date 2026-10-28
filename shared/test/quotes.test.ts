import { describe, expect, it } from 'vitest'
import type { PullResponse, PushRequest, PushResponse } from '../src/protocol.ts'
import { changesFromJob, csvText, lineCents, linesFor, quoteLine, linesByGroup, money, quoteTotals, vatPeriodOf, type Quote, type QuoteLine } from '../src/quotes.ts'
import { MemoryStorage, SyncClient, type Transport } from '../src/sync/client.ts'
import { invoicesCsv, quotesToFollow, vatSummaryCsv, type QuoteView } from '../src/sync/money-view.ts'
import type { JobView } from '../src/sync/jobs-view.ts'

/**
 * Quotes and money (ADR 0042): what a quote comes to, VAT by rate after the
 * discount and to the cent; the lines a job's kit and crew make; Revenue's
 * two-month VAT periods; files a spreadsheet opens safely; and on the
 * device, a quote changed with no signal shown as waiting, the months, who
 * owes and the accountant's files, and a role that isn't sent money.
 */

const line = (l: Partial<QuoteLine>): QuoteLine => ({ id: 'l', kind: 'other', what: 'Delivery', ref: null, group: '', qty: 1, days: 1, unitCents: 10000, vat: '23', ...l })

describe('what a quote comes to', () => {
  it('takes the discount off each rate and works the VAT out on what is left, so the totals add up', () => {
    const t = quoteTotals({
      lines: [line({ qty: 8, days: 2, unitCents: 4500 }), line({ qty: 1, days: 1, unitCents: 15000, vat: '13.5' })],
      discountPct: 10,
    })
    expect(t.rates).toEqual([
      { rate: '23', before: 72000, discount: 7200, net: 64800, vat: 14904, gross: 79704 },
      { rate: '13.5', before: 15000, discount: 1500, net: 13500, vat: 1823, gross: 15323 },
    ])
    expect(t).toMatchObject({ subtotal: 87000, discount: 8700, net: 78300, vat: 16727, gross: 95027 })
    expect(t.gross).toBe(t.net + t.vat)
  })

  it('rounds each line, and a half day, to the cent', () => {
    const t = quoteTotals({ lines: [line({ qty: 3, days: 1.5, unitCents: 333 })], discountPct: 12.5 })
    expect(t.subtotal).toBe(1499)
    expect(t.discount).toBe(187)
    expect(t.vat).toBe(Math.round(1312 * 0.23))
    expect(quoteTotals({ lines: [], discountPct: 0 })).toMatchObject({ gross: 0, rates: [] })
  })

  it('charges a line once whatever its days, as a device from before reads it too', () => {
    // Proves: a delivery charged once is how many × the price; it keeps 1 for its days, so lineCents without `per` agrees.
    expect(lineCents(line({ qty: 2, days: 1, unitCents: 15000, per: 'once' }))).toBe(30000)
    expect(lineCents(line({ qty: 2, days: 3, unitCents: 15000, per: 'once' }))).toBe(30000)
    expect(lineCents(line({ qty: 2, days: 3, unitCents: 15000, per: 'day' }))).toBe(90000)
    expect(lineCents(line({ qty: 2, days: 3, unitCents: 15000 }))).toBe(90000)
    expect(quoteLine.safeParse(line({ per: 'once' })).success).toBe(true)
    expect(quoteLine.safeParse({ ...line({}), per: 'week' }).success).toBe(false)
  })

  it('writes euros as a quote does', () => {
    expect(money(125000)).toBe('€1,250.00')
    expect(money(5)).toBe('€0.05')
  })
})

describe("a job's kit and crew as lines", () => {
  const prices = { product: (id: string) => (id === 'y10p' ? 4500 : undefined), role: (r: string) => (r === 'Rigger' ? 38000 : undefined) }
  const lines = linesFor(
    [
      { id: 'k1', modelId: 'y10p', name: 'd&b Y10P', group: 'Audio', qty: 8, days: 3 },
      { id: 'k2', modelId: 'mystery', name: 'Hazer', group: 'Lighting', phase: 'Show', qty: 1, days: 0 },
    ],
    [
      { id: 'c1', role: 'Rigger', needed: 2, days: 2, bookedCents: 30000 },
      { id: 'c2', role: 'Stagehand', needed: 4, days: 1, bookedCents: 26000 },
      { id: 'c3', role: 'Runner', needed: 1, days: 1, bookedCents: null },
    ],
    prices,
    (() => {
      let n = 0
      return () => `n${++n}`
    })()
  )

  it('prices each from the price list, a role with none at its booked rate, and a product with none at nothing for the office to price', () => {
    expect(lines.map((l) => [l.what, l.qty, l.days, l.unitCents, l.vat])).toEqual([
      ['d&b Y10P', 8, 3, 4500, '23'],
      ['Hazer (Show)', 1, 1, 0, '23'],
      ['Rigger', 2, 2, 38000, '23'],
      ['Stagehand', 4, 1, 26000, '23'],
      ['Runner', 1, 1, 0, '23'],
    ])
    expect(lines.map((l) => l.ref)).toEqual(['k1', 'k2', 'c1', 'c2', 'c3'])
  })

  it('lists kit by department, then crew, then anything else', () => {
    const all = [line({ id: 'x' }), ...lines]
    expect(linesByGroup(all).map((g) => [g.group, g.lines.length])).toEqual([
      ['Audio', 1],
      ['Lighting', 1],
      ['Crew', 3],
      ['Other', 1],
    ])
  })
})

describe('a quote against its job as the job changes', () => {
  const prices = { product: (id: string) => (id === 'y10p' ? 4500 : undefined), role: () => 30000 }
  let n = 0
  const ids = () => `x${++n}`
  const kit = [{ id: 'k1', modelId: 'y10p', name: 'd&b Y10P', group: 'Audio', qty: 8, days: 3 }]
  const crew = [{ id: 'c1', role: 'Rigger', needed: 2, days: 2, bookedCents: null }]
  const quoted = linesFor(kit, crew, prices, ids)

  it('finds nothing when the quote was built from the job as it is', () => {
    expect(changesFromJob(quoted, kit, crew, prices, ids)).toEqual({ added: [], gone: [], changed: [] })
  })

  it('finds kit and crew added, lines whose kit or call has gone, and how many changed, leaving lines typed in alone', () => {
    // Proves: matched by what each line was built from; only how many is compared; a line typed in is never "gone".
    const typed = line({ id: 'typed', what: 'Delivery', per: 'once' })
    const now = changesFromJob(
      [...quoted, typed],
      [{ ...kit[0]!, qty: 10 }, { id: 'k2', modelId: 'hazer', name: 'Hazer', group: 'Lighting', qty: 1, days: 1 }],
      [],
      prices,
      ids
    )
    expect(now.added.map((l) => [l.what, l.ref, l.unitCents, l.modelId])).toEqual([['Hazer', 'k2', 0, 'hazer']])
    expect(now.gone.map((l) => l.what)).toEqual(['Rigger'])
    expect(now.changed.map((c) => [c.line.what, c.line.qty, c.qty])).toEqual([['d&b Y10P', 8, 10]])
  })
})

describe('VAT periods', () => {
  it('are two months, January and February first', () => {
    expect(vatPeriodOf('2026-10-17')).toEqual({ key: '2026-09', start: '2026-09-01', end: '2026-10-31', label: 'Sep–Oct 2026' })
    expect(vatPeriodOf('2028-01-03')).toMatchObject({ start: '2028-01-01', end: '2028-02-29', label: 'Jan–Feb 2028' })
    expect(vatPeriodOf('2026-12-31')).toMatchObject({ start: '2026-11-01', end: '2026-12-31' })
  })
})

describe('a file for the accountant', () => {
  it('opens in a spreadsheet with Irish names intact and nothing run as a formula', () => {
    const text = csvText(['Client', 'Net'], [['=HYPERLINK("x")', '-12.50'], ['Seán, "the boss"', '+353 1 555']])
    expect(text.startsWith('﻿')).toBe(true)
    expect(text).toBe('﻿Client,Net\r\n"\'=HYPERLINK(""x"")",-12.50\r\n"Seán, ""the boss""",+353 1 555\r\n')
  })
})

/** A server that applies everything, and can be told to leave money out, as it does for a role without it. */
class Server implements Transport {
  seq = 0
  changes: PullResponse['changes'] = []
  money = true
  push = async (req: PushRequest): Promise<PushResponse> => ({ results: req.mutations.map((m) => ({ id: m.id, status: 'applied' as const, seq: ++this.seq })) })
  pull = async (after: number): Promise<PullResponse> => {
    const changes = this.changes.filter((c) => c.seq > after && (this.money || !['quote', 'productPrice'].includes(c.entity)))
    return { changes, cursor: Math.max(after, this.seq), more: false, ...(this.money ? {} : { money: false }) }
  }
  put(entity: PullResponse['changes'][number]['entity'], id: string, data: unknown) {
    this.changes.push({ seq: ++this.seq, entity, id, op: 'put', data })
  }
}

const quote = (q: Partial<Quote>): Quote => ({
  id: 'q1',
  projectId: 'gala',
  version: 1,
  status: 'accepted',
  lines: [line({ qty: 10, unitCents: 10000 }), line({ id: 'f', unitCents: 20000, vat: '13.5' })],
  discountPct: 0,
  notes: '',
  madeAt: '2026-09-01T09:00:00.000Z',
  savedAt: '2026-09-01T09:00:00.000Z',
  sentOn: '2026-09-02',
  answeredOn: '2026-09-05',
  invoicedOn: '2026-10-02',
  invoiceRef: 'SH-1042',
  paidOn: null,
  ...q,
})

const project = { id: 'gala', name: 'Autumn Gala', clientId: 'bw', venueId: null, status: 'confirmed', notes: '', createdAt: '2026-09-01T09:00:00.000Z' }

describe('money on the device', () => {
  it('shows a quote saved with no signal as waiting, numbered after the last', async () => {
    const server = new Server()
    server.put('project', 'gala', project)
    server.put('quote', 'q1', quote({ status: 'sent', answeredOn: null, invoicedOn: null, invoiceRef: '' }))
    const phone = await new SyncClient({ storage: new MemoryStorage(), transport: server, clientId: 'phone' }).open()
    await phone.sync()
    await phone.mutate('quote.save', { id: 'q2', projectId: 'gala', lines: [line({})], discountPct: 5, notes: '' })
    const m = phone.view().money
    expect(m.quotesOf('gala').map((q) => [q.version, q.status, q.pending, q.latest])).toEqual([
      [2, 'draft', true, true],
      [1, 'sent', false, false],
    ])
    expect(m.draftOf('gala')?.totals.net).toBe(9500)
    // The draft isn't the quote that counts until it goes to the client.
    expect(m.currentOf('gala')?.id).toBe('q1')
    await phone.mutate('quote.sent', { id: 'q2', on: '2026-10-17' })
    expect(phone.view().money.currentOf('gala')).toMatchObject({ id: 'q2', status: 'sent', pending: true })
  })

  it("counts what's owed until it's paid, and makes the accountant's files from what's invoiced", async () => {
    const server = new Server()
    server.put('client', 'bw', { id: 'bw', name: 'Brightwater Events', contacts: [], notes: '' })
    server.put('project', 'gala', project)
    server.put('quote', 'q1', quote({}))
    const phone = await new SyncClient({ storage: new MemoryStorage(), transport: server, clientId: 'phone' }).open()
    await phone.sync()
    const m = phone.view().money
    expect(m.owed).toMatchObject([{ client: 'Brightwater Events', cents: 123000 + 22700 }])
    expect(m.job('gala')).toMatchObject({ quoted: 120000, costs: 0, margin: 120000 })
    const period = { start: '2026-09-01', end: '2026-10-31', label: 'Sep–Oct 2026' }
    expect(invoicesCsv(m, period).split('\r\n').slice(1, 3)).toEqual([
      '2026-10-02,SH-1042,Brightwater Events,Autumn Gala,1,23%,1000.00,230.00,1230.00,',
      '2026-10-02,SH-1042,Brightwater Events,Autumn Gala,1,13.5%,200.00,27.00,227.00,',
    ])
    expect(vatSummaryCsv(m, period).split('\r\n').slice(1, 4)).toEqual(['Sep–Oct 2026,23%,1000.00,230.00,1230.00', 'Sep–Oct 2026,13.5%,200.00,27.00,227.00', 'Sep–Oct 2026 in all,,1200.00,257.00,1457.00'])
    expect(invoicesCsv(m, { start: '2026-11-01', end: '2026-12-31', label: '' }).split('\r\n').length).toBe(2)

    await phone.mutate('quote.paid', { id: 'q1', on: '2026-10-16' })
    expect(phone.view().money.owed).toEqual([])
  })

  it('drops money it held when its role loses it, and reads again from the start when given it back', async () => {
    const server = new Server()
    server.put('project', 'gala', project)
    server.put('quote', 'q1', quote({}))
    server.put('productPrice', 'y10p', { id: 'y10p', dayCents: 4500 })
    const storage = new MemoryStorage()
    const phone = await new SyncClient({ storage, transport: server, clientId: 'phone' }).open()
    await phone.sync()
    expect(phone.view().money.quotesOf('gala')).toHaveLength(1)

    server.money = false
    server.put('place', 'a1', { id: 'a1', name: 'Bay A1', notes: '' })
    await phone.sync()
    expect(phone.view().money.quotesOf('gala')).toEqual([])
    expect(phone.view().money.productPrice('y10p')).toBeUndefined()
    expect((await storage.load())?.entities.quote).toEqual({})

    server.money = true
    await phone.sync()
    expect(phone.view().money.quotesOf('gala')).toHaveLength(1)
    expect(phone.view().money.productPrice('y10p')).toBe(4500)
  })
})

describe('quotes to follow up (ADR 0081)', () => {
  const job = (id: string, status: JobView['status']) => ({ id, name: id, status }) as JobView
  let n = 0
  const quote = (over: Partial<QuoteView>) =>
    ({ id: `q${++n}`, status: 'sent', sentOn: null, answeredOn: null, invoicedOn: null, savedAt: '2026-10-20T10:00:00Z', ...over }) as QuoteView
  const today = '2026-10-27'

  it('sorts each job by what it is waiting on, the longest waiting first', () => {
    const drafts = new Map<string, QuoteView>()
    const rows: { job: JobView; current: QuoteView | undefined }[] = [
      { job: job('Draft only', 'enquiry'), current: undefined },
      { job: job('Sent lately', 'quoted'), current: quote({ sentOn: '2026-10-25' }) },
      { job: job('Sent long ago', 'quoted'), current: quote({ sentOn: '2026-10-10' }) },
      { job: job('Said yes', 'quoted'), current: quote({ status: 'accepted', sentOn: '2026-10-10', answeredOn: '2026-10-20' }) },
      { job: job('Said yes, confirmed, invoiced', 'confirmed'), current: quote({ status: 'accepted', answeredOn: '2026-10-20', invoicedOn: '2026-10-21' }) },
      { job: job('Said no', 'quoted'), current: quote({ status: 'declined', answeredOn: '2026-10-26' }) },
      { job: job('Lost', 'lost'), current: quote({ sentOn: '2026-10-01' }) },
    ]
    drafts.set('Draft only', quote({ status: 'draft', savedAt: '2026-10-24T09:00:00Z' }))
    const f = quotesToFollow({ jobs: rows as never, draftOf: (id) => drafts.get(id) }, today)
    expect(f.drafts.map((x) => [x.job.name, x.days])).toEqual([['Draft only', 3]])
    expect(f.waiting.map((x) => [x.job.name, x.days])).toEqual([
      ['Sent long ago', 17],
      ['Sent lately', 2],
    ])
    expect(f.outOfStep.map((x) => [x.job.name, x.want])).toEqual([
      ['Said yes', 'confirmed'],
      ['Said no', 'lost'],
    ])
  })

  it('leaves a sent quote out of waiting while a new version is being drafted', () => {
    const rows = [{ job: job('Second go', 'quoted'), current: quote({ sentOn: '2026-10-01' }) }]
    const f = quotesToFollow({ jobs: rows as never, draftOf: () => quote({ status: 'draft' }) }, today)
    expect(f.waiting).toEqual([])
    expect(f.drafts).toHaveLength(1)
  })
})
