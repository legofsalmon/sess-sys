import {
  DEPARTMENT_LABELS,
  DEPARTMENTS,
  FROM_NOTES_JOBS,
  MAX_QTY,
  newId,
  notesPlan,
  plural,
  sectionDepartment,
  spanLabel,
  STOPPED,
  TRACKING,
  type Department,
  type JobNotesKit,
  type JobView,
  type NoteChoice,
  type NotesPlan,
  type RowPlan,
  type Tracking,
  type View,
} from '@sh/shared'
import { useMemo, useState, type FormEvent } from 'react'
import { Confirm, Refusal, useAct } from '../act.tsx'
import { Empty } from '../Empty.tsx'
import { ShowAll } from '../Fold.tsx'
import { Heading } from '../Icon.tsx'
import { useAccess } from '../role.ts'
import { client } from '../sync.ts'
import { JOBS, type Step } from '../Up.tsx'
import { Top } from './common.tsx'
import type { Tone } from './Kit.tsx'

/**
 * Kit from the notes (ADR 0043). A job brought in from Google Calendar
 * keeps each event's description in its notes, and many hold a kit list.
 * A job's page offers to turn it into kit lines (#jobs/<id>/notes-kit):
 * each line as written, the product it matched and how sure that is, a
 * choice of another, "Not kit", or a new product where the role can add
 * one, and nothing is added until the office says so. What's on the job
 * already isn't added again. Kit in the notes (#jobs/notes-kit) lists the
 * jobs whose notes hold kit not on them yet, to work through a season, and
 * adds the ones with nothing to check in one go. The notes stay as written.
 * The reading and matching are this device's own, so it all works with no
 * signal.
 */

export const NOTES_KIT: Step = { href: '#jobs/notes-kit', label: 'Kit in the notes' }

/** "6 to add, 2 to check": what a job's notes still want, for a list. */
function stillWants(plan: NotesPlan): string {
  const toAdd = plan.rows.filter((r) => r.state === 'add').length
  return [toAdd ? `${toAdd} to add` : '', plan.checking ? `${plan.checking} to check` : '', plan.choosing ? `${plan.choosing} with no product yet` : ''].filter(Boolean).join(', ')
}

/** On a job's Kit card: what its notes list, and the way to turn it into kit. Nothing when they list none. */
export function NotesKitLink({ job, view }: { job: JobView; view: View }) {
  const n = view.notesKit.forJob(job.id)
  const mayKit = useAccess().can('kit')
  if (!n || !mayKit) return null
  const kit = n.plan.rows.filter((r) => r.state !== 'not-kit').length
  const toAdd = n.plan.rows.filter((r) => r.state === 'add').length
  const open = !n.read && (toAdd > 0 || n.plan.choosing > 0)
  return (
    <div className="pick-link notes-kit-link">
      <a className="button" href={`#jobs/${encodeURIComponent(job.id)}/notes-kit`}>
        Kit from the notes
      </a>
      <span>
        {open
          ? `The notes list ${plural(kit, 'line')} of kit${toAdd ? `; ${toAdd === kit ? (toAdd === 1 ? "it isn't" : "none are") : `${toAdd} aren't`} on the job yet` : ''}${n.plan.choosing ? `, ${n.plan.choosing} with no product found` : ''}.`
          : 'What the notes list is on the job.'}
      </span>
    </div>
  )
}

/** On the Jobs list and the bring-in: how many jobs' notes hold kit not on them yet, for the roles that put kit on jobs. */
export function NotesKitNudge({ view }: { view: View }) {
  const mayKit = useAccess().can('kit')
  if (!mayKit) return null
  const n = view.notesKit.toDo.length
  if (n === 0) return null
  return (
    <section className="card notes-kit-nudge" aria-label="Kit in the notes">
      <Heading icon="kit">Kit in the notes</Heading>
      <p>
        {n === 1 ? "1 job's notes list" : `${n.toLocaleString('en-IE')} jobs' notes list`} kit that isn't on {n === 1 ? 'the job' : 'them'} yet.{' '}
        <a href="#jobs/notes-kit">Work through them</a>
      </p>
    </section>
  )
}

