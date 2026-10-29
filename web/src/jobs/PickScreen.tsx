import {
  dayLabel,
  daysBetween,
  DEPARTMENT_LABELS,
  DEPARTMENTS,
  holdOf,
  itemByCode,
  MAX_QTY,
  newId,
  normaliseNumber,
  plural,
  RETIRED_LABELS,
  spanLabel,
  STATUS_LABELS,
  vehicleName,
  type AssetView,
  type Department,
  type Direction,
  type FaultView,
  type JobView,
  type PickFrom,
  type PickList,
  type PickRow,
  type View,
} from '@sh/shared'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useScanKeys } from '../scanKeys.ts'
import { act, Refusal, useAct } from '../act.tsx'
import { Empty } from '../Empty.tsx'
import { mistakeLabel } from '../stock/common.tsx'
import { closeFault, faultState, reportFault, ReportFault } from '../stock/Faults.tsx'
import { dueText } from '../stock/Inspections.tsx'
import { CameraScanner, primeSound } from '../stock/Scanner.tsx'
import { kitOf } from '../home/standing.ts'
import { useAccess } from '../role.ts'
import { client } from '../sync.ts'
import { useToday } from '../view.ts'
import { JobStatusPill, Top } from './common.tsx'
import { JOBS } from '../Up.tsx'
import { useUnderTop } from '../useUnderTop.ts'

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
  /** Takes back what was just recorded, by recording the opposite (ADR 0072): nothing is deleted. */
  undo?: Undo
  /** Found because the case it's kept in was reported missing and is marked found with it: it may have been taken out of that case. */
  outOf?: OutOfCase
}
interface OutOfCase {
  item: AssetView
  holder: AssetView
  fault: FaultView
}
/** What to record to take a scan or a count back, and what to say once it's done. */
interface Undo {
  run: () => Promise<unknown>
  said: string
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

/** One scan, or one count, as a change; whoever asks for it runs it through act(). */
const record = (projectId: string, direction: Direction, what: { assetId: string; modelId: string } | { modelId: string; qty: number }) =>
  client.mutate('move.record', { id: newId(), projectId, direction, assetId: null, qty: 1, ...what, at: new Date().toISOString() })

export function PickScreen({ view, id }: { view: View; id: string }) {
  const job = view.jobs.jobs.find((j) => j.id === id)
  if (!job)
    return (
      <div className="app jobs warehouse pick">
        <Top view={view} up={{ steps: [JOBS] }} />
        <section className="card">
          <p className="empty">This job isn't on this device. It may still be on its way: check again once it says “Up to date”.</p>
        </section>
      </div>
    )
  return <Pick key={job.id} view={view} job={job} />
}

function Pick({ view, job }: { view: View; job: JobView }) {
  const today = useToday()
  const over = !!job.span && job.span.end < today
  const [mode, setMode] = useState<Direction>(over ? 'in' : 'out')
  const [camera, setCamera] = useState(false)
  const [typed, setTyped] = useState('')
  const [said, setSaid] = useState<Said>()
  // Scans that weren't recorded stay, said together, until someone dismisses them: the next scan doesn't wipe them.
  const [failed, setFailed] = useState<string[]>([])
  const field = useRef<HTMLInputElement>(null)
  const pick = view.moves.pickList(job.id)!
  // Sending kit out and back is stock's (audit finding 9): a role without it reads the list, and can still report damage or a loss.
  const access = useAccess()
  const mayMove = access.can('stock')
  const dock = useUnderTop(mayMove)
  const say: Say = (tone, text, more) => setSaid({ tone, text, at: Date.now(), ...more })
  useWakeLock(mayMove)
  // A scanner's first read goes to the scan field (audit, 20 October 2026, finding 98).
  useScanKeys(mayMove)

  // A label or a maker's serial, read by the camera or typed by a scanner.
  // What's looked up before anything is recorded comes from the view on screen;
  // only the count after a scan is recorded needs the device's latest.
  const onCode = async (code: string) => {
    const w = view.warehouse
    const n = normaliseNumber(code)
    // An old tag from before Session Hire's labels works too (ADR 0026).
    const a = itemByCode(w, code)
    // A label from a run not stuck on anything yet says so; any other number is most likely a slip of the finger, as the Stock
    // search reads it (audit, 20 October 2026, finding 94).
    if (!a)
      return say(
        'warn',
        n && view.labels.runOf(n) ? `${n} isn't on anything yet. Put it on an item in the Stock tab first.` : `Nothing has the number ${n || code.trim()}. Check the label.`
      )
    const name = itemName(a)
    // Never stock, so nothing to scan out or back (audit finding 19).
    if (a.retiredReason === 'mistake') return say('warn', `${mistakeLabel(a)} Nothing was recorded.`)
    const was = view.moves.outOf(a.id)
    const other = was && was.projectId !== job.id ? (view.jobs.jobs.find((j) => j.id === was.projectId)?.name ?? 'another job') : undefined
    const notes: string[] = []
    if (a.status === 'retired') notes.push(`It's marked as ${a.retiredReason ? RETIRED_LABELS[a.retiredReason].toLowerCase() : 'retired'}.`)
    // Scanned, so it isn't missing any more; damaged, and it shouldn't go out.
    const fault = view.faults.stopping(a.id)
    const found = fault?.kind === 'missing'
    if (found) await act(() => closeFault(fault, 'found'))
    // Missing because the case it's kept in is: that case is marked found with it, as a sealed case is (ADR 0018), and saying
    // so offers the other answer, that it was taken out of that case (audit, 20 October 2026, finding 102).
    const holder = found && fault.assetId && fault.assetId !== a.id ? w.assets.get(fault.assetId) : undefined
    const answer: Say = holder && fault ? (tone, text, more) => say(tone, text, { ...more, outOf: { item: a, holder, fault } }) : say
    if (holder) notes.push(`${holder.number || 'The case'}, the case it's kept in, was reported missing; it's marked found since this was in it.`)
    else if (found) notes.push("It was reported missing, so it's marked found.")
    else if (fault && mode === 'out') notes.push(`It's reported ${faultState(fault).toLowerCase()}${fault.note ? `: ${fault.note}` : ''}. Check it before it goes.`)
    // Failed or overdue its PAT or examination (ADR 0020): it shouldn't go.
    const check = mode === 'out' ? view.inspections.blocks(a.id) : undefined
    if (check) notes.push(`${dueText(check)}. Test it before it goes.`)

    if (mode === 'out') {
      if (was && !other) return answer(holder ? 'warn' : 'quiet', `${name} is already out with ${job.name}${was.inCase ? `, in ${was.inCase.number}` : ''}.`)
      await act(() => record(job.id, 'out', { assetId: a.id, modelId: a.modelId }))
      const row = client.view().moves.pickList(job.id)?.rows.find((r) => r.modelId === a.modelId)
      const contents = a.model?.isCase ? inside(a) : 0
      const withIt = contents ? `, with ${plural(contents, 'item')} in it` : ''
      let text = `${name} out${withIt}.`
      if (row && row.need > 0) text = row.out > row.need ? `${name} out${withIt}: ${row.out} out, and ${job.name} needs ${row.need}.` : `${name}: ${row.out} of ${row.need} out${withIt}.`
      if (other) notes.push(`It was out with ${other}; now it's out with ${job.name}.`)
      if (row && row.lines.length === 0 && !a.model?.isCase)
        notes.push(`It isn't on the kit for ${job.name}. Add it to the kit, or scan it back in if it isn't going.`)
      // Out with another job before: undoing puts it back out with that one, as it was.
      const undo: Undo = was
        ? { run: () => record(was.projectId, 'out', { assetId: a.id, modelId: a.modelId }), said: `${name} is out with ${other} again, as it was.` }
        : { run: () => record(job.id, 'in', { assetId: a.id, modelId: a.modelId }), said: `${name} isn't out: it's back in stock.` }
      return answer(notes.length || (row && row.out > row.need && row.need > 0) ? 'warn' : 'ok', [text, ...notes].join(' '), { undo })
    }

    if (!was) return answer(found ? 'warn' : 'quiet', [`${name} isn't out, so there's nothing to bring back.`, ...notes].join(' '))
    await act(() => record(was.projectId, 'in', { assetId: a.id, modelId: a.modelId }))
    const row = client.view().moves.pickList(job.id)?.rows.find((r) => r.modelId === a.modelId)
    let text = `${name} back.`
    if (!other && row) text = `${name} back: ${row.back} of ${row.back + row.out} back.`
    if (other) notes.push(`It went out with ${other}, not ${job.name}, so it's back from there.`)
    const undo: Undo = { run: () => record(was.projectId, 'out', { assetId: a.id, modelId: a.modelId }), said: `${name} is out with ${other ?? job.name} again.` }
    return answer(notes.length ? 'warn' : 'ok', [text, ...notes].join(' '), { back: a, undo })
  }

  const read = (code: string) => void onCode(code).catch((err: Error) => setFailed((f) => [...f, `${code.trim()}: ${err.message}`]))
  const submit = (e: FormEvent) => {
    e.preventDefault()
    const code = typed.trim()
    if (!code) return
    setTyped('')
    read(code)
  }

  const rows = pick.rows
  // Going out, the kit and anything out that isn't on it; coming back, whatever went out.
  const inMode = mode === 'in' ? rows.filter((r) => r.out > 0 || r.back > 0 || r.missing > 0) : rows.filter((r) => r.lines.length > 0 || r.out > 0)
  // Their part of it (ADR 0072): a head of department starts on their own department's kit, and the choice is kept on the phone.
  const parts = DEPARTMENTS.filter((d) => inMode.some((r) => departmentOfRow(r) === d))
  const me = access.personId ? view.crew.people.find((p) => p.id === access.personId) : undefined
  const mine = me?.department ? kitOf(me.department) : undefined
  const [prefs, setPrefs] = usePickPrefs()
  const wanted = prefs.part ?? mine ?? 'all'
  const part: Department | 'all' = parts.length > 1 && wanted !== 'all' && parts.includes(wanted) ? wanted : 'all'
  const shown = part === 'all' ? inMode : inMode.filter((r) => departmentOfRow(r) === part)
  const byPlace = mode === 'out' && prefs.order === 'place'
  const total = totalLine(pick, shown, mode, part)

  return (
    <div className="app jobs warehouse pick">
      <Top view={view} up={{ steps: [JOBS, { href: `#jobs/${job.id}`, label: job.name }], here: 'Pick list' }} />

      <section className="card" aria-label="Scanning">
        <header className="title">
          <h1>Pick list</h1>
          <JobStatusPill status={job.status} pending={job.pending} />
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
        <p className={`pick-total${total.done ? ' done' : ''}`}>{total.text}</p>
        {mode === 'out' && <Brief view={view} job={job} today={today} />}
        {!mayMove && <p className="hint">Whoever keeps the stock scans kit out and back here.</p>}
      </section>

      {/* The scan box stays under the top bar while the list scrolls (audit, 20 October 2026, finding 5), as Jobs' week headings
          do; not while the camera is on, which would cover the list. */}
      {mayMove && (
        <section className={`card scan-dock${camera ? '' : ' docked'}`} aria-label="Scan" ref={dock}>
          <form className="scan-row" onSubmit={submit}>
            <input
              ref={field}
              type="search"
              enterKeyHint="go"
              autoComplete="off"
              // An example that fits at phone width, where a sentence was cut short (audit, 20 October 2026, finding 95).
              placeholder="SH-000123"
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
            <div className="said-row">
              <p key={said.at} className={`said ${said.tone}`} role="status" aria-label="Last scan">
                {said.text}
              </p>
              {said.undo && <UndoButton undo={said.undo} say={say} />}
              {said.outOf && <NotInCase key={`out-of-${said.at}`} {...said.outOf} say={say} />}
            </div>
          )}
          {failed.length > 0 && (
            <div className="alert scan-failed" role="alert">
              <p>{failed.length === 1 ? "1 scan wasn't recorded. Scan it again:" : `${failed.length} scans weren't recorded. Scan them again:`}</p>
              <ul>
                {failed.map((f, i) => (
                  <li key={i}>{f}</li>
                ))}
              </ul>
              <button type="button" onClick={() => setFailed([])}>
                Dismiss
              </button>
            </div>
          )}
          {said?.back && mode === 'in' && <DamageTo key={`damage-${said.at}`} a={said.back} job={job} say={say} />}
        </section>
      )}

