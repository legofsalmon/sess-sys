import { describe, expect, it } from 'vitest'
import { irishToday } from '../src/calendar.ts'
import { HOLDING, OFFER_STATUSES, type CrewCall, type Offer, type Person } from '../src/crew.ts'
import type { Inspection } from '../src/inspections.ts'
import { monthsLater } from '../src/inspections.ts'
import type { Phase, Project } from '../src/jobs.ts'
import type { KitLine } from '../src/kit.ts'
import { DEPARTMENTS, type Asset, type Model, type Place } from '../src/stock.ts'
import { crewView } from '../src/sync/crew-view.ts'
import { inspectionsView } from '../src/sync/inspections-view.ts'
import { jobsView } from '../src/sync/jobs-view.ts'
import { kitView } from '../src/sync/kit-view.ts'
import { movesView } from '../src/sync/pick-view.ts'
import { warehouseView } from '../src/sync/stock-view.ts'

/**
 * The three hotspots of the device's data model, each reworked to do its
 * work once rather than once per record, give the same answer as the plain
 * way they replaced, on a made-up fixture bigger than the seed: offers
 * gathered by call once, against looking through every offer for every
 * call; one date formatter, against one made per inspection; one collator,
 * against one made per comparison, on the names that tell them apart
 * (case, accents and numbers).
 */

