import {
  inShForm,
  normaliseNumber,
  plural,
  RETIRED_LABELS,
  RETIRED_REASONS,
  type AssetView,
  type CommandInput,
  type RetiredReason,
  type View,
  type WarehouseView,
} from '@sh/shared'
import { useState, type FormEvent } from 'react'
import { Refusal, useAct } from '../act.tsx'
import { Empty } from '../Empty.tsx'
import { Page } from '../jobs/common.tsx'
import { when } from '../format.ts'
import { Pending, StatusPill } from '../StatusPill.tsx'
import { client } from '../sync.ts'
import { faultState, FaultsCard, ReportButtons } from './Faults.tsx'
import { dueText, InspectionsCard } from './Inspections.tsx'
import { ItemLog } from './ItemLog.tsx'
import { CountsOf } from './Counts.tsx'
import { PrintLabels } from './Labels.tsx'
import { CameraScanner, primeSound } from './Scanner.tsx'
import {
  contentsLabel,
  CountHere,
  CountRow,
  itemNumbered,
  itemToPut,
  loopIn,
  numberLabel,
  ScanResult,
  useNewPlace,
  whereLabel,
  WhereChoices,
  whereNamed,
} from './common.tsx'

/**
 * One numbered item: its label, its product, where it's kept, the labels
 * it had before, and for a case, what's in it. Its label can be printed
 * here (ADR 0015). Retiring keeps it and its number for the record; it can
 * be brought back. Damage, or its going missing, is reported here, and
 * each fault is fixed, found or written off here too (ADR 0018), and its
 * electrical tests and thorough examinations are recorded (ADR 0020). Its
 * log says everything that happened to it (ADR 0026).
 */
export function ItemScreen({ view, id, bare }: { view: View; id: string; bare?: boolean }) {
  const w = view.warehouse
  const a = w.assets.get(id)
  if (!a)
    return (
      <Page
        view={view}
        title="Stock"
        className="warehouse"
        back={
          <a className="back" href="#stock">
            ‹ All stock
          </a>
        }
        bare={bare}
      >
        <section className="card">
          <p className="empty">This item isn't on this device. It may still be on its way: check again once it says “Up to date”.</p>
        </section>
      </Page>
    )
  return (
    <Page
      view={view}
      title="Stock"
      className="warehouse"
      back={
        <a className="back" href={a.model && !a.model.mistake ? `#stock/product/${a.model.id}` : '#stock'}>
          ‹ {a.model && !a.model.mistake ? a.model.name : 'All stock'}
        </a>
      }
      bare={bare}
    >
      <Summary a={a} w={w} view={view} />
      <FaultsCard faults={view.faults.ofAsset(a.id)}>
        {a.status === 'active' && <ReportButtons asset={a} model={a.model} projectId={view.moves.outOf(a.id)?.projectId ?? null} />}
      </FaultsCard>
      <InspectionsCard view={view} a={a} />
      {a.model?.isCase && a.status === 'active' && <Inside c={a} w={w} />}
      {a.model?.isCase && a.status === 'active' && <CountsOf view={view} where={{ placeId: null, caseId: a.id }} />}
      <ItemLog view={view} a={a} />
      <WhereChoices w={w} />
    </Page>
  )
}

type Mode = 'move' | 'details' | 'label' | 'print' | 'retire'

