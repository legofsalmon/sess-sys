import { describe, expect, it } from 'vitest'
import type { PullResponse, PushRequest, PushResponse } from '../src/protocol.ts'
import { chargedFor, packageIncludes, changesFromJob, csvText, depositCents, quoteNumberLabel, validUntil, versionChanges, lineCents, linesFor, quoteLine, linesByGroup, money, quoteTotals, vatPeriodOf, type Quote, type QuoteLine } from '../src/quotes.ts'
import { MemoryStorage, SyncClient, type Transport } from '../src/sync/client.ts'
import { belowZero, invoicesCsv, marginsByMonth, quoteRows, quoteRowShown, quotesToFollow, vatSummaryCsv, type JobMoney, type QuoteView } from '../src/sync/money-view.ts'
import type { JobView } from '../src/sync/jobs-view.ts'

/**
 * Quotes and money (ADR 0042): what a quote comes to, VAT by rate after the
 * discount and to the cent; the lines a job's kit and crew make; Revenue's
 * two-month VAT periods; files a spreadsheet opens safely; and on the
 * device, a quote changed with no signal shown as waiting, the months, who
 * owes and the accountant's files, and a role that isn't sent money.
 */

const line = (l: Partial<QuoteLine>): QuoteLine => ({ id: 'l', kind: 'other', what: 'Delivery', ref: null, group: '', qty: 1, days: 1, unitCents: 10000, vat: '23', ...l })

describe('the printed quote (ADR 0084)', () => {
  it("is numbered without padding, holds its prices for so many days from the day it's sent, and works out the deposit", () => {
    expect(quoteNumberLabel({ number: 1115, version: 1 })).toBe('1115')
    expect(quoteNumberLabel({ number: 1115, version: 2 })).toBe('1115 · version 2')
    expect(quoteNumberLabel({ number: null, version: 1 })).toBe('')
    expect(validUntil({ sentOn: '2026-10-28', validDays: 30 }, '2026-11-02')).toBe('2026-11-27')
    // A draft counts from today, and a quote from before holds for 30.
    expect(validUntil({ sentOn: null }, '2026-12-20')).toBe('2027-01-19')
    expect(depositCents(95027, 50)).toBe(47514)
  })

  it('says what changed since the version before, matching lines by what they are, not their ids', () => {
    const y10 = line({ id: 'a', kind: 'kit', what: 'd&b Y10P', modelId: 'y10', qty: 8, days: 2, unitCents: 4500 })
    const was = { discountPct: 0, lines: [y10, line({ id: 'b', what: 'Delivery', per: 'once' }), line({ id: 'c', kind: 'crew', what: 'Audio tech', ref: 'call1', days: 2, unitCents: 40000 })] }
    const now = {
      discountPct: 10,
      lines: [
        { ...y10, id: 'a2', qty: 10 },
        // The same, charged once: days don't count.
        line({ id: 'b2', what: 'delivery ', per: 'once', days: 3 }),
        line({ id: 'd', what: 'Generator', unitCents: 30000 }),
      ],
    }
    const c = versionChanges(was, now)
    expect(c.added.map((l) => l.what)).toEqual(['Generator'])
    expect(c.removed.map((l) => l.what)).toEqual(['Audio tech'])
    expect(c.changed.map((x) => [x.line.qty, x.was.qty])).toEqual([[10, 8]])
    expect(c.discount).toEqual({ was: 0, now: 10 })
    expect(versionChanges(was, { ...was, lines: was.lines.map((l) => ({ ...l, id: `${l.id}2` })) })).toEqual({ added: [], removed: [], changed: [], discount: null, agreed: null })
  })
})

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

