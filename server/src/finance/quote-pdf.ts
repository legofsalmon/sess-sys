import PDFDocument from 'pdfkit'
import {
  depositCents,
  letterDay,
  lineCents,
  linesByGroup,
  money,
  pctWord,
  quoteNumberLabel,
  RATE_UNIT,
  spanLabel,
  validUntil,
  VAT_LABELS,
  venueLabel,
  type Client,
  type LineKind,
  type Quote,
  type QuoteSettings,
  type QuoteTotals,
  type Setting,
  type Venue,
} from '@sh/shared'

/**
 * The quote as a PDF, made on the server (ADR 0101) to go with the email.
 * It says what the A4 page the device prints says (web/src/jobs/
 * QuoteSheet.tsx), in the same order: the two are kept together, so a
 * client sent the PDF and one handed the printed page read the same
 * quote. Drawn with pdfkit rather than a browser: the server has none.
 */

/** Everything the sheet shows, gathered by the caller. */
export interface Sheet {
  q: Quote
  totals: QuoteTotals
  job: { name: string; span: { start: string; end: string } | undefined; venue: Pick<Venue, 'name' | 'address'> | undefined; client: Client | undefined }
  /** Admin's office details: the address, phone, email and VAT number printed at the top. */
  office: Setting | undefined
  quoting: Pick<QuoteSettings, 'terms' | 'bank'>
  /** Today in Ireland, for a draft's date and how long it holds. */
  today: string
}

const KIND_WORDS: Record<LineKind, string> = { kit: 'Kit', crew: 'Crew', other: 'Other' }

/** 14 mm, as the printed page's margins. */
const MARGIN = 39.7
const INK = '#111111'
const MUTED = '#666666'
const RULE = '#cccccc'
const BODY = 9.5
const SMALL = 8
const REGULAR = 'Helvetica'
const BOLD = 'Helvetica-Bold'

/**
 * Helvetica as a PDF carries it knows Latin letters, the euro sign and the
 * usual punctuation, and nothing else: an emoji or a letter from another
 * alphabet would come out as a blank box, so it's left out rather than drawn.
 */
const ENCODABLE = /[ -~ -ÿ€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ\n\t]/u
export const drawable = (s: string) => [...s].filter((c) => ENCODABLE.test(c)).join('')

