import {
  MAX_QTY,
  newId,
  OUTCOME_LABELS,
  OUTCOMES_FOR,
  type AssetView,
  type CommandInput,
  type FaultKind,
  type FaultOutcome,
  type FaultView,
  type Model,
  type View,
} from '@sh/shared'
import { useState, type FormEvent, type ReactNode } from 'react'
import { act } from '../crew/CrewScreen.tsx'
import { when } from '../format.ts'
import { client } from '../sync.ts'
import { numberLabel, Pending } from './common.tsx'

/**
 * Faults and missing kit (ADR 0018): reporting damage or kit that's
 * missing, on an item's page, a product's (for counted kit), or the pick
 * list as kit comes back; and the repair list, where each one is fixed,
 * found, found not faulty, or written off. Kit that can't go out comes off
 * what's free for jobs until then.
 */

/** "SH-000123 d&b Y10P", or "3 × XLR 10 m". */
export function faultWhat(f: FaultView): string {
  if (f.assetId) return [f.asset ? numberLabel(f.asset) : 'An item', f.model?.name].filter(Boolean).join(' ')
  return `${f.qty.toLocaleString('en-IE')} × ${f.model?.name ?? 'a product since removed'}`
}

/** "Damaged, can't go out", "Damaged, fit to go out", or "Missing". */
export function faultState(f: FaultView): string {
  if (f.kind === 'missing') return 'Missing'
  return f.usable ? 'Damaged, fit to go out' : "Damaged, can't go out"
}

export const reportFault = (args: Omit<CommandInput<'fault.report'>, 'id' | 'at'>) =>
  act(() => client.mutate('fault.report', { id: newId(), at: new Date().toISOString(), ...args }))

/** Report an item, or some counted kit, damaged or missing. */
export function ReportFault({
  kind,
  asset,
  model,
  projectId = null,
  most,
  onDone,
}: {
  kind: FaultKind
  asset?: AssetView
  model: Model | undefined
  projectId?: string | null
  /** For counted kit: the most there could be. */
  most?: number
  onDone: () => void
}) {
  const [qty, setQty] = useState(most === 1 ? '1' : '')
  const [note, setNote] = useState('')
  const [usable, setUsable] = useState(false)
  const [error, setError] = useState('')
  const name = asset ? numberLabel(asset) : (model?.name ?? 'It')
  const submit = (e: FormEvent) => {
    e.preventDefault()
    setError('')
    const n = asset ? 1 : Number(qty)
    if (!asset && (!Number.isInteger(n) || n < 1 || n > MAX_QTY)) return setError('How many? A whole number, please.')
    if (kind === 'damaged' && !note.trim()) return setError("Say what's wrong, for whoever repairs it.")
    const modelId = asset?.modelId ?? model?.id
    if (!modelId) return setError('That product is no longer in the stock list.')
    void reportFault({ kind, assetId: asset?.id ?? null, modelId, qty: n, projectId, usable: kind === 'damaged' && usable, note: note.trim() }).then(
      onDone,
      (err: Error) => setError(err.message)
    )
  }
  return (
    <form className="grid-form fault-form" onSubmit={submit} aria-label={`Report ${name} ${kind}`}>
      <p className="hint wide">
        {kind === 'missing'
          ? "It comes off what's free for jobs until it's found."
          : "Unless it can still go out, it comes off what's free for jobs until it's fixed."}
      </p>
      {!asset && (
        <label>
          How many
          <input type="number" inputMode="numeric" min={1} max={MAX_QTY} value={qty} onChange={(e) => setQty(e.target.value)} autoFocus />
        </label>
      )}
      <label className="wide">
        {kind === 'missing' ? 'Where it was last seen' : "What's wrong"}
        <textarea
          rows={2}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          maxLength={2000}
          placeholder={kind === 'missing' ? 'e.g. Not in the van after the Point' : 'e.g. Rattles at high level; grille dented'}
          autoFocus={!!asset}
        />
      </label>
      {kind === 'damaged' && (
        <label className="tick wide">
          <input type="checkbox" checked={usable} onChange={(e) => setUsable(e.target.checked)} />
          <span>It can still go out</span>
        </label>
      )}
      {error && <p className="alert wide">{error}</p>}
      <div className="actions wide">
        <button type="submit" className="primary">
          {kind === 'missing' ? 'Report missing' : 'Report damage'}
        </button>
        <button type="button" onClick={onDone}>
          Cancel
        </button>
      </div>
    </form>
  )
}

/** Buttons to report damage or missing kit, and the form for whichever is chosen. */
export function ReportButtons({ asset, model, projectId, most }: { asset?: AssetView; model: Model | undefined; projectId?: string | null; most?: number }) {
  const [kind, setKind] = useState<FaultKind>()
  return (
    <>
      <div className="actions">
        {(['damaged', 'missing'] as const).map((k) => (
          <button key={k} type="button" aria-pressed={kind === k} onClick={() => setKind(kind === k ? undefined : k)}>
            {k === 'damaged' ? 'Report damage' : 'Report missing'}
          </button>
        ))}
      </div>
      {kind && <ReportFault key={kind} kind={kind} asset={asset} model={model} projectId={projectId} most={most} onDone={() => setKind(undefined)} />}
    </>
  )
}

