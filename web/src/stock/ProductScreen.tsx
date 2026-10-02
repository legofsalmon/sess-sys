import {
  CATEGORY_IDEAS,
  DEPARTMENT_LABELS,
  DEPARTMENTS,
  euroText,
  INSPECTION_MONTHS,
  MAX_MONTHS,
  MAX_QTY,
  newId,
  normaliseNumber,
  parseEuro,
  plural,
  RETIRED_LABELS,
  stillOutReason,
  stockId,
  valueLabel,
  type CommandInput,
  type Department,
  type FaultsView,
  type InspectionsView,
  type KitLineView,
  type ModelView,
  type View,
  type WarehouseView,
} from '@sh/shared'
import { useRef, useState, type FormEvent } from 'react'
import { Confirm, Refusal, useAct } from '../act.tsx'
import { Empty } from '../Empty.tsx'
import { JobStatusPill, Page } from '../jobs/common.tsx'
import { forLabel, kitState } from '../jobs/Kit.tsx'
import { Pending } from '../StatusPill.tsx'
import { client } from '../sync.ts'
import { useToday } from '../view.ts'
import {
  amountLabel,
  atLabel,
  CountRow,
  findWhere,
  numberLabel,
  TrackingChoice,
  useNewPlace,
  whereLabel,
  WhereChoices,
  whereNamed,
  whereProblem,
  whereText,
} from './common.tsx'
import { faultState, FaultsCard, ReportButtons } from './Faults.tsx'
import { dueText } from './Inspections.tsx'

/**
 * One product: what it is, the jobs it's on (ADR 0014), its numbered items,
 * and where it's counted, faults in what's counted (ADR 0018), and how
 * often its items need testing (ADR 0020). Items are added one after another while
 * labelling: the number field is ready for the next label as soon as one is
 * added, and where stays put. One that should never have been added is
 * marked as a mistake, which hides it and its items everywhere but the
 * history (audit finding 19).
 */
export function ProductScreen({ view, id, bare }: { view: View; id: string; bare?: boolean }) {
  const w = view.warehouse
  const m = w.models.find((x) => x.id === id)
  const mistake = w.mistakes.get(id)
  const back = (
    <a className="back" href="#stock">
      ‹ All stock
    </a>
  )
  if (!m)
    return (
      <Page view={view} title="Stock" className="warehouse" back={back} bare={bare}>
        <section className="card">
          <p className="empty">
            {mistake
              ? `${mistake.name} was marked as added by mistake, so it's kept only in the history.`
              : "This product isn't on this device. It may still be on its way, or it was removed: check again once it says “Up to date”."}
          </p>
        </section>
      </Page>
    )
  return (
    <Page view={view} title="Stock" className="warehouse" back={back} bare={bare}>
      <Summary m={m} w={w} view={view} />
      <OnJobs m={m} lines={view.kit.byModel.get(m.id) ?? []} />
      {m.tracking === 'serialised' && <Items m={m} w={w} faults={view.faults} inspections={view.inspections} />}
      <Counted m={m} w={w} />
      {(m.tracking === 'bulk' || m.countedTotal > 0 || view.faults.ofModel(m.id).length > 0) && (
        <FaultsCard faults={view.faults.ofModel(m.id)} title={m.tracking === 'bulk' ? 'Faults' : 'Faults in those not labelled yet'}>
          {m.countedTotal > 0 && <ReportButtons model={m} most={m.countedTotal} />}
        </FaultsCard>
      )}
      <WhereChoices w={w} />
    </Page>
  )
}

