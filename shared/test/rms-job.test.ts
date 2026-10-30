import { describe, expect, it } from 'vitest'
import { matcherFor, rmsJobDraft, rmsRule, rmsSuggestions, suggestionLine, withModel, type Pricing, type RmsLine, type RmsOpportunity } from '../src/index.ts'

/**
 * A job made from a past quote from Current RMS (ADR 0102): its lines as a
 * draft quote's here, matched to the stock list and charged as they were.
 */

const STOCK = [
  { id: 'tiger', name: 'Avolites Tiger Touch 2', department: 'lighting' as const },
  { id: 'p5', name: 'SGM P5', department: 'lighting' as const },
]
const pricing: Pricing = {
  matcher: matcherFor(STOCK),
  model: (id) => STOCK.find((x) => x.id === id),
  productPrice: (id) => ({ tiger: 20_000, p5: 9_000 })[id],
  productRate: () => 'daily',
  rolePrice: (role) => (role === 'Sound engineer' ? 45_000 : undefined),
  roles: ['Sound engineer'],
}

let n = 0
const line = (l: Partial<RmsLine>): RmsLine => ({
  id: ++n,
  opportunityId: 10,
  path: '0001-0001',
  kind: 'Principal',
  transaction: 'Rental',
  itemType: 'Product',
  itemId: null,
  name: '',
  description: '',
  quantity: 1,
  priceCents: 0,
  discountPct: 0,
  chargeableDays: 1,
  rateDefinition: '',
  period: '',
  unitCents: 0,
  totalCents: 0,
  taxCents: 0,
  subRent: false,
  startsAt: null,
  endsAt: null,
  ...l,
})

const LINES = [
  line({ path: '0001', kind: 'Group', name: 'Lighting', transaction: '', itemType: '', totalCents: 22_400 }),
  line({ path: '0001-0001', name: 'Avolites Tiger Touch 2', priceCents: 15_000, discountPct: 60, chargeableDays: 5, rateDefinition: 'Weekly Rate', unitCents: 6_000, totalCents: 6_000 }),
  line({ path: '0001-0001-0001', kind: 'Accessory', name: 'Desk cover', priceCents: 0 }),
  line({ path: '0001-0002', name: 'Sgm P5', quantity: 4, priceCents: 8_000, discountPct: 60, chargeableDays: 5, rateDefinition: '3 Day Week Rate', unitCents: 9_600, totalCents: 38_400 }),
  line({ path: '0001-0003', name: 'Hazer we hired in', priceCents: 0, chargeableDays: 5, rateDefinition: 'Daily Rate' }),
  line({ path: '0002', kind: 'Group', name: 'Crew', transaction: '', itemType: '' }),
  line({ path: '0002-0001', transaction: 'Service', itemType: 'Service', name: 'Sound Engineer', quantity: 2, priceCents: 40_000, chargeableDays: 2, unitCents: 80_000, totalCents: 160_000 }),
  line({ path: '0002-0002', itemType: 'TextItem', name: 'Lighting package', priceCents: 50_000, chargeableDays: 4, rateDefinition: '3 Day Week Rate', unitCents: 150_000, totalCents: 150_000 }),
  line({ path: '0003', transaction: 'Sale', itemType: 'TextItem', name: 'Gaffer tape', quantity: 3, priceCents: 900, chargeableDays: 0, unitCents: 900, totalCents: 2_700 }),
]