describe('rate rules, line discounts and an agreed price (ADR 0085)', () => {
  it('charges a week as one, a 3 Day Week as no more than three days in any seven, and Daily by the day, as Current RMS did', () => {
    // Proves: the counts Current RMS charged on its lines, read from its history.
    expect([1, 3, 7, 8, 14, 15].map((d) => chargedFor('weekly', d))).toEqual([1, 1, 1, 2, 2, 3])
    expect([1, 2, 3, 4, 7, 8, 10, 11, 14, 0.5].map((d) => chargedFor('week3', d))).toEqual([1, 2, 3, 3, 3, 4, 6, 6, 6, 1])
    expect([1, 2.5, 9].map((d) => chargedFor('daily', d))).toEqual([1, 2.5, 9])
  })

  it("takes a line's own discount off it before the whole quote's", () => {
    expect(lineCents(line({ qty: 2, days: 3, unitCents: 10000, discountPct: 30 }))).toBe(42000)
    expect(lineCents(line({ qty: 1, days: 1, unitCents: 333, discountPct: 12.5 }))).toBe(291)
    const t = quoteTotals({ lines: [line({ unitCents: 10000, discountPct: 50 }), line({ unitCents: 10000 })], discountPct: 10 })
    expect(t).toMatchObject({ subtotal: 15000, discount: 1500, net: 13500 })
    expect(quoteLine.safeParse(line({ discountPct: 101 })).success).toBe(false)
    expect(quoteLine.safeParse(line({ rate: 'week3', out: 10, days: 6 })).success).toBe(true)
  })

  it('makes the discount whatever brings the lines to a price agreed, shared across the VAT rates so the totals still add up', () => {
    const lines = [line({ qty: 8, days: 2, unitCents: 4500 }), line({ unitCents: 15000, vat: '13.5' })]
    const t = quoteTotals({ lines, discountPct: 10, agreedCents: 80000 })
    expect(t).toMatchObject({ subtotal: 87000, discount: 7000, net: 80000, discountPct: 8 })
    expect(t.rates.reduce((n, r) => n + r.discount, 0)).toBe(7000)
    expect(t.gross).toBe(t.net + t.vat)
    // None agreed: the percentage, as before.
    expect(quoteTotals({ lines, discountPct: 10, agreedCents: null })).toMatchObject({ discount: 8700, discountPct: 10 })
    const was = { lines, discountPct: 0, agreedCents: null }
    expect(versionChanges(was, { ...was, agreedCents: 80000, discountPct: 8 })).toMatchObject({ agreed: { was: null, now: 80000 }, discount: null })
  })

  it("counts a kit line's days by its product's rule, keeping the days out", () => {
    const [l] = linesFor([{ id: 'k1', modelId: 'y10p', name: 'd&b Y10P', group: 'Audio', qty: 4, days: 10 }], [], { product: () => 5500, role: () => undefined, rate: () => 'week3' }, () => 'n1')
    expect(l).toMatchObject({ rate: 'week3', out: 10, days: 6, unitCents: 5500 })
    expect(lineCents(l!)).toBe(4 * 6 * 5500)
  })
})

