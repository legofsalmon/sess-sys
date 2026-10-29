import { barcode, barcodeFits, plural, qrCode, type ModelView } from '@sh/shared'
import { useMemo, useState } from 'react'
import { Heading } from '../Icon.tsx'
import { PrintSheet, usePrinting } from './Labels.tsx'

/**
 * Cable labels (ADR 0095): what a cable is, such as "10 m XLR", in big
 * type, printed here for any product, as many as asked for. Everyday
 * cables are counted rather than numbered, so these carry the product, not
 * an item's number: its name or other words typed, and if wanted its stock
 * code as a QR code or as a long thin barcode, which scanned in the Stock
 * search opens the product. They print through the browser's print dialog
 * on a label printer, as an item's labels do (ADR 0015).
 */

/** The labels a cable takes, each one to a page on a label printer. */
export const CABLE_LAYOUTS = {
  wrap: { name: 'Wrap round, 50 × 25 mm', hint: 'Self-laminating: the clear tail wraps over the print.', page: '50mm 25mm' },
  flag: { name: 'Flag, 100 × 25 mm', hint: 'Round the cable and stuck to itself: it says it on both sides.', page: '100mm 25mm' },
  bag: { name: 'Bag or bin, 50 × 25 mm', hint: 'For the bag, bin or tub the cables are kept in.', page: '50mm 25mm' },
} as const
export type CableLayout = keyof typeof CABLE_LAYOUTS

/** What goes in the code on a cable label. */
export const CABLE_CODES = { barcode: 'Barcode', qr: 'QR code', none: 'No code' } as const
export type CableCode = keyof typeof CABLE_CODES

/** The most printed at once, as for an item's labels. */
const MOST = 500

const KEY = 'sh.cableLabels'
/** The layout and code used last on this device, since it's usually the same printer and labels. */
function saved(): { layout: CableLayout; code: CableCode } {
  const out = { layout: 'wrap' as CableLayout, code: 'barcode' as CableCode }
  try {
    const was = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Record<string, string>
    if (was.layout && was.layout in CABLE_LAYOUTS) out.layout = was.layout as CableLayout
    if (was.code && was.code in CABLE_CODES) out.code = was.code as CableCode
  } catch {
    // Storage blocked or spoilt: the first of each, then.
  }
  return out
}

/** Type as big as fits the room on one line, in millimetres: a bold letter is about 0.7 of its height wide; no bigger than `most`, and long words go onto a second line rather than very small. */
const fit = (words: string, widthMm: number, most: number) => Math.max(3.2, Math.min(most, widthMm / (Math.max(words.length, 1) * 0.7)))

/** A Code 128 barcode, its bars a module apart, with its words under it. */
function Bars({ text }: { text: string }) {
  const b = useMemo(() => barcode(text), [text])
  if (!b) return null
  // The white a scanner needs either side, in modules.
  const quiet = 10
  return (
    <div className="bars">
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox={`${-quiet} 0 ${b.width + quiet * 2} 1`}
        preserveAspectRatio="none"
        shapeRendering="crispEdges"
        role="img"
        aria-label={`Barcode for ${text}`}
      >
        <rect x={-quiet} y={0} width={b.width + quiet * 2} height={1} fill="#fff" />
        <path d={b.path} fill="#000" />
      </svg>
      <small>{text}</small>
    </div>
  )
}

function Qr({ text }: { text: string }) {
  const { size, path } = useMemo(() => qrCode(text), [text])
  const quiet = 2
  const side = size + quiet * 2
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      className="qr"
      viewBox={`${-quiet} ${-quiet} ${side} ${side}`}
      shapeRendering="crispEdges"
      role="img"
      aria-label={`QR code for ${text}`}
    >
      <rect x={-quiet} y={-quiet} width={side} height={side} fill="#fff" />
      <path d={path} fill="#000" />
    </svg>
  )
}

/** What one end of a label says: the words, and the code if there is one. */
function Face({ words, code, kind, widthMm }: { words: string; code: string; kind: CableCode; widthMm: number }) {
  const qr = kind === 'qr' && code
  const bars = kind === 'barcode' && code
  // A QR code takes 19 mm of the width; a barcode a row under the words.
  const room = qr ? widthMm - 21 : widthMm - 3
  return (
    <div className={`face${qr ? ' with-qr' : ''}`}>
      {qr && <Qr text={code} />}
      <div className="words">
        <b style={{ fontSize: `${fit(words, room, bars ? 6.5 : qr ? 7 : 10)}mm` }}>{words}</b>
        {bars && <Bars text={code} />}
      </div>
    </div>
  )
}

