import {
  dayLabel,
  DEFAULT_PREP_DAYS,
  DEFAULT_RETURN_DAYS,
  DEPARTMENT_LABELS,
  heldAround,
  kitDaysOf,
  MAX_KIT_DAYS,
  DEPARTMENTS,
  MAX_QTY,
  newId,
  plural,
  spanLabel,
  STOPPED,
  type CommandInput,
  type Department,
  type JobView,
  type KitLineView,
  type KitOther,
  type View,
} from '@sh/shared'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Confirm, Refusal, useAct } from '../act.tsx'
import { Empty } from '../Empty.tsx'
import { Fold, ShowAll } from '../Fold.tsx'
import { ProductChoices } from '../stock/common.tsx'
import { Pending } from '../StatusPill.tsx'
import { client } from '../sync.ts'
import { useToday } from '../view.ts'

/**
 * Kit on jobs (ADR 0014): what a job needs from the stock list, for the
 * whole job or one phase, by department, each line saying whether there's
 * enough on its days once the other jobs have theirs. Worked out on this
 * device (view.kit), so it works with no signal. Short is never a reason
 * to refuse a line: the count may be unfinished, or it's about to be
 * subhired.
 */

/** "Whole job · Mon 6 Oct to Sat 11 Oct", or the phase's name and days. */
export function forLabel(l: KitLineView): string {
  if (l.phaseId) return l.phase ? `${l.phase.name} · ${spanLabel(l.phase)}` : 'A phase since removed'
  return `Whole job · ${l.job?.span ? spanLabel(l.job.span) : 'no dates yet'}`
}

export const productName = (l: KitLineView) => l.model?.name ?? 'A product since removed'

/** "Nissan", "Nissan and Fuel", "Nissan, Fuel and Tour". */
const inWords = (parts: string[]) => (parts.length <= 1 ? (parts[0] ?? '') : `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}`)

/** "8 on Electric Picnic and 2 more on this job". */
const whoHas = (others: KitOther[]) => inWords(others.map((o) => (o.same ? `${o.qty} more on this job` : `${o.qty} on ${o.name}`)))

export type Tone = 'bad' | 'warn' | 'ok' | 'quiet'

/** Why some aren't counted as owned: "1 damaged, missing or due a test and 2 still out after their jobs". */
function notFree(l: KitLineView): string {
  return inWords(
    [
      l.unusable ? `${l.unusable} damaged, missing or due a test` : '',
      l.late ? `${l.late} still out after ${l.late === 1 ? 'its job' : 'their jobs'}` : '',
    ].filter(Boolean)
  )
}

/** ", getting it ready" on a day before the line's own, ", checking it back in" on one after (ADR 0031). */
function whichDay(l: KitLineView, day: string): string {
  if (!l.span) return ''
  return day < l.span.start ? ', getting it ready' : day > l.span.end ? ', checking it back in' : ''
}

/**
 * Whether a line has enough, in words: "Short 2 on Wed 8 Oct: 10 owned, 4
 * on Fuel". Kit damaged or missing (ADR 0018), failed or overdue a test
 * (ADR 0020), or still out after another job (ADR 0031), isn't counted as
 * owned. A line's kit is held on its days to get it ready and check it
 * back too, so it can be short on those. Short on a confirmed job is bad; on
 * an enquiry or a quote it's a warning, as is enough that the pencilled jobs would use up. Undefined
 * when there's nothing to say: a stopped job, or days gone by.
 */