      <section className="card pick-list" aria-label="Kit">
        <h2>{mode === 'out' ? 'Kit to go out' : 'Kit coming back'}</h2>
        {(parts.length > 1 || mode === 'out') && rows.length > 0 && (
          <div className="pick-ways">
            {parts.length > 1 && (
              <div className="filters" role="group" aria-label="Whose kit">
                <button type="button" aria-pressed={part === 'all'} onClick={() => setPrefs({ part: 'all' })}>
                  All
                </button>
                {parts.map((d) => {
                  const left = inMode.filter((r) => departmentOfRow(r) === d && !rowDone(r, mode)).length
                  return (
                    <button key={d} type="button" aria-pressed={part === d} onClick={() => setPrefs({ part: d })}>
                      {DEPARTMENT_LABELS[d]}
                      <span className="left">{left ? `${left.toLocaleString('en-IE')} left` : 'done'}</span>
                    </button>
                  )
                })}
              </div>
            )}
            {mode === 'out' && (
              <div className="filters" role="group" aria-label="In what order">
                <button type="button" aria-pressed={!byPlace} onClick={() => setPrefs({ order: 'department' })}>
                  By department
                </button>
                <button type="button" aria-pressed={byPlace} onClick={() => setPrefs({ order: 'place' })}>
                  By where it's kept
                </button>
              </div>
            )}
          </div>
        )}
        {rows.length === 0 && (
          <Empty>
            Add the job's kit on <a href={`#jobs/${job.id}/kit`}>its page</a>.
          </Empty>
        )}
        {mode === 'in' && rows.length > 0 && inMode.length === 0 && <Empty>Kit shows here once it has gone out with this job.</Empty>}
        {(() => {
          const row = (r: PickRow) => <Row key={r.modelId} row={r} job={job} mode={mode} say={say} mayMove={mayMove} />
          if (byPlace) {
            // A walk round the warehouse: what's left, under the place most of it is kept; what's done, folded at the end.
            const done = shown.filter((r) => rowDone(r, mode))
            return (
              <>
                {walk(shown.filter((r) => !rowDone(r, mode))).map(([where, here]) => (
                  <div className="kit-group" key={where}>
                    <h3>{where}</h3>
                    {here.map(row)}
                  </div>
                ))}
                {done.length > 0 && (
                  <details className="pick-done">
                    <summary>{done.length === shown.length ? `All ${done.length.toLocaleString('en-IE')} done` : `${done.length.toLocaleString('en-IE')} done`}</summary>
                    {done.map(row)}
                  </details>
                )}
              </>
            )
          }
          const byDepartment = new Map<Department | 'extra', PickRow[]>()
          for (const r of shown) {
            const d = r.lines.length === 0 ? 'extra' : departmentOfRow(r)
            byDepartment.set(d, [...(byDepartment.get(d) ?? []), r])
          }
          const groups: [Department | 'extra', string][] = [...DEPARTMENTS.map((d) => [d, DEPARTMENT_LABELS[d]] as [Department, string]), ['extra', 'Not on the kit']]
          return groups
            .filter(([d]) => byDepartment.has(d))
            .map(([d, label]) => {
              const here = byDepartment.get(d)!
              // What's still to do first, and what's done folded under it (audit, 20 October 2026, finding 5).
              const done = here.filter((r) => rowDone(r, mode))
              return (
                <div className="kit-group" key={d}>
                  <h3>{label}</h3>
                  {here.filter((r) => !rowDone(r, mode)).map(row)}
                  {done.length > 0 && (
                    <details className="pick-done">
                      <summary>{done.length === here.length ? `All ${done.length.toLocaleString('en-IE')} done` : `${done.length.toLocaleString('en-IE')} done`}</summary>
                      {done.map(row)}
                    </details>
                  )}
                </div>
              )
            })
        })()}
      </section>
    </div>
  )
}