/** The words and tone for a row once the choices are in. */
function rowSays(p: RowPlan, chosen: boolean): { tone: Tone; text: string } {
  const how = p.row.match.how
  const adds = p.onJob ? `Adds ${p.adds}: the job has ${p.onJob} on these days already.` : `Adds ${p.adds}.`
  switch (p.state) {
    case 'already':
      return { tone: 'quiet', text: `Already on the job: ${p.onJob} on these days.` }
    case 'not-kit':
      if (chosen) return { tone: 'quiet', text: 'Not kit, so left out.' }
      if (how === 'chosen') return { tone: 'quiet', text: 'Not kit, as chosen before, so left out.' }
      return { tone: 'quiet', text: "Under transport and labour, and like nothing in the stock list, so it's left out as not kit." }
    case 'choose':
      return {
        tone: 'warn',
        text: p.row.match.likely.length ? "Not sure which product this is. Choose one, or say it's not kit." : "Nothing like it in the stock list. Choose a product, or say it's not kit.",
      }
    case 'add':
      if (chosen) return { tone: 'quiet', text: adds }
      if (how === 'name') return { tone: 'quiet', text: `Matches by name. ${adds}` }
      if (how === 'chosen') return { tone: 'quiet', text: `As chosen before. ${adds}` }
      if (how === 'code') return { tone: 'warn', text: `Matched by its model: check it's the right one. ${adds}` }
      return { tone: 'warn', text: `A close match: check it's the right one. ${adds}` }
  }
}