export function kitState(l: KitLineView, today: string): { tone: Tone; text: string } | undefined {
  const subhired = l.subhireQty > 0 ? `${l.subhireQty === l.qty ? 'All' : l.subhireQty} subhired${l.supplier ? ` from ${l.supplier}` : ''}.` : ''
  const say = (tone: Tone, text: string) => ({ tone, text: [subhired, text].filter(Boolean).join(' ') })
  if (l.hold === 'none' || (l.held && l.held.end < today)) return subhired ? say('quiet', '') : undefined
  if (!l.span) return say('quiet', l.phaseId ? "Its phase has been removed, so it isn't checked." : "No dates yet, so it isn't checked yet.")
  if (l.own === 0) return say('ok', '')
  const pencilled = l.hold === 'pencilled'
  if (l.short > 0) {
    const tone = pencilled ? 'warn' : 'bad'
    if (l.owned === 0 && l.unusable + l.late > 0)
      return say(
        tone,
        `None fit to go out: ${notFree(l)}, so ${pencilled ? 'it would be' : "it's"} short ${l.short} until they're ${l.late ? (l.unusable ? 'back, fixed, found or tested' : 'back') : 'fixed, found or tested'}.`
      )
    if (l.owned === 0) return say(tone, `None counted in stock yet, so ${pencilled ? 'it would be' : "it's"} short ${l.short} until they are.`)
    const held = l.others.filter((o) => o.hold === 'held')
    const more = l.shortDays > 1 ? ` Short on ${plural(l.shortDays - 1, 'other day')} too.` : ''
    return say(
      tone,
      `${pencilled ? 'Would be short' : 'Short'} ${l.short} on ${dayLabel(l.shortDay!)}${whichDay(l, l.shortDay!)}${pencilled ? ' if it goes ahead' : ''}: ${l.owned} owned${l.unusable || l.late ? ` and fit to go out (${notFree(l)})` : ''}${held.length ? `, ${whoHas(held)}` : ''}.${more}`
    )
  }
  if (l.ifPencilled > 0) {
    const names = l.others.filter((o) => o.hold === 'pencilled' && !o.same).map((o) => o.name)
    const unless = names.length ? `unless ${inWords(names)} ${names.length === 1 ? 'goes' : 'go'} ahead` : 'unless the enquiries and quotes then go ahead'
    return say('warn', `Enough, ${unless}: then short ${l.ifPencilled} on ${dayLabel(l.pencilledDay!)}${whichDay(l, l.pencilledDay!)}.`)
  }
  return say('ok', l.spare ? `Enough, with ${l.spare} to spare.` : 'Enough, with none to spare.')
}

/** "5 products, 2 short", for the job's summary; undefined with no kit. */
export function kitSummary(job: JobView, lines: readonly KitLineView[]): string | undefined {
  if (lines.length === 0) return undefined
  const products = plural(new Set(lines.map((l) => l.modelId)).size, 'product')
  if (STOPPED.includes(job.status)) return `${products}, not held`
  const short = new Set(lines.filter((l) => l.short > 0).map((l) => l.modelId)).size
  return short ? `${products}, ${short} short` : products
}

/** How a job's kit looks in a list: short on a confirmed job, or on one pencilled in; undefined when not short. */
export function kitShort(lines: readonly KitLineView[] | undefined): Tone | undefined {
  const short = lines?.find((l) => l.short > 0)
  return short ? (short.hold === 'held' ? 'bad' : 'warn') : undefined
}

/** The job page's Kit card. */
export function KitCard({ job, view }: { job: JobView; view: View }) {
  const lines = view.kit.byJob.get(job.id) ?? []
  const today = useToday()
  const department = (l: KitLineView): Department => l.model?.department ?? 'other'
  // In the order they're shown, so "Show all" adds to the end, not in among them; a line short or at risk stays in view.
  const byDepartment = DEPARTMENTS.flatMap((d) => lines.filter((l) => department(l) === d))
  const toAct = (l: KitLineView) => {
    const tone = kitState(l, today)?.tone
    return tone === 'bad' || tone === 'warn'
  }
  return (
    <section className="card kit" aria-label="Kit">
      <h2>Kit</h2>
      <PickLink job={job} view={view} lines={lines} />
      {lines.length > 0 && !STOPPED.includes(job.status) && <KitDays job={job} />}
      {STOPPED.includes(job.status) && lines.length > 0 && <p className="hint">This job is {job.status}, so its kit is free for other jobs.</p>}
      {lines.length === 0 && <Empty>Add what the job needs from the stock list, for the whole job or one phase.</Empty>}
      <ShowAll items={byDepartment} limit={3} what="lines" keep={toAct}>
        {(shown) =>
          DEPARTMENTS.filter((d) => shown.some((l) => department(l) === d)).map((d) => (
            <div className="kit-group" key={d}>
              <h3>{DEPARTMENT_LABELS[d]}</h3>
              {shown
                .filter((l) => department(l) === d)
                .map((l) => (
                  <KitLine key={l.id} line={l} job={job} today={today} />
                ))}
            </div>
          ))
        }
      </ShowAll>
      <Fold label="Add kit">
        <AddKit job={job} view={view} lines={lines} />
      </Fold>
      <ProductChoices w={view.warehouse} />
      <datalist id="supplier-names">
        {view.kit.suppliers.map((s) => (
          <option key={s} value={s} />
        ))}
      </datalist>
    </section>
  )
}