function Summary({ m, w, view }: { m: ModelView; w: WarehouseView; view: View }) {
  const [editing, setEditing] = useState(false)
  const [removing, setRemoving] = useState(false)
  const [mistaking, setMistaking] = useState(false)
  const { run, error, refuse } = useAct()
  const onKit = view.kit.lines.filter((l) => l.modelId === m.id)
  const unusable = view.faults.unusable(m.id)
  // What stops a plain Remove on the server stops it here, so "Added by mistake" is offered instead: any item ever labelled as it,
  // even one retired as added by mistake and so in no list here, and any time it went out with a job.
  const hadItems = [...w.assets.values()].some((a) => a.modelId === m.id)
  const removable =
    !hadItems && m.countedTotal === 0 && onKit.length === 0 && !view.moves.everMoved(m.id) && !view.faults.all.some((f) => f.modelId === m.id)
  const remove = () => {
    setRemoving(false)
    void run(() => client.mutate('model.remove', { id: m.id })).then((ok) => {
      if (ok) location.hash = '#stock'
    })
  }
  // What the server would turn down, said now in its words: kit on a job, out with one, or a case still holding kit.
  const askMistake = () => {
    refuse('')
    const jobs = [...new Set(onKit.map((l) => l.job?.name ?? 'a job'))].sort((a, b) => a.localeCompare(b))
    if (jobs.length) {
      const which = jobs.length === 1 ? jobs[0] : `${jobs.length} jobs (${jobs.slice(0, 3).join(', ')}${jobs.length > 3 ? '…' : ''})`
      return refuse(`${m.name} is on the kit for ${which}. Take it off ${jobs.length === 1 ? 'that job' : 'those'} first.`)
    }
    // Out as the pick lists have it, which is how the server works it out too.
    const out = view.moves.outWith(m.id)
    if (out.length) return refuse(stillOutReason(m.name, out))
    for (const a of m.items) {
      const counted = a.counted.reduce((n, s) => n + s.qty, 0)
      const holding = [a.items.length > 0 && plural(a.items.length, 'item'), counted > 0 && `${counted.toLocaleString('en-IE')} counted`].filter(Boolean)
      if (holding.length) return refuse(`${numberLabel(a)} still holds ${holding.join(' and ')}. Empty it first.`)
    }
    setMistaking(true)
  }
  const mistake = () => {
    setMistaking(false)
    void run(() => client.mutate('model.mistake', { id: m.id })).then((ok) => {
      if (ok) location.hash = '#stock'
    })
  }
  const hidden = [m.items.length > 0 && plural(m.items.length, 'item'), m.countedTotal > 0 && `${m.countedTotal.toLocaleString('en-IE')} counted`].filter(Boolean)
  return (
    <section className="card">
      <header className="title">
        <h1>{m.name}</h1>
        <Pending pending={m.pending} />
      </header>
      <dl className="facts">
        <div>
          <dt>Department</dt>
          <dd>{DEPARTMENT_LABELS[m.department]}</dd>
        </div>
        <div>
          <dt>Category</dt>
          <dd>{m.category || 'None'}</dd>
        </div>
        <div>
          <dt>Kept track of</dt>
          <dd>{m.tracking === 'bulk' ? 'Counted' : m.isCase ? 'Numbered; holds other kit' : 'Numbered'}</dd>
        </div>
        <div>
          <dt>Value of one</dt>
          <dd>{m.valueCents === null ? 'Not given' : valueLabel(m.valueCents)}</dd>
        </div>
        <div className="wide">
          <dt>In all</dt>
          <dd>
            {m.total.toLocaleString('en-IE')}
            {m.tracking === 'serialised' &&
              m.countedTotal > 0 &&
              `: ${m.items.length.toLocaleString('en-IE')} labelled, ${m.countedTotal.toLocaleString('en-IE')} not yet`}
            {unusable > 0 && <span className="flag bad"> {unusable.toLocaleString('en-IE')} can't go out</span>}
          </dd>
        </div>
        {m.tracking === 'serialised' && (
          <div className="wide">
            <dt>Testing</dt>
            <dd>{checksLabel(m)}</dd>
          </div>
        )}
      </dl>
      {m.notes && <p className="notes">{m.notes}</p>}
      <Refusal error={error} />
      {editing ? (
        <EditProduct m={m} w={w} onDone={() => setEditing(false)} />
      ) : removing ? (
        <Confirm question={`Remove ${m.name} from the stock list? Nothing is counted or labelled as it, so nothing else changes.`} yes="Remove it" onYes={remove} onNo={() => setRemoving(false)} />
      ) : mistaking ? (
        <Confirm
          question={`Mark ${m.name} as added by mistake? It leaves every list and count${hidden.length ? `, with its ${hidden.join(' and ')}` : ''}, and is kept only in the history. This can't be undone.`}
          yes="It was a mistake"
          onYes={mistake}
          onNo={() => setMistaking(false)}
        />
      ) : (
        <div className="actions">
          <button type="button" onClick={() => setEditing(true)}>
            Change details
          </button>
          {removable ? (
            <button type="button" className="link" onClick={() => setRemoving(true)}>
              Remove product
            </button>
          ) : (
            <button type="button" className="link" onClick={askMistake}>
              Added by mistake
            </button>
          )}
        </div>
      )}
    </section>
  )
}

/** The jobs it's on from today on, soonest first, each with whether there's enough; the first few, then the rest on request. */
function OnJobs({ m, lines }: { m: ModelView; lines: readonly KitLineView[] }) {
  const today = useToday()
  const row = (l: KitLineView) => {
    const state = kitState(l, today)
    return (
      <li key={l.id}>
        <a className="job-row" href={`#jobs/${l.projectId}`}>
          <div>
            <b>{l.job?.name ?? 'A job'}</b>
            <p>{forLabel(l)}</p>
            {state && <p className={`kit-note ${state.tone}`}>{state.text}</p>}
          </div>
          <div className="side">
            {l.job && <JobStatusPill status={l.job.status} pending={l.pending} />}
            <small>{l.qty.toLocaleString('en-IE')} needed</small>
          </div>
        </a>
      </li>
    )
  }
  return (
    <section className="card" aria-label="On jobs">
      <h2>On jobs</h2>
      <p className="hint">{m.total.toLocaleString('en-IE')} owned. Confirmed jobs hold them; enquiries and quotes are pencilled in.</p>
      {lines.length === 0 && <p className="empty">Not on any job coming up.</p>}
      <ul className="job-list">{lines.slice(0, 5).map(row)}</ul>
      {lines.length > 5 && (
        <details>
          <summary>{lines.length - 5} more</summary>
          <ul className="job-list">{lines.slice(5).map(row)}</ul>
        </details>
      )}
    </section>
  )
}

const every = (n: number) => (n === 1 ? 'every month' : `every ${n} months`)

/** "PAT every 12 months; thorough examination every 6 months", or "None". */
function checksLabel(m: ModelView): string {
  const parts = [m.patMonths && `PAT ${every(m.patMonths)}`, m.liftingMonths && `thorough examination ${every(m.liftingMonths)}`].filter(Boolean) as string[]
  if (parts.length === 0) return 'None'
  const text = parts.join('; ')
  return text[0]!.toUpperCase() + text.slice(1)
}

/** A number of months typed in: null for blank (never), NaN when it isn't one. */
function monthsTyped(text: string): number | null {
  const t = text.trim()
  if (!t) return null
  const n = Number(t)
  return Number.isInteger(n) && n >= 1 && n <= MAX_MONTHS ? n : NaN
}

function EditProduct({ m, w, onDone }: { m: ModelView; w: WarehouseView; onDone: () => void }) {
  const [f, setF] = useState({
    name: m.name,
    department: m.department,
    category: m.category,
    tracking: m.tracking,
    isCase: m.isCase,
    value: m.valueCents === null ? '' : euroText(m.valueCents),
    notes: m.notes,
    pat: m.patMonths === null ? '' : String(m.patMonths),
    lifting: m.liftingMonths === null ? '' : String(m.liftingMonths),
  })
  const { run, error, refuse } = useAct()
  const save = (e: FormEvent) => {
    e.preventDefault()
    const name = f.name.trim()
    if (!name) return
    const taken = w.models.find((x) => x.id !== m.id && x.name.trim().toLowerCase() === name.toLowerCase())
    if (taken) return refuse(`There's already a product called ${taken.name}.`)
    const value = parseEuro(f.value)
    if (value.reason !== undefined) return refuse(value.reason)
    const valueCents = value.cents
    // What the server would turn down, said now.
    if (f.tracking === 'bulk' && m.tracking === 'serialised' && m.items.length > 0)
      return refuse(`${m.name} has ${plural(m.items.length, 'numbered item')}, so it can't be counted only. Retire them first.`)
    const holding = m.items.filter((a) => a.items.length > 0 || a.counted.length > 0).length
    if (!f.isCase && m.isCase && holding > 0)
      return refuse(`${plural(holding, 'case')} of ${m.name} ${holding === 1 ? 'has' : 'have'} kit in ${holding === 1 ? 'it' : 'them'}. Empty them first.`)
    const numbered = f.tracking === 'serialised'
    const patMonths = numbered ? monthsTyped(f.pat) : m.patMonths
    const liftingMonths = numbered ? monthsTyped(f.lifting) : m.liftingMonths
    if (Number.isNaN(patMonths) || Number.isNaN(liftingMonths)) return refuse(`How often is a whole number of months, from 1 to ${MAX_MONTHS}, or blank for never.`)
    // Only what changed, so two people changing different things both keep theirs.
    const next = {
      name,
      department: f.department,
      category: f.category.trim(),
      tracking: f.tracking,
      isCase: f.isCase,
      valueCents,
      notes: f.notes.trim(),
      patMonths,
      liftingMonths,
    }
    const changes: Partial<CommandInput<'model.update'>> = {}
    for (const k of Object.keys(next) as (keyof typeof next)[]) if (next[k] !== m[k]) (changes as Record<string, unknown>)[k] = next[k]
    if (Object.keys(changes).length === 0) return onDone()
    void run(() => client.mutate('model.update', { id: m.id, ...changes })).then((ok) => ok && onDone())
  }
  const categories = [...new Set([...w.categories, ...CATEGORY_IDEAS])]
  return (
    <form className="grid-form" onSubmit={save}>
      <label className="wide">
        Name <input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required />
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
        Category <input list="edit-category-names" value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })} />
      </label>
      <TrackingChoice tracking={f.tracking} isCase={f.isCase} onChange={(t) => setF({ ...f, ...t })} />
      {f.tracking === 'serialised' && (
        <>
          <label>
            PAT every, in months
            <input
              inputMode="numeric"
              value={f.pat}
              placeholder={`Never, or e.g. ${INSPECTION_MONTHS.pat}`}
              onChange={(e) => setF({ ...f, pat: e.target.value })}
            />
          </label>
          <label>
            Thorough examination every, in months
            <input
              inputMode="numeric"
              value={f.lifting}
              placeholder={`Never, or e.g. ${INSPECTION_MONTHS.lifting}`}
              onChange={(e) => setF({ ...f, lifting: e.target.value })}
            />
          </label>
          <p className="hint wide">Blank for never. PAT for anything that plugs in; a thorough examination for lifting gear such as hoists, chain and truss.</p>
        </>
      )}
      <label className="wide">
        Value of one, in euro <input inputMode="decimal" value={f.value} onChange={(e) => setF({ ...f, value: e.target.value })} />
      </label>
      <label className="wide">
        Notes <textarea rows={2} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} />
      </label>
      <Refusal error={error} className="wide" />
      <div className="actions wide">
        <button type="submit" className="primary">
          Save product
        </button>
        <button type="button" onClick={onDone}>
          Cancel
        </button>
      </div>
      <datalist id="edit-category-names">
        {categories.map((c) => (
          <option key={c} value={c} />
        ))}
      </datalist>
    </form>
  )
}

