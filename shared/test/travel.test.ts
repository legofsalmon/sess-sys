import { describe, expect, it } from 'vitest'
import { quoteLine, quoteTotals, versionChanges, type QuoteLine } from '../src/quotes.ts'
import { crewDays, DUBLIN_CENTRE, extrasFor, fuelCents, kmBetween, roadKmFromDublin, travelSettingsOf } from '../src/travel.ts'

/**
 * Travel and subsistence (ADR 0086): how far a venue is from Dublin city
 * centre, the fuel there and back, the crew's days, and the two lines a
 * quote works out for itself, or why it hasn't one.
 */

const crew = (l: Partial<QuoteLine> = {}): QuoteLine => ({ id: 'c', kind: 'crew', what: 'Audio tech', ref: null, group: 'Crew', qty: 2, days: 3, unitCents: 40000, vat: '23', per: 'day', ...l })
const GALWAY = { lat: 53.2707, lng: -9.0568 }
const NAAS = { lat: 53.2159, lng: -6.6669 }
const set = travelSettingsOf({ travelFromKm: 50, fuelCentsPerLitre: 174.9, litresPer100Km: 10, perDiemCents: 3908, fuelSetOn: '2026-10-28' })
let n = 0
const newId = () => `new-${++n}`
const extras = (o: Partial<Parameters<typeof extrasFor>[0]> = {}) =>
  extrasFor({ lines: [crew()], settings: set, pin: GALWAY, typedKm: null, mealsProvided: false, ids: {}, newId, ...o })

describe('how far a venue is (ADR 0086)', () => {
  it('measures from Dublin city centre, a quarter more for the roads', () => {
    expect(kmBetween(DUBLIN_CENTRE, DUBLIN_CENTRE)).toBe(0)
    // Galway is about 187 km as the crow flies and about 208 by the M6, which a fifth more comes near.
    expect(Math.round(kmBetween(DUBLIN_CENTRE, GALWAY))).toBe(186)
    expect(roadKmFromDublin(GALWAY)).toBe(223)
    expect(roadKmFromDublin(NAAS)).toBe(37)
  })

  it('charges the fuel there and back, to the cent', () => {
    // 2 × 100 km at 10 l/100 km is 20 litres, at €1.749.
    expect(fuelCents(100, set)).toBe(3498)
  })
})

describe("a quote's travel and subsistence (ADR 0086)", () => {
  it("charges the crew's travel past the distance set, a car trip each crew day, and subsistence for each crew day", () => {
    const e = extras()
    expect(e.lines.map((l) => [l.extra, l.what, l.qty, l.unitCents, l.per])).toEqual([
      ['travel', 'Crew travel, 223 km each way from Dublin, 6 car trips', 6, fuelCents(223, set), 'once'],
      ['subsistence', 'Crew subsistence, 6 crew days', 6, 3908, 'day'],
    ])
    for (const l of e.lines) expect(quoteLine.safeParse(l).success).toBe(true)
    expect(e.travel).toMatchObject({ km: 223, from: 'map', none: null })
  })

  it('takes a distance typed on the quote over the map, and charges nothing within the distance', () => {
    expect(extras({ typedKm: 210 }).lines[0]).toMatchObject({ what: 'Crew travel, 210 km each way from Dublin, 6 car trips', qty: 6 })
    // Crew sharing cars, three to a car: 6 crew days are two car loads.
    expect(extras({ settings: { ...set, crewPerCar: 3 } }).lines[0]).toMatchObject({ what: 'Crew travel, 223 km each way from Dublin, 2 car trips', qty: 2 })
    expect(extras({ lines: [crew({ qty: 1, days: 1 })] }).lines[0]!.what).toBe('Crew travel, 223 km each way from Dublin, 1 car trip')
    const near = extras({ pin: NAAS })
    expect(near.lines.map((l) => l.extra)).toEqual(['subsistence'])
    expect(near.travel.none).toBe('37 km from Dublin city centre, so within the 50 km travel starts after.')
    expect(extras({ pin: null }).travel.none).toMatch(/isn't on the map/)
    expect(extras({ pin: null, typedKm: 120 }).travel).toMatchObject({ km: 120, from: 'typed', none: null })
  })

  it('charges no subsistence when the job provides meals, or with no crew', () => {
    expect(extras({ mealsProvided: true }).lines.map((l) => l.extra)).toEqual(['travel'])
    expect(extras({ mealsProvided: true }).subsistence.none).toBe('The job gives the crew their meals.')
    expect(extras({ lines: [] }).subsistence.none).toBe('No crew on the quote yet.')
    expect(extras({ lines: [] }).travel.none).toBe('No crew on the quote yet.')
  })

  it("charges nothing for a price that isn't set yet, and says where to set it", () => {
    const none = extrasFor({ lines: [crew()], settings: travelSettingsOf(undefined), pin: GALWAY, typedKm: null, mealsProvided: false, ids: {}, newId })
    expect(none.lines).toEqual([])
    expect(none.travel.none).toMatch(/No fuel price set yet/)
    expect(none.subsistence.none).toMatch(/No per diem set yet/)
    expect(none.travel.trips).toBe(6)
  })

  it('counts a half day as a day for meals, and leaves its own lines out of the count', () => {
    expect(crewDays([crew({ qty: 3, days: 1.5 }), crew({ qty: 1, days: 2 }), { ...crew({ qty: 6 }), kind: 'other', extra: 'subsistence' }])).toBe(8)
  })

  it('keeps the ids it had, so a draft with them reads as saved, and matches them across versions', () => {
    const was = extras({ ids: { travel: 't1', subsistence: 's1' } })
    expect(was.lines.map((l) => l.id)).toEqual(['t1', 's1'])
    const now = extras({ lines: [crew({ qty: 3 })], ids: { travel: 't2', subsistence: 's2' } })
    const changes = versionChanges({ lines: was.lines, discountPct: 0 }, { lines: now.lines, discountPct: 0 })
    expect(changes.added).toEqual([])
    expect(changes.changed.map((c) => c.line.extra)).toEqual(['travel', 'subsistence'])
  })

  it('counts in the totals and an agreed price like any line', () => {
    const lines = [crew(), ...extras().lines]
    const t = quoteTotals({ lines, discountPct: 0 })
    expect(t.subtotal).toBe(240000 + 6 * fuelCents(223, set) + 6 * 3908)
  })
})
