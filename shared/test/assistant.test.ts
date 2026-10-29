import { describe, expect, it } from 'vitest'
import {
  adviceSuggestions,
  assistantBlocked,
  costCents,
  enquiryPhases,
  enquiryReading,
  enquirySuggestions,
  matcherFor,
  suggestionLine,
  withModel,
  type AssistantStatus,
  type EnquiryReading,
  type Pricing,
} from '../src/index.ts'

/**
 * Claude inside the app (ADR 0096): what it read of an enquiry, matched to
 * the stock list and priced from the price list on the device, as lines a
 * person takes onto a quote.
 */

const STOCK = [
  { id: 'y10p', name: 'd&b Y10P', department: 'audio' as const },
  { id: 'sm58', name: 'Shure SM58', department: 'audio' as const },
  { id: 'spiider', name: 'Robe Spiider', department: 'lighting' as const },
]
const pricing: Pricing = {
  matcher: matcherFor(STOCK),
  model: (id) => STOCK.find((x) => x.id === id),
  productPrice: (id) => ({ y10p: 4_000, sm58: 1_000 })[id],
  productRate: (id) => (id === 'y10p' ? 'week3' : undefined),
  rolePrice: (role) => (role === 'Sound engineer' ? 45_000 : undefined),
  roles: ['Sound engineer', 'Stage hand'],
}

const read = (r: Partial<EnquiryReading>): EnquiryReading =>
  enquiryReading.parse({ name: 'Launch', client: '', venue: '', start: '', end: '', phases: [], kit: [], crew: [], other: [], questions: [], summary: '', ...r })

describe('an enquiry read by Claude', () => {
  it('matches kit to the stock list, priced and named as the product is, and leaves the rest to choose', () => {
    const [y10, mics, haze] = enquirySuggestions(
      read({
        kit: [
          { qty: 8, what: 'Y10P', department: 'audio' },
          { qty: 4, what: 'SM58 mics', department: 'audio' },
          { qty: 1, what: 'Hazer', department: 'lighting' },
        ],
      }),
      pricing,
      3
    )
    expect(y10).toMatchObject({ what: 'd&b Y10P', said: 'Y10P', modelId: 'y10p', group: 'Audio', qty: 8, days: 3, cents: 4_000, rate: 'week3' })
    expect(mics).toMatchObject({ modelId: 'sm58', cents: 1_000, rate: null })
    expect(haze).toMatchObject({ what: 'Hazer', modelId: null, how: 'none', cents: undefined, group: 'Lighting' })
    // Choosing a product follows its name and price; choosing none goes back to the words.
    expect(withModel(pricing, haze!, 'spiider')).toMatchObject({ what: 'Robe Spiider', modelId: 'spiider', cents: undefined })
    expect(withModel(pricing, y10!, null)).toMatchObject({ what: 'Y10P', modelId: null, cents: undefined, rate: null })
  })

  it('names crew as the company does, priced by role, and charges the rest once', () => {
    const [sound, hands, van] = enquirySuggestions(read({ crew: [{ qty: 1, role: 'sound engineer', days: 2 }, { qty: 4, role: 'Stage hands', days: null }], other: [{ qty: 1, what: 'Van and driver' }] }), pricing, 3)
    expect(sound).toMatchObject({ kind: 'crew', what: 'Sound engineer', how: 'role', days: 2, cents: 45_000 })
    expect(hands).toMatchObject({ what: 'Stage hand', qty: 4, days: 3, cents: undefined })
    expect(van).toMatchObject({ kind: 'other', per: 'once', days: 1 })
  })

  it('goes on the quote as lines: a rule charges its days out, and no price is nothing', () => {
    const [y10, haze] = enquirySuggestions(read({ kit: [{ qty: 8, what: 'Y10P', department: 'audio' }, { qty: 1, what: 'Hazer', department: 'lighting' }] }), pricing, 7)
    expect(suggestionLine(y10!, 'a')).toMatchObject({ id: 'a', what: 'd&b Y10P', qty: 8, days: 3, out: 7, rate: 'week3', unitCents: 4_000, modelId: 'y10p', vat: '23' })
    expect(suggestionLine(haze!, 'b')).toMatchObject({ unitCents: 0, modelId: null, days: 7, per: 'day' })
  })

  it('gives its phases, or one Show across its days, or none without dates', () => {
    expect(enquiryPhases(read({ start: '2027-03-04', end: '2027-03-05' }))).toEqual([{ name: 'Show', start: '2027-03-04', end: '2027-03-05' }])
    expect(enquiryPhases(read({ start: '2027-03-04', end: '2027-03-01' }))).toEqual([{ name: 'Show', start: '2027-03-04', end: '2027-03-04' }])
    expect(enquiryPhases(read({ phases: [{ name: 'Build', start: '2027-03-03', end: '' }, { name: '', start: '2027-03-04', end: '2027-03-05' }] }))).toEqual([
      { name: 'Build', start: '2027-03-03', end: '2027-03-03' },
      { name: 'Show', start: '2027-03-04', end: '2027-03-05' },
    ])
    expect(enquiryPhases(read({}))).toEqual([])
  })
})

describe('changes Claude suggests to a quote', () => {
  it('prices what it adds from the price list unless the person said a price', () => {
    const [mics, pa] = adviceSuggestions(
      {
        note: '',
        add: [
          { kind: 'kit', what: 'SM58', department: 'audio', qty: 2, days: null, per: 'day', priceCents: null },
          { kind: 'kit', what: 'Y10P', department: 'audio', qty: 2, days: 1, per: 'day', priceCents: 2_500 },
        ],
        remove: [],
        change: [],
        discountPct: null,
      },
      pricing,
      2
    )
    expect(mics).toMatchObject({ modelId: 'sm58', days: 2, cents: 1_000 })
    expect(pa).toMatchObject({ modelId: 'y10p', days: 1, cents: 2_500 })
  })
})

describe('whether Claude can be asked', () => {
  const s: AssistantStatus = { configured: true, on: true, model: 'claude-opus-5-5', month: '2026-10', spentCents: 0, limitCents: 5_000, uses: 0 }
  it('says why not, in the office’s words', () => {
    expect(assistantBlocked(s)).toBeNull()
    expect(assistantBlocked(undefined)).toMatch(/signal/)
    expect(assistantBlocked({ ...s, configured: false })).toMatch(/set up/)
    expect(assistantBlocked({ ...s, on: false })).toMatch(/turned off/)
    expect(assistantBlocked({ ...s, spentCents: 5_000 })).toMatch(/limit/)
  })

  it('counts what an ask cost, rounded up, at Opus’s price for a model not listed', () => {
    expect(costCents('claude-opus-5-5', 10_000, 2_000)).toBe(8)
    expect(costCents('claude-haiku-5-5', 1_000, 100)).toBe(1)
    expect(costCents('claude-new', 10_000, 2_000)).toBe(8)
  })
})