function Items({ m, w, faults, inspections }: { m: ModelView; w: WarehouseView; faults: FaultsView; inspections: InspectionsView }) {
  return (
    <section className="card" aria-label="Items">
      <h2>Items</h2>
      {m.items.length === 0 && <Empty />}
      <ul className="item-list">
        {m.items.map((a) => (
          <li key={a.id}>
            <a className="item-row" href={`#stock/item/${a.id}`}>
              <div>
                <b>{numberLabel(a)}</b>
                <p>
                  {whereLabel(a, w)}
                  {a.serial && ` · Serial ${a.serial}`}
                  {faults.stopping(a.id) && <span className="flag bad"> {faultState(faults.stopping(a.id)!)}</span>}
                  {inspections.blocks(a.id) && <span className="flag bad"> {dueText(inspections.blocks(a.id)!)}</span>}
                </p>
              </div>
              <Pending pending={a.pending} />
            </a>
          </li>
        ))}
      </ul>
      {m.retired.length > 0 && (
        <details>
          <summary>Retired ({m.retired.length})</summary>
          <ul className="item-list">
            {m.retired.map((a) => (
              <li key={a.id}>
                <a className="item-row" href={`#stock/item/${a.id}`}>
                  <div>
                    <b>{numberLabel(a)}</b>
                    <p>{a.retiredReason ? RETIRED_LABELS[a.retiredReason] : 'Retired'}</p>
                  </div>
                  <Pending pending={a.pending} />
                </a>
              </li>
            ))}
          </ul>
        </details>
      )}
      <AddItem m={m} w={w} />
    </section>
  )
}