/** The way to the job's pick list (ADR 0017), with how much is out. */
function PickLink({ job, view, lines }: { job: JobView; view: View; lines: readonly KitLineView[] }) {
  const pick = view.moves.pickList(job.id)
  if (!pick || (lines.length === 0 && pick.stillOut === 0)) return null
  const said =
    pick.stillOut === 0 && pick.back > 0
      ? 'All back'
      : pick.stillOut > 0
        ? pick.need
          ? `Out: ${pick.out} of ${pick.need}`
          : `${pick.stillOut} out`
        : pick.need
          ? `${pick.need} to go out`
          : 'All subhired'
  return (
    <div className="pick-link">
      <a className="button" href={`#jobs/${job.id}/pick`}>
        Pick list
      </a>
      <span>{said}</span>
    </div>
  )
}

const daysWord = (n: number) => (n === 0 ? 'no days' : n === 1 ? 'a day' : `${n} days`)

/**
 * When the job's kit is held (ADR 0031): its days, with the days before to
 * get it ready and after to check it back in, which the job can change.
 */
function KitDays({ job }: { job: JobView }) {
  const { prep, back } = kitDaysOf(job)
  const [editing, setEditing] = useState(false)
  const [f, setF] = useState({ prep: String(prep), back: String(back) })
  const { run, error, refuse } = useAct()
  const held = job.span && heldAround(job, job.span)
  const save = (e: FormEvent) => {
    e.preventDefault()
    const p = Number(f.prep)
    const b = Number(f.back)
    const ok = (n: number) => Number.isInteger(n) && n >= 0 && n <= MAX_KIT_DAYS
    if (!f.prep.trim() || !f.back.trim() || !ok(p) || !ok(b)) return refuse(`Whole days, from 0 to ${MAX_KIT_DAYS}, before and after.`)
    const changes: CommandInput<'project.update'> = { id: job.id }
    if (p !== prep) changes.prepDays = p
    if (b !== back) changes.returnDays = b
    if (changes.prepDays === undefined && changes.returnDays === undefined) return setEditing(false)
    void run(() => client.mutate('project.update', changes)).then((done) => done && setEditing(false))
  }
  return (
    <div className="kit-days">
      <p>
        {held ? (
          <>
            Kit held <b>{spanLabel(held)}</b>:{' '}
          </>
        ) : (
          'Kit held '
        )}
        {daysWord(prep)} before to get it ready, {daysWord(back)} after to check it back in.{' '}
        {!editing && (
          <button type="button" className="link" onClick={() => setEditing(true)}>
            Change
          </button>
        )}
      </p>
      {editing && (
        <form className="grid-form" onSubmit={save} aria-label="Days to get kit ready and back">
          <label>
            Days before, to get it ready
            <input inputMode="numeric" value={f.prep} onChange={(e) => setF({ ...f, prep: e.target.value })} />
          </label>
          <label>
            Days after, to check it back in
            <input inputMode="numeric" value={f.back} onChange={(e) => setF({ ...f, back: e.target.value })} />
          </label>
          <p className="hint wide">
            Usually {daysWord(DEFAULT_PREP_DAYS)} before and {daysWord(DEFAULT_RETURN_DAYS)} after. None before when the job has its own Prep phase.
          </p>
          <Refusal error={error} className="wide" />
          <div className="actions wide">
            <button type="submit" className="primary">
              Save kit days
            </button>
            <button
              type="button"
              onClick={() => {
                setF({ prep: String(prep), back: String(back) })
                refuse('')
                setEditing(false)
              }}
            >
              Cancel
            </button>
          </div>
        </form>
      )}
    </div>
  )
}

