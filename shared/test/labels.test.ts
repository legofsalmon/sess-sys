import jsQR from 'jsqr'
import { describe, expect, it } from 'vitest'
import { labelPayload, labelsCsv, numberText, qrCode, runNumbers } from '../src/labels.ts'
import { normaliseNumber } from '../src/stock.ts'

/**
 * What goes on a label (ADR 0015): a QR code that any decoder reads back as
 * the number, and a run's numbers for a label maker.
 */

/** The QR code as a picture, 4 pixels a module inside the 4-module quiet zone a label leaves, read by a decoder as a camera would. */
function read(text: string): string | undefined {
  const { size, path } = qrCode(text)
  const dark = new Set<string>()
  // Walk the path back into modules: each part is a row's run of dark modules.
  for (const [, x, y, w] of path.matchAll(/M(\d+) (\d+)h(\d+)v1h-\d+z/g)) for (let i = 0; i < Number(w); i++) dark.add(`${Number(x) + i},${y}`)
  const scale = 4
  const quiet = 4
  const side = (size + quiet * 2) * scale
  const pixels = new Uint8ClampedArray(side * side * 4).fill(255)
  for (let py = 0; py < side; py++)
    for (let px = 0; px < side; px++) {
      const mx = Math.floor(px / scale) - quiet
      const my = Math.floor(py / scale) - quiet
      if (!dark.has(`${mx},${my}`)) continue
      const at = (py * side + px) * 4
      pixels[at] = pixels[at + 1] = pixels[at + 2] = 0
    }
  // jsqr is CommonJS, so its function is the module's default.
  return jsQR.default(pixels, side, side)?.data
}

describe('labels', () => {
  it('reads back as its number, from the first to the last', () => {
    for (const n of [1, 101, 4217, 123_456, 999_999]) {
      const number = numberText(n)
      expect(read(labelPayload(number))).toBe(number)
      expect(normaliseNumber(read(labelPayload(number))!)).toBe(number)
    }
  })

  it('is the smallest QR code, 21 modules square, at the highest error correction', () => {
    for (let n = 1; n <= 999_999; n += 37_037) expect(qrCode(labelPayload(numberText(n))).size).toBe(21)
  })

  it('reads back for a run of numbers', () => {
    const numbers = runNumbers({ first: 500, count: 60 })
    expect(numbers[0]).toBe('SH-000500')
    expect(numbers.at(-1)).toBe('SH-000559')
    for (const number of numbers) expect(read(labelPayload(number))).toBe(number)
  })

  it('lists part of a run, and none before the numbers are set aside', () => {
    expect(runNumbers({ first: 101, count: 500 }, 498)).toEqual(['SH-000599', 'SH-000600'])
    expect(runNumbers({ first: 101, count: 500 }, 0, 2)).toEqual(['SH-000101', 'SH-000102'])
    expect(runNumbers({ first: null, count: 500 })).toEqual([])
  })

  it('makes a spreadsheet for a label maker', () => {
    expect(labelsCsv(runNumbers({ first: 101, count: 3 }))).toBe(
      'Number,QR code\r\nSH-000101,SH-000101\r\nSH-000102,SH-000102\r\nSH-000103,SH-000103\r\n'
    )
  })
})