/** One job's notes, line by line, to check before anything goes on its kit. */
export function NotesKitScreen({ view, jobId }: { view: View; jobId: string }) {
  const job = view.jobs.jobs.find((j) => j.id === jobId)
  const n = view.notesKit.forJob(jobId)
  const access = useAccess()
  const mayKit = access.can('kit')
  const [choices, setChoices] = useState<Record<string, NoteChoice>>({})
  const [making, setMaking] = useState<string>()
  const [done, setDone] = useState('')
  const { run, error, refuse } = useAct()
  const plan = useMemo(() => (n ? notesPlan(n.rows, n.kit, choices, newId) : undefined), [n, choices])
  const up = { steps: job ? [JOBS, { href: `#jobs/${encodeURIComponent(job.id)}`, label: job.name }] : [JOBS], here: 'Kit from the notes' }

  if (!job || !n || !plan)
    return (
      <div className="app crew jobs notes-kit">
        <Top view={view} up={up} />
        <section className="card">
          <p className="empty">
            {!job ? "This job isn't on this device. It may still be on its way: check again once it says “Up to date”." : "This job's notes don't list any kit: no line like “4 x d&b Y10P”."}
          </p>
        </section>
      </div>
    )

  const choose = (key: string, c: NoteChoice) => {
    setDone('')
    setChoices((now) => ({ ...now, [key]: { ...now[key], ...c } }))
  }
  const toAdd = plan.rows.filter((r) => r.state === 'add').length
  const next = view.notesKit.toDo.find((x) => x.job.id !== job.id)
  const nothingNew = n.read && plan.adding === 0 && plan.names.length === 0
  const add = () => {
    setDone('')
    const said = plan.adding ? `Added ${plural(plan.adding, 'line')} to the kit for ${job.name}.` : `Done: nothing to add to ${job.name}.`
    void run(() => client.mutate('kit.fromNotes', { jobs: [{ projectId: job.id, sum: n.sum, lines: plan.lines }], names: plan.names })).then((ok) => {
      if (ok) {
        setChoices({})
        setDone(said)
      }
    })
  }
  const scopes = [{ id: null as string | null, name: 'Whole job', when: job.span ? spanLabel(job.span) : 'no dates yet' }, ...job.phases.map((p) => ({ id: p.id as string | null, name: p.name, when: spanLabel(p) }))]

  return (
    <div className="app crew jobs notes-kit">
      <Top view={view} up={up} />
      <section className="card">
        <header className="title">
          <h1>Kit from the notes</h1>
        </header>
        <p className="hint">
          The lines of {job.name}'s notes that look like kit, each matched to the stock list. Nothing goes on the job until you add it, what's on it already isn't added again,
          and the notes stay as written.
        </p>
        {STOPPED.includes(job.status) && <p className="hint">This job is {job.status}, so its kit isn't held for it.</p>}
        {!mayKit && <p className="hint">You can look; putting kit on a job is for the office, heads of department and the warehouse.</p>}
      </section>

      {scopes.map((s) => {
        const rows = plan.rows.filter((r) => r.row.phaseId === s.id)
        if (rows.length === 0) return null
        return (
          <section className="card kit" key={s.id ?? 'job'} aria-label={s.id ? `${s.name}'s notes` : "The job's notes"}>
            <Heading icon={s.id ? 'time' : 'kit'}>{s.id ? `${s.name}'s notes` : "The job's notes"}</Heading>
            <p className="hint">
              For {s.id ? s.name : 'the whole job'}, {s.when}
            </p>
            {rows.map((p) => (
              <NoteLine
                key={p.row.key}
                p={p}
                view={view}
                chosen={choices[p.row.key]?.pick !== undefined}
                mayKit={mayKit}
                mayStock={access.can('stock')}
                making={making === p.row.key}
                onChoose={(c) => choose(p.row.key, c)}
                onMake={(on) => setMaking(on ? p.row.key : undefined)}
              />
            ))}
          </section>
        )
      })}

      <section className="bring notes-kit-add" aria-label="Add to the kit">
        <p>
          {plan.adding ? `Adds ${plural(plan.adding, 'line')} to the kit${toAdd > plan.adding ? `, from ${toAdd} lines of the notes` : ''}.` : 'Nothing to add: what the notes list is on the job, or left out.'}
          {plan.choosing ? ` ${plan.choosing === 1 ? '1 line is' : `${plan.choosing} lines are`} left out until a product is chosen for ${plan.choosing === 1 ? 'it' : 'them'}.` : ''}
        </p>
        <Refusal error={error} />
        {done && (
          <p className="added" role="status">
            {done}{' '}
            {next ? (
              <a href={`#jobs/${encodeURIComponent(next.job.id)}/notes-kit`}>Next: {next.job.name} ›</a>
            ) : (
              <a href={`#jobs/${encodeURIComponent(job.id)}/kit`}>Back to the job</a>
            )}
          </p>
        )}
        {mayKit && !nothingNew && (
          <div className="actions">
            <button
              type="button"
              className="primary"
              onClick={() => {
                if (plan.lines.some((l) => l.qty > MAX_QTY)) return refuse('That would make more than a line can hold.')
                add()
              }}
            >
              {plan.adding ? `Add ${plural(plan.adding, 'line')} to the kit` : 'Done: nothing to add'}
            </button>
            <a href="#jobs/notes-kit">All jobs with kit in their notes</a>
          </div>
        )}
        {(!mayKit || nothingNew) && <a href="#jobs/notes-kit">All jobs with kit in their notes</a>}
      </section>
    </div>
  )
}

/** A line of the notes as written, what it matched, and the way to change it. */
function NoteLine({
  p,
  view,
  chosen,
  mayKit,
  mayStock,
  making,
  onChoose,
  onMake,
}: {
  p: RowPlan
  view: View
  chosen: boolean
  mayKit: boolean
  mayStock: boolean
  making: boolean
  onChoose: (c: NoteChoice) => void
  onMake: (on: boolean) => void
}) {
  const models = view.warehouse.models
  const says = rowSays(p, chosen)
  const value = making ? 'new' : p.state === 'not-kit' ? 'not-kit' : (p.modelId ?? '')
  const likely = p.row.match.likely.map((id) => models.find((m) => m.id === id)).filter((m): m is NonNullable<typeof m> => !!m)
  const [qty, setQty] = useState(String(p.qty))
  return (
    <article className="kit-line note-line" aria-label={p.row.line.text}>
      <header>
        <div>
          <b className="written">{p.row.line.text}</b>
          {p.row.line.note && <p>Note: {p.row.line.note}</p>}
        </div>
      </header>
      <div className="grid-form">
        <label>
          Product
          <select
            value={value}
            disabled={!mayKit}
            onChange={(e) => {
              const v = e.target.value
              if (v === 'new') return onMake(true)
              onMake(false)
              if (v) onChoose({ pick: v })
            }}
          >
            {value === '' && <option value="">Choose a product…</option>}
            {likely.length > 0 && (
              <optgroup label="Most like it">
                {likely.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </optgroup>
            )}
            {DEPARTMENTS.map((d) => {
              const of = models.filter((m) => m.department === d && !likely.includes(m))
              return of.length ? (
                <optgroup key={d} label={DEPARTMENT_LABELS[d]}>
                  {of.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
                </optgroup>
              ) : null
            })}
            <option value="not-kit">Not kit</option>
            {mayStock && <option value="new">New product…</option>}
          </select>
        </label>
        <label>
          How many
          <input
            type="number"
            inputMode="numeric"
            min={1}
            max={MAX_QTY}
            value={qty}
            disabled={!mayKit || p.state === 'not-kit'}
            onChange={(e) => {
              setQty(e.target.value)
              const n = Number(e.target.value)
              if (Number.isInteger(n) && n >= 1 && n <= MAX_QTY) onChoose({ qty: n })
            }}
          />
        </label>
      </div>
      <p className={`kit-state ${says.tone}`}>{says.text}</p>
      {making && (
        <NewProduct
          p={p}
          view={view}
          onMade={(id) => {
            onMake(false)
            onChoose({ pick: id })
          }}
          onCancel={() => onMake(false)}
        />
      )}
    </article>
  )
}

/** A product the stock list doesn't have yet, named as the notes name it, where the role can add products (ADR 0013, 0034). */
function NewProduct({ p, view, onMade, onCancel }: { p: RowPlan; view: View; onMade: (id: string) => void; onCancel: () => void }) {
  const [f, setF] = useState({ name: p.row.line.name, department: sectionDepartment(p.row.line.section) as Department, tracking: 'serialised' as Tracking })
  const { run, error, refuse } = useAct()
  const save = (e: FormEvent) => {
    e.preventDefault()
    const name = f.name.trim()
    if (!name) return refuse("The product's name is needed.")
    const same = view.warehouse.models.find((m) => m.name.trim().toLowerCase() === name.toLowerCase())
    if (same) return refuse(`There's a product called ${same.name} already: choose it from the list.`)
    const id = newId()
    void run(() => client.mutate('model.create', { id, name, department: f.department, category: '', tracking: f.tracking, isCase: false, valueCents: null, notes: '' })).then((ok) => ok && onMade(id))
  }
  return (
    <form className="grid-form new-product" onSubmit={save} aria-label="New product">
      <label className="wide">
        Name
        <input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required />
      </label>
      <label>
        Department
        <select value={f.department} onChange={(e) => setF({ ...f, department: e.target.value as Department })}>
          {DEPARTMENTS.map((d) => (
            <option key={d} value={d}>
              {DEPARTMENT_LABELS[d]}
            </option>
          ))}
        </select>
      </label>
      <label>
        Kept
        <select value={f.tracking} onChange={(e) => setF({ ...f, tracking: e.target.value as Tracking })}>
          {TRACKING.map((t) => (
            <option key={t} value={t}>
              {t === 'serialised' ? 'Numbered, one by one' : 'Counted'}
            </option>
          ))}
        </select>
      </label>
      <p className="hint wide">It goes in the stock list with nothing counted yet. Its page, on the Stock tab, takes its category, value and count.</p>
      <Refusal error={error} className="wide" />
      <div className="actions wide">
        <button type="submit" className="primary">
          Add the product
        </button>
        <button type="button" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  )
}

/** "Fri 3 Oct to Sat 4 Oct", or that it has no dates. */
const whenOf = (n: JobNotesKit) => (n.job.span ? spanLabel(n.job.span) : 'No dates yet')

/** Every job whose notes list kit not on it yet, to work through a season of jobs brought in. */
export function NotesKitListScreen({ view }: { view: View }) {
  const mayKit = useAccess().can('kit')
  const toDo = view.notesKit.toDo
  const ready = view.notesKit.ready
  const check = toDo.filter((n) => !ready.includes(n))
  const lines = ready.reduce((s, n) => s + n.plan.adding, 0)
  const [asking, setAsking] = useState(false)
  const [done, setDone] = useState('')
  const { run, error } = useAct()

  const addAll = () => {
    setAsking(false)
    const jobs = ready.map((n) => ({ projectId: n.job.id, sum: n.sum, lines: n.plan.lines }))
    const said = `Added ${plural(lines, 'line')} to ${plural(jobs.length, 'job')}. They go to the server as soon as there's signal, and each can be changed on its job.`
    // A call at a time (ADR 0011, 0026): each change holds up to FROM_NOTES_JOBS jobs, so none is too big for the server to take in one go.
    void run(async () => {
      for (let at = 0; at < jobs.length; at += FROM_NOTES_JOBS) await client.mutate('kit.fromNotes', { jobs: jobs.slice(at, at + FROM_NOTES_JOBS), names: [] })
    }).then((ok) => ok && setDone(said))
  }

  return (
    <div className="app crew jobs notes-kit">
      <Top view={view} up={{ steps: [JOBS], here: NOTES_KIT.label }} />
      <section className="card">
        <header className="title">
          <h1>Kit in the notes</h1>
        </header>
        <p className="hint">
          Jobs brought in from Google Calendar keep each event's description in their notes. Where it lists kit, it can go on the job as kit lines. The notes stay as written.
        </p>
        {toDo.length === 0 && !done && <Empty>No job's notes list kit that isn't on the job. Jobs brought in from Google Calendar show here when theirs do.</Empty>}
        {done && (
          <p className="added" role="status">
            {done}
          </p>
        )}
      </section>

      {ready.length > 0 && (
        <section className="card" aria-label="Ready to add">
          <Heading icon="done">Ready to add</Heading>
          <p className="hint">
            {ready.length === 1 ? '1 job' : `${ready.length.toLocaleString('en-IE')} jobs`} where every line of kit matches a product by its name, or as chosen before, or is on the job already.
          </p>
          <Refusal error={error} />
          {mayKit &&
            (asking ? (
              <Confirm
                question={`Add ${plural(lines, 'line')} of kit to ${plural(ready.length, 'job')}, as their notes list them?`}
                yes="Add them"
                no="Not now"
                onYes={addAll}
                onNo={() => setAsking(false)}
              >
                <p>What's on each job already isn't added again. Any line can be changed or taken off on its job afterwards.</p>
              </Confirm>
            ) : (
              <div className="actions">
                <button type="button" className="primary" onClick={() => setAsking(true)}>
                  Add {plural(lines, 'line')} to {plural(ready.length, 'job')}
                </button>
              </div>
            ))}
          <JobsToDo list={ready} />
        </section>
      )}

      {check.length > 0 && (
        <section className="card" aria-label="To check">
          <Heading icon="attention">To check</Heading>
          <p className="hint">Jobs with a line that matched a product by a guess, or matched nothing. Open one to check its lines, then add them.</p>
          <JobsToDo list={check} />
        </section>
      )}
    </div>
  )
}

function JobsToDo({ list }: { list: readonly JobNotesKit[] }) {
  return (
    <ShowAll items={list} limit={8} what="jobs">
      {(shown) => (
        <ul className="job-list">
          {shown.map((n) => (
            <li key={n.job.id}>
              <a className="job-row" href={`#jobs/${encodeURIComponent(n.job.id)}/notes-kit`}>
                <div>
                  <b>{n.job.name}</b>
                  <p>{whenOf(n)}</p>
                </div>
                <div className="side">
                  <small className={n.plan.checking || n.plan.choosing ? 'flag warn' : undefined}>{stillWants(n.plan)}</small>
                </div>
              </a>
            </li>
          ))}
        </ul>
      )}
    </ShowAll>
  )
}
