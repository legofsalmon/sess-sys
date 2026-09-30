import {
  MAX_QTY,
  newId,
  normaliseNumber,
  plural,
  stockId,
  type AssetView,
  type ModelView,
  type StockView,
  type Tracking,
  type WarehouseView,
  type Where,
} from '@sh/shared'
import { useState, type FormEvent, type ReactNode } from 'react'
import { act } from '../crew/CrewScreen.tsx'
import { client } from '../sync.ts'

/** What the Stock screens share: names for where things are, and picking a place or case by typing (ADR 0013). */

/** The commands whose refusals the Stock screens show. */
export const STOCK_COMMANDS = /^(model|place|asset|stock|labels|fault|inspection)\./

/** An item's number, or what it will have. */
export const numberLabel = (a: { number: string }) => a.number || 'Number when synced'

/** "12 items · 4 not labelled yet", or "120 counted". */
export function amountLabel(m: ModelView): string {
  if (m.tracking === 'bulk') return `${m.countedTotal.toLocaleString('en-IE')} counted`
  const parts = [plural(m.items.length, 'item')]
  if (m.countedTotal > 0) parts.push(`${m.countedTotal.toLocaleString('en-IE')} not labelled yet`)
  return parts.join(' · ')
}

/** "3 items and 20 counted in it", for a case. */
export function contentsLabel(c: AssetView): string {
  const counted = c.counted.reduce((n, s) => n + s.qty, 0)
  return (
    [c.items.length > 0 && plural(c.items.length, 'item'), counted > 0 && `${counted.toLocaleString('en-IE')} counted`].filter(Boolean).join(' and ') + ' in it'
  )
}

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase()

/** "Bay A3", "In SH-000200 (Amp rack), Bay A3", or "Not placed yet". */
export function whereLabel(x: Where, w: WarehouseView): string {
  if (x.placeId) return w.places.find((p) => p.id === x.placeId)?.name ?? 'A place since removed'
  if (x.caseId) {
    const c = w.assets.get(x.caseId)
    return c ? `In ${numberLabel(c)} (${c.model?.name ?? 'a case'})${c.at ? `, ${c.at.name}` : ''}` : 'In a case'
  }
  return 'Not placed yet'
}

/** "at Bay A3" or "in SH-000200 (Amp rack)", after a count. */
export function atLabel(x: Where, w: WarehouseView): string {
  if (x.caseId) {
    const c = w.assets.get(x.caseId)
    return c ? `in ${numberLabel(c)} (${c.model?.name ?? 'a case'})` : 'in a case'
  }
  return x.placeId ? `at ${whereLabel(x, w)}` : 'nowhere yet'
}

/** Where something is, as the where field shows it: the place's name or the case's number. */
export function whereText(x: Where, w: WarehouseView): string {
  if (x.placeId) return w.places.find((p) => p.id === x.placeId)?.name ?? ''
  if (x.caseId) return w.assets.get(x.caseId)?.number ?? ''
  return ''
}

/** The item a typed or scanned number is on, now or before. */
export function itemNumbered(text: string, w: WarehouseView): AssetView | undefined {
  const number = normaliseNumber(text)
  return number ? w.byNumber.get(number) : undefined
}

/**
 * What's typed in a where field, if it's already known: a case by its
 * number, or a place by its name. Undefined for something new.
 */
export function findWhere(text: string, w: WarehouseView): Where | undefined {
  const t = text.trim()
  if (!t) return undefined
  const c = itemNumbered(t, w)
  if (c?.model?.isCase && c.status === 'active') return { placeId: null, caseId: c.id }
  const p = w.places.find((x) => same(x.name, t))
  return p ? { placeId: p.id, caseId: null } : undefined
}

/**
 * The same, adding a new place for a name not seen before, as jobs do with
 * clients and venues. A number that isn't a case is a mistake to say.
 * Null for nothing typed.
 */
export async function whereNamed(text: string, w: WarehouseView): Promise<Where | null> {
  const t = text.trim()
  if (!t) return null
  const known = findWhere(t, w)
  if (known) return known
  const problem = whereProblem(t, w)
  if (problem) throw new Error(problem)
  const id = newId()
  await client.mutate('place.upsert', { id, name: t, notes: '' })
  return { placeId: id, caseId: null }
}

