import {
  DEPARTMENT_LABELS,
  DEPARTMENTS,
  holdOf,
  MAX_QTY,
  newId,
  normaliseNumber,
  plural,
  RETIRED_LABELS,
  spanLabel,
  STATUS_LABELS,
  type AssetView,
  type Department,
  type Direction,
  type JobView,
  type PickRow,
  type View,
} from '@sh/shared'
import { useRef, useState, type FormEvent } from 'react'
import { act } from '../crew/CrewScreen.tsx'
import { faultState, reportFault, ReportFault } from '../stock/Faults.tsx'
import { dueText } from '../stock/Inspections.tsx'
import { CameraScanner, primeSound } from '../stock/Scanner.tsx'
import { client } from '../sync.ts'
import { NotDone, StatusPill, today, Top } from './common.tsx'

/**
 * A job's pick list (ADR 0017): what its kit needs from Session Hire's
 * own, where to find it, and what's out. Going out, each item scanned is
 * recorded as out with the job; coming back, as back in. A scan is never
 * refused: when it doesn't match the plan, the answer says so, and it's
 * kept. Worked out on this phone from the scans it has, so it works with
 * no signal. Coming back, kit that's damaged or missing is reported here
 * (ADR 0018), and a missing item scanned is marked found.
 */

type Tone = 'ok' | 'warn' | 'quiet'
interface Said {
  tone: Tone
  text: string
  /** Changes each time, so the same answer twice still reads as new. */
  at: number
  /** The item that just came back, so damage to it can be reported. */
  back?: AssetView
}

/** "SH-000123 d&b Y10P". */
const itemName = (a: AssetView) => [a.number || 'An item', a.model?.name].filter(Boolean).join(' ')
const rowName = (r: PickRow) => r.model?.name ?? 'A product since removed'

/** Everything in a case, however deep. */
function inside(c: AssetView, seen = new Set<string>()): number {
  let n = 0
  for (const x of c.items) {
    if (seen.has(x.id)) continue
    seen.add(x.id)
    n += 1 + inside(x, seen)
  }
  return n
}

const record = (projectId: string, direction: Direction, what: { assetId: string; modelId: string } | { modelId: string; qty: number }) =>
  act(() => client.mutate('move.record', { id: newId(), projectId, direction, assetId: null, qty: 1, ...what, at: new Date().toISOString() }))

export function PickScreen({ view, id }: { view: View; id: string }) {
  const job = view.jobs.jobs.find((j) => j.id === id)
  if (!job)
    return (
      <div className="app crew jobs warehouse pick">
        <Top view={view} />
        <a className="back" href="#jobs">
          ‹ All jobs
        </a>
        <section className="card">
          <p className="empty">This job isn't on this device. It may still be on its way: check again once it says “Up to date”.</p>
        </section>
      </div>
    )
  return <Pick key={job.id} view={view} job={job} />
}