function KitLine({ line, job, today }: { line: KitLineView; job: JobView; today: string }) {
  // Open with how many to subhire already filled in, from "Subhire the 2 short".
  const [editing, setEditing] = useState<{ subhire?: number } | undefined>()
  const state = kitState(line, today)
  return (
    <article className="kit-line" aria-label={`${line.qty} × ${productName(line)}`}>
      <header>
        <div>
          <b>
            {line.qty} × {productName(line)}
          </b>{' '}
          <Pending pending={line.pending} />
          <p>{forLabel(line)}</p>
          {line.notes && <p>{line.notes}</p>}
        </div>
        <button type="button" className="link" onClick={() => setEditing(editing ? undefined : {})} aria-expanded={!!editing}>
          Change
        </button>
      </header>
      {state && <p className={`kit-state ${state.tone}`}>{state.text}</p>}
      {line.short > 0 && !editing && (
        <button type="button" onClick={() => setEditing({ subhire: Math.min(line.qty, line.subhireQty + line.short) })}>
          Subhire the {line.short} short
        </button>
      )}
      {editing && <EditKit line={line} job={job} subhire={editing.subhire} onDone={() => setEditing(undefined)} />}
    </article>
  )
}

/** Whole job or one of its phases, by id; '' for the whole job. */
function ForChoice({ job, value, onChange }: { job: JobView; value: string; onChange: (phaseId: string) => void }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} aria-label="For which days">
      <option value="">Whole job</option>
      {job.phases.map((p) => (
        <option key={p.id} value={p.id}>
          {p.name}, {spanLabel(p)}
        </option>
      ))}
    </select>
  )
}

/** Only what was changed is sent, so someone else's change to another field stands. */
function EditKit({ line, job, subhire, onDone }: { line: KitLineView; job: JobView; subhire?: number; onDone: () => void }) {
  const [f, setF] = useState({
    qty: String(line.qty),
    phaseId: line.phaseId ?? '',
    subhired: String(subhire ?? line.subhireQty),
    supplier: line.supplier,
    notes: line.notes,
  })
  const [removing, setRemoving] = useState(false)
  const { run, error, refuse } = useAct()
  const supplierField = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (subhire !== undefined) supplierField.current?.focus()
  }, [subhire])
  const name = productName(line)

  const save = (e: FormEvent) => {
    e.preventDefault()
    const qty = Number(f.qty)
    const subhired = Number(f.subhired || 0)
    if (!Number.isInteger(qty) || qty < 1 || qty > MAX_QTY) return refuse('How many does the job need? A whole number, please.')
    if (!Number.isInteger(subhired) || subhired < 0) return refuse('How many are subhired? A whole number, please.')
    if (subhired > qty) return refuse(`The job needs ${qty}, so no more than ${qty} can be subhired.`)
    const changes: CommandInput<'kit.update'> = { id: line.id }
    if (qty !== line.qty) changes.qty = qty
    if ((f.phaseId || null) !== line.phaseId) changes.phaseId = f.phaseId || null
    if (subhired !== line.subhireQty) changes.subhireQty = subhired
    if (f.supplier.trim() !== line.supplier) changes.supplier = f.supplier.trim()
    if (f.notes.trim() !== line.notes) changes.notes = f.notes.trim()
    if (Object.keys(changes).length === 1) return onDone()
    void run(() => client.mutate('kit.update', changes)).then((ok) => ok && onDone())
  }
  const remove = () => {
    setRemoving(false)
    void run(() => client.mutate('kit.remove', { id: line.id })).then((ok) => ok && onDone())
  }

  return (
    <form className="grid-form" onSubmit={save} aria-label={`Change ${name}`}>
      <label>
        How many <input type="number" inputMode="numeric" min={1} max={MAX_QTY} value={f.qty} onChange={(e) => setF({ ...f, qty: e.target.value })} required />
      </label>
      <label>
        For <ForChoice job={job} value={f.phaseId} onChange={(phaseId) => setF({ ...f, phaseId })} />
      </label>
      <label>
        Subhired <input type="number" inputMode="numeric" min={0} max={MAX_QTY} value={f.subhired} onChange={(e) => setF({ ...f, subhired: e.target.value })} />
      </label>
      <label>
        From{' '}
        <input
          ref={supplierField}
          list="supplier-names"
          value={f.supplier}
          onChange={(e) => setF({ ...f, supplier: e.target.value })}
          placeholder="Who they're hired from"
        />
      </label>
      <label className="wide">
        Note <input value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} placeholder="e.g. spares, side stage" />
      </label>
      <Refusal error={error} className="wide" />
      {removing ? (
        <Confirm
          className="wide"
          question={`Take ${line.qty} × ${name} off the kit for ${job.name}? It's no longer held for the job, so it's free for others.`}
          yes="Take it off"
          onYes={remove}
          onNo={() => setRemoving(false)}
        />
      ) : (
        <div className="actions wide">
          <button type="submit" className="primary">
            Save line
          </button>
          <button type="button" onClick={onDone}>
            Cancel
          </button>
          <button type="button" className="link" onClick={() => setRemoving(true)}>
            Take off the kit
          </button>
        </div>
      )}
    </form>
  )
}