/** A small fixed pseudo-random source, so the fixture is the same every run. */
function random(seed: number) {
  let s = seed
  return () => (s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296
}
const pick = <T>(rnd: () => number, from: readonly T[]) => from[Math.floor(rnd() * from.length)]!
const table = <T extends { id: string }>(rows: readonly T[]): Record<string, T> => Object.fromEntries(rows.map((r) => [r.id, r]))
const day = (n: number) => `2026-10-${String(n).padStart(2, '0')}`

const NAMES = ['Aoife', 'áine', 'Brian', 'Ciarán', 'ciara', 'Dónal', 'Éabha', 'eoin', 'Niamh', 'Órla', 'oisín', 'Pádraig', 'Róisín', 'Séan', 'sinéad', 'Tadhg']

const model = (id: string, name: string, extra: Partial<Model> = {}): Model => ({
  id,
  name,
  department: 'audio',
  category: '',
  tracking: 'serialised',
  isCase: false,
  valueCents: null,
  notes: '',
  patMonths: null,
  liftingMonths: null,
  ...extra,
})
const asset = (id: string, modelId: string, placeId: string | null): Asset => ({
  id,
  modelId,
  number: `SH-${id.padStart(6, '0')}`,
  formerNumbers: [],
  serial: '',
  placeId,
  caseId: null,
  status: 'active',
  retiredReason: null,
  retiredNote: null,
  notes: '',
})
const place = (id: string, name: string): Place => ({ id, name, notes: '' })
const project = (id: string, name: string): Project => ({ id, name, clientId: null, venueId: null, status: 'confirmed', notes: '' })
const phase = (id: string, projectId: string, name: string, start: string, end: string): Phase => ({ id, projectId, name, start, end, venueId: null, notes: '' })

describe('crew: each call’s offers, gathered once', () => {
  it('match looking through every offer for every call, in order, with the same days held', () => {
    const rnd = random(7)
    const people: Person[] = NAMES.map((name, i) => ({ id: `p${i}`, name, kind: 'freelancer', email: null, phone: null, skills: [], dayRateCents: null, notes: '', linkToken: '', archived: false }))
    const calls: CrewCall[] = Array.from({ length: 60 }, (_, i) => {
      const start = 1 + Math.floor(rnd() * 25)
      return {
        id: `c${i}`,
        projectId: null,
        phaseId: null,
        project: `Job ${i % 9}`,
        phase: '',
        venue: '',
        role: 'Tech',
        start: day(start),
        end: day(start + Math.floor(rnd() * 4)),
        callTime: null,
        needed: 1 + Math.floor(rnd() * 3),
        dayRateCents: null,
        details: '',
        replyBy: null,
        // A cancelled call keeps its offers, and still shows them.
        status: i % 7 === 3 ? 'cancelled' : 'open',
      }
    })
    // Some whose call is gone: never shown, either way.
    const orphans = 5
    const offers: Offer[] = Array.from({ length: 400 + orphans }, (_, i) => {
      const c = i < 400 ? pick(rnd, calls) : { ...calls[0]!, id: 'gone' }
      const span = Number(c.end.slice(-2)) - Number(c.start.slice(-2)) + 1
      const days = Array.from({ length: span }, (_, d) => day(Number(c.start.slice(-2)) + d)).filter(() => rnd() > 0.3)
      return {
        id: `o${i}`,
        callId: c.id,
        personId: pick(rnd, people).id,
        status: pick(rnd, OFFER_STATUSES),
        days: days.length ? days : [c.start],
        dayRateCents: null,
        counterRateCents: null,
        note: '',
        respondedAt: null,
        respondedVia: null,
        override: false,
        seenAt: null,
      }
    })
    const view = crewView({ person: table(people), crewCall: table(calls), offer: table(offers) }, [], 0)
    const person = new Map(people.map((p) => [p.id, { ...p, pending: false }]))
    // The same order the view uses: live answers first, then the ones that are over.
    const rank = (s: Offer['status']) => ['confirmed', 'accepted', 'countered', 'offered', 'pulled-out', 'declined', 'filled', 'cancelled'].indexOf(s)
    let seen = 0
    for (const c of view.calls) {
      // The plain way: every offer looked through for this call, then sorted the same way.
      const plain = offers
        .filter((o) => o.callId === c.id)
        .map((o) => ({ ...o, pending: false, person: person.get(o.personId) }))
        .sort((a, b) => rank(a.status) - rank(b.status) || (a.person?.name ?? '').localeCompare(b.person?.name ?? ''))
      expect(c.offers).toEqual(plain)
      const heldByDay: Record<string, number> = {}
      for (const d of c.days) heldByDay[d] = plain.filter((o) => HOLDING.includes(o.status) && o.days.includes(d)).length
      expect(c.heldByDay).toEqual(heldByDay)
      expect(c.openDays).toEqual(c.days.filter((d) => heldByDay[d]! < c.needed))
      seen += c.offers.length
    }
    expect(seen).toBe(offers.length - orphans)
    // The fixture is big enough to mean something: calls with several offers, in more than one status, some cancelled.
    expect(view.calls.filter((c) => c.offers.length > 3).length).toBeGreaterThan(20)
    expect(view.calls.filter((c) => c.status === 'cancelled' && c.offers.length > 0).length).toBeGreaterThan(3)
  })
})

describe('inspections: one date formatter', () => {
  it('gives each record the day in Ireland that a formatter made for it would, across midnight and the clocks changing', () => {
    const at = [
      // The clocks go forward on 29 March 2026 at 01:00 UTC, and back on 25 October at 01:00 UTC.
      '2026-03-28T23:30:00Z',
      '2026-03-29T00:30:00Z',
      '2026-03-29T01:30:00Z',
      '2026-06-30T23:30:00Z',
      '2026-07-01T00:30:00+01:00',
      '2026-10-24T23:30:00Z',
      '2026-10-25T00:30:00Z',
      '2026-10-25T01:30:00Z',
      '2026-12-31T23:59:59Z',
      '2027-01-01T00:00:00Z',
      '2026-10-01T12:00:00.000Z',
      // A time that isn't one reads as it did before, rather than throwing (a fail, so nothing is due from it).
      'not a time',
    ]
    const models = [model('m1', 'Shure SM58', { patMonths: 12 }), model('m2', 'Lifting sling', { department: 'rigging', liftingMonths: 6 })]
    const assets = at.map((_, i) => asset(String(i + 1), i % 2 ? 'm2' : 'm1', null))
    const inspections: Inspection[] = at.map((when, i) => ({ id: `i${i}`, assetId: assets[i]!.id, kind: i % 2 ? 'lifting' : 'pat', passed: when !== 'not a time', at: when, by: 'Test Co', note: '' }))
    const warehouse = warehouseView({ model: table(models), asset: table(assets) }, [], 0)
    const view = inspectionsView({ inspection: table(inspections) }, [], 0, warehouse, '2026-10-01')
    for (const i of inspections) {
      const [record] = view.ofAsset(i.assetId)
      expect(record?.day).toBe(irishToday(new Date(i.at)))
    }
    // And what's due is worked out from that day.
    const [due] = view.dueOf('4')
    expect(due).toMatchObject({ kind: 'lifting', due: monthsLater('2026-07-01', 6), state: 'ok' })
    // Midnight in Ireland is not midnight UTC in summer: the fourth record is on 1 July, not 30 June.
    expect(view.ofAsset('4')[0]?.day).toBe('2026-07-01')
    expect(view.ofAsset('1')[0]?.day).toBe('2026-03-28')
    expect(view.ofAsset('12')[0]?.day).toBe('Invalid Date')
  })
})

describe('kit and pick lists: one collator', () => {
  const products = ['d&b Y10P', 'D&B V7P', 'éclairage LED', 'Eclairage bar', 'Zoom H6', 'zoom h5', 'Amp rack', 'amp Rack 2', 'Ólafur light', 'Olafur stand', 'XLR 10 m', 'XLR 5 m']

  it('orders a job’s kit as a collator made per comparison would', () => {
    const rnd = random(11)
    const models = products.map((name, i) => model(`m${i}`, name, { department: pick(rnd, DEPARTMENTS) }))
    const job = project('j1', 'Harbour Lights')
    const phases = [phase('ph1', 'j1', 'Load in', '2026-10-03', '2026-10-04'), phase('ph2', 'j1', 'Show', '2026-10-05', '2026-10-06')]
    const lines: KitLine[] = Array.from({ length: 80 }, (_, i) => ({
      id: `k${String(i).padStart(2, '0')}`,
      projectId: 'j1',
      phaseId: pick(rnd, [null, 'ph1', 'ph2']),
      modelId: pick(rnd, models).id,
      qty: 1 + Math.floor(rnd() * 4),
      subhireQty: 0,
      supplier: '',
      notes: '',
    }))
    const warehouse = warehouseView({ model: table(models) }, [], 0)
    // The Stock tab's own order of products, which was the biggest cost of all at a few hundred products.
    expect(warehouse.models.map((m) => m.name)).toEqual(
      [...products].sort((a, b) => a.localeCompare(b, 'en-IE', { sensitivity: 'base' }) || a.localeCompare(b))
    )
    const jobs = jobsView({ project: table([job]), phase: table(phases) }, [], 0, [])
    const kit = kitView({ kitLine: table(lines) }, [], 0, jobs, warehouse, '2026-10-01')
    // The plain way: the same order, with a collator made for each comparison.
    const department = (l: (typeof kit.lines)[number]) => {
      const i = l.model ? DEPARTMENTS.indexOf(l.model.department) : -1
      return i < 0 ? DEPARTMENTS.length : i
    }
    const plain = [...kit.lines].sort(
      (a, b) =>
        department(a) - department(b) ||
        (a.model?.name ?? '').localeCompare(b.model?.name ?? '', 'en-IE', { sensitivity: 'base' }) ||
        (a.phaseId ? (a.phase?.start ?? '9999') : '').localeCompare(b.phaseId ? (b.phase?.start ?? '9999') : '') ||
        a.id.localeCompare(b.id)
    )
    expect(kit.byJob.get('j1')!.map((l) => l.id)).toEqual(plain.map((l) => l.id))
    // The order means something: case and accents don't split a product from its neighbour.
    const names = kit.byJob.get('j1')!.filter((l) => l.model?.department === kit.byJob.get('j1')![0]!.model?.department).map((l) => l.model!.name)
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b, 'en-IE', { sensitivity: 'base' })))
  })

  it('orders where to find kit as a collator made per comparison would, with numbers in order', () => {
    const wheres = ['Bay 10', 'Bay 2', 'Bay 1', 'bay 3', 'Van 1', 'Shelf 2B', 'Shelf 2A', 'Shelf 10', 'Shelf 9', 'Éire bay']
    const places = wheres.map((name, i) => place(`pl${i}`, name))
    const models = [model('m1', 'XLR 10 m')]
    const assets = wheres.flatMap((_, i) => [asset(`${i * 2 + 1}`, 'm1', `pl${i}`), asset(`${i * 2 + 2}`, 'm1', `pl${i}`)])
    const job = project('j1', 'Harbour Lights')
    const phases = [phase('ph1', 'j1', 'Show', '2026-10-05', '2026-10-06')]
    const lines: KitLine[] = [{ id: 'k1', projectId: 'j1', phaseId: null, modelId: 'm1', qty: 30, subhireQty: 0, supplier: '', notes: '' }]
    const warehouse = warehouseView({ model: table(models), asset: table(assets), place: table(places) }, [], 0)
    const jobs = jobsView({ project: table([job]), phase: table(phases) }, [], 0, [])
    const kit = kitView({ kitLine: table(lines) }, [], 0, jobs, warehouse, '2026-10-01')
    const moves = movesView({}, [], 0, jobs, warehouse, kit, '2026-10-01')
    const from = moves.pickList('j1')!.rows[0]!.from.map((f) => f.where)
    expect(from).toEqual([...wheres].sort((a, b) => a.localeCompare(b, 'en-IE', { numeric: true })))
    expect(from.indexOf('Bay 2')).toBeLessThan(from.indexOf('Bay 10'))
    expect(from.indexOf('Shelf 9')).toBeLessThan(from.indexOf('Shelf 10'))
  })
})