describe("a past quote's lines", () => {
  const offered = rmsSuggestions(LINES, pricing)
  const by = (said: string) => offered.find((o) => o.s.said === said)!

  it('leaves out groups and the accessories that came free with a product', () => {
    expect(offered.map((o) => o.s.said)).toEqual(['Avolites Tiger Touch 2', 'Sgm P5', 'Hazer we hired in', 'Sound Engineer', 'Lighting package', 'Gaffer tape'])
  })

  it('matches products to the stock list and charges them as Current RMS did', () => {
    const tiger = by('Avolites Tiger Touch 2').s
    expect(tiger).toMatchObject({ kind: 'kit', modelId: 'tiger', cents: 15_000, rate: 'weekly', days: 5, discountPct: 60, group: 'Lighting' })
    expect(suggestionLine(tiger, 'a')).toMatchObject({ unitCents: 15_000, rate: 'weekly', out: 5, days: 1, discountPct: 60, modelId: 'tiger' })
    const p5 = suggestionLine(by('Sgm P5').s, 'b')
    expect(p5).toMatchObject({ modelId: 'p5', qty: 4, unitCents: 8_000, rate: 'week3', out: 5, days: 3 })
  })

  it('keeps the price charged when another product is picked', () => {
    const tiger = by('Avolites Tiger Touch 2').s
    expect(withModel(pricing, tiger, 'p5')).toMatchObject({ modelId: 'p5', cents: 15_000, rate: 'weekly' })
    expect(withModel(pricing, tiger, null)).toMatchObject({ modelId: null, what: 'Avolites Tiger Touch 2', cents: 15_000 })
  })

  it('offers lines charged nothing unticked', () => {
    expect(by('Hazer we hired in').take).toBe(false)
    expect(offered.filter((o) => o.take)).toHaveLength(5)
  })

  it('makes services crew, typed lines as written, and things sold charged once', () => {
    expect(by('Sound Engineer').s).toMatchObject({ kind: 'crew', what: 'Sound engineer', qty: 2, days: 2, cents: 40_000, per: 'day' })
    expect(suggestionLine(by('Lighting package').s, 'c')).toMatchObject({ kind: 'other', rate: 'week3', out: 4, days: 3, unitCents: 50_000 })
    expect(suggestionLine(by('Gaffer tape').s, 'd')).toMatchObject({ kind: 'other', per: 'once', days: 1, qty: 3, unitCents: 900 })
  })

  it('reads the rate definitions', () => {
    expect([rmsRule('Weekly Rate'), rmsRule('3 Day Week Rate'), rmsRule('Daily Rate'), rmsRule('Catering')]).toEqual(['weekly', 'week3', 'daily', undefined])
  })
})

const opp = (o: Partial<RmsOpportunity>): RmsOpportunity => ({
  id: 10, number: '0000001043', subject: 'Nissan launch', client: 'Verve Live', venue: 'RDS', state: 'Order', status: 'Active',
  startsAt: '2026-11-04T23:30:00Z', endsAt: '2026-11-06T18:00:00Z', netCents: 0, grossCents: 0, rentalCents: 0, saleCents: 0, serviceCents: 0,
  surchargeCents: 0, taxCents: 0, undiscountedCents: 0, chargeableDays: 2, discountCategory: '', priceCategory: '', tags: [], createdAt: null, updatedAt: null, ...o,
})

describe('the job a past quote makes', () => {
  it('takes its name, the client as spelt here, and its days in Ireland', () => {
    const d = rmsJobDraft(opp({ netCents: 6_000 }), [LINES[1]!], ['Verve'], '2026-10-30')
    expect(d).toEqual({ name: 'Nissan launch', client: 'Verve', venue: 'RDS', start: '2026-11-04', end: '2026-11-06', status: 'confirmed', agreedCents: null })
  })

  it('is an enquiry unless it was an order, and keeps a total agreed on the whole', () => {
    const d = rmsJobDraft(opp({ state: 'Quotation', status: 'Provisional', netCents: 5_000 }), [LINES[1]!], [], '2026-10-30')
    expect(d).toMatchObject({ client: 'Verve Live', status: 'enquiry', agreedCents: 5_000 })
  })

  it('starts today with no days', () => {
    expect(rmsJobDraft(opp({ startsAt: null, endsAt: null, subject: '' }), [], [], '2026-10-30')).toMatchObject({ name: '0000001043', start: '2026-10-30', end: '2026-10-30' })
  })
})