/** The department a row's kit is in; a product since removed is Other. */
const departmentOfRow = (r: PickRow): Department => r.model?.department ?? 'other'

const PREFS = 'sh.pick'
interface Prefs {
  /** Whose kit: a department, or all of it. */
  part?: Department | 'all'
  /** Going out, the list by department (the kit's own order) or by where it's kept. */
  order?: 'department' | 'place'
}

/** How this phone last read pick lists (ADR 0072): kept for every job, as the person picking is the same from job to job. */
function usePickPrefs(): [Prefs, (change: Prefs) => void] {
  const [prefs, setPrefs] = useState<Prefs>(() => {
    try {
      const p = JSON.parse(localStorage.getItem(PREFS) ?? 'null') as Prefs | null
      return {
        ...(p?.part && (p.part === 'all' || (DEPARTMENTS as readonly string[]).includes(p.part)) ? { part: p.part } : {}),
        ...(p?.order === 'place' || p?.order === 'department' ? { order: p.order } : {}),
      }
    } catch {
      // Nothing kept, or storage is blocked: start from who they are.
      return {}
    }
  })
  const change = (c: Prefs) => {
    const next = { ...prefs, ...c }
    setPrefs(next)
    try {
      localStorage.setItem(PREFS, JSON.stringify(next))
    } catch {
      // Private browsing can refuse storage; the choice lasts this visit.
    }
  }
  return [prefs, change]
}

