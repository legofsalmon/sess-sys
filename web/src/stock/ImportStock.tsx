import {
  bringInStockLabel,
  columnLetter,
  knownStockOf,
  needsColumnStep,
  plural,
  previewStockList,
  readStockFile,
  STOCK_FIELD_LABELS,
  STOCK_FIELDS,
  stockListSaid,
  UNCHANGED,
  type StockField,
  type StockFile,
  type StockListCounts,
  type StockListOptions,
  type StockListPreviewRow,
  type StockListReading,
  type StockListResult,
  type View,
} from '@sh/shared'
import { useEffect, useRef, useState, type ChangeEvent } from 'react'
import { Confirm, Refusal, useAct } from '../act.tsx'
import { ShowAll } from '../Fold.tsx'
import { Top } from '../jobs/common.tsx'
import { post } from '../server.ts'

/**
 * Bringing in the stock list (ADR 0026), at #account/import-stock: choose
 * the sheet saved as a .csv file; say which column is which when the app
 * doesn't know a header; see every row as the app read it, with what it
 * will add or change and anything it couldn't read marked; fix those in
 * place or skip them; then bring them all in at once. The server reads the
 * file against the catalogue, so this needs signal; as a row is fixed, the
 * same shared rules run again against what this device holds.
 */

/** A row as the office is fixing it. */
interface Row extends StockListPreviewRow {
  /** Decided once, from the preview: the fields a row had problems with stay as fields for the rest of it, so they don't vanish mid-word. */
  fix: StockField[]
}

interface Previewing {
  at: 'preview'
  text: string
  file: StockFile
  columns: (StockField | null)[]
  notRead: string[]
  rows: Row[]
  counts: StockListCounts
  places: string[]
  cases: string[]
  options: StockListOptions
}

type Step =
  | { at: 'choose'; problem?: string }
  | { at: 'reading' }
  | { at: 'columns'; text: string; file: StockFile; columns: (StockField | null)[]; problem?: string }
  | Previewing
  | { at: 'done'; result: StockListResult }

/** The server takes up to this much; said here first, so a bigger file is told in words. */
const MOST_BYTES = 5_000_000
const NO_OPTIONS: StockListOptions = { make: false, defaultPlace: '' }

const readFile = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result ?? ''))
    reader.onerror = () => reject(new Error("Couldn't read that file."))
    reader.readAsText(file)
  })

/** The fields a row's problems are about; one the tick solves is said under the row instead, as the tick is the usual answer. */
const fieldsOf = (r: StockListPreviewRow) => [...new Set(r.problems.filter((p) => !p.tick).map((p) => p.field).filter((f): f is StockField => f !== null))]

export function ImportStockScreen({ view }: { view: View }) {
  const [step, setStep] = useState<Step>({ at: 'choose' })
  const heading = useRef<HTMLHeadingElement>(null)
  const offline = view.connection === 'offline'
  // A new step is announced by moving to its heading.
  useEffect(() => heading.current?.focus(), [step.at])

  /** The server's reading of the file with these columns. */
  const preview = async (text: string, file: StockFile, columns: (StockField | null)[]) => {
    setStep({ at: 'reading' })
    try {
      const read = await post<StockListReading>('/api/stock/import/preview', { text, columns, options: NO_OPTIONS })
      setStep({
        at: 'preview',
        text,
        file,
        columns,
        notRead: read.notRead,
        rows: read.rows.map((r) => ({ ...r, fix: fieldsOf(r) })),
        counts: read.counts,
        places: read.places,
        cases: read.cases,
        options: NO_OPTIONS,
      })
    } catch (err) {
      setStep({ at: 'columns', text, file, columns, problem: (err as Error).message })
    }
  }

  const choose = async (e: ChangeEvent<HTMLInputElement>) => {
    const chosen = e.target.files?.[0]
    if (!chosen) return
    if (chosen.size > MOST_BYTES) return setStep({ at: 'choose', problem: 'The file is bigger than 5 MB.' })
    setStep({ at: 'reading' })
    let text: string
    try {
      text = await readFile(chosen)
    } catch (err) {
      return setStep({ at: 'choose', problem: (err as Error).message })
    }
    const read = readStockFile(text)
    if (!read.file) return setStep({ at: 'choose', problem: read.problem })
    if (needsColumnStep(read.file)) setStep({ at: 'columns', text, file: read.file, columns: read.file.columns })
    else await preview(text, read.file, read.file.columns)
  }

  return (
    <div className="app warehouse jobs import import-stock">
      <Top view={view} title="Account" />
      <a className="back" href="#account">
        ‹ Account
      </a>
      <header className="title">
        <h1 ref={heading} tabIndex={-1}>
          {step.at === 'done' ? 'Brought in' : 'Bring in the stock list'}
        </h1>
      </header>
      {step.at === 'choose' || step.at === 'reading' ? (
        <Choose reading={step.at === 'reading'} offline={offline} problem={step.at === 'choose' ? step.problem : undefined} onChoose={choose} />
      ) : step.at === 'columns' ? (
        <Columns
          step={step}
          offline={offline}
          onColumns={(columns) => setStep({ ...step, columns, problem: undefined })}
          onRead={() => void preview(step.text, step.file, step.columns)}
          onBack={() => setStep({ at: 'choose' })}
        />
      ) : step.at === 'done' ? (
        <Done result={step.result} onAgain={() => setStep({ at: 'choose' })} />
      ) : (
        <Preview
          step={step}
          view={view}
          offline={offline}
          onStep={setStep}
          onColumns={() => setStep({ at: 'columns', text: step.text, file: step.file, columns: step.columns })}
          onBack={() => setStep({ at: 'choose' })}
          onDone={(result) => setStep({ at: 'done', result })}
        />
      )}
    </div>
  )
}

