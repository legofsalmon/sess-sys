import { describe, expect, it } from 'vitest'
import { acrossAt, blanksFor, gapsOf, spanAcross, type RackSlot } from '../src/index.ts'

/** Building a rack up (ADR 0078): where narrower kit sits, the gaps left, and the blanks for them. */

const slot = (id: string, modelId: string, top: number | null, side: 'front' | 'rear' = 'front'): RackSlot => ({
  id,
  rackId: 'rack',
  modelId,
  top,
  side,
  qty: 1,
  notes: '',
  across: 'left',
  label: '',
  group: '',
  colour: null,
  inSlotId: null,
})

describe('a rack built up', () => {
  it('places half and third widths across the rails', () => {
    expect(spanAcross('full', 'right')).toEqual([0, 1])
    expect(spanAcross('half', 'right')).toEqual([0.5, 1])
    expect(spanAcross('half', 'middle')).toEqual([0.25, 0.75])
    expect(spanAcross('third', 'middle')[0]).toBeCloseTo(1 / 3)
    expect(acrossAt(0.1, 'half')).toBe('left')
    expect(acrossAt(0.5, 'half')).toBe('middle')
    expect(acrossAt(0.9, 'third')).toBe('right')
  })

  it('finds the empty units on a side and fills them with the tallest blanks that fit', () => {
    const models = new Map([
      ['amp', { id: 'amp', name: 'Amp', units: 2, depthMm: null, weightKg: null, powerW: null }],
      ['di', { id: 'di', name: 'DI', units: 1, depthMm: null, weightKg: null, powerW: null }],
    ])
    const gaps = gapsOf(8, [slot('a', 'amp', 1), slot('b', 'di', 6), slot('c', 'amp', 3, 'rear'), slot('d', 'di', null)], models, 'front')
    expect(gaps).toEqual([
      { top: 3, units: 3 },
      { top: 7, units: 2 },
    ])
    expect(blanksFor(gaps, [{ id: 'b1', units: 1 }, { id: 'b2', units: 2 }])).toEqual({
      put: [
        { modelId: 'b2', top: 3 },
        { modelId: 'b1', top: 5 },
        { modelId: 'b2', top: 7 },
      ],
      left: 0,
    })
    expect(blanksFor(gaps, [{ id: 'b2', units: 2 }]).left).toBe(1)
  })
})
