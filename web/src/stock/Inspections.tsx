import {
  INSPECTION_KINDS,
  INSPECTION_LABELS,
  INSPECTION_SHORT,
  itemByCode,
  newId,
  normaliseNumber,
  type AssetView,
  type Due,
  type InspectionKind,
  type View,
} from '@sh/shared'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { act, Refusal, useAct } from '../act.tsx'
import { Top } from '../jobs/common.tsx'
import { Pending } from '../StatusPill.tsx'
import { client } from '../sync.ts'
import { useToday } from '../view.ts'
import { mistakeLabel, numberLabel } from './common.tsx'
import { CameraScanner, primeSound } from './Scanner.tsx'

/**
 * Inspections (ADR 0020): the electrical test (PAT) and the thorough
 * examination of lifting gear. A product says how often its items need
 * each; each one done is recorded on the item's page, or a batch at a
 * time by scanning (#stock/testing), where each pass is held for a few
 * seconds with Undo before it's recorded (audit finding 17), and the
 * Stock tab lists what's failed, overdue or due soon. Failed or overdue
 * kit can't go out.
 */

/** "2 Oct 2027". */
export const dateLabel = (day: string) =>
  new Date(`${day}T12:00:00Z`).toLocaleDateString('en-IE', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })

/** "PAT overdue since 2 Oct 2026", "PAT failed on 1 Sep 2026", "PAT due 2 Oct 2026"; a day the stock list gave says so, as no test here set it. */
export function dueText(d: Due): string {
  const what = d.kind === 'pat' ? 'PAT' : 'Thorough examination'
  const listed = d.fromList ? ', as the stock list says' : ''
  switch (d.state) {
    case 'failed':
      return `${what} failed on ${dateLabel(d.last!.day)}`
    case 'overdue':
      return `${what} overdue since ${dateLabel(d.due!)}${listed}`
    case 'unrecorded':
      return `${what} not recorded yet`
    default:
      return `${what} due ${dateLabel(d.due!)}${listed}`
  }
}

const TESTER_KEY = 'sh.tester'
function savedTester(): string {
  try {
    return localStorage.getItem(TESTER_KEY) ?? ''
  } catch {
    return ''
  }
}
function saveTester(by: string) {
  try {
    localStorage.setItem(TESTER_KEY, by)
  } catch {
    // Private browsing: typed again next time.
  }
}

/** When it was done: now for today, else noon that day. */
const whenDone = (day: string, today: string) => (day === today ? new Date().toISOString() : `${day}T12:00:00.000Z`)

/** One test as a change; whoever asks for it runs it through act(). */
const record = (a: { assetId: string; kind: InspectionKind; passed: boolean; day: string; today: string; by: string; note: string }) =>
  client.mutate('inspection.record', { id: newId(), assetId: a.assetId, kind: a.kind, passed: a.passed, at: whenDone(a.day, a.today), by: a.by, note: a.note })

