import { encode } from 'uqr'
import { z } from 'zod'
import { text, whole } from './plain.ts'

/**
 * Printing labels (ADR 0015). Numbers are set aside a run at a time before
 * their labels are printed, here or by a label maker, so the next free
 * number the server gives out never lands on a label that isn't stuck on
 * yet. A run nobody has used can be cancelled, which takes it off the
 * list; its numbers are still never given out again, since its labels may
 * be printed already. Each label carries a QR code and its number in large
 * type; the QR code holds just the number, which any scanner, and the
 * Stock tab's search, reads back.
 */

const id = z.string().min(1).max(64)

/** The most numbers set aside at once: a big roll from a label maker. */
export const MAX_RUN = 10_000
/** The highest number there can be, since they're six digits. */
export const MAX_NUMBER = 999_999

/** A run of numbers set aside for printing labels. The numbers never change once set aside. */
export interface LabelRun {
  id: string
  /** The first number, as a whole number: 101 for SH-000101. Null on a device until the server has set them aside. */
  first: number | null
  /** How many numbers, one after another from the first. */
  count: number
  /** What they're for, such as "Polyester roll from Label World". */
  name: string
  notes: string
  /** When they were set aside. */
  createdAt: string
  /** Cancelled before any of its labels went on an item (audit finding 19): off the list, its numbers never given out again. */
  cancelled: boolean
}

export interface LabelEntities {
  labelRun: LabelRun
}
export const LABEL_ENTITY_NAMES = ['labelRun'] as const

const name = text(200, "What they're for")
const notes = text(2000, 'The notes')

export const labelCommandSchemas = {
  /** The next free numbers, as many as asked for. The server picks them, so two devices never get the same ones. */
  'labels.reserve': z.object({ id, count: whole(1, MAX_RUN, 'How many labels'), name, notes }),
  /** What a run is for. Its numbers stay as they are. */
  'labels.update': z
    .object({ id, name: name.optional(), notes: notes.optional() })
    .refine((u) => u.name !== undefined || u.notes !== undefined, { message: 'Nothing to change.' }),
  /** A run set aside by mistake, taken off the list; its numbers are never given out again. Refused once any of them is on an item. */
  'labels.cancel': z.object({ id }),
} as const

/** "SH-000123" from 123. */
export const numberText = (n: number) => `SH-${String(n).padStart(6, '0')}`

/** 123 from "SH-000123". */
export const numberValue = (number: string) => Number(number.slice(3))

/** Every number in a run, in order; none until the server has set them aside. */
export function runNumbers(run: Pick<LabelRun, 'first' | 'count'>, from = 0, upTo = run.count): string[] {
  if (run.first === null) return []
  const out: string[] = []
  for (let i = Math.max(0, from); i < Math.min(run.count, upTo); i++) out.push(numberText(run.first + i))
  return out
}

/**
 * What a label's QR code holds: its number, as `SH-000123`. It never goes
 * out of date, it's the smallest QR code there is, and the app reads it
 * back as it reads the same number typed.
 */
export const labelPayload = (number: string) => number

/**
 * A QR code for some text, as an SVG path on a grid `size` modules wide,
 * with no quiet zone: the label leaves the white space around it. Error
 * correction is at the highest level, H, which reads with up to 30% of the
 * code scuffed off; a number still fits the smallest code, 21 × 21.
 */
export function qrCode(text: string): { size: number; path: string } {
  const qr = encode(text, { ecc: 'H', border: 0 })
  let path = ''
  qr.data.forEach((row, y) => {
    // Each run of dark modules along a row is one rectangle, which keeps the path short.
    for (let x = 0; x < row.length; x++) {
      if (!row[x]) continue
      let end = x + 1
      while (row[end]) end++
      path += `M${x} ${y}h${end - x}v1h${x - end}z`
      x = end
    }
  })
  return { size: qr.size, path }
}

/**
 * A run's labels as a spreadsheet, one row per label, for a label maker or
 * a label printer's own software (P-touch Editor and ZebraDesigner both
 * print from one): the number to print, and what the QR code holds.
 */
export function labelsCsv(numbers: readonly string[]): string {
  return ['Number,QR code', ...numbers.map((n) => `${n},${labelPayload(n)}`)].map((row) => `${row}\r\n`).join('')
}

/**
 * Code 128 (set B), the long thin barcode for cable labels: run along a
 * cable its bars stay straight however tight the label wraps, where a QR
 * code bends. Each value's bars and spaces as module widths, bar first;
 * 103 to 105 start sets A, B and C, and the last is the stop.
 */
const CODE128 = [
  '212222', '222122', '222221', '121223', '121322', '131222', '122213', '122312', '132212', '221213',
  '221312', '231212', '112232', '122132', '122231', '113222', '123122', '123221', '223211', '221132',
  '221231', '213212', '223112', '312131', '311222', '321122', '321221', '312212', '322112', '322211',
  '212123', '212321', '232121', '111323', '131123', '131321', '112313', '132113', '132311', '211313',
  '231113', '231311', '112133', '112331', '132131', '113123', '113321', '133121', '313121', '211331',
  '231131', '213113', '213311', '213131', '311123', '311321', '331121', '312113', '312311', '332111',
  '314111', '221411', '431111', '111224', '111422', '121124', '121421', '141122', '141221', '112214',
  '112412', '122114', '122411', '142112', '142211', '241211', '221114', '413111', '241112', '134111',
  '111242', '121142', '121241', '114212', '124112', '124211', '411212', '421112', '421211', '212141',
  '214121', '412121', '111143', '111341', '131141', '114113', '114311', '411113', '411311', '113141',
  '114131', '311141', '411131', '211412', '211214', '211232', '2331112',
]
const START_B = 104
const STOP = 106

/** Whether some text fits a Code 128 barcode: letters, digits, spaces and the usual marks, up to 40 of them. */
export const barcodeFits = (text: string) => text.length > 0 && text.length <= 40 && /^[\x20-\x7e]+$/.test(text)

/**
 * A Code 128 barcode for some text, as an SVG path on a grid `width`
 * modules wide and one high, with no quiet zone: the label leaves the
 * white space either side. Null when the text won't go in one.
 */
export function barcode(text: string): { width: number; path: string } | null {
  if (!barcodeFits(text)) return null
  const values = [...text].map((c) => c.charCodeAt(0) - 32)
  const check = values.reduce((sum, v, i) => sum + v * (i + 1), START_B) % 103
  let x = 0
  let path = ''
  for (const v of [START_B, ...values, check, STOP]) {
    ;[...CODE128[v]!].forEach((w, i) => {
      // Even places are bars, odd are spaces.
      if (i % 2 === 0) path += `M${x} 0h${w}v1h-${w}z`
      x += Number(w)
    })
  }
  return { width: x, path }
}