/** The line under the title: how far along, for the part shown and, when that's one department, for the whole job. */
function totalLine(pick: PickList, shown: PickRow[], mode: Direction, part: Department | 'all'): { text: string; done: boolean } {
  const n = (x: number) => x.toLocaleString('en-IE')
  if (mode === 'out') {
    if (!pick.need) return { text: 'Nothing on the kit to go out yet.', done: false }
    const whole = pick.out >= pick.need ? `All ${n(pick.need)} out: ready to load.` : `${n(pick.out)} of ${n(pick.need)} out`
    if (part === 'all') return { text: whole, done: pick.out >= pick.need }
    const kit = shown.filter((r) => r.lines.length > 0)
    const need = kit.reduce((t, r) => t + r.need, 0)
    const out = kit.reduce((t, r) => t + Math.min(r.out, r.need), 0)
    const mine = out >= need ? `${DEPARTMENT_LABELS[part]}: all ${n(need)} out` : `${DEPARTMENT_LABELS[part]}: ${n(out)} of ${n(need)} out`
    return { text: pick.out >= pick.need ? `${mine}. ${whole}` : `${mine} · ${n(pick.out)} of ${n(pick.need)} in all`, done: out >= need }
  }
  const sum = (rows: PickRow[]) => rows.reduce((t, r) => ({ back: t.back + r.back, out: t.out + r.out, missing: t.missing + r.missing }), { back: 0, out: 0, missing: 0 })
  const t = part === 'all' ? { back: pick.back, out: pick.stillOut, missing: pick.missing } : sum(shown)
  if (!t.back && !t.out && !t.missing) return { text: 'Nothing has gone out yet.', done: false }
  const text = `${n(t.back)} back, ${n(t.out)} still out${t.missing ? `, ${n(t.missing)} missing` : ''}`
  return { text: part === 'all' ? text : `${DEPARTMENT_LABELS[part]}: ${text}`, done: t.out === 0 && t.missing === 0 }
}

