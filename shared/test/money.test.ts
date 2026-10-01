import { describe, expect, it } from 'vitest'
import { EURO_HINT, euroText, parseEuro } from '../src/money.ts'

/**
 * Money as people type it (audit finding 15): what each way of writing a
 * price comes to in cents, what nothing typed means, and the plain words
 * for anything that isn't a price.
 */

describe('a price typed in', () => {
  it('reads plain numbers, with a comma or a dot before the cents', () => {
    expect(parseEuro('250')).toEqual({ cents: 25000 })
    expect(parseEuro('250.5')).toEqual({ cents: 25050 })
    expect(parseEuro('250,5')).toEqual({ cents: 25050 })
    expect(parseEuro('250.50')).toEqual({ cents: 25050 })
    expect(parseEuro('12,50')).toEqual({ cents: 1250 })
    expect(parseEuro('0')).toEqual({ cents: 0 })
    expect(parseEuro('.50')).toEqual({ cents: 50 })
    // A trailing dot is a slip, not a price of nothing.
    expect(parseEuro('250.')).toEqual({ cents: 25000 })
  })

  it('takes a euro sign before or after, with or without a space', () => {
    expect(parseEuro('€250')).toEqual({ cents: 25000 })
    expect(parseEuro('€ 250')).toEqual({ cents: 25000 })
    expect(parseEuro('250 €')).toEqual({ cents: 25000 })
    expect(parseEuro('EUR 250')).toEqual({ cents: 25000 })
    expect(parseEuro('250 eur')).toEqual({ cents: 25000 })
    expect(parseEuro(' 250 ')).toEqual({ cents: 25000 })
  })

  it('reads thousands split by a comma, a dot or a space, since cents are never three digits', () => {
    // The audit's case: this was €1.25.
    expect(parseEuro('1,250')).toEqual({ cents: 125000 })
    expect(parseEuro('€1,250')).toEqual({ cents: 125000 })
    expect(parseEuro('1.250')).toEqual({ cents: 125000 })
    expect(parseEuro('1 250')).toEqual({ cents: 125000 })
    expect(parseEuro('1 250,50')).toEqual({ cents: 125050 })
    expect(parseEuro('1,250.50')).toEqual({ cents: 125050 })
    expect(parseEuro('1.250,50')).toEqual({ cents: 125050 })
    expect(parseEuro('1,250,000')).toEqual({ cents: 125000000 })
    expect(parseEuro('1 250 000')).toEqual({ cents: 125000000 })
    expect(parseEuro('1 250.50')).toEqual({ cents: 125050 })
    expect(parseEuro('12,500')).toEqual({ cents: 1250000 })
  })

  it('does not drop a space between digits that are not thousands, since "12 50" is not €1,250', () => {
    // A slip for "12.50" on a phone keyboard would otherwise be a hundred times the price, and saved.
    for (const typed of ['12 50', '2 50', '1 2 3', '1 250 50', '1 2500', '1,250 000'])
      expect(parseEuro(typed), typed).toEqual({ reason: EURO_HINT })
  })

  it('means nothing typed by null, so a rate can be left to agree', () => {
    expect(parseEuro('')).toEqual({ cents: null })
    expect(parseEuro('   ')).toEqual({ cents: null })
    expect(parseEuro('€')).toEqual({ cents: null })
  })

  it('refuses anything that is not a price, in words that say what to put in', () => {
    for (const typed of ['abc', '€abc', '12..5', '1,2,3', '250.500.1', '1234,567', '1,25,000', '12,5.00', '1.250.5', '1.2.3,4', '250.123.4'])
      expect(parseEuro(typed), typed).toEqual({ reason: EURO_HINT })
    expect(parseEuro('-5')).toEqual({ reason: "A price can't be less than nothing." })
    expect(parseEuro('1234567890123')).toEqual({ reason: "That's more than a price could be." })
  })

  it('writes cents back the way a form shows them', () => {
    expect(euroText(25000)).toBe('250')
    expect(euroText(25050)).toBe('250.50')
    expect(euroText(5)).toBe('0.05')
    expect(euroText(0)).toBe('0')
  })
})