function AddItem({ m, w }: { m: ModelView; w: WarehouseView }) {
  const [f, setF] = useState({ number: '', serial: '', where: m.counted.length === 1 ? whereText(m.counted[0]!, w) : '' })
  const [fromCount, setFromCount] = useState(true)
  const { run, error, refuse } = useAct()
  const { ask, question, asking } = useNewPlace(w)
  const [lastId, setLastId] = useState('')
  const numberField = useRef<HTMLInputElement>(null)
  const known = findWhere(f.where, w)
  const countedThere = known ? (m.counted.find((s) => s.id === stockId(m.id, known))?.qty ?? 0) : 0
  // The number it got, once the server has given it one.
  const last = lastId ? w.assets.get(lastId) : undefined

  const submit = (e: FormEvent) => {
    e.preventDefault()
    const typed = f.number.trim()
    const number = (typed && normaliseNumber(typed)) || null
    if (typed && !number) return refuse(`“${typed}” isn't a Session Hire number: they're SH- and six digits, such as SH-000123.`)
    const other = number ? w.byNumber.get(number) : undefined
    if (number && other) {
      return refuse(
        other.number === number
          ? `${number} is already in use (${other.model?.name ?? 'another item'}).`
          : `${number} was used before (${other.model?.name ?? 'another item'}, now ${numberLabel(other)}), and a number is never used twice. Use another label.`
      )
    }
    const problem = whereProblem(f.where, w)
    if (problem) return refuse(problem)
    const id = newId()
    const one = countedThere > 0 && fromCount
    const go = () => {
      // Ready for the next label, in the same place; a refusal brings what was typed back, unless the next label has been typed since.
      const cleared = { ...f, number: '', serial: '' }
      setF(cleared)
      numberField.current?.focus()
      void run(async () => {
        const where = (await whereNamed(f.where, w)) ?? { placeId: null, caseId: null }
        await client.mutate('asset.add', { id, modelId: m.id, number, serial: f.serial.trim(), ...where, notes: '', fromCount: one })
      }).then((ok) => {
        if (ok) setLastId(id)
        else setF((now) => (now === cleared ? f : now))
      })
    }
    if (!ask(f.where, go)) go()
  }

  return (
    <form className="grid-form add-item" onSubmit={submit}>
      <h3 className="wide">Add an item</h3>
      <label className="wide">
        Number
        <input
          ref={numberField}
          value={f.number}
          onChange={(e) => setF({ ...f, number: e.target.value })}
          placeholder="From its label; empty for the next free one"
          autoComplete="off"
          autoCapitalize="characters"
          enterKeyHint="done"
          disabled={asking}
        />
      </label>
      <label>
        Serial <input value={f.serial} onChange={(e) => setF({ ...f, serial: e.target.value })} placeholder="The maker's, if any" autoComplete="off" disabled={asking} />
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
      {last && !error && (
        <p className="added wide" role="status">
          {last.number ? (
            <>
              Added <a href={`#stock/item/${last.id}`}>{last.number}</a>.
            </>
          ) : (
            'Added. It gets the next free number when it syncs.'
          )}
        </p>
      )}
      {question ?? (
        <button type="submit" className="primary wide">
          Add item
        </button>
      )}
    </form>
  )
}