/** One cable label, as it prints: a flag says it at both ends, the middle round the cable left blank. */
export function CableLabel({ words, code, kind, layout }: { words: string; code: string; kind: CableCode; layout: CableLayout }) {
  return (
    <div className={`label cable ${layout}`}>
      <Face words={words} code={code} kind={kind} widthMm={layout === 'flag' ? 40 : 50} />
      {layout === 'flag' && (
        <>
          <span className="round" aria-hidden />
          <Face words={words} code={code} kind={kind} widthMm={40} />
        </>
      )}
    </div>
  )
}

/** Cable labels for a product: what they say, which label, the code on them, how many, and Print. */
export function CableLabels({ m }: { m: ModelView }) {
  const first = useMemo(saved, [])
  const [words, setWords] = useState(m.name)
  const [layout, setLayout] = useState<CableLayout>(first.layout)
  const [kind, setKind] = useState<CableCode>(first.code)
  const [count, setCount] = useState('2')
  const [printing, setPrinting] = usePrinting()
  const remember = (next: { layout: CableLayout; code: CableCode }) => {
    try {
      localStorage.setItem(KEY, JSON.stringify(next))
    } catch {
      // Remembered for this page only.
    }
  }
  const stockCode = m.code.trim()
  // A barcode holds the stock code, which the Stock search finds; a QR code holds it too, or the name where there's none.
  const code = kind === 'barcode' ? (barcodeFits(stockCode) ? stockCode : '') : kind === 'qr' ? stockCode || m.name : ''
  const noBarcode = kind === 'barcode' && !code
  const said = words.trim()
  const n = Number(count)
  const many = Number.isInteger(n) && n >= 1 && n <= MOST ? n : 0
  return (
    <section className="card cable-labels" aria-label="Cable labels">
      <Heading icon="label">Cable labels</Heading>
      <p className="hint">Big type saying what it is, for each end of a cable or the bag it lives in.</p>
      <div className="grid-form">
        <label className="wide">
          What they say <input value={words} maxLength={40} onChange={(e) => setWords(e.target.value)} placeholder="Such as 10 m XLR" />
        </label>
        <label>
          How many{' '}
          <input type="number" inputMode="numeric" min={1} max={MOST} value={count} onChange={(e) => setCount(e.target.value)} aria-invalid={!many} />
        </label>
      </div>
      <fieldset className="layouts">
        <legend>Label</legend>
        {(Object.keys(CABLE_LAYOUTS) as CableLayout[]).map((l) => (
          <label key={l} className="tick">
            <input
              type="radio"
              name="cable-layout"
              checked={layout === l}
              onChange={() => {
                setLayout(l)
                remember({ layout: l, code: kind })
              }}
            />
            <span>
              {CABLE_LAYOUTS[l].name}
              <small>{CABLE_LAYOUTS[l].hint}</small>
            </span>
          </label>
        ))}
      </fieldset>
      <fieldset className="layouts">
        <legend>Code on it</legend>
        {(Object.keys(CABLE_CODES) as CableCode[]).map((c) => (
          <label key={c} className="tick">
            <input
              type="radio"
              name="cable-code"
              checked={kind === c}
              onChange={() => {
                setKind(c)
                remember({ layout, code: c })
              }}
            />
            <span>{CABLE_CODES[c]}</span>
          </label>
        ))}
      </fieldset>
      {noBarcode ? (
        <p className="hint" role="note">
          {stockCode
            ? 'Its stock code has letters a barcode can’t hold. Give it one of plain letters, numbers and dashes under Details, or print a QR code.'
            : 'A barcode holds the product’s stock code, and it has none yet. Give it one under Details, such as XLR-10M, or print a QR code.'}
        </p>
      ) : kind !== 'none' ? (
        <p className="hint">
          {kind === 'barcode'
            ? 'Run the barcode along the cable. Scanned in the Stock search, it opens this product.'
            : 'Scanned in the Stock search, it opens this product.'}
        </p>
      ) : null}
      <div className="preview" aria-label="Preview">
        {said && <CableLabel words={said} code={code} kind={kind} layout={layout} />}
      </div>
      <p className="hint">Print at actual size, not fitted to the page.</p>
      <button type="button" className="primary" disabled={!said || !many || printing} onClick={() => setPrinting(true)}>
        {many === 1 ? 'Print the label' : `Print ${plural(many || 0, 'label')}`}
      </button>
      {printing && (
        <PrintSheet className={`cable ${layout}`} page={CABLE_LAYOUTS[layout].page}>
          {Array.from({ length: many }, (_, i) => (
            <div key={i} className="page">
              <CableLabel words={said} code={code} kind={kind} layout={layout} />
            </div>
          ))}
        </PrintSheet>
      )}
    </section>
  )
}
