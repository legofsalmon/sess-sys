import { describe, expect, it } from 'vitest'
import { aliasesOf, findProducts, KitMatcher } from '../src/index.ts'

const p = (id: string, name: string, department: 'audio' | 'lighting' | 'power', category = '', aliases: string[] = []) => ({
  id,
  name,
  department,
  category,
  aliases,
})
const STOCK = [
  p('sm58', 'Shure SM58', 'audio', 'Mics', ['Beta 58', 'Fifty-eight']),
  p('sm57', 'Shure SM57', 'audio', 'Mics'),
  p('y10p', 'd&b Y10P', 'audio', 'Speakers', ['Wedge']),
  p('xlr10', 'XLR 10 m', 'audio', 'Cables'),
  p('spiider', 'Robe Spiider', 'lighting', 'Fixtures', ['Spider']),
  p('16a', '16A extension 10 m', 'power', 'Cables'),
]
const names = (typed: string) => findProducts(STOCK, typed).map((f) => f.product.id)

describe('finding a product as it is typed', () => {
  it('finds what is typed anywhere in the name, the name starting with it first', () => {
    expect(names('58')).toEqual(['sm58'])
    expect(names('shure')).toEqual(['sm57', 'sm58'])
    expect(names('sm 58')).toEqual(['sm58'])
    expect(names('SM-58')).toEqual(['sm58'])
    expect(names('ext')).toEqual(['16a'])
  })

  it('finds by another name, and says which', () => {
    expect(findProducts(STOCK, 'beta')).toEqual([{ product: STOCK[0], via: 'Beta 58' }])
    expect(findProducts(STOCK, 'spider')[0]).toEqual({
      product: STOCK[4],
      via: 'Spider',
    })
    expect(names('wedge')).toEqual(['y10p'])
  })

  it('needs every word, found in any field and any order', () => {
    expect(names('58 shure')).toEqual(['sm58'])
    expect(names('cable 10')).toEqual(['16a', 'xlr10'])
    expect(names('lighting')).toEqual(['spiider'])
    expect(names('shure wedge')).toEqual([])
  })

  it('puts a name before a word of a name, before a name holding it, before another name', () => {
    const list = [p('a', 'Wedge monitor', 'audio'), p('b', 'Floor wedge', 'audio'), p('c', 'Sidewedges', 'audio'), p('d', 'd&b M4', 'audio', '', ['Wedge M4'])]
    expect(findProducts(list, 'wedge').map((f) => f.product.id)).toEqual(['a', 'b', 'c', 'd'])
    expect(findProducts(list, '')).toEqual([])
  })
})

describe('other names as typed', () => {
  it('splits at commas, trims, keeps each once and leaves out the name', () => {
    expect(aliasesOf(' 58,  Beta   58, beta 58,, Shure SM58 ', 'Shure SM58')).toEqual(['58', 'Beta 58'])
  })
})

describe('Kit from the notes and other names', () => {
  const matcher = new KitMatcher(STOCK)
  it('matches a line written as another name as surely as the name', () => {
    expect(matcher.match('Beta 58')).toEqual({
      how: 'name',
      modelId: 'sm58',
      likely: ['sm58'],
    })
    expect(matcher.match('spider')).toEqual({
      how: 'name',
      modelId: 'spiider',
      likely: ['spiider'],
    })
  })
  it('never lets another name take the place of a product so named', () => {
    const m = new KitMatcher([p('a', 'Wedge', 'audio'), ...STOCK])
    expect(m.match('wedge').modelId).toBe('a')
  })
})
