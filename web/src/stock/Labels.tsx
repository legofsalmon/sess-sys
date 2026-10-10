import {
  labelPayload,
  labelsCsv,
  MAX_RUN,
  newId,
  normaliseNumber,
  numberValue,
  plural,
  qrCode,
  runNumbers,
  stockId,
  type LabelRunView,
  type LabelsView,
  type View,
  type WarehouseView,
} from '@sh/shared'
import { useEffect, useMemo, useRef, useState, type FormEvent, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { Confirm, Refusal, useAct } from '../act.tsx'
import { when } from '../format.ts'
import { Empty } from '../Empty.tsx'
import { Top } from '../jobs/common.tsx'
import { Pending } from '../StatusPill.tsx'
import { client } from '../sync.ts'
import { atLabel, findWhere, ProductChoices, useNewPlace, WhereChoices, whereNamed, whereProblem } from './common.tsx'

/**
 * Labels (ADR 0015). Numbers are set aside a run at a time (#stock/labels),
 * after a question saying how many, before their labels are printed, so
 * the next free number never lands on a label that isn't stuck on yet; a
 * run none of whose labels is on an item yet can be cancelled (audit
 * finding 19), which takes it off the list without ever giving its
 * numbers out again. A run prints here, or goes to a label maker as a
 * spreadsheet (#stock/labels/<id>); an item's own label prints from its
 * page; and a label from a run goes on an item when its number is scanned
 * or typed in the Stock search.
 */

/** How labels are laid out for the printer they go through. */
export const LAYOUTS = {
  wide: { name: 'Label printer, 50 × 25 mm', page: '50mm 25mm', perPage: 1 },
  square: { name: 'Label printer, 25 × 25 mm', page: '25mm 25mm', perPage: 1 },
  sheet: { name: 'A4 sheets of 65, 38 × 21 mm', page: 'A4', perPage: 65 },
} as const
export type Layout = keyof typeof LAYOUTS

/** The most labels printed here at once; a whole roll is a job for a label maker. */
export const MAX_PRINT = 500

const LAYOUT_KEY = 'sh.labels.layout'
/** The layout used last on this device, since it's usually the same printer. */
function savedLayout(): Layout {
  try {
    const saved = localStorage.getItem(LAYOUT_KEY)
    if (saved && saved in LAYOUTS) return saved as Layout
  } catch {
    // Storage blocked: the first layout, then.
  }
  return 'wide'
}

/** "SH-000101 to SH-000600", "SH-000101", or what it'll be until the server has set them aside. */
export const rangeLabel = (r: LabelRunView) =>
  !r.firstNumber ? 'Numbers when synced' : r.count === 1 ? r.firstNumber : `${r.firstNumber} to ${r.lastNumber}`

/** The same, breaking only between the numbers on a narrow screen. */
function Range({ r }: { r: LabelRunView }) {
  if (!r.firstNumber || r.count === 1) return <span className="nowrap">{rangeLabel(r)}</span>
  return (
    <>
      <span className="nowrap">{r.firstNumber}</span> to <span className="nowrap">{r.lastNumber}</span>
    </>
  )
}

/** One label: the QR code, the number in large type, and whose it is. */
export function Label({ number, caption, layout }: { number: string; caption?: string; layout: Layout }) {
  const { size, path } = useMemo(() => qrCode(labelPayload(number)), [number])
  // The white space a scanner needs round the code, in modules; the label's own margin adds to it.
  const quiet = 2
  const side = size + quiet * 2
  return (
    <div className={`label ${layout}`}>
      <svg
        xmlns="http://www.w3.org/2000/svg"
        className="qr"
        viewBox={`${-quiet} ${-quiet} ${side} ${side}`}
        shapeRendering="crispEdges"
        role="img"
        aria-label={`QR code for ${number}`}
      >
        <rect x={-quiet} y={-quiet} width={side} height={side} fill="#fff" />
        <path d={path} fill="#000" />
      </svg>
      <div className="words">
        <b>{number}</b>
        {layout !== 'square' && <small>Session Hire</small>}
        {layout !== 'square' && caption && <small className="caption">{caption}</small>}
      </div>
    </div>
  )
}

/**
 * Print labels on this device: a layout to suit the printer, the first few
 * at their real size, and all of them once Print is pressed. Only while
 * printing are they all on the page, and the printed page holds nothing
 * else.
 */
export function PrintLabels({ numbers, caption }: { numbers: readonly string[]; caption?: string }) {
  const [layout, setLayout] = useState<Layout>(savedLayout)
  const [printing, setPrinting] = useState(false)
  useEffect(() => {
    if (!printing) return
    const done = () => setPrinting(false)
    addEventListener('afterprint', done)
    // Once the labels are on the page.
    const frame = requestAnimationFrame(() => print())
    return () => {
      cancelAnimationFrame(frame)
      removeEventListener('afterprint', done)
    }
  }, [printing])
  const choose = (l: Layout) => {
    setLayout(l)
    try {
      localStorage.setItem(LAYOUT_KEY, l)
    } catch {
      // Remembered for this page only.
    }
  }
  const { perPage, page } = LAYOUTS[layout]
  const pages: string[][] = []
  for (let i = 0; i < numbers.length; i += perPage) pages.push(numbers.slice(i, i + perPage))
  return (
    <div className="print-labels">
      <fieldset className="layouts">
        <legend>Printer</legend>
        {(Object.keys(LAYOUTS) as Layout[]).map((l) => (
          <label key={l} className="tick">
            <input type="radio" name="layout" checked={layout === l} onChange={() => choose(l)} />
            <span>{LAYOUTS[l].name}</span>
          </label>
        ))}
      </fieldset>
      <div className="preview" aria-label="Preview">
        {numbers.slice(0, 3).map((n) => (
          <Label key={n} number={n} caption={caption} layout={layout} />
        ))}
      </div>
      <p className="hint">Print at actual size, not fitted to the page.</p>
      <button type="button" className="primary" disabled={numbers.length === 0 || printing} onClick={() => setPrinting(true)}>
        {numbers.length === 1 ? 'Print the label' : `Print ${plural(numbers.length, 'label')}`}
      </button>
      {printing &&
        createPortal(
          <div className={`print-sheet ${layout}`}>
            <style>{`@page { size: ${page}; margin: 0; }`}</style>
            {pages.map((p) => (
              <div key={p[0]} className="page">
                {p.map((n) => (
                  <Label key={n} number={n} caption={caption} layout={layout} />
                ))}
              </div>
            ))}
          </div>,
          document.body
        )}
    </div>
  )
}

/** Labels on the Stock tab: how far they've got, and the way to print more. */
export function LabelsCard({ labels }: { labels: LabelsView }) {
  const setAside = labels.runs.reduce((n, r) => n + r.count, 0)
  const used = labels.runs.reduce((n, r) => n + r.used, 0)
  return (
    <section className="card" aria-label="Labels">
      <h2>Labels</h2>
      <p className="hint">
        {labels.runs.length === 0 ? (
          'Set numbers aside to print labels here or to send to a label maker. Scan or type a label in the search above to put it on an item.'
        ) : (
          <>
            {plural(setAside, 'number')} set aside for printing, {used.toLocaleString('en-IE')} of them on items so far.
            {labels.next && (
              <>
                {' '}
                The next free number is <span className="nowrap">{labels.next}</span>.
              </>
            )}
          </>
        )}
      </p>
      <a className="button" href="#stock/labels">
        Print labels
      </a>
    </section>
  )
}

/** Every run of numbers set aside, and setting more aside. */
export function LabelsScreen({ view }: { view: View }) {
  const runs = view.labels.runs
  return (
    <div className="app warehouse">
      <Top view={view} title="Stock" />
      <a className="back" href="#stock">
        ‹ All stock
      </a>
      <section className="card">
        <h1>Labels</h1>
        <p className="hint">
          Numbers are set aside before their labels are printed, here or by a label maker, so no other item gets them. Once a label is stuck on, scan
          or type it in the Stock search to put it on its item.
        </p>
        <SetAside labels={view.labels} />
      </section>
      <section className="card" aria-label="Set aside">
        <h2>Set aside</h2>
        {runs.length === 0 && <Empty />}
        <ul className="job-list">
          {runs.map((r) => (
            <li key={r.id}>
              <a className="job-row" href={`#stock/labels/${r.id}`}>
                <div>
                  <b>
                    <Range r={r} />
                  </b>
                  <p>{[r.name, `set aside ${when(r.createdAt)}`].filter(Boolean).join(' · ')}</p>
                </div>
                <div className="side">
                  <Pending pending={r.pending} />
                  <small>
                    {r.used.toLocaleString('en-IE')} of {r.count.toLocaleString('en-IE')} on items
                  </small>
                </div>
              </a>
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}

function SetAside({ labels }: { labels: LabelsView }) {
  const [f, setF] = useState({ count: '', name: '' })
  // The count, said back before anything is set aside: a slip of a zero is 10,000 labels.
  const [asking, setAsking] = useState<number>()
  const { run, error, refuse } = useAct()
  const [lastId, setLastId] = useState('')
  const last = labels.runs.find((r) => r.id === lastId)
  const submit = (e: FormEvent) => {
    e.preventDefault()
    const count = Number(f.count)
    if (!Number.isInteger(count) || count < 1 || count > MAX_RUN) return refuse(`How many labels? From 1 to ${MAX_RUN.toLocaleString('en-IE')} at a time.`)
    setAsking(count)
  }
  const reserve = (count: number) => {
    setAsking(undefined)
    const id = newId()
    // A refusal brings what was typed back, unless the next run has been typed since.
    const cleared = { count: '', name: '' }
    setF(cleared)
    void run(() => client.mutate('labels.reserve', { id, count, name: f.name.trim(), notes: '' })).then((ok) => {
      if (ok) setLastId(id)
      else setF((now) => (now === cleared ? f : now))
    })
  }
  return (
    <form className="grid-form" onSubmit={submit} aria-label="Set numbers aside">
      <label>
        How many labels
        <input
          type="number"
          inputMode="numeric"
          min={1}
          max={MAX_RUN}
          value={f.count}
          onChange={(e) => setF({ ...f, count: e.target.value })}
          required
          disabled={asking !== undefined}
        />
      </label>
      <label>
        What for{' '}
        <input
          value={f.name}
          onChange={(e) => setF({ ...f, name: e.target.value })}
          placeholder="e.g. Label World roll"
          maxLength={200}
          disabled={asking !== undefined}
        />
      </label>
      <Refusal error={error} className="wide" />
      {last && !error && (
        <p className="added wide" role="status">
          {last.firstNumber ? (
            <>
              Set aside{' '}
              <a href={`#stock/labels/${last.id}`}>
                <Range r={last} />
              </a>
              .
            </>
          ) : (
            'Set aside. The numbers come from the server when it syncs.'
          )}
        </p>
      )}
      {asking !== undefined ? (
        <Confirm
          className="wide"
          question={`Reserve ${plural(asking, 'number')}? Nothing else gets them. The run can be cancelled until one of its labels is on an item.`}
          yes="Reserve them"
          no="Not yet"
          onYes={() => reserve(asking)}
          onNo={() => setAsking(undefined)}
        />
      ) : (
        <button type="submit" className="primary wide">
          Set numbers aside
        </button>
      )}
    </form>
  )
}

/** One run: what it's for, how far it's got, printing it here, and the spreadsheet for a label maker. */
export function RunScreen({ view, id }: { view: View; id: string }) {
  const r = view.labels.runs.find((x) => x.id === id)
  if (!r)
    return (
      <div className="app warehouse">
        <Top view={view} title="Stock" />
        <a className="back" href="#stock/labels">
          ‹ Labels
        </a>
        <section className="card">
          <p className="empty">These labels aren't on the list. They were cancelled, or they're still on their way: check again once it says “Up to date”.</p>
        </section>
      </div>
    )
  return (
    <div className="app warehouse">
      <Top view={view} title="Stock" />
      <a className="back" href="#stock/labels">
        ‹ Labels
      </a>
      <RunSummary r={r} />
      {r.firstNumber ? (
        <>
          <PrintRun r={r} />
          <ForLabelMaker r={r} />
        </>
      ) : (
        <section className="card">
          <p className="empty">The numbers come from the server, so these print once they've synced.</p>
        </section>
      )}
    </div>
  )
}

function RunSummary({ r }: { r: LabelRunView }) {
  const [editing, setEditing] = useState(false)
  const [cancelling, setCancelling] = useState(false)
  const { run, error } = useAct()
  const cancel = () => {
    setCancelling(false)
    void run(() => client.mutate('labels.cancel', { id: r.id })).then((ok) => {
      if (ok) location.hash = '#stock/labels'
    })
  }
  return (
    <section className="card">
      <header className="title">
        <h1 className="number">
          <Range r={r} />
        </h1>
        <Pending pending={r.pending} />
      </header>
      <dl className="facts">
        <div>
          <dt>How many</dt>
          <dd>{r.count.toLocaleString('en-IE')}</dd>
        </div>
        <div>
          <dt>On items</dt>
          <dd>{r.used === 0 ? 'None yet' : `${r.used.toLocaleString('en-IE')} so far`}</dd>
        </div>
        <div className="wide">
          <dt>What for</dt>
          <dd>{r.name || 'Not said'}</dd>
        </div>
        <div className="wide">
          <dt>Set aside</dt>
          <dd>{when(r.createdAt)}</dd>
        </div>
      </dl>
      {r.notes && <p className="notes">{r.notes}</p>}
      <Refusal error={error} />
      {editing ? (
        <EditRun r={r} onDone={() => setEditing(false)} />
      ) : cancelling ? (
        <Confirm
          question={`Cancel the run ${rangeLabel(r)}? It comes off the list, and its ${r.count === 1 ? 'number is' : `${plural(r.count, 'number')} are`} never given out again.`}
          yes="Cancel the run"
          no="Keep it"
          onYes={cancel}
          onNo={() => setCancelling(false)}
        />
      ) : (
        <div className="actions">
          <button type="button" onClick={() => setEditing(true)}>
            Change details
          </button>
          {r.used === 0 && r.firstNumber && (
            <button type="button" className="link" onClick={() => setCancelling(true)}>
              Cancel the run
            </button>
          )}
        </div>
      )}
    </section>
  )
}

function EditRun({ r, onDone }: { r: LabelRunView; onDone: () => void }) {
  const [f, setF] = useState({ name: r.name, notes: r.notes })
  const { run, error } = useAct()
  const save = (e: FormEvent) => {
    e.preventDefault()
    const name = f.name.trim()
    const notes = f.notes.trim()
    const changes = { ...(name !== r.name ? { name } : {}), ...(notes !== r.notes ? { notes } : {}) }
    if (Object.keys(changes).length === 0) return onDone()
    void run(() => client.mutate('labels.update', { id: r.id, ...changes })).then((ok) => ok && onDone())
  }
  return (
    <form className="grid-form" onSubmit={save}>
      <label className="wide">
        What for <input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} maxLength={200} />
      </label>
      <label className="wide">
        Notes <textarea rows={2} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} maxLength={2000} />
      </label>
      <Refusal error={error} className="wide" />
      <div className="actions wide">
        <button type="submit" className="primary">
          Save
        </button>
        <button type="button" onClick={onDone}>
          Cancel
        </button>
      </div>
    </form>
  )
}

/** Some or all of a run, up to 500 at a time, from any of its numbers. */
function PrintRun({ r }: { r: LabelRunView }) {
  const [from, setFrom] = useState(r.firstNumber)
  const [count, setCount] = useState(String(Math.min(r.count, MAX_PRINT)))
  const start = normaliseNumber(from)
  const offset = start ? numberValue(start) - r.first! : -1
  const n = Number(count)
  const problem =
    offset < 0 || offset >= r.count
      ? `From one of these: ${rangeLabel(r)}.`
      : !Number.isInteger(n) || n < 1
        ? 'How many to print?'
        : n > MAX_PRINT
          ? `Up to ${MAX_PRINT} at a time here. A whole roll is best sent to a label maker.`
          : offset + n > r.count
            ? `Only ${r.count - offset} from ${start} to ${r.lastNumber}.`
            : ''
  const numbers = problem ? [] : runNumbers(r, offset, offset + n)
  return (
    <section className="card" aria-label="Print here">
      <h2>Print here</h2>
      <p className="hint">On a label printer, or on A4 sheets of labels in an office printer.</p>
      <div className="grid-form">
        <label>
          From <input value={from} onChange={(e) => setFrom(e.target.value)} autoComplete="off" autoCapitalize="characters" />
        </label>
        <label>
          How many <input type="number" inputMode="numeric" min={1} max={MAX_PRINT} value={count} onChange={(e) => setCount(e.target.value)} />
        </label>
        {problem && <p className="alert wide">{problem}</p>}
      </div>
      <PrintLabels numbers={numbers} />
    </section>
  )
}

/** The whole run as a spreadsheet, made on this device. */
function ForLabelMaker({ r }: { r: LabelRunView }) {
  const download = () => {
    const url = URL.createObjectURL(new Blob([labelsCsv(runNumbers(r))], { type: 'text/csv' }))
    const a = document.createElement('a')
    a.href = url
    a.download = `session-hire-labels-${r.firstNumber}-to-${r.lastNumber}.csv`
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
  return (
    <section className="card" aria-label="For a label maker">
      <h2>For a label maker</h2>
      <p className="hint">
        A spreadsheet of all {plural(r.count, 'label')}, a row each: the number to print under the QR code, and what the QR code holds. Label makers
        print rolls and metal tags from one, and so does a label printer's own software.
      </p>
      <button type="button" onClick={download}>
        Download the spreadsheet
      </button>
    </section>
  )
}

/** What labelling remembers between labels: the product and where, since it goes a shelf at a time. */
export interface ClaimMemory {
  product: string
  where: string
}

/**
 * A label that isn't on anything yet, scanned or typed in the Stock search:
 * say which product it's on and where that's kept, and it becomes that
 * product's item with this number, one of those counted there if some are.
 */
export function ClaimLabel({
  number,
  view,
  memory,
  productField,
  onClaimed,
}: {
  number: string
  view: View
  memory: RefObject<ClaimMemory>
  productField: RefObject<HTMLInputElement | null>
  onClaimed: (id: string) => void
}) {
  const w = view.warehouse
  const [f, setF] = useState(memory.current)
  const [fromCount, setFromCount] = useState(true)
  const { run: tryTo, error, refuse } = useAct()
  const { ask, question, asking } = useNewPlace(w)
  const run = view.labels.runOf(number)
  const m = findProduct(f.product, w)
  const known = findWhere(f.where, w)
  const countedThere = m && known ? (m.counted.find((s) => s.id === stockId(m.id, known))?.qty ?? 0) : 0
  const beyond = !run && view.labels.next && numberValue(number) >= numberValue(view.labels.next)

  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (!m) return refuse(f.product.trim() ? `No product is called ${f.product.trim()}. Add it on the Stock tab first.` : 'Which product is it on?')
    if (m.tracking !== 'serialised') return refuse(`${m.name} is counted, not numbered. Change it to numbered to label them one by one.`)
    const problem = whereProblem(f.where, w)
    if (problem) return refuse(problem)
    const id = newId()
    const one = countedThere > 0 && fromCount
    memory.current = { product: m.name, where: f.where }
    const go = () =>
      void tryTo(async () => {
        const where = (await whereNamed(f.where, w)) ?? { placeId: null, caseId: null }
        await client.mutate('asset.add', { id, modelId: m.id, number, serial: '', ...where, notes: '', fromCount: one })
      }).then((ok) => ok && onClaimed(id))
    if (!ask(f.where, go)) go()
  }

  return (
    <form className="grid-form claim" onSubmit={submit} aria-label={`Put ${number} on an item`}>
      <h3 className="wide">{number} isn't on anything yet</h3>
      <p className="hint wide">
        {run
          ? `It's one of the labels set aside ${when(run.createdAt)}${run.name ? ` for ${run.name}` : ''}. Which product is it on?`
          : beyond
            ? `No label with ${number} has been printed here or given out yet, so check the label. Which product is it on?`
            : 'Which product is it on?'}
      </p>
      <label>
        Product{' '}
        <input
          ref={productField}
          list="product-names"
          value={f.product}
          onChange={(e) => setF({ ...f, product: e.target.value })}
          onFocus={(e) => e.target.select()}
          placeholder="e.g. d&b Y10P"
          autoComplete="off"
          required
          disabled={asking}
        />
      </label>
      <label>
        Where it's kept{' '}
        <input list="where-choices" value={f.where} onChange={(e) => setF({ ...f, where: e.target.value })} placeholder="A place, or a case's number" disabled={asking} />
      </label>
      {countedThere > 0 && known && (
        <label className="wide tick">
          <input type="checkbox" checked={fromCount} onChange={(e) => setFromCount(e.target.checked)} />
          <span>
            One of the {countedThere.toLocaleString('en-IE')} counted {atLabel(known, w)}, not labelled until now
          </span>
        </label>
      )}
      <Refusal error={error} className="wide" />
      {question ?? (
        <button type="submit" className="primary wide">
          {/* The product named, as it's carried over from the last label: a shelf of something else shows here before it's pressed. */}
          Put {number} on {m ? `a ${m.name}` : 'it'}
        </button>
      )}
      <ProductChoices w={w} />
      <WhereChoices w={w} />
    </form>
  )
}

const findProduct = (name: string, w: WarehouseView) => w.models.find((x) => x.name.trim().toLowerCase() === name.trim().toLowerCase())