/**
 * Going out, the rows still to pick under the place most of each is kept,
 * places in the stock list's order, so the list reads as a walk round the
 * warehouse; a row with nothing left to find goes last.
 */
function walk(rows: PickRow[]): [string, PickRow[]][] {
  const places = new Map<string, PickRow[]>()
  const nowhere: PickRow[] = []
  for (const r of rows) {
    const most = r.from.reduce<PickFrom | undefined>((best, f) => (!best || f.items.length + f.counted > best.items.length + best.counted ? f : best), undefined)
    if (most) places.set(most.where, [...(places.get(most.where) ?? []), r])
    else nowhere.push(r)
  }
  const out = [...places.entries()].sort(([a], [b]) => byWhere.compare(a, b))
  if (nowhere.length) out.push(['Nowhere in stock', nowhere])
  return out
}
const byWhere = new Intl.Collator('en-IE', { numeric: true })

/**
 * What the person picking needs before they start, when they didn't plan
 * it (ADR 0072): when the kit is first needed and where, and the vans it
 * goes in. The kit's own notes are on its rows.
 */
function Brief({ view, job, today }: { view: View; job: JobView; today: string }) {
  const next = job.phases.find((p) => p.end >= today)
  if (!next) return null
  const days = daysBetween(today, next.start)
  const when = next.start < today ? 'On now' : days === 0 ? 'Today' : days === 1 ? 'Tomorrow' : `In ${days.toLocaleString('en-IE')} days`
  const vans = view.vehicles.ofJob(job.id).filter((b) => b.end >= today)
  return (
    <ul className="pick-brief" aria-label="Before you start">
      <li>
        <b>{when}</b>: {next.name}, {dayLabel(next.start)}
        {next.venue && ` at ${next.venue.name}`}
      </li>
      {vans.length > 0 && (
        <li>
          <b>Going in</b>: {vans.map((b) => `${b.vehicle ? vehicleName(b.vehicle) : 'a vehicle since removed'}${b.driver ? `, ${b.driver.name} driving` : ''}`).join('; ')}
        </li>
      )}
    </ul>
  )
}