function Counted({ m, w }: { m: ModelView; w: WarehouseView }) {
  const numbered = m.tracking === 'serialised'
  return (
    <section className="card" aria-label={numbered ? 'Not labelled yet' : 'Counted'}>
      <h2>{numbered ? 'Not labelled yet' : 'Counted'}</h2>
      {numbered && <p className="hint">How many are here but not labelled yet. Adding an item where some are counted takes one off.</p>}
      {m.counted.length === 0 && <Empty />}
      {m.counted.map((s) => (
        <CountRow key={s.id} s={s} w={w}>
          {whereLabel(s, w)}
        </CountRow>
      ))}
      <NewCount m={m} w={w} />
      <p className="hint">In all: {amountLabel(m)}.</p>
    </section>
  )
}

/** A count somewhere not counted before. */
function NewCount({ m, w }: { m: ModelView; w: WarehouseView }) {
  const [where, setWhere] = useState('')
  const [qty, setQty] = useState('')
  // A count that would replace one already made waits here until the office says so.
  const [asking, setAsking] = useState<{ n: number; already: number; at: string } | undefined>()
  const { run, error, refuse } = useAct()
  const place = useNewPlace(w)
  const save = (n: number) => {
    setAsking(undefined)
    void run(async () => {
      const at = await whereNamed(where, w)
      if (!at) throw new Error('Where are they?')
      await client.mutate('stock.set', { modelId: m.id, ...at, qty: n })
    }).then((ok) => {
      if (!ok) return
      setWhere('')
      setQty('')
    })
  }
  const submit = (e: FormEvent) => {
    e.preventDefault()
    const n = Number(qty)
    if (!Number.isInteger(n) || n < 1 || n > MAX_QTY) return refuse('How many are there? A whole number, please.')
    const problem = whereProblem(where, w)
    if (problem) return refuse(problem)
    if (place.ask(where, () => save(n))) return
    const known = findWhere(where, w)
    const already = known && m.counted.find((s) => s.id === stockId(m.id, known))
    if (known && already) return setAsking({ n, already: already.qty, at: atLabel(known, w) })
    save(n)
  }
  const held = !!asking || place.asking
  return (
    <form className="grid-form" onSubmit={submit}>
      <h3 className="wide">Add a count</h3>
      <label>
        Counted at <input list="where-choices" value={where} onChange={(e) => setWhere(e.target.value)} placeholder="A place, or a case's number" required disabled={held} />
      </label>
      <label>
        How many <input type="number" inputMode="numeric" min={1} max={MAX_QTY} value={qty} onChange={(e) => setQty(e.target.value)} required disabled={held} />
      </label>
      <Refusal error={error} className="wide" />
      {place.question ? (
        place.question
      ) : asking ? (
        <Confirm
          className="wide"
          question={`${asking.already.toLocaleString('en-IE')} are counted ${asking.at} already. Make it ${asking.n.toLocaleString('en-IE')}?`}
          yes={`Make it ${asking.n.toLocaleString('en-IE')}`}
          no="Leave the count"
          onYes={() => save(asking.n)}
          onNo={() => setAsking(undefined)}
        />
      ) : (
        <button type="submit" className="wide">
          Save count
        </button>
      )}
    </form>
  )
}