/** What's wrong with what's typed in a where field, before anything is sent: a number that isn't a case in stock. */
export function whereProblem(text: string, w: WarehouseView): string | undefined {
  const t = text.trim()
  const number = normaliseNumber(t)
  if (!number || findWhere(t, w)) return undefined
  const found = w.byNumber.get(number)
  if (!found) return `No case has the number ${number}.`
  return found.model?.isCase ? `${number} is retired, so nothing can go in it.` : `${number} (${found.model?.name ?? 'an item'}) doesn't hold other kit.`
}

/** Why an item can't go into a case, when it can't: it's that case, or the case is already inside it. The server says the same. */
export function loopIn(itemId: string, caseId: string, w: WarehouseView): string | undefined {
  const target = w.assets.get(caseId)
  const seen = new Set<string>()
  for (let c = target; c && !seen.has(c.id); c = c.inCase) {
    seen.add(c.id)
    if (c.id === itemId) return `${numberLabel(target!)} is ${caseId === itemId ? 'that case itself' : 'inside it'}, and nothing can go inside itself.`
  }
  return undefined
}

/** Places and cases to pick from as you type; a case by its number, with what it is beside it. */
export function WhereChoices({ w }: { w: WarehouseView }) {
  return (
    <datalist id="where-choices">
      {w.places.map((p) => (
        <option key={p.id} value={p.name} />
      ))}
      {w.cases
        .filter((c) => c.number)
        .map((c) => (
          <option key={c.id} value={c.number}>
            {`${c.model?.name ?? 'Case'}${c.at ? `, ${c.at.name}` : ''}`}
          </option>
        ))}
    </datalist>
  )
}

export function Pending({ pending }: { pending: boolean }) {
  return pending ? <span className="pill pending">Waiting to sync</span> : null
}

/** Products to pick from as you type. */
export function ProductChoices({ w }: { w: WarehouseView }) {
  return (
    <datalist id="product-names">
      {w.models.map((m) => (
        <option key={m.id} value={m.name} />
      ))}
    </datalist>
  )
}

/**
 * How many are counted somewhere, with Count again and Move some.
 * `children` says what the count is of: where, on a product's page; the
 * product, on a place's or a case's.
 */
export function CountRow({ s, w, children }: { s: StockView; w: WarehouseView; children: ReactNode }) {
  const [mode, setMode] = useState<'count' | 'move' | undefined>()
  const [qty, setQty] = useState('')
  const [to, setTo] = useState('')
  const [error, setError] = useState('')
  const name = s.model?.name ?? 'them'
  const open = (next: 'count' | 'move') => {
    setError('')
    setQty(next === 'count' ? String(s.qty) : '')
    setMode(mode === next ? undefined : next)
  }
  const submit = (e: FormEvent) => {
    e.preventDefault()
    setError('')
    const n = Number(qty)
    if (!Number.isInteger(n) || n < 0 || n > MAX_QTY) return setError('A whole number, please.')
    if (mode === 'count') {
      void act(() => client.mutate('stock.set', { modelId: s.modelId, placeId: s.placeId, caseId: s.caseId, qty: n })).then(
        () => setMode(undefined),
        (err: Error) => setError(err.message)
      )
      return
    }
    if (n < 1) return setError('How many to move?')
    if (n > s.qty) return setError(`Only ${s.qty.toLocaleString('en-IE')} counted ${atLabel(s, w)}.`)
    const known = findWhere(to, w)
    if (known && stockId(s.modelId, known) === s.id) return setError("That's where they are already.")
    void act(async () => {
      const dest = await whereNamed(to, w)
      if (!dest) throw new Error('Where to?')
      await client.mutate('stock.move', {
        modelId: s.modelId,
        fromPlaceId: s.placeId,
        fromCaseId: s.caseId,
        toPlaceId: dest.placeId,
        toCaseId: dest.caseId,
        qty: n,
      })
    }).then(
      () => {
        setMode(undefined)
        setTo('')
      },
      (err: Error) => setError(err.message)
    )
  }
  return (
    <div className="row count">
      <div className="what">
        <b className="n">{s.qty.toLocaleString('en-IE')}</b> <span>{children}</span>
      </div>
      <div className="actions">
        <Pending pending={s.pending} />
        <button type="button" aria-pressed={mode === 'count'} onClick={() => open('count')}>
          Count again
        </button>
        <button type="button" aria-pressed={mode === 'move'} onClick={() => open('move')}>
          Move some
        </button>
      </div>
      {mode && (
        <form className="detail grid-form" onSubmit={submit}>
          <label className={mode === 'count' ? 'wide' : undefined}>
            {mode === 'count' ? `How many ${name} are there now` : 'How many'}
            <input type="number" inputMode="numeric" min={0} max={MAX_QTY} value={qty} onChange={(e) => setQty(e.target.value)} required />
          </label>
          {mode === 'move' && (
            <label>
              To <input list="where-choices" value={to} onChange={(e) => setTo(e.target.value)} placeholder="A place, or a case's number" required />
            </label>
          )}
          {error && <p className="alert wide">{error}</p>}
          <button type="submit" className="primary wide">
            {mode === 'count' ? 'Save count' : `Move ${name}`}
          </button>
        </form>
      )}
    </div>
  )
}