/** Keeps the phone's screen on while kit is being picked, so it isn't unlocked again with gloves on between scans. */
function useWakeLock(on: boolean) {
  useEffect(() => {
    const lock = (navigator as Navigator & { wakeLock?: { request(type: 'screen'): Promise<{ release(): Promise<void> }> } }).wakeLock
    if (!on || !lock) return
    let held: { release(): Promise<void> } | undefined
    let gone = false
    const take = () => {
      if (document.visibilityState !== 'visible') return
      // Refused (low battery, or a browser that asks): the screen sleeps as it always did.
      lock.request('screen').then((l) => (gone ? void l.release() : (held = l)), () => undefined)
    }
    // The lock goes when the page is hidden; take it again on coming back.
    document.addEventListener('visibilitychange', take)
    take()
    return () => {
      gone = true
      document.removeEventListener('visibilitychange', take)
      void held?.release().catch(() => undefined)
    }
  }, [on])
}

/** Takes back the last scan or count, by recording the opposite: what was recorded stays in the history. */
function UndoButton({ undo, say }: { undo: Undo; say: Say }) {
  const { run, error } = useAct()
  return (
    <>
      <button type="button" className="undo" onClick={() => void run(undo.run).then((ok) => ok && say('quiet', `Undone: ${undo.said}`))}>
        Undo
      </button>
      <Refusal error={error} />
    </>
  )
}

/**
 * The item scanned was in a case reported missing, so the case was marked found with it; this says it had been taken out of
 * the case instead (audit, 20 October 2026, finding 102): it comes out of the case, and the case is reported missing again,
 * with the same note.
 */
function NotInCase({ item, holder, fault, say }: OutOfCase & { say: Say }) {
  const { run, error } = useAct()
  const number = holder.number || 'the case'
  const separate = async () => {
    await client.mutate('asset.move', { id: item.id, placeId: null, caseId: null })
    await reportFault({ kind: 'missing', assetId: holder.id, modelId: holder.modelId, qty: 1, projectId: fault.projectId, usable: false, note: fault.note })
  }
  return (
    <>
      <button
        type="button"
        onClick={() => void run(separate).then((ok) => ok && say('warn', `${item.number || 'It'} is out of ${number}, and ${number} is reported missing again.`))}
      >
        It's not in {number} any more
      </button>
      <Refusal error={error} />
    </>
  )
}

/** Coming back: report damage to the item just scanned. Once it's reported, the scan line says so and the button goes (audit, 20 October 2026, finding 42). */
function DamageTo({ a, job, say }: { a: AssetView; job: JobView; say: Say }) {
  const [open, setOpen] = useState(false)
  if (!open)
    return (
      <div className="actions">
        <button type="button" onClick={() => setOpen(true)}>
          Report damage to {a.number || 'it'}
        </button>
      </div>
    )
  return (
    <ReportFault
      kind="damaged"
      asset={a}
      model={a.model}
      projectId={job.id}
      onDone={() => setOpen(false)}
      onReported={({ usable }) => say('warn', damagedText(a.number || itemName(a), usable))}
    />
  )
}

/** "SH-000013 reported damaged: can't go out until it's fixed." */
const damagedText = (what: string, usable: boolean, many = false) =>
  `${what} reported damaged: ${usable ? `${many ? 'they' : 'it'} can still go out.` : `can't go out until ${many ? "they're" : "it's"} fixed.`}`

/** "1 in Bay A2 can't go out (damaged)", the kit card's words, or "2 missing". */
function heldText(h: PickRow['held'][number]): string {
  const n = h.items.length.toLocaleString('en-IE')
  if (h.why === 'missing') return `${n} missing`
  return `${n} ${h.where === 'Not said where' ? 'not placed' : `in ${h.where}`} can't go out (${h.why === 'damaged' ? 'damaged' : 'due a test'})`
}

/** What a scan or a tap on the list did, said in the scan line at the top, where the eye already goes. */
type Say = (tone: Tone, text: string, more?: { back?: AssetView; undo?: Undo; outOf?: OutOfCase }) => void