/** An item's inspections: where it stands on each its product needs, the record, and recording one. */
export function InspectionsCard({ view, a }: { view: View; a: AssetView }) {
  const dues = view.inspections.dueOf(a.id)
  const done = view.inspections.ofAsset(a.id)
  const [open, setOpen] = useState(false)
  if (dues.length === 0 && done.length === 0) return null
  const kinds = dues.length ? dues.map((d) => d.kind) : [...INSPECTION_KINDS]
  return (
    <section className="card inspections" aria-label="Inspections">
      <h2>Inspections</h2>
      {dues.length === 0 && (
        <p className="hint">
          {a.model?.name ?? 'Its product'} doesn't say how often its items need testing. Set it with Change details on{' '}
          {a.model ? <a href={`#stock/product/${a.model.id}`}>its page</a> : 'its page'}.
        </p>
      )}
      {dues.length > 0 && (
        <ul className="due-list">
          {dues.map((d) => (
            <li key={d.kind} className={`due ${d.state}`}>
              <b>{dueText(d)}</b>
              <span>
                {d.state === 'failed' || d.state === 'overdue'
                  ? "Can't go out until it passes."
                  : d.state === 'unrecorded'
                    ? 'Record the last one, if it was done on paper.'
                    : d.fromList
                      ? `None recorded here yet; then every ${d.months === 1 ? 'month' : `${d.months} months`}.`
                      : `Every ${d.months === 1 ? 'month' : `${d.months} months`}; last passed ${dateLabel(d.last!.day)}.`}
              </span>
            </li>
          ))}
        </ul>
      )}
      {a.status === 'active' &&
        (open ? (
          <RecordOne a={a} kinds={kinds} onDone={() => setOpen(false)} />
        ) : (
          <div className="actions">
            <button type="button" onClick={() => setOpen(true)}>
              Record a test
            </button>
          </div>
        ))}
      {done.length > 0 && (
        <details open={done.length <= 3}>
          <summary>{done.length === 1 ? 'One recorded' : `${done.length} recorded`}</summary>
          <ul className="item-list">
            {done.map((i) => (
              <li key={i.id} className="inspection">
                <div>
                  <b>
                    {INSPECTION_LABELS[i.kind]}: {i.passed ? 'passed' : 'failed'}
                  </b>
                  <p>
                    {dateLabel(i.day)}
                    {i.by && ` · ${i.by}`}
                    {i.note && ` · ${i.note}`}
                  </p>
                </div>
                <Pending pending={i.pending} />
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  )
}

function RecordOne({ a, kinds, onDone }: { a: AssetView; kinds: InspectionKind[]; onDone: () => void }) {
  const [kind, setKind] = useState<InspectionKind>(kinds[0]!)
  const [passed, setPassed] = useState(true)
  const today = useToday()
  const [day, setDay] = useState(today)
  const [by, setBy] = useState(savedTester)
  const [note, setNote] = useState('')
  const { run, error, refuse } = useAct()
  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (!day || day > today) return refuse('When was it done? Today or a day before.')
    saveTester(by.trim())
    void run(() => record({ assetId: a.id, kind, passed, day, today, by: by.trim(), note: note.trim() })).then((ok) => ok && onDone())
  }
  return (
    <form className="grid-form" onSubmit={submit} aria-label={`Record a test of ${numberLabel(a)}`}>
      {kinds.length > 1 && (
        <fieldset className="wide reasons">
          <legend>Which</legend>
          {kinds.map((k) => (
            <label key={k} className="tick">
              <input type="radio" name="kind" checked={kind === k} onChange={() => setKind(k)} />
              <span>{INSPECTION_LABELS[k]}</span>
            </label>
          ))}
        </fieldset>
      )}
      <fieldset className="wide reasons">
        <legend>Result</legend>
        <label className="tick">
          <input type="radio" name="result" checked={passed} onChange={() => setPassed(true)} />
          <span>Passed</span>
        </label>
        <label className="tick">
          <input type="radio" name="result" checked={!passed} onChange={() => setPassed(false)} />
          <span>Failed</span>
        </label>
      </fieldset>
      <label>
        When <input type="date" value={day} max={today} onChange={(e) => setDay(e.target.value)} />
      </label>
      <label>
        By <input value={by} onChange={(e) => setBy(e.target.value)} placeholder="Who tested it" maxLength={200} />
      </label>
      <label className="wide">
        Note <input value={note} onChange={(e) => setNote(e.target.value)} placeholder={passed ? 'e.g. Earth 0.08 Ω' : 'e.g. Earth fault on the IEC inlet'} maxLength={2000} />
      </label>
      <Refusal error={error} className="wide" />
      <div className="actions wide">
        <button type="submit" className="primary">
          Record {INSPECTION_SHORT[kind] === 'PAT' ? 'PAT' : 'examination'}
        </button>
        <button type="button" onClick={onDone}>
          Cancel
        </button>
      </div>
    </form>
  )
}

/** The Stock tab's list of what's failed, overdue or due in the next 30 days, and what's not recorded yet. */
export function InspectionsDue({ view }: { view: View }) {
  const { attention, unrecorded } = view.inspections
  const needed = view.warehouse.models.some((m) => m.patMonths || m.liftingMonths)
  if (!needed) return null
  const stopped = attention.filter((d) => d.state !== 'soon')
  const soon = attention.filter((d) => d.state === 'soon')
  const row = (d: Due) => (
    <li key={`${d.asset.id}-${d.kind}`}>
      <a className="job-row" href={`#stock/item/${d.asset.id}`}>
        <div>
          <b>
            {numberLabel(d.asset)} {d.asset.model?.name}
          </b>
          <p>{dueText(d)}</p>
        </div>
      </a>
    </li>
  )
  const byProduct = new Map<string, number>()
  for (const d of unrecorded) byProduct.set(d.asset.model?.name ?? 'A product', (byProduct.get(d.asset.model?.name ?? 'A product') ?? 0) + 1)
  return (
    <section className="card inspections-due" aria-label="Inspections due">
      <h2>Inspections due</h2>
      {stopped.length === 0 && soon.length === 0 && <p className="empty">Nothing failed, overdue or due in the next 30 days.</p>}
      {stopped.length > 0 && (
        <>
          <h3>Can't go out</h3>
          <ul className="job-list">{stopped.map(row)}</ul>
        </>
      )}
      {soon.length > 0 && (
        <>
          <h3>Due in the next 30 days</h3>
          <ul className="job-list">{soon.map(row)}</ul>
        </>
      )}
      {unrecorded.length > 0 && (
        <p className="hint">
          Not recorded yet:{' '}
          {[...byProduct]
            .map(([name, n]) => `${n} × ${name}`)
            .join(', ')}
          . They can still go out; record their last test when you have it.
        </p>
      )}
      <div className="actions">
        <a className="button" href="#stock/testing">
          Test a batch
        </a>
      </div>
    </section>
  )
}

interface Said {
  tone: 'ok' | 'warn' | 'quiet'
  text: string
  at: number
  /** The item and record just made, with who tested it and when, so it can be marked failed instead. */
  last?: { a: AssetView; kind: InspectionKind; by: string; day: string; today: string }
}

/** How long a pass is held with Undo before it's recorded: time to see the wrong label was read. */
export const HOLD_MS = 5000

/** A pass read but not recorded yet, with the tester and day as they were when it was read. */
interface Held {
  a: AssetView
  kind: InspectionKind
  by: string
  day: string
  /** The day it was read on, which says whether `day` means now, however long the screen has been open. */
  today: string
  /** When it's recorded, unless undone first. */
  until: number
}

/** "SH-000123 d&b Y10P". */
const itemName = (a: AssetView) => [numberLabel(a), a.model?.name].filter(Boolean).join(' ')

/**
 * Testing a batch: scan each item as it passes. Each pass sits at the top
 * for five seconds with Undo, then goes through the normal command path,
 * so it queues with no signal like any other change; a second read while
 * one is held records the first at once. Mark the last one failed if it
 * didn't pass.
 */
export function TestingScreen({ view }: { view: View }) {
  const [kind, setKind] = useState<InspectionKind>('pat')
  const [by, setBy] = useState(savedTester)
  const today = useToday()
  const [day, setDay] = useState(today)
  const [typed, setTyped] = useState('')
  const [camera, setCamera] = useState(false)
  const [said, setSaid] = useState<Said>()
  const [done, setDone] = useState<{ a: AssetView; passed: boolean; at: number }[]>([])
  const [held, setHeld] = useState<Held>()
  const [now, setNow] = useState(() => Date.now())
  // The one held as of the latest read, for a read or a timer that lands before the next render.
  const heldRef = useRef<Held>(undefined)
  const say = (tone: Said['tone'], text: string, last?: Said['last']) => setSaid({ tone, text, at: Date.now(), last })

  const hold = (h: Held) => {
    heldRef.current = h
    // The clock only ticks while one is held, so it's set now, or the first count would be from the last hold.
    setNow(Date.now())
    setHeld(h)
  }
  /** The held pass taken off hold, so whatever happens to it next happens once. */
  const take = (): Held | undefined => {
    const h = heldRef.current
    heldRef.current = undefined
    if (h) setHeld(undefined)
    return h
  }

  /** A pass taken off hold, recorded. */
  const commit = async (h: Held) => {
    const name = itemName(h.a)
    try {
      await act(() => record({ assetId: h.a.id, kind: h.kind, passed: true, day: h.day, today: h.today, by: h.by, note: '' }))
    } catch (err) {
      return say('warn', (err as Error).message)
    }
    setDone((d) => [{ a: h.a, passed: true, at: Date.now() }, ...d])
    const due = client.view().inspections.dueOf(h.a.id).find((d) => d.kind === h.kind)
    const last = { a: h.a, kind: h.kind, by: h.by, day: h.day, today: h.today }
    if (!due) return say('warn', `${name}: passed. Its product doesn't say how often it needs one, so it's never due; set it on the product's page.`, last)
    return say('ok', `${name}: passed, next due ${dateLabel(due.due!)}.`, last)
  }

  // Counting down while one is held, and recorded when its time is up, unless it's been undone or recorded since.
  useEffect(() => {
    if (!held) return
    const timer = setTimeout(() => {
      if (heldRef.current === held) void commit(take()!)
    }, Math.max(0, held.until - Date.now()))
    const tick = setInterval(() => setNow(Date.now()), 250)
    return () => {
      clearTimeout(timer)
      clearInterval(tick)
    }
  }, [held])

  // Leaving the screen, or the phone locking, records the one held at once: only Undo drops a pass.
  useEffect(() => {
    const recordNow = () => {
      const h = take()
      if (h) void commit(h)
    }
    const hidden = () => document.visibilityState === 'hidden' && recordNow()
    document.addEventListener('visibilitychange', hidden)
    return () => {
      document.removeEventListener('visibilitychange', hidden)
      recordNow()
    }
  }, [])

  const onCode = async (code: string) => {
    const w = client.view().warehouse
    const n = normaliseNumber(code)
    // An old tag from before Session Hire's labels works too (ADR 0026).
    const a = itemByCode(w, code)
    if (!a) return say('warn', n ? `${n} isn't on anything yet.` : `Nothing has the code ${code.trim()}.`)
    const name = itemName(a)
    if (a.retiredReason === 'mistake') return say('warn', `${mistakeLabel(a)} Nothing was recorded.`)
    if (a.status !== 'active') return say('warn', `${name} is retired, so it wasn't recorded. Bring it back first if it's still here.`)
    saveTester(by.trim())
    // The same label again while it's held: still held, not passed twice.
    if (heldRef.current?.a.id === a.id) return
    // Only one is ever held: a new read takes the last one as passed.
    const before = take()
    hold({ a, kind, by: by.trim(), day, today, until: Date.now() + HOLD_MS })
    if (before) await commit(before)
  }
  const read = (code: string) => void onCode(code).catch((err: Error) => say('warn', err.message))
  const submit = (e: FormEvent) => {
    e.preventDefault()
    const code = typed.trim()
    if (!code) return
    setTyped('')
    read(code)
  }
  const undo = () => {
    const h = take()
    if (h) say('quiet', `${itemName(h.a)}: dropped, nothing recorded.`)
  }
  /** A fail recorded for the last item read, by the tester and on the day it was read as, whether it was held or recorded as passed. */
  const failed = (last: NonNullable<Said['last']>) =>
    void act(() => record({ assetId: last.a.id, kind: last.kind, passed: false, day: last.day, today: last.today, by: last.by, note: '' })).then(
      () => {
        setDone((d) => [{ a: last.a, passed: false, at: Date.now() }, ...d])
        say('warn', `${itemName(last.a)}: failed. It can't go out until it passes. Report what's wrong on its page.`)
      },
      (err: Error) => say('warn', err.message)
    )
  // Failed while held: the fail is recorded in place of the pass.
  const failedHeld = () => {
    const h = take()
    if (h) failed(h)
  }
  const left = held ? Math.max(1, Math.ceil((held.until - now) / 1000)) : 0

  return (
    <div className="app warehouse pick">
      <Top view={view} title="Stock" />
      <a className="back" href="#stock">
        ‹ All stock
      </a>
      <section className="card" aria-label="Testing">
        <header className="title">
          <h1>Test a batch</h1>
        </header>
        <p className="hint">
          Scan each item as it passes. Each pass waits five seconds with Undo, then it's recorded, with no signal too. If one fails, press It failed.
        </p>
        {held && (
          <div className="held" role="status" aria-label="Held">
            <p>
              <b>Passed: {numberLabel(held.a)}</b>
              {/* Not read out every second; the help line says how long. */}
              <span aria-hidden="true"> · recorded in {left} s</span>
            </p>
            <div className="actions">
              <button type="button" onClick={undo}>
                Undo
              </button>
              <button type="button" onClick={failedHeld}>
                It failed
              </button>
            </div>
          </div>
        )}
        <div className="filters" role="group" aria-label="Which test">
          {INSPECTION_KINDS.map((k) => (
            <button key={k} type="button" aria-pressed={kind === k} onClick={() => setKind(k)}>
              {k === 'pat' ? 'PAT' : 'Thorough examination'}
            </button>
          ))}
        </div>
        <div className="grid-form">
          <label>
            By <input value={by} onChange={(e) => setBy(e.target.value)} placeholder="Who's testing" maxLength={200} />
          </label>
          <label>
            When <input type="date" value={day} max={today} onChange={(e) => setDay(e.target.value || today)} />
          </label>
        </div>
        <form className="scan-row" onSubmit={submit}>
          <input
            type="search"
            enterKeyHint="go"
            autoComplete="off"
            placeholder="Scan or type a number"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            aria-label="Number or serial"
          />
          <button
            type="button"
            aria-pressed={camera}
            onClick={() => {
              if (!camera) primeSound()
              setCamera(!camera)
            }}
          >
            Scan
          </button>
        </form>
        {camera && <CameraScanner onRead={read} onStop={() => setCamera(false)} small />}
        {said && (
          <p key={said.at} className={`said ${said.tone}`} role="status" aria-label="Last scan">
            {said.text}
          </p>
        )}
        {said?.last && !held && (
          <div className="actions">
            <button type="button" onClick={() => failed(said.last!)}>
              It failed
            </button>
          </div>
        )}
      </section>
      {done.length > 0 && (
        <section className="card" aria-label="Tested">
          <h2>Tested here: {done.length}</h2>
          <ul className="numbers">
            {done.map((d) => (
              <li key={`${d.at}-${d.a.id}-${d.passed}`}>
                <a href={`#stock/item/${d.a.id}`} className={d.passed ? '' : 'failed'}>
                  {numberLabel(d.a)}
                  {d.passed ? '' : ' failed'}
                </a>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}