function Summary({ a, w, view }: { a: AssetView; w: WarehouseView; view: View }) {
  const out = view.moves.outOf(a.id)
  const outWith = out && view.jobs.jobs.find((j) => j.id === out.projectId)
  const fault = view.faults.stopping(a.id)
  const check = view.inspections.blocks(a.id)
  const [mode, setMode] = useState<Mode | undefined>()
  const retired = a.status === 'retired'
  const toggle = (m: Mode) => setMode(mode === m ? undefined : m)
  const done = () => setMode(undefined)
  const { run, error } = useAct()
  const reinstate = () => void run(() => client.mutate('asset.reinstate', { id: a.id }))
  return (
    <section className="card">
      <header className="title">
        <h1 className="number">{numberLabel(a)}</h1>
        {a.pending ? <Pending pending /> : retired && <StatusPill tone="cancelled">Retired</StatusPill>}
      </header>
      <dl className="facts">
        <div>
          <dt>Product</dt>
          <dd>{a.model ? a.model.mistake ? a.model.name : <a href={`#stock/product/${a.model.id}`}>{a.model.name}</a> : 'Removed'}</dd>
        </div>
        <div>
          <dt>Serial</dt>
          <dd>{a.serial || 'None'}</dd>
        </div>
        {a.oldNumber && (
          <div>
            <dt>Old number</dt>
            <dd>{a.oldNumber}</dd>
          </div>
        )}
        {retired ? (
          <div className="wide">
            <dt>Retired</dt>
            <dd>
              {a.retiredReason ? RETIRED_LABELS[a.retiredReason] : 'Yes'}
              {a.retiredNote && `: ${a.retiredNote}`}
            </dd>
          </div>
        ) : (
          <div className="wide">
            <dt>Where</dt>
            <dd>{a.inCase ? <WhereLink a={a} /> : a.at ? <a href={`#stock/place/${a.at.id}`}>{a.at.name}</a> : whereLabel(a, w)}</dd>
          </div>
        )}
        {out && (
          <div className="wide">
            <dt>Out</dt>
            <dd>
              With <a href={`#jobs/${out.projectId}/pick`}>{outWith?.name ?? 'a job'}</a> since {when(out.since)}
              {out.inCase && `, in ${out.inCase.number || 'a case'}`}
            </dd>
          </div>
        )}
        {fault && (
          <div className="wide">
            <dt>Fault</dt>
            <dd className="bad">
              {faultState(fault)}
              {fault.note && `: ${fault.note}`}
            </dd>
          </div>
        )}
        {check && (
          <div className="wide">
            <dt>Testing</dt>
            <dd className="bad">{dueText(check)}: it can't go out until it passes</dd>
          </div>
        )}
        {a.formerNumbers.length > 0 && (
          <div className="wide">
            <dt>Labels before</dt>
            <dd>{a.formerNumbers.join(', ')}</dd>
          </div>
        )}
      </dl>
      {a.notes && <p className="notes">{a.notes}</p>}
      <Refusal error={error} />
      {retired ? (
        a.model?.mistake ? (
          <p className="hint">{a.model.name} was marked as added by mistake, so this is kept for the history only.</p>
        ) : (
          <div className="actions">
            <button type="button" onClick={reinstate}>
              Bring back
            </button>
          </div>
        )
      ) : (
        <div className="actions">
          {(['move', 'details', 'label', 'print', 'retire'] as const).map((m) => (
            <button key={m} type="button" aria-pressed={mode === m} onClick={() => toggle(m)}>
              {{ move: 'Move', details: 'Change details', label: 'New label', print: 'Print label', retire: 'Retire' }[m]}
            </button>
          ))}
        </div>
      )}
      {!retired && mode === 'move' && <Move a={a} w={w} onDone={done} />}
      {!retired && mode === 'details' && <Details a={a} w={w} onDone={done} />}
      {!retired && mode === 'label' && <Relabel a={a} w={w} onDone={done} />}
      {!retired &&
        mode === 'print' &&
        (a.number ? (
          <PrintLabels numbers={[a.number]} caption={a.model?.name} />
        ) : (
          <p className="hint">It gets its number when it syncs, and its label can be printed then.</p>
        ))}
      {!retired && mode === 'retire' && <Retire a={a} onDone={done} />}
    </section>
  )
}

/** "In SH-000200 (Amp rack), Bay A3", with links to the case and the place. */
function WhereLink({ a }: { a: AssetView }) {
  const c = a.inCase!
  return (
    <>
      In <a href={`#stock/item/${c.id}`}>{numberLabel(c)}</a> ({c.model?.name ?? 'a case'})
      {c.at && (
        <>
          , <a href={`#stock/place/${c.at.id}`}>{c.at.name}</a>
        </>
      )}
    </>
  )
}

function Move({ a, w, onDone }: { a: AssetView; w: WarehouseView; onDone: () => void }) {
  const [to, setTo] = useState('')
  const { run, error, refuse } = useAct()
  const { ask, question, asking } = useNewPlace(w)
  const submit = (e: FormEvent) => {
    e.preventDefault()
    const typed = itemNumbered(to, w)
    if (typed?.model?.isCase && typed.status === 'active') {
      const loop = loopIn(a.id, typed.id, w)
      if (loop) return refuse(loop)
    }
    const go = () =>
      void run(async () => {
        const dest = (await whereNamed(to, w)) ?? { placeId: null, caseId: null }
        if (dest.placeId === a.placeId && dest.caseId === a.caseId) return
        await client.mutate('asset.move', { id: a.id, ...dest })
      }).then((ok) => ok && onDone())
    if (!ask(to, go)) go()
  }
  return (
    <form className="grid-form" onSubmit={submit}>
      <label className="wide">
        Where to
        <input
          list="where-choices"
          value={to}
          onChange={(e) => setTo(e.target.value)}
          placeholder="A place, or a case's number; empty if not known"
          autoFocus
          disabled={asking}
        />
      </label>
      {a.model?.isCase && (a.items.length > 0 || a.counted.length > 0) && <p className="hint wide">Everything in it goes too.</p>}
      <Refusal error={error} className="wide" />
      {question ?? (
        <div className="actions wide">
          <button type="submit" className="primary">
            Move {numberLabel(a)}
          </button>
          <button type="button" onClick={onDone}>
            Cancel
          </button>
        </div>
      )}
    </form>
  )
}