/** All out that's needed, or all back: nothing left to do on the row. */
const rowDone = (row: PickRow, mode: Direction) => (mode === 'out' ? row.lines.length > 0 && row.out >= row.need : row.out === 0 && row.missing === 0)

function Row({ row, job, mode, say, mayMove }: { row: PickRow; job: JobView; mode: Direction; say: Say; mayMove: boolean }) {
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
  const done = rowDone(row, mode)
  const [damage, setDamage] = useState(false)
  const { run, error } = useAct()
  const countable = row.model?.tracking === 'bulk' || (row.model?.countedTotal ?? 0) > 0 || row.counted > 0 || row.countedBack > 0
  const lines = row.lines.length > 1 ? row.lines.map((l) => `${l.own} for ${l.phase?.name ?? (l.phaseId ? 'a phase' : 'the whole job')}`).join(', ') : ''
  // Whoever put the kit on knew why; whoever picks it may not (ADR 0072).
  const notes = row.lines.filter((l) => l.notes?.trim()).map((l) => (row.lines.length > 1 ? `${l.phase?.name ?? 'Whole job'}: ${l.notes!.trim()}` : l.notes!.trim()))
  return (
    <article className={`pick-row${done ? ' done' : ''}`} aria-label={name}>
      <header>
        <div>
          <b>{name}</b>
          {lines && <p>{lines}</p>}
        </div>
        <span className="count">{count}</span>
      </header>
      {notes.map((n, i) => (
        <p className="pick-note" key={i}>
          <b>Note</b> {n}
        </p>
      ))}
      {extra && (
        <p className={`kit-state ${row.model?.isCase ? 'quiet' : 'warn'}`}>
          {row.model?.isCase ? "A case: what's in it counts on its own rows." : `Not on the kit for ${job.name}.`}
        </p>
      )}
      {mode === 'out' && !extra && row.out < row.need && row.from.length > 0 && (
        <ul className="from" aria-label="Where to find them">
          {/* One line a place with how many are there; the numbers folded under it (audit, 20 October 2026, finding 5): every
              number of every item in stock made a 300-line pick list 56,000 px long on a phone. */}
          {row.from.map((f) => (
            <li key={f.where}>
              <b>{f.where}</b>
              {`: ${(f.items.length + f.counted).toLocaleString('en-IE')} here`}
              {f.items.length > 0 && (
                <details>
                  <summary>{f.items.length === 1 ? 'Its number' : `The ${f.items.length.toLocaleString('en-IE')} numbers`}</summary>
                  {/* Each number kept whole on its line, so it never breaks at its hyphen (audit, 20 October 2026, finding 41). */}
                  <p>
                    {f.items.map((a, i) => (
                      <span key={a.id}>
                        {i > 0 && ', '}
                        <span className="number">{a.number || 'no number yet'}</span>
                      </span>
                    ))}
                  </p>
                </details>
              )}
            </li>
          ))}
        </ul>
      )}
      {mode === 'out' && !extra && row.out < row.need && row.from.length === 0 && (
        <p className="kit-state warn">
          {row.held.length
            ? `None fit to go out: ${row.held.map(heldText).join('; ')}. Subhire them on the job's page, or sort them out on Repairs or Testing.`
            : "None in the stock list that aren't out. Subhire them on the job's page, or count them in the Stock tab."}
        </p>
      )}
      {row.items.length > 0 && (
        <ul className="numbers out-items" aria-label={mode === 'out' ? 'Out' : 'Still out'}>
          {row.items.map((a) => (
            <li key={a.id}>
              <a href={`#stock/item/${a.id}`}>{a.number || 'no number yet'}</a>
              {/* Apart and at least 44 px wide, so a gloved tap for Back doesn't land on Missing; Missing is the quieter of the two,
                  and happens at once with Undo beside its answer (audit, 20 October 2026, finding 40). */}
              {mayMove && (
                <button type="button" className="link" onClick={() =>
                    void run(() => record(job.id, 'in', { assetId: a.id, modelId: a.modelId })).then(
                      (ok) =>
                        ok &&
                        say('ok', mode === 'out' ? `${a.number || name} isn't going: it's back in stock.` : `${a.number || name} back.`, {
                          undo: { run: () => record(job.id, 'out', { assetId: a.id, modelId: a.modelId }), said: `${a.number || name} is out with ${job.name} again.` },
                        })
                    )
                  }
                >
                  {mode === 'out' ? 'Not going' : 'Back'}
                </button>
              )}
              {mode === 'in' && (
                <button
                  type="button"
                  className="link quiet"
                  onClick={() => {
                    const id = newId()
                    void run(() => reportFault({ id, kind: 'missing', assetId: a.id, modelId: a.modelId, qty: 1, projectId: job.id, usable: false, note: '' })).then(
                      (ok) =>
                        ok &&
                        say('warn', `${a.number || name} marked missing. Scan it when it turns up and it's marked found.`, {
                          // Taken back as the opposite (ADR 0072): the report closed as found, and the item out with the job again.
                          undo: {
                            run: async () => {
                              await client.mutate('fault.close', { id, outcome: 'found', at: new Date().toISOString() })
                              await record(job.id, 'out', { assetId: a.id, modelId: a.modelId })
                            },
                            said: `${a.number || name} isn't missing: it's out with ${job.name} again.`,
                          },
                        })
                    )
                  }}
                >
                  Missing
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      <Refusal error={error} />
      {mode === 'in' && row.missingItems.length > 0 && (
        <ul className="numbers missing-items" aria-label="Missing">
          {row.missingItems.map((a) => (
            <li key={a.id}>
              <a href={`#stock/item/${a.id}`}>{a.number || 'no number yet'}</a>
            </li>
          ))}
        </ul>
      )}
      {countable && mayMove && <Count row={row} job={job} mode={mode} say={say} />}
      {mode === 'in' && countable && row.countedBack > 0 && !damage && (
        <button type="button" className="link" onClick={() => setDamage(true)}>
          Report damage to counted {name}
        </button>
      )}
      {damage && (
        <ReportFault
          kind="damaged"
          model={row.model}
          projectId={job.id}
          most={row.countedBack}
          onDone={() => setDamage(false)}
          onReported={({ usable, qty }) => say('warn', damagedText(`${qty.toLocaleString('en-IE')} × ${name}`, usable, qty > 1))}
        />
      )}
    </article>
  )
}

/** Counted kit, and numbered products not labelled yet: how many go out, or come back. */
function Count({ row, job, mode, say }: { row: PickRow; job: JobView; mode: Direction; say: Say }) {
  const name = rowName(row)
  const [qty, setQty] = useState('')
  const { run, error, refuse } = useAct()
  const go = (what: Direction | 'missing', all?: number) => {
    const n = all ?? Number(qty)
    if (!Number.isInteger(n) || n < 1 || n > MAX_QTY) return refuse('How many? A whole number, please.')
    void run(() =>
      what === 'missing'
        ? reportFault({ kind: 'missing', assetId: null, modelId: row.modelId, qty: n, projectId: job.id, usable: false, note: '' })
        : record(job.id, what, { modelId: row.modelId, qty: n })
    ).then((ok) => {
      if (!ok) return
      setQty('')
      const many = `${n.toLocaleString('en-IE')} × ${name}`
      if (what === 'missing') return say('warn', `${many} marked missing.`)
      const undo: Undo = { run: () => record(job.id, what === 'out' ? 'in' : 'out', { modelId: row.modelId, qty: n }), said: what === 'out' ? `${many} not counted out.` : `${many} not counted back.` }
      say('ok', what === 'out' ? `${many} counted out.` : `${many} counted back.`, { undo })
    })
  }
  const submit = (e: FormEvent) => {
    e.preventDefault()
    go(mode)
  }
  const label = mode === 'out' ? 'Count out' : 'Count back'
  // The rest in one tap, with gloves on (ADR 0072): going out, what the kit still needs and is counted on the shelves; coming back, all counted out.
  const onShelf = row.from.reduce((n, f) => n + f.counted, 0)
  const rest = mode === 'out' ? (row.lines.length ? Math.min(Math.max(0, row.need - row.out), onShelf) : 0) : row.counted
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
      <button type="submit">{label}</button>
      {rest > 1 && (
        <button type="button" className="all" onClick={() => go(mode, rest)}>
          {mode === 'out' ? `Count out the ${rest.toLocaleString('en-IE')}` : `Count back all ${rest.toLocaleString('en-IE')}`}
        </button>
      )}
      {mode === 'in' && row.counted > 0 && (
        <button type="button" onClick={() => go('missing')}>
          Missing
        </button>
      )}
      <Refusal error={error} />
    </form>
  )
}