/** A product from the stock list, for the whole job or a phase. One already on the job for the same days is added to. */
function AddKit({ job, view, lines }: { job: JobView; view: View; lines: readonly KitLineView[] }) {
  const w = view.warehouse
  const [f, setF] = useState({ product: '', qty: '1', phaseId: '' })
  const { run, error, refuse } = useAct()
  const [added, setAdded] = useState('')

  const submit = (e: FormEvent) => {
    e.preventDefault()
    setAdded('')
    const typed = f.product.trim()
    if (!typed) return
    const m = w.models.find((x) => x.name.trim().toLowerCase() === typed.toLowerCase())
    if (!m) return refuse(`No product is called ${typed}. Add it to the stock list on the Stock tab first.`)
    const n = Number(f.qty)
    if (!Number.isInteger(n) || n < 1 || n > MAX_QTY) return refuse('How many? A whole number, please.')
    const phaseId = f.phaseId || null
    const days = phaseId ? `for ${job.phases.find((p) => p.id === phaseId)?.name ?? 'that phase'}` : 'for the whole job'
    const already = lines.find((l) => l.modelId === m.id && l.phaseId === phaseId)
    if (already && already.qty + n > MAX_QTY) return refuse(`That would make ${(already.qty + n).toLocaleString('en-IE')}, more than a line can hold.`)
    // Ready for the next product; a refusal brings what was typed back, unless the next thing has been typed since.
    const cleared = { ...f, product: '', qty: '1' }
    setF(cleared)
    void run(() =>
      already
        ? client.mutate('kit.update', { id: already.id, qty: already.qty + n })
        : client.mutate('kit.add', { id: newId(), projectId: job.id, phaseId, modelId: m.id, qty: n, subhireQty: 0, supplier: '', notes: '' })
    ).then((ok) => {
      if (ok) setAdded(already ? `Now ${already.qty + n} × ${m.name} ${days}.` : `Added ${n} × ${m.name} ${days}.`)
      else setF((now) => (now === cleared ? f : now))
    })
  }

  return (
    <form className="grid-form add-kit" onSubmit={submit} aria-label="Add kit">
      <h3 className="wide">Add kit</h3>
      {w.models.length === 0 && <p className="hint wide">Kit comes from the stock list, which is empty so far. Add products on the Stock tab.</p>}
      <label className="wide">
        Product{' '}
        <input
          list="product-names"
          value={f.product}
          onChange={(e) => setF({ ...f, product: e.target.value })}
          placeholder="From the stock list"
          autoComplete="off"
          required
        />
      </label>
      <label>
        How many <input type="number" inputMode="numeric" min={1} max={MAX_QTY} value={f.qty} onChange={(e) => setF({ ...f, qty: e.target.value })} required />
      </label>
      <label>
        For <ForChoice job={job} value={f.phaseId} onChange={(phaseId) => setF({ ...f, phaseId })} />
      </label>
      <Refusal error={error} className="wide" />
      {added && !error && (
        <p className="added wide" role="status">
          {added}
        </p>
      )}
      <button type="submit" className="primary wide">
        Add to kit
      </button>
    </form>
  )
}