function Choose(p: { reading: boolean; offline: boolean; problem: string | undefined; onChoose: (e: ChangeEvent<HTMLInputElement>) => void }) {
  return (
    <section className="card" aria-label="Choose a file">
      <p>
        Save the stock list as a .csv file (CSV UTF-8) and choose it here. The first row names the columns, such as Item, Make, Model, Quantity,
        Serial, Asset number, Location, Case, Value and PAT due, in any order; a title above it is fine. Nothing is saved until you've seen every
        row.
      </p>
      <label className="field">
        Stock list file
        <input type="file" accept=".csv,text/csv" onChange={p.onChoose} disabled={p.reading || p.offline} />
      </label>
      {p.reading && <p className="hint">Reading the file…</p>}
      {p.problem && (
        <p className="alert" role="alert">
          {p.problem}
        </p>
      )}
      {p.offline && <p className="hint">This needs signal: the server reads the file against everything already in the stock list.</p>}
    </section>
  )
}

/** Which column is which: every column with its first values, the known ones chosen already. A field goes with one column only. */
function Columns(p: {
  step: Extract<Step, { at: 'columns' }>
  offline: boolean
  onColumns: (columns: (StockField | null)[]) => void
  onRead: () => void
  onBack: () => void
}) {
  const { file, columns, problem } = p.step
  const pick = (i: number, field: StockField | null) => p.onColumns(columns.map((f, j) => (j === i ? field : f === field ? null : f)))
  const named = columns.includes('product') || columns.includes('model')
  return (
    <section className="card" aria-label="Which column is which">
      <h2>Which column is which</h2>
      <p>
        The app doesn't know every column's name. Say what each one holds. A column left on “Not read” isn't read, and the preview lists it.
      </p>
      <ul className="columns-list">
        {file.header.map((h, i) => (
          <li key={i}>
            <label>
              <span>
                <b>{h || `Column ${columnLetter(i)}`}</b>
                <small>{file.samples[i]!.join(' · ') || 'Empty'}</small>
              </span>
              <select value={columns[i] ?? ''} onChange={(e) => pick(i, (e.target.value || null) as StockField | null)} aria-label={`What ${h || `column ${columnLetter(i)}`} holds`}>
                <option value="">Not read</option>
                {STOCK_FIELDS.map((f) => (
                  <option key={f} value={f}>
                    {STOCK_FIELD_LABELS[f]}
                  </option>
                ))}
              </select>
            </label>
          </li>
        ))}
      </ul>
      {!named && <p className="warn-line">One column has to be the Product, or the Model.</p>}
      {problem && (
        <p className="alert" role="alert">
          {problem}
        </p>
      )}
      <div className="actions">
        <button type="button" className="primary" onClick={p.onRead} disabled={p.offline || !named}>
          Read the rows
        </button>
        <button type="button" onClick={p.onBack}>
          Choose another file
        </button>
      </div>
      {p.offline && <p className="hint">This needs signal.</p>}
    </section>
  )
}