export function quotePdf(d: Sheet): Promise<Buffer> {
  const { q, totals, job, office, quoting, today } = d
  const draft = q.status === 'draft'
  const number = quoteNumberLabel(q)
  const title = draft ? `Draft quote for ${job.name}` : `Quote ${q.number ?? ''} for ${job.name}`.replace('  ', ' ')
  const doc = new PDFDocument({
    size: 'A4',
    margins: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN },
    bufferPages: true,
    info: { Title: drawable(title), Author: 'Session Hire', Creator: 'Session Hire' },
  })
  const chunks: Buffer[] = []
  doc.on('data', (c: Buffer) => chunks.push(c))
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)))
    doc.on('error', reject)
  })

  const left = MARGIN
  const width = doc.page.width - MARGIN * 2
  const t = (s: string) => drawable(s)
  const text = (s: string, opts: PDFKit.Mixins.TextOptions & { x?: number; y?: number; size?: number; font?: string; color?: string } = {}) => {
    const { x, y, size = BODY, font = REGULAR, color = INK, ...rest } = opts
    doc.font(font).fontSize(size).fillColor(color)
    if (x !== undefined || y !== undefined) doc.text(t(s), x ?? doc.x, y ?? doc.y, rest)
    else doc.text(t(s), rest)
  }

  // Who it's from, at the left; the quote's facts at the right.
  const top = doc.y
  const half = width * 0.55
  text('Session Hire', { x: left, y: top, size: 15, font: BOLD, width: half })
  const address = office?.address?.trim()
  const reach = [office?.phone, office?.email].filter(Boolean).join(' · ')
  const vat = office?.vatNumber?.trim()
  if (address) text(address, { width: half })
  if (reach) text(reach, { width: half })
  if (vat) text(`VAT number ${vat}`, { width: half })
  const fromBottom = doc.y
  const factsX = left + half + 10
  const factsW = width - half - 10
  let y = top + 3
  const fact = (label: string, value: string) => {
    text(label, { x: factsX, y, size: SMALL, color: MUTED, width: factsW, align: 'right' })
    y = doc.y
    text(value, { x: factsX, y, font: BOLD, width: factsW, align: 'right' })
    y = doc.y + 3
  }
  fact(draft ? 'Draft quote' : 'Quote', number || (draft ? 'Not sent yet' : ''))
  fact('Date', letterDay(q.sentOn ?? today))
  fact('Valid until', letterDay(validUntil(q, today)))
  doc.y = Math.max(fromBottom, y) + 16

  // Who it's for, and the job.
  const toTop = doc.y
  const col = width / 2 - 8
  const client = job.client
  const contact = client?.contacts[0]
  if (client) {
    text('For', { x: left, y: toTop, size: SMALL, color: MUTED, width: col })
    text(client.name, { font: BOLD, width: col })
    if (contact) text(contact.name, { width: col })
    if (client.address?.trim()) text(client.address.trim(), { width: col })
  }
  const toBottom = doc.y
  text(job.name, { x: left + col + 16, y: toTop, size: 13, font: BOLD, width: col })
  const where = [job.span && spanLabel(job.span), job.venue && venueLabel(job.venue)].filter(Boolean).join(' · ')
  if (where) text(where, { width: col })
  doc.y = Math.max(toBottom, doc.y) + 14
  doc.x = left

  // The lines, grouped as on the page.
  const cell = (s: string, more: PDFKit.Mixins.CellOptions = {}): PDFKit.Mixins.CellOptions => ({ text: t(s), ...more })
  const right = { align: { x: 'right' as const } }
  const rows: PDFKit.Mixins.CellOptions[][] = [
    ['What', 'How many', 'Days', 'Price', 'VAT', 'Amount'].map((h, i) => cell(h, { type: 'TH', font: { src: BOLD, size: SMALL }, textColor: MUTED, border: { bottom: 0.8 }, borderColor: INK, ...(i ? right : {}) })),
  ]
  for (const g of linesByGroup(q.lines)) {
    rows.push([cell(g.group || KIND_WORDS[g.lines[0]!.kind], { colSpan: 6, font: { src: BOLD, size: BODY }, padding: [7, 4, 3, 4] })])
    for (const l of g.lines) {
      const days = l.per === 'once' ? '' : l.rate === 'weekly' ? `${l.days} wk` : l.days.toLocaleString('en-IE')
      const price = `${money(l.unitCents)} ${l.per === 'once' ? 'once' : `a ${RATE_UNIT[l.rate ?? 'daily']}`}`
      const amount = `${money(lineCents(l))}${l.discountPct ? `\nless ${pctWord(l.discountPct)}` : ''}`
      rows.push([
        cell(l.includes ? `${l.what}\n${l.includes}` : l.what),
        cell(String(l.qty), right),
        cell(days, right),
        cell(price, right),
        cell(VAT_LABELS[l.vat], right),
        cell(amount, right),
      ])
    }
  }
  doc.font(REGULAR).fontSize(BODY).fillColor(INK)
  doc.table({
    position: { x: left, y: doc.y },
    maxWidth: width,
    columnStyles: ['*', 52, 40, 88, 36, 84],
    defaultStyle: { textColor: INK, border: { top: 0, left: 0, right: 0, bottom: 0.5 }, borderColor: RULE, padding: [4, 4, 4, 4] },
    data: rows,
  })
  doc.moveDown(0.6)

  // What it comes to, at the right.
  const sums: [string, string, boolean][] = []
  if (totals.discount > 0) {
    sums.push(['Subtotal', money(totals.subtotal), false])
    sums.push([q.agreedCents != null ? `Agreed discount, ${pctWord(totals.discountPct)}` : `Discount, ${pctWord(totals.discountPct)}`, `-${money(totals.discount)}`, false])
  }
  sums.push(['Before VAT', money(totals.net), false])
  for (const r of totals.rates) sums.push([`VAT at ${VAT_LABELS[r.rate]}${totals.rates.length > 1 ? ` on ${money(r.net)}` : ''}`, money(r.vat), false])
  sums.push(['Total', money(totals.gross), true])
  const sumsW = 250
  doc.font(REGULAR).fontSize(BODY).fillColor(INK)
  doc.table({
    position: { x: left + width - sumsW, y: doc.y },
    maxWidth: sumsW,
    columnStyles: ['*', 96],
    defaultStyle: { textColor: INK, border: 0, padding: [3, 4, 3, 4] },
    data: sums.map(([label, value, total]) => [
      cell(label, total ? { font: { src: BOLD, size: 11 }, border: { top: 0.8 }, borderColor: INK } : { textColor: MUTED }),
      cell(value, { ...right, ...(total ? { font: { src: BOLD, size: 11 }, border: { top: 0.8 }, borderColor: INK } : {}) }),
    ]),
  })
  doc.x = left
  doc.moveDown(0.8)

  if (q.depositPct) {
    text(`A deposit of ${pctWord(q.depositPct)}, ${money(depositCents(totals.gross, q.depositPct))}, confirms the booking.`, { width })
    doc.moveDown(0.5)
  }
  if (q.notes.trim()) {
    text(q.notes.trim(), { width })
    doc.moveDown(0.8)
  }
  const section = (heading: string, body: string, after?: string) => {
    text(heading, { size: 10.5, font: BOLD, width })
    doc.moveDown(0.2)
    text(body, { width })
    if (after) {
      doc.moveDown(0.3)
      text(after, { width })
    }
    doc.moveDown(0.8)
  }
  if (quoting.terms.trim()) section('Terms', quoting.terms.trim())
  if (quoting.bank.trim()) section('Paying by bank transfer', quoting.bank.trim(), q.number ? `Please give quote ${q.number} as the reference.` : undefined)
  text(`Prices are in euro: each line is how many, at its price, for the days charged or once.${reach ? ` Questions: ${reach}.` : ''}`, { size: SMALL, color: MUTED, width })

  // Page numbers, only when there's more than one page; written in the bottom margin, which pdfkit otherwise keeps clear.
  const pages = doc.bufferedPageRange()
  if (pages.count > 1)
    for (let i = 0; i < pages.count; i++) {
      doc.switchToPage(pages.start + i)
      const bottom = doc.page.margins.bottom
      doc.page.margins.bottom = 0
      text(`Page ${i + 1} of ${pages.count}`, { x: left, y: doc.page.height - MARGIN + 8, size: SMALL, color: MUTED, width, align: 'right', lineBreak: false })
      doc.page.margins.bottom = bottom
    }
  doc.end()
  return done
}