/** Only what changed is sent, as for products and jobs. */
function Details({ a, w, onDone }: { a: AssetView; w: WarehouseView; onDone: () => void }) {
  const [f, setF] = useState({ modelId: a.modelId, serial: a.serial, oldNumber: a.oldNumber, notes: a.notes })
  const { run, error, refuse } = useAct()
  // Another numbered product, when it was put down as the wrong one.
  const products = w.models.filter((m) => m.tracking === 'serialised')
  const submit = (e: FormEvent) => {
    e.preventDefault()
    const changes: CommandInput<'asset.update'> = { id: a.id }
    if (f.modelId !== a.modelId) {
      const next = products.find((m) => m.id === f.modelId)
      if (next && !next.isCase && (a.items.length > 0 || a.counted.length > 0))
        return refuse(`${numberLabel(a)} has kit in it, and ${next.name} doesn't hold other kit. Empty it first.`)
      changes.modelId = f.modelId
    }
    if (f.serial.trim() !== a.serial) changes.serial = f.serial.trim()
    if (f.oldNumber.trim() !== a.oldNumber) {
      if (inShForm(f.oldNumber)) return refuse(`${f.oldNumber.trim()} is a Session Hire number. Put it on as the item's label, with New label, not as its old number.`)
      changes.oldNumber = f.oldNumber.trim()
    }
    if (f.notes.trim() !== a.notes) changes.notes = f.notes.trim()
    if (Object.keys(changes).length === 1) return onDone()
    void run(() => client.mutate('asset.update', changes)).then((ok) => ok && onDone())
  }
  return (
    <form className="grid-form" onSubmit={submit}>
      <label className="wide">
        Product
        <select value={f.modelId} onChange={(e) => setF({ ...f, modelId: e.target.value })}>
          {products.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </select>
      </label>
      <label className="wide">
        Serial <input value={f.serial} onChange={(e) => setF({ ...f, serial: e.target.value })} autoComplete="off" />
      </label>
      <label className="wide">
        Old number{' '}
        <input
          value={f.oldNumber}
          onChange={(e) => setF({ ...f, oldNumber: e.target.value })}
          placeholder="A tag it had before Session Hire's label, if any"
          autoComplete="off"
        />
      </label>
      <label className="wide">
        Notes <textarea rows={2} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} />
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

/** For a label that's lost or worn out. The old number stays with the item and is never used again. */
function Relabel({ a, w, onDone }: { a: AssetView; w: WarehouseView; onDone: () => void }) {
  const [typed, setTyped] = useState('')
  const { run, error, refuse } = useAct()
  const submit = (e: FormEvent) => {
    e.preventDefault()
    const t = typed.trim()
    const number = (t && normaliseNumber(t)) || null
    if (t && !number) return refuse(`“${t}” isn't a Session Hire number: they're SH- and six digits, such as SH-000123.`)
    if (number && number === a.number) return refuse(`${number} is its label now.`)
    const other = number ? w.byNumber.get(number) : undefined
    if (number && other) {
      return refuse(
        other.id === a.id
          ? `${number} was its label before, and a number is never used twice. Use another label.`
          : other.number === number
            ? `${number} is already in use (${other.model?.name ?? 'another item'}).`
            : `${number} was used before (${other.model?.name ?? 'another item'}, now ${numberLabel(other)}), and a number is never used twice. Use another label.`
      )
    }
    void run(() => client.mutate('asset.relabel', { id: a.id, number })).then((ok) => ok && onDone())
  }
  return (
    <form className="grid-form" onSubmit={submit}>
      <p className="hint wide">For a label that's lost or worn out. {a.number ? `${a.number} stays in its history and is never used again.` : ''}</p>
      <label className="wide">
        New number
        <input
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          placeholder="From the new label; empty for the next free one"
          autoComplete="off"
          autoCapitalize="characters"
          autoFocus
        />
      </label>
      <Refusal error={error} className="wide" />
      <div className="actions wide">
        <button type="submit" className="primary">
          Save new label
        </button>
        <button type="button" onClick={onDone}>
          Cancel
        </button>
      </div>
    </form>
  )
}

function Retire({ a, onDone }: { a: AssetView; onDone: () => void }) {
  const [reason, setReason] = useState<RetiredReason>('scrapped')
  const [note, setNote] = useState('')
  const { run, error, refuse } = useAct()
  const holding = [
    a.items.length > 0 && plural(a.items.length, 'item'),
    a.counted.length > 0 && `${a.counted.reduce((n, s) => n + s.qty, 0).toLocaleString('en-IE')} counted`,
  ].filter(Boolean)
  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (holding.length) return refuse(`${numberLabel(a)} still holds ${holding.join(' and ')}. Empty it first.`)
    void run(() => client.mutate('asset.retire', { id: a.id, reason, note: note.trim() })).then((ok) => ok && onDone())
  }
  return (
    <form className="grid-form" onSubmit={submit}>
      <p className="hint wide">It stops counting as stock. Its number and history are kept, and it can be brought back.</p>
      <fieldset className="wide reasons">
        <legend>Why</legend>
        {RETIRED_REASONS.map((r) => (
          <label key={r} className="tick">
            <input type="radio" name="reason" checked={reason === r} onChange={() => setReason(r)} />
            <span>{RETIRED_LABELS[r]}</span>
          </label>
        ))}
      </fieldset>
      <label className="wide">
        Note <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Dropped at the Point, cone torn" maxLength={500} />
      </label>
      <Refusal error={error} className="wide" />
      <div className="actions wide">
        <button type="submit" className="primary">
          Retire {numberLabel(a)}
        </button>
        <button type="button" onClick={onDone}>
          Cancel
        </button>
      </div>
    </form>
  )
}

/** A case's contents: items in it, and what's counted in it. Items go in by their number, scanned or typed, with the camera staying on for the next (audit finding 18). */
function Inside({ c, w }: { c: AssetView; w: WarehouseView }) {
  const [number, setNumber] = useState('')
  const [camera, setCamera] = useState(false)
  const [putIn, setPutIn] = useState('')
  const { run, error, refuse } = useAct()
  const put = (t: string) => {
    setPutIn('')
    if (!t) return
    const { item, problem } = itemToPut(t, w)
    if (!item) return refuse(problem)
    if (item.caseId === c.id) return refuse(`${item.number} is in here already.`)
    const loop = loopIn(item.id, c.id, w)
    if (loop) return refuse(loop)
    void run(() => client.mutate('asset.move', { id: item.id, placeId: null, caseId: c.id })).then(
      (ok) => ok && setPutIn(`${item.number} (${item.model?.name ?? 'an item'}) is in ${numberLabel(c)} now.`)
    )
  }
  const submit = (e: FormEvent) => {
    e.preventDefault()
    put(number.trim())
    setNumber('')
  }
  const close = () => {
    setCamera(false)
    setPutIn('')
    refuse('')
  }
  const empty = c.items.length === 0 && c.counted.length === 0
  return (
    <section className="card" aria-label="In it">
      <h2>In it</h2>
      {empty && <Empty />}
      {c.items.length > 0 && (
        <ul className="item-list">
          {c.items.map((i) => (
            <li key={i.id}>
              <a className="item-row" href={`#stock/item/${i.id}`}>
                <div>
                  <b>{numberLabel(i)}</b> {i.model?.name}
                  {i.model?.isCase && (i.items.length > 0 || i.counted.length > 0) && <p>{contentsLabel(i)}</p>}
                </div>
                <Pending pending={i.pending} />
              </a>
            </li>
          ))}
        </ul>
      )}
      {c.counted.map((s) => (
        <CountRow key={s.id} s={s} w={w}>
          × {s.model ? <a href={`#stock/product/${s.model.id}`}>{s.model.name}</a> : 'a product since removed'}
          {s.model?.tracking === 'serialised' && <small>, not labelled yet</small>}
        </CountRow>
      ))}
      <form className="grid-form" onSubmit={submit}>
        <h3 className="wide">Put an item in</h3>
        <div className="wide scan-row">
          <label>
            Its number
            <input
              value={number}
              onChange={(e) => setNumber(e.target.value)}
              placeholder="e.g. SH-000123"
              autoComplete="off"
              autoCapitalize="characters"
              enterKeyHint="done"
            />
          </label>
          <button
            type="button"
            aria-pressed={camera}
            onClick={() => {
              if (!camera) primeSound()
              if (camera) close()
              else setCamera(true)
            }}
          >
            Scan
          </button>
        </div>
        {camera && (
          <div className="wide">
            <CameraScanner onRead={(code) => put(code.trim())} onStop={close} small />
          </div>
        )}
        <Refusal error={error} className="wide" />
        {putIn && !error && (
          <ScanResult label="Put in" onClose={camera ? close : undefined}>
            {putIn}
            {camera && ' Scan the next label.'}
          </ScanResult>
        )}
        <button type="submit" className="wide">
          Put it in {numberLabel(c)}
        </button>
      </form>
      <CountHere w={w} at={{ placeId: null, caseId: c.id }} title="Count what's in it" />
    </section>
  )
}