function Preview(p: {
  step: Previewing
  view: View
  offline: boolean
  onStep: (step: Previewing) => void
  onColumns: () => void
  onBack: () => void
  onDone: (result: StockListResult) => void
}) {
  const { step } = p
  const { rows, counts, options } = step
  const { run, error } = useAct()
  const [bringing, setBringing] = useState(false)
  const [progress, setProgress] = useState<{ done: number; left: number }>()
  const [asking, setAsking] = useState(false)

  /** Every row checked and matched again by the shared rules, with what this device holds, so a problem clears as it's fixed. */
  const recheck = (next: Row[], nextOptions: StockListOptions) => {
    const read = previewStockList(
      next.map((r) => ({ row: r.row, cells: r.cells, skip: r.skip })),
      knownStockOf(p.view.warehouse),
      nextOptions
    )
    p.onStep({ ...step, options: nextOptions, rows: read.rows.map((r, i) => ({ ...r, fix: next[i]!.fix })), counts: read.counts, places: read.places, cases: read.cases })
  }
  const typed = (row: number, field: StockField, value: string) =>
    recheck(
      rows.map((r) => (r.row === row ? { ...r, cells: { ...r.cells, [field]: value } } : r)),
      options
    )
  const skip = (row: number, on: boolean) =>
    recheck(
      rows.map((r) => (r.row === row ? { ...r, skip: on } : r)),
      options
    )

  /** A long list goes in a call at a time, each sent with what the last said each row now does, until nothing's left. */
  const bring = async () => {
    setBringing(true)
    let sent = rows.map((r) => ({ row: r.row, cells: r.cells, skip: r.skip, does: r.does }))
    let all: StockListResult | undefined
    const ok = await run(async () => {
      for (;;) {
        const going = all !== undefined
        let got: StockListResult
        try {
          got = await post<StockListResult>('/api/stock/import', { rows: sent, options, going })
        } catch (err) {
          if (!going) throw err
          throw new Error(`${(err as Error).message} What went in before stays: choose the file again to see what's left.`)
        }
        const was = all
        all = was ? { ...got, products: was.products + got.products, items: was.items + got.items, counted: was.counted + got.counted, places: was.places + got.places, changed: was.changed + got.changed } : got
        if (!got.left) return
        const now = new Map(got.left.rows.map((r) => [r.row, r.does]))
        sent = sent.map((r) => ({ ...r, does: now.get(r.row) ?? r.does }))
        setProgress({ done: all.products + all.items + all.counted + all.places + all.changed, left: got.left.changes })
      }
    })
    setBringing(false)
    setProgress(undefined)
    if (ok && all) p.onDone({ ...all, left: undefined })
  }

  const live = counts.rows - counts.skipped
  const question = [
    counts.products > 0 && plural(counts.products, 'new product'),
    counts.items > 0 && plural(counts.items, 'new item'),
    counts.counted > 0 && plural(counts.counted, 'count'),
    options.make && step.places.length > 0 && plural(step.places.length, 'new place'),
    counts.updates > 0 && `${plural(counts.updates, 'row')} changing what's here`,
  ].filter(Boolean)
  const [first, ...rest] = stockListSaid(counts).split(' read')

  return (
    <>
      <section className="card" aria-label="What was read">
        <p role="status">
          <b>{first}</b> read{rest.join(' read')}
        </p>
        {step.notRead.length > 0 && <p className="hint">Not read: {step.notRead.join(', ')}.</p>}
        <div className="links">
          <button type="button" className="link" onClick={p.onColumns} disabled={bringing}>
            Which column is which
          </button>
          <button type="button" className="link" onClick={p.onBack} disabled={bringing}>
            Choose another file
          </button>
        </div>
      </section>

      <section className="card" aria-label="Places and cases">
        <h2>Places and cases</h2>
        {step.places.length === 0 && step.cases.length === 0 ? (
          <p className="hint">Every place and case the list names is here already.</p>
        ) : (
          <>
            {step.places.length > 0 && (
              <p>
                <b>Places not here yet:</b> {step.places.join(', ')}
              </p>
            )}
            {step.cases.length > 0 && (
              <p>
                <b>Cases not here yet:</b> {step.cases.join(', ')}
              </p>
            )}
            <label className="tick">
              <input type="checkbox" checked={options.make} onChange={(e) => recheck(rows, { ...options, make: e.target.checked })} disabled={bringing} />
              <span>
                <b>Make the places and cases this list names</b>
                <small>Each is made once, by its name. A case is made as a product of that name that holds other kit, with one item.</small>
              </span>
            </label>
          </>
        )}
        <label className="field">
          Kit the list doesn't place is at
          <input
            list="import-places"
            value={options.defaultPlace}
            onChange={(e) => recheck(rows, { ...options, defaultPlace: e.target.value })}
            placeholder="e.g. Warehouse; empty to leave it unplaced"
            disabled={bringing}
          />
        </label>
        <datalist id="import-places">
          {p.view.warehouse.places.map((x) => (
            <option key={x.id} value={x.name} />
          ))}
        </datalist>
      </section>

      <section className="card" aria-label="Rows">
        <ShowAll items={rows} limit={30} what="rows" keep={(r) => r.fix.length > 0 || r.problems.length > 0}>
          {(shown) => (
            <ul className="found stock-rows">
              {shown.map((r) => (
                <RowCard key={r.row} row={r} onTyped={(field, value) => typed(r.row, field, value)} onSkip={(on) => skip(r.row, on)} />
              ))}
            </ul>
          )}
        </ShowAll>
      </section>

      <div className="bring">
        <Refusal error={error} />
        {counts.problems > 0 && <p className="hint">{counts.problems === 1 ? '1 row still has a problem: fix it or skip it.' : `${counts.problems} rows still have problems: fix them or skip them.`}</p>}
        {p.offline && <p className="hint">This needs signal.</p>}
        {progress && (
          <p className="hint" role="status">
            A long list goes in a part at a time: {plural(progress.done, 'change')} made, about {progress.left.toLocaleString('en-IE')} to go. Keep this open.
          </p>
        )}
        {asking ? (
          <Confirm
            question={`${question.length ? question.join(', ') : 'Nothing changes'}. Each can be changed afterwards, but this can't be undone in one go.`}
            yes="Bring them in"
            no="Not yet"
            onYes={() => {
              setAsking(false)
              void bring()
            }}
            onNo={() => setAsking(false)}
          />
        ) : (
          <button
            type="button"
            className="primary"
            disabled={bringing || p.offline || live === 0 || counts.problems > 0 || counts.unchanged === live}
            onClick={() => setAsking(true)}
          >
            {bringing ? 'Bringing in…' : bringInStockLabel(counts)}
          </button>
        )}
      </div>
    </>
  )
}