/** An item's or a product's faults: the open ones, with what to do about them, then the rest. */
export function FaultsCard({ faults, children, title = 'Faults' }: { faults: FaultView[]; children?: ReactNode; title?: string }) {
  const open = faults.filter((f) => f.open)
  const closed = faults.filter((f) => !f.open)
  return (
    <section className="card faults" aria-label={title}>
      <h2>{title}</h2>
      {faults.length === 0 && <p className="empty">None reported.</p>}
      {open.length > 0 && (
        <ul className="fault-list">
          {open.map((f) => (
            <FaultItem key={f.id} f={f} />
          ))}
        </ul>
      )}
      {children}
      {closed.length > 0 && (
        <details>
          <summary>{closed.length === 1 ? 'One before' : `${closed.length} before`}</summary>
          <ul className="fault-list">
            {closed.map((f) => (
              <FaultItem key={f.id} f={f} />
            ))}
          </ul>
        </details>
      )}
    </section>
  )
}

function FaultItem({ f, linked = false }: { f: FaultView; linked?: boolean }) {
  const [editing, setEditing] = useState(false)
  const [error, setError] = useState('')
  const closeAs = (outcome: FaultOutcome) => {
    setError('')
    if (outcome === 'written-off') {
      const what = faultWhat(f)
      const effect = f.assetId ? `It's retired as ${f.kind === 'missing' ? 'lost' : 'scrapped'}` : "They're taken off the count"
      if (!confirm(`Write off ${what}? ${effect}, and it's kept in the history.`)) return
    }
    void act(() => client.mutate('fault.close', { id: f.id, outcome, at: new Date().toISOString() })).catch((err: Error) => setError(err.message))
  }
  const href = f.assetId ? `#stock/item/${f.assetId}` : `#stock/product/${f.modelId}`
  return (
    <li className={`fault ${f.open ? (f.stops ? 'stops' : 'usable') : 'closed'}`} aria-label={faultWhat(f)}>
      <header>
        <div>
          {linked ? (
            <a href={href}>
              <b>{faultWhat(f)}</b>
            </a>
          ) : (
            <b>{f.assetId ? faultState(f) : `${faultWhat(f)}: ${faultState(f).toLowerCase()}`}</b>
          )}
          <p>
            {linked && `${faultState(f)} · `}
            {f.job ? (
              <>
                {f.kind === 'missing' ? 'From ' : 'Back from '}
                <a href={`#jobs/${f.job.id}/pick`}>{f.job.name}</a>,{' '}
              </>
            ) : (
              ''
            )}
            reported {when(f.at)}
            {!f.open && f.outcome && ` · ${OUTCOME_LABELS[f.outcome]}${f.closedAt ? ` ${when(f.closedAt)}` : ''}`}
          </p>
        </div>
        <Pending pending={f.pending} />
      </header>
      {f.note && <p className="notes">{f.note}</p>}
      {f.repair && !editing && (
        <p className="repair">
          <b>Repair notes:</b> {f.repair}
        </p>
      )}
      {editing ? (
        <EditFault f={f} onDone={() => setEditing(false)} />
      ) : (
        f.open && (
          <div className="actions">
            {OUTCOMES_FOR[f.kind].map((o) => (
              <button key={o} type="button" onClick={() => closeAs(o)}>
                {o === 'written-off' ? 'Write off' : OUTCOME_LABELS[o]}
              </button>
            ))}
            <button type="button" onClick={() => setEditing(true)}>
              Repair notes
            </button>
          </div>
        )
      )}
      {error && <p className="alert">{error}</p>}
    </li>
  )
}

/** Only what changed is sent. */
function EditFault({ f, onDone }: { f: FaultView; onDone: () => void }) {
  const [repair, setRepair] = useState(f.repair)
  const [usable, setUsable] = useState(f.usable)
  const [error, setError] = useState('')
  const submit = (e: FormEvent) => {
    e.preventDefault()
    const changes: CommandInput<'fault.update'> = { id: f.id }
    if (repair.trim() !== f.repair) changes.repair = repair.trim()
    if (usable !== f.usable) changes.usable = usable
    if (Object.keys(changes).length === 1) return onDone()
    void act(() => client.mutate('fault.update', changes)).then(onDone, (err: Error) => setError(err.message))
  }
  return (
    <form className="grid-form" onSubmit={submit}>
      <label className="wide">
        Repair notes
        <textarea rows={3} value={repair} onChange={(e) => setRepair(e.target.value)} maxLength={4000} placeholder="e.g. Sent to d&b for a new driver, €180" autoFocus />
      </label>
      {f.kind === 'damaged' && (
        <label className="tick wide">
          <input type="checkbox" checked={usable} onChange={(e) => setUsable(e.target.checked)} />
          <span>It can still go out</span>
        </label>
      )}
      {error && <p className="alert wide">{error}</p>}
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

/** The Stock tab's repair list: every open fault, oldest first. */
export function RepairList({ view }: { view: View }) {
  const open = view.faults.open
  if (open.length === 0) return null
  const missing = open.filter((f) => f.kind === 'missing')
  const damaged = open.filter((f) => f.kind === 'damaged')
  const list = (faults: FaultView[]) => (
    <ul className="fault-list">
      {faults.map((f) => (
        <FaultItem key={f.id} f={f} linked />
      ))}
    </ul>
  )
  return (
    <section className="card faults" aria-label="Faults and repairs">
      <h2>Faults and repairs</h2>
      <p className="hint">Kit that can't go out is taken off what's free for jobs until it's fixed or found.</p>
      {damaged.length > 0 && (
        <>
          <h3>Damaged</h3>
          {list(damaged)}
        </>
      )}
      {missing.length > 0 && (
        <>
          <h3>Missing</h3>
          {list(missing)}
        </>
      )}
    </section>
  )
}