describe('a package (ADR 0087)', () => {
  it('prints what it holds, and anything else it includes, after its line', () => {
    const names: Record<string, string> = { sm58: 'Shure SM58', di: 'DI box' }
    const items = [{ modelId: 'sm58', qty: 4 }, { modelId: 'di', qty: 2 }]
    expect(packageIncludes({ items, notes: 'with clips' }, (id) => names[id])).toBe('4 × Shure SM58, 2 × DI box, with clips')
    expect(packageIncludes({ items: [{ modelId: 'gone', qty: 1 }], notes: '' }, (id) => names[id])).toBe('1 × a product no longer listed')
    expect(packageIncludes({ items: [], notes: ' Stands and clips ' }, () => undefined)).toBe('Stands and clips')
    expect(quoteLine.safeParse(line({ kind: 'kit', what: 'Mic package', packageId: 'p1', includes: '4 × Shure SM58' })).success).toBe(true)
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

  it("says how much of what's owed is invoiced, and sets a cancelled job's quote aside everywhere until it's invoiced (audit findings 29 and 30)", async () => {
    const server = new Server()
    server.put('client', 'bw', { id: 'bw', name: 'Brightwater Events', contacts: [], notes: '' })
    server.put('project', 'gala', project)
    server.put('project', 'fair', { ...project, id: 'fair', name: 'Craft Fair' })
    server.put('project', 'gone', { ...project, id: 'gone', name: 'Called Off', status: 'cancelled' })
    server.put('quote', 'q1', quote({}))
    server.put('quote', 'q2', quote({ id: 'q2', projectId: 'fair', invoicedOn: null, invoiceRef: '' }))
    server.put('quote', 'q3', quote({ id: 'q3', projectId: 'gone', invoicedOn: null, invoiceRef: '' }))
    const phone = await new SyncClient({ storage: new MemoryStorage(), transport: server, clientId: 'phone' }).open()
    await phone.sync()
    let m = phone.view().money
    // Accepted on both live jobs, invoiced on one: the cancelled job's isn't owed, quoted or in the margin.
    expect(m.owed).toMatchObject([{ client: 'Brightwater Events', cents: 2 * 145700, invoiced: 145700 }])
    expect(m.owed[0]!.quotes.map((x) => x.job.name)).toEqual(['Autumn Gala', 'Craft Fair'])
    expect(m.job('gone')).toMatchObject({ setAside: true, quoted: 0, margin: null })
    expect(m.months.reduce((s, x) => s + x.confirmed, 0)).toBe(240000)
    // A cancellation fee is invoiced, and then it counts in all three.
    await phone.mutate('quote.invoiced', { id: 'q3', on: '2026-10-20', ref: 'SH-1050' })
    m = phone.view().money
    expect(m.owed[0]).toMatchObject({ cents: 3 * 145700, invoiced: 2 * 145700 })
    expect(m.job('gone')).toMatchObject({ setAside: false, quoted: 120000, margin: 120000 })
    expect(m.months.reduce((s, x) => s + x.confirmed, 0)).toBe(360000)
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

describe('margin by job (audit finding 31)', () => {
  const jm = (name: string, start: string | null, margin: number | null, costs = 0) =>
    ({ job: { id: name, name, span: start ? { start, end: start } : undefined }, current: margin === null ? undefined : {}, costs, margin }) as unknown as JobMoney

  it('groups by the month each job starts: this month, then those coming, then those gone, the latest first', () => {
    const jobs = [jm('Jan', '2026-01-10', 100), jm('Oct', '2026-10-05', 100), jm('Dec', '2026-12-01', 100), jm('Sep', '2026-09-30', 100), jm('Nov', '2026-11-02', 100), jm('Costs only', '2026-08-01', null, 500), jm('Nothing', '2026-08-01', null)]
    expect(marginsByMonth(jobs, '2026-10-29').map((m) => [m.key, m.jobs.map((j) => j.job.name)])).toEqual([
      ['2026-10', ['Oct']],
      ['2026-11', ['Nov']],
      ['2026-12', ['Dec']],
      ['2026-09', ['Sep']],
      ['2026-08', ['Costs only']],
      ['2026-01', ['Jan']],
    ])
  })

  it('names the jobs below zero, the most lost first', () => {
    const jobs = [jm('Fine', '2026-10-01', 100), jm('Bit under', '2026-03-01', -27000), jm('Well under', '2026-10-01', -90000), jm('No quote', '2026-10-01', null, 500)]
    expect(belowZero(jobs).map((j) => j.job.name)).toEqual(['Well under', 'Bit under'])
  })
})

describe('every quote in one list (ADR 0088)', () => {
  const job = (id: string, client?: string) => ({ id, name: id, status: 'quoted', client: client ? { name: client } : undefined }) as JobView
  const quote = (over: Partial<QuoteView>) =>
    ({ id: over.id ?? 'q', status: 'sent', sentOn: null, answeredOn: null, invoicedOn: null, paidOn: null, invoiceRef: '', number: null, savedAt: '2026-10-20T10:00:00Z', ...over }) as QuoteView

  it("lists each job's draft, or else the quote that counts, the last changed first", () => {
    const drafts = new Map([['Second go', quote({ id: 'd', status: 'draft', savedAt: '2026-10-26T09:00:00Z' })]])
    const rows = quoteRows({
      jobs: [
        { job: job('Paid lately', 'Liffey Brands'), current: quote({ status: 'accepted', number: 1115, invoicedOn: '2026-10-22', paidOn: '2026-10-27', invoiceRef: 'SH-1050' }) },
        { job: job('Second go'), current: quote({ id: 'v1', number: 1116, sentOn: '2026-10-01' }) },
        { job: job('Costs only'), current: undefined },
        { job: job('Sent'), current: quote({ sentOn: '2026-10-21' }) },
      ] as never,
      draftOf: (id) => drafts.get(id),
    })
    expect(rows.map((r) => [r.job.name, r.quote.status, r.changed])).toEqual([
      ['Paid lately', 'accepted', '2026-10-27'],
      ['Second go', 'draft', '2026-10-26'],
      ['Sent', 'sent', '2026-10-21'],
    ])
    expect(rows[1]!.behind?.id).toBe('v1')

    // Narrowed by what it is, and found by the client, the number of the version sent, or the invoice.
    expect(rows.filter((r) => quoteRowShown(r, 'accepted', '')).map((r) => r.job.name)).toEqual(['Paid lately'])
    expect(rows.filter((r) => quoteRowShown(r, 'all', 'liffey')).map((r) => r.job.name)).toEqual(['Paid lately'])
    expect(rows.filter((r) => quoteRowShown(r, 'all', '1116')).map((r) => r.job.name)).toEqual(['Second go'])
    expect(rows.filter((r) => quoteRowShown(r, 'all', 'sh-1050')).map((r) => r.job.name)).toEqual(['Paid lately'])
    expect(rows.filter((r) => quoteRowShown(r, 'sent', 'liffey'))).toEqual([])
  })
})