/** One row as the app read it: what it is, where it goes and what bringing it in does, with its fields to fix where it couldn't read them, and Skip. */
function RowCard({ row: r, onTyped, onSkip }: { row: Row; onTyped: (field: StockField, value: string) => void; onSkip: (on: boolean) => void }) {
  const about = (field: StockField | null) => r.problems.filter((x) => x.field === field || (field === null && x.field !== null && !r.fix.includes(x.field)))
  return (
    <li className={r.skip ? 'is-off' : 'is-on'} aria-label={`Row ${r.row}`}>
      <div className="head">
        <b>{r.product || `Row ${r.row}`}</b>
        <label className="skip">
          <input type="checkbox" checked={r.skip} onChange={(e) => onSkip(e.target.checked)} aria-label={`Skip row ${r.row}`} />
          Skip
        </label>
      </div>
      {r.facts && <p>{r.facts}</p>}
      {r.where && <p>{r.where}</p>}
      {!r.skip &&
        r.does.map((d) => (
          <p key={d} className={d === UNCHANGED ? 'same' : 'does'}>
            {d}
          </p>
        ))}
      {!r.skip &&
        r.asides.map((x) => (
          <p key={x} className="hint">
            {x}
          </p>
        ))}
      {about(null).map((x) => (
        <p key={x.text} className="warn-line">
          {x.text}
        </p>
      ))}
      {r.fix.length > 0 && (
        <div className="fix">
          {r.fix.map((f) => (
            <label key={f}>
              {STOCK_FIELD_LABELS[f]}
              <input value={r.cells[f] ?? ''} onChange={(e) => onTyped(f, e.target.value)} aria-label={`${STOCK_FIELD_LABELS[f]} for row ${r.row}`} disabled={r.skip} />
              {about(f).map((x) => (
                <small key={x.text} className="warn-line">
                  {x.text}
                </small>
              ))}
            </label>
          ))}
        </div>
      )}
    </li>
  )
}

function Done({ result, onAgain }: { result: StockListResult; onAgain: () => void }) {
  const parts = [
    plural(result.products, 'new product'),
    plural(result.items, 'new item'),
    plural(result.counted, 'count'),
    result.places > 0 && plural(result.places, 'new place'),
    result.changed > 0 && `${plural(result.changed, 'item')} moved or changed`,
  ].filter(Boolean)
  return (
    <section className="card" aria-label="Brought in">
      <p role="status">
        Brought in {plural(result.rows, 'row')}: {parts.join(', ')}.{result.skipped > 0 && ` ${plural(result.skipped, 'row')} skipped.`}
      </p>
      <div className="actions">
        <a className="button primary" href="#stock">
          Stock tab
        </a>
        <button type="button" onClick={onAgain}>
          Bring in another list
        </button>
      </div>
    </section>
  )
}
