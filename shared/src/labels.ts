import { encode } from 'uqr'
import { z } from 'zod'

/**
 * Printing labels (ADR 0015). Numbers are set aside a run at a time before
 * their labels are printed, here or by a label maker, so the next free
 * number the server gives out never lands on a label that isn't stuck on
 * yet. Each label carries a QR code and its number in large type; the QR
 * code holds just the number, which any scanner, and the Stock tab's
 * search, reads back.
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
}

export interface LabelEntities {
  labelRun: LabelRun
}
export const LABEL_ENTITY_NAMES = ['labelRun'] as const

const name = z.string().max(200)
const notes = z.string().max(2000)

export const labelCommandSchemas = {
  /** The next free numbers, as many as asked for. The server picks them, so two devices never get the same ones. */
  'labels.reserve': z.object({ id, count: z.number().int().min(1).max(MAX_RUN), name, notes }),
  /** What a run is for. Its numbers stay as they are. */
  'labels.update': z
    .object({ id, name: name.optional(), notes: notes.optional() })
    .refine((u) => u.name !== undefined || u.notes !== undefined, { message: 'Nothing to change.' }),
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