function Pick({ view, job }: { view: View; job: JobView }) {
  const over = !!job.span && job.span.end < today()
  const [mode, setMode] = useState<Direction>(over ? 'in' : 'out')
  const [camera, setCamera] = useState(false)
  const [typed, setTyped] = useState('')
  const [said, setSaid] = useState<Said>()
  const field = useRef<HTMLInputElement>(null)
  const pick = view.moves.pickList(job.id)!
  const say = (tone: Tone, text: string, back?: AssetView) => setSaid({ tone, text, at: Date.now(), back })

  // A label or a maker's serial, read by the camera or typed by a scanner.
  // What's looked up before anything is recorded comes from the view on screen;
  // only the count after a scan is recorded needs the device's latest.
  const onCode = async (code: string) => {
    const w = view.warehouse
    const n = normaliseNumber(code)
    const serial = code.trim().toLowerCase()
    const bySerial = [...w.assets.values()].filter((a) => a.serial && a.serial.toLowerCase() === serial)
    const a = (n && w.byNumber.get(n)) || (bySerial.length === 1 ? bySerial[0] : undefined)
    if (!a) return say('warn', n ? `${n} isn't on anything yet. Put it on an item in the Stock tab first.` : `Nothing has the code ${code.trim()}.`)
    const name = itemName(a)
    const was = view.moves.outOf(a.id)
    const other = was && was.projectId !== job.id ? (view.jobs.jobs.find((j) => j.id === was.projectId)?.name ?? 'another job') : undefined
    const notes: string[] = []
    if (a.status === 'retired') notes.push(`It's marked as ${a.retiredReason ? RETIRED_LABELS[a.retiredReason].toLowerCase() : 'retired'}.`)
    // Scanned, so it isn't missing any more; damaged, and it shouldn't go out.
    const fault = view.faults.stopping(a.id)
    const found = fault?.kind === 'missing'
    if (found) await act(() => client.mutate('fault.close', { id: fault.id, outcome: 'found', at: new Date().toISOString() }))
    if (found) notes.push("It was reported missing, so it's marked found.")
    else if (fault && mode === 'out') notes.push(`It's reported ${faultState(fault).toLowerCase()}${fault.note ? `: ${fault.note}` : ''}. Check it before it goes.`)
    // Failed or overdue its PAT or examination (ADR 0020): it shouldn't go.
    const check = mode === 'out' ? view.inspections.blocks(a.id) : undefined
    if (check) notes.push(`${dueText(check)}. Test it before it goes.`)

    if (mode === 'out') {
      if (was && !other) return say('quiet', `${name} is already out with ${job.name}${was.inCase ? `, in ${was.inCase.number}` : ''}.`)
      await record(job.id, 'out', { assetId: a.id, modelId: a.modelId })
      const row = client.view().moves.pickList(job.id)?.rows.find((r) => r.modelId === a.modelId)
      const contents = a.model?.isCase ? inside(a) : 0
      const withIt = contents ? `, with ${plural(contents, 'item')} in it` : ''
      let text = `${name} out${withIt}.`
      if (row && row.need > 0) text = row.out > row.need ? `${name} out${withIt}: ${row.out} out, and ${job.name} needs ${row.need}.` : `${name}: ${row.out} of ${row.need} out${withIt}.`
      if (other) notes.push(`It was out with ${other}; now it's out with ${job.name}.`)
      if (row && row.lines.length === 0 && !a.model?.isCase)
        notes.push(`It isn't on the kit for ${job.name}. Add it to the kit, or scan it back in if it isn't going.`)
      return say(notes.length || (row && row.out > row.need && row.need > 0) ? 'warn' : 'ok', [text, ...notes].join(' '))
    }

    if (!was) return say(found ? 'warn' : 'quiet', [`${name} isn't out, so there's nothing to bring back.`, ...notes].join(' '))
    await record(was.projectId, 'in', { assetId: a.id, modelId: a.modelId })
    const row = client.view().moves.pickList(job.id)?.rows.find((r) => r.modelId === a.modelId)
    let text = `${name} back.`
    if (!other && row) text = `${name} back: ${row.back} of ${row.back + row.out} back.`
    if (other) notes.push(`It went out with ${other}, not ${job.name}, so it's back from there.`)
    return say(notes.length ? 'warn' : 'ok', [text, ...notes].join(' '), a)
  }

  const read = (code: string) => void onCode(code).catch((err: Error) => say('warn', err.message))
  const submit = (e: FormEvent) => {
    e.preventDefault()
    const code = typed.trim()
    if (!code) return
    setTyped('')
    read(code)
  }

  const rows = pick.rows
  const byDepartment = new Map<Department | 'extra', PickRow[]>()
  for (const r of rows) {
    const d = r.lines.length === 0 ? 'extra' : (r.model?.department ?? 'other')
    byDepartment.set(d, [...(byDepartment.get(d) ?? []), r])
  }
  const groups: [Department | 'extra', string][] = [...DEPARTMENTS.map((d) => [d, DEPARTMENT_LABELS[d]] as [Department, string]), ['extra', 'Not on the kit']]
  // Going out, the kit and anything out that isn't on it; coming back, whatever went out.
  const shown = mode === 'in' ? rows.filter((r) => r.out > 0 || r.back > 0 || r.missing > 0) : rows.filter((r) => r.lines.length > 0 || r.out > 0)

  return (
    <div className="app crew jobs warehouse pick">
      <Top view={view} />
      <a className="back" href={`#jobs/${job.id}`}>
        ‹ {job.name}
      </a>
      <NotDone view={view} names={/^(move|fault)\./} />

      <section className="card" aria-label="Scanning">
        <header className="title">
          <h1>Pick list</h1>
          <StatusPill status={job.status} pending={job.pending} />
        </header>
        <p className="hint">
          {job.name} · {job.span ? spanLabel(job.span) : 'No dates yet'}
          {holdOf(job.status) !== 'held' && ` · ${STATUS_LABELS[job.status]}, not confirmed, but its kit can still go out.`}
        </p>
        <div className="filters" role="group" aria-label="Going out or coming back">
          <button type="button" aria-pressed={mode === 'out'} onClick={() => setMode('out')}>
            Going out
          </button>
          <button type="button" aria-pressed={mode === 'in'} onClick={() => setMode('in')}>
            Coming back
          </button>
        </div>
        <p className="pick-total">
          {mode === 'out'
            ? pick.need
              ? `${pick.out} of ${pick.need} out`
              : 'Nothing on the kit to go out yet.'
            : pick.stillOut + pick.back + pick.missing
              ? `${pick.back} back, ${pick.stillOut} still out${pick.missing ? `, ${pick.missing} missing` : ''}`
              : 'Nothing has gone out yet.'}
        </p>
        <form className="scan-row" onSubmit={submit}>
          <input
            ref={field}
            type="search"
            enterKeyHint="go"
            autoComplete="off"
            placeholder={mode === 'out' ? 'Scan or type a number to send out' : 'Scan or type a number coming back'}
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
        {said?.back && mode === 'in' && <DamageTo key={`damage-${said.at}`} a={said.back} job={job} />}
      </section>

      <section className="card pick-list" aria-label="Kit">
        <h2>{mode === 'out' ? 'Kit to go out' : 'Kit coming back'}</h2>
        {rows.length === 0 && (
          <p className="empty">
            No kit on this job yet. Add it on <a href={`#jobs/${job.id}`}>the job's page</a>.
          </p>
        )}
        {mode === 'in' && rows.length > 0 && shown.length === 0 && <p className="empty">Nothing has gone out with this job yet.</p>}
        {groups
          .filter(([d]) => byDepartment.get(d)?.some((r) => shown.includes(r)))
          .map(([d, label]) => (
            <div className="kit-group" key={d}>
              <h3>{label}</h3>
              {byDepartment
                .get(d)!
                .filter((r) => shown.includes(r))
                .map((r) => (
                  <Row key={r.modelId} row={r} job={job} mode={mode} />
                ))}
            </div>
          ))}
      </section>
    </div>
  )
}