/** Count a product at a place or in a case, picking it by name. For a numbered product, it's the ones not labelled yet. */
export function CountHere({ w, at, title }: { w: WarehouseView; at: Where; title: string }) {
  const [name, setName] = useState('')
  const [qty, setQty] = useState('')
  const [error, setError] = useState('')
  const submit = (e: FormEvent) => {
    e.preventDefault()
    setError('')
    const m = w.models.find((x) => same(x.name, name))
    if (!m) return setError(`No product is called ${name.trim()}. Add it on the Stock page first.`)
    const n = Number(qty)
    if (!Number.isInteger(n) || n < 1 || n > MAX_QTY) return setError('How many are there? A whole number, please.')
    const already = m.counted.find((s) => s.id === stockId(m.id, at))
    if (already && !confirm(`${already.qty.toLocaleString('en-IE')} × ${m.name} are counted ${atLabel(at, w)} already. Make it ${n.toLocaleString('en-IE')}?`))
      return
    void act(() => client.mutate('stock.set', { modelId: m.id, ...at, qty: n })).then(
      () => {
        setName('')
        setQty('')
      },
      (err: Error) => setError(err.message)
    )
  }
  return (
    <form className="grid-form" onSubmit={submit}>
      <h3 className="wide">{title}</h3>
      <label>
        Product <input list="product-names" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. XLR 10 m" required autoComplete="off" />
      </label>
      <label>
        How many <input type="number" inputMode="numeric" min={1} max={MAX_QTY} value={qty} onChange={(e) => setQty(e.target.value)} required />
      </label>
      {error && <p className="alert wide">{error}</p>}
      <button type="submit" className="wide">
        Save count
      </button>
      <ProductChoices w={w} />
    </form>
  )
}

/** Numbered or counted, and whether it holds other kit, as the new product and edit forms ask. */
export function TrackingChoice({
  tracking,
  isCase,
  onChange,
}: {
  tracking: Tracking
  isCase: boolean
  onChange: (t: { tracking: Tracking; isCase: boolean }) => void
}) {
  return (
    <fieldset className="wide tracking">
      <legend>How it's kept track of</legend>
      <label className="choice">
        <input type="radio" name="tracking" checked={tracking === 'serialised'} onChange={() => onChange({ tracking: 'serialised', isCase })} />
        <span>
          <b>Numbered</b>
          <small>Each one gets its own label: anything worth more than about €150, tested or inspected, or likely to go missing.</small>
        </span>
      </label>
      <label className="choice">
        <input type="radio" name="tracking" checked={tracking === 'bulk'} onChange={() => onChange({ tracking: 'bulk', isCase: false })} />
        <span>
          <b>Counted</b>
          <small>Only how many there are: cables, clamps, adaptors.</small>
        </span>
      </label>
      <label className="choice">
        <input type="checkbox" checked={isCase} disabled={tracking === 'bulk'} onChange={(e) => onChange({ tracking, isCase: e.target.checked })} />
        <span>
          <b>Holds other kit</b>
          <small>A road case, rack, bag or cable bundle.</small>
        </span>
      </label>
    </fieldset>
  )
}