/** Coming back: report damage to the item just scanned. */
function DamageTo({ a, job }: { a: AssetView; job: JobView }) {
  const [open, setOpen] = useState(false)
  if (!open)
    return (
      <div className="actions">
        <button type="button" onClick={() => setOpen(true)}>
          Report damage to {a.number || 'it'}
        </button>
      </div>
    )
  return <ReportFault kind="damaged" asset={a} model={a.model} projectId={job.id} onDone={() => setOpen(false)} />
}

function Row({ row, job, mode }: { row: PickRow; job: JobView; mode: Direction }) {
  const name = rowName(row)
  const extra = row.lines.length === 0
  const missing = row.missing ? `, ${row.missing} missing` : ''
  const count =
    mode === 'out'
      ? extra
        ? `${row.out} out`
        : `${row.out} of ${row.need} out`
      : row.out
        ? `${row.out} still out${missing}`
        : row.missing
          ? `${row.back} back${missing}`
          : `All ${row.back} back`
  const done = mode === 'out' ? !extra && row.out >= row.need : row.out === 0 && row.missing === 0
  const [damage, setDamage] = useState(false)
  const countable = row.model?.tracking === 'bulk' || (row.model?.countedTotal ?? 0) > 0 || row.counted > 0 || row.countedBack > 0
  const lines = row.lines.length > 1 ? row.lines.map((l) => `${l.own} for ${l.phase?.name ?? (l.phaseId ? 'a phase' : 'the whole job')}`).join(', ') : ''
  return (
    <article className={`pick-row${done ? ' done' : ''}`} aria-label={name}>
      <header>
        <div>
          <b>{name}</b>
          {lines && <p>{lines}</p>}
        </div>
        <span className="count">{count}</span>
      </header>
      {extra && (
        <p className={`kit-state ${row.model?.isCase ? 'quiet' : 'warn'}`}>
          {row.model?.isCase ? "A case: what's in it counts on its own rows." : `Not on the kit for ${job.name}.`}
        </p>
      )}
      {mode === 'out' && !extra && row.out < row.need && row.from.length > 0 && (
        <ul className="from" aria-label="Where to find them">
          {row.from.map((f) => (
            <li key={f.where}>
              <b>{f.where}</b>
              {': '}
              {[f.items.map((a) => a.number || 'no number yet').join(', '), f.counted > 0 && `${f.counted.toLocaleString('en-IE')} counted`].filter(Boolean).join('; ')}
            </li>
          ))}
        </ul>
      )}
      {mode === 'out' && !extra && row.out < row.need && row.from.length === 0 && (
        <p className="kit-state warn">None in the stock list that aren't out. Subhire them on the job's page, or count them in the Stock tab.</p>
      )}
      {row.items.length > 0 && (
        <ul className="numbers out-items" aria-label={mode === 'out' ? 'Out' : 'Still out'}>
          {row.items.map((a) => (
            <li key={a.id}>
              <a href={`#stock/item/${a.id}`}>{a.number || 'no number yet'}</a>
              <button type="button" className="link" onClick={() => void record(job.id, 'in', { assetId: a.id, modelId: a.modelId }).catch((err: Error) => alert(err.message))}>
                {mode === 'out' ? 'Not going' : 'Back'}
              </button>
              {mode === 'in' && (
                <button
                  type="button"
                  className="link"
                  onClick={() =>
                    void reportFault({ kind: 'missing', assetId: a.id, modelId: a.modelId, qty: 1, projectId: job.id, usable: false, note: '' }).catch((err: Error) =>
                      alert(err.message)
                    )
                  }
                >
                  Missing
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {mode === 'in' && row.missingItems.length > 0 && (
        <ul className="numbers missing-items" aria-label="Missing">
          {row.missingItems.map((a) => (
            <li key={a.id}>
              <a href={`#stock/item/${a.id}`}>{a.number || 'no number yet'}</a>
            </li>
          ))}
        </ul>
      )}
      {countable && <Count row={row} job={job} mode={mode} />}
      {mode === 'in' && countable && row.countedBack > 0 && !damage && (
        <button type="button" className="link" onClick={() => setDamage(true)}>
          Report damage to counted {name}
        </button>
      )}
      {damage && <ReportFault kind="damaged" model={row.model} projectId={job.id} most={row.countedBack} onDone={() => setDamage(false)} />}
    </article>
  )
}

/** Counted kit, and numbered products not labelled yet: how many go out, or come back. */
function Count({ row, job, mode }: { row: PickRow; job: JobView; mode: Direction }) {
  const name = rowName(row)
  const [qty, setQty] = useState('')
  const [error, setError] = useState('')
  const go = (what: Direction | 'missing') => {
    setError('')
    const n = Number(qty)
    if (!Number.isInteger(n) || n < 1 || n > MAX_QTY) return setError('How many? A whole number, please.')
    const done =
      what === 'missing'
        ? reportFault({ kind: 'missing', assetId: null, modelId: row.modelId, qty: n, projectId: job.id, usable: false, note: '' })
        : record(job.id, what, { modelId: row.modelId, qty: n })
    void done.then(() => setQty(''), (err: Error) => setError(err.message))
  }
  const submit = (e: FormEvent) => {
    e.preventDefault()
    go(mode)
  }
  const label = mode === 'out' ? 'Count out' : 'Count back'
  return (
    <form className="count-row" onSubmit={submit} aria-label={`${label} ${name}`}>
      <p>
        {mode === 'out'
          ? row.counted
            ? `${row.counted.toLocaleString('en-IE')} counted out`
            : row.model?.tracking === 'bulk'
              ? 'Counted, not numbered'
              : 'Some not labelled yet'
          : row.counted
            ? `${row.counted.toLocaleString('en-IE')} counted out, ${row.countedBack.toLocaleString('en-IE')} back`
            : `${row.countedBack.toLocaleString('en-IE')} counted back`}
        {mode === 'in' && row.countedMissing > 0 && `, ${row.countedMissing.toLocaleString('en-IE')} missing`}
      </p>
      <input type="number" inputMode="numeric" min={1} max={MAX_QTY} value={qty} onChange={(e) => setQty(e.target.value)} aria-label="How many" placeholder="How many" />
      <button type="submit">{mode === 'out' ? 'Out' : 'Back'}</button>
      {mode === 'in' && row.counted > 0 && (
        <button type="button" onClick={() => go('missing')}>
          Missing
        </button>
      )}
      {error && <p className="alert">{error}</p>}
    </form>
  )
}
