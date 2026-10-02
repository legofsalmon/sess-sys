import {
  itemByCode,
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
import { flushSync } from 'react-dom'
import { Confirm, Refusal, useAct } from '../act.tsx'
import { Pending } from '../StatusPill.tsx'
import { client } from '../sync.ts'

/**
 * What the Stock screens share: names for where things are, picking a place
 * or case by typing (ADR 0013), the question before a name nobody has used
 * makes a new place, and what the last scan did, under the camera.
 */

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
 * The item a scanned or typed code names, to put somewhere, or why not:
 * its number, an old tag (ADR 0026) or its maker's serial, as a scan reads
 * them. A number it had before is turned down, so an old label still on it
 * is noticed.
 */
export function itemToPut(code: string, w: WarehouseView): { item: AssetView; problem?: undefined } | { item?: undefined; problem: string } {
  const item = itemByCode(w, code)
  const typed = normaliseNumber(code)
  if (!item) return { problem: typed ? `No item has the number ${typed}.` : `Nothing has the code ${code.trim()}.` }
  if (typed && item.number !== typed && item.formerNumbers.includes(typed)) return { problem: `${typed} was an old label. That item is ${numberLabel(item)} now.` }
  if (item.retiredReason === 'mistake') return { problem: mistakeLabel(item) }
  if (item.status !== 'active') return { problem: `${item.number} (${item.model?.name ?? 'an item'}) is retired. Bring it back first.` }
  return { item }
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
  if (found.retiredReason === 'mistake') return `${number} was added by mistake.`
  return found.model?.isCase ? `${number} is retired, so nothing can go in it.` : `${number} (${found.model?.name ?? 'an item'}) doesn't hold other kit.`
}

/**
 * The question before a where that matches no place makes a new one (audit
 * finding 19), so a slip of the thumb doesn't leave a "Bay A4" beside the
 * "Bay A3" meant. `ask` answers whether the question is now on screen: if
 * so, `go` runs once it's answered yes, and the form shows `question` in
 * the button's place with its fields held still (`asking`).
 */
export function useNewPlace(w: WarehouseView) {
  const [asking, setAsking] = useState<{ name: string; go: () => void }>()
  const ask = (text: string, go: () => void): boolean => {
    const t = text.trim()
    if (!t || findWhere(t, w) || whereProblem(t, w)) return false
    setAsking({ name: t, go })
    return true
  }
  const question = asking ? (
    <Confirm
      className="wide"
      question={`Make a new place called “${asking.name}”? It joins the places on the Stock tab.`}
      yes="Make the place"
      no="Go back"
      onYes={() => {
        // The fields are back before the form goes on, so the number field can take the focus for the next label.
        flushSync(() => setAsking(undefined))
        asking.go()
      }}
      onNo={() => setAsking(undefined)}
    />
  ) : null
  return { ask, question, asking: !!asking }
}

/**
 * What the last scan or put-away did, in a row under the camera, which
 * stays on for the next label (audit finding 18); Close ends the session.
 */
export function ScanResult({ children, onClose, label = 'Last scan' }: { children: ReactNode; onClose?: () => void; label?: string }) {
  return (
    <div className="scan-result wide">
      <div className="added" role="status" aria-label={label}>
        {children}
      </div>
      {onClose && (
        <button type="button" onClick={onClose}>
          Close
        </button>
      )}
    </div>
  )
}

/** "SH-000123 (d&b Y10P) was added by mistake.", for a label that's on nothing real. */
export const mistakeLabel = (a: AssetView) => `${numberLabel(a)} (${a.model?.name ?? 'an item'}) was added by mistake.`

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
  const { run, error, refuse } = useAct()
  const { ask, question, asking } = useNewPlace(w)
  const name = s.model?.name ?? 'them'
  const open = (next: 'count' | 'move') => {
    refuse('')
    setQty(next === 'count' ? String(s.qty) : '')
    setMode(mode === next ? undefined : next)
  }
  const submit = (e: FormEvent) => {
    e.preventDefault()
    const n = Number(qty)
    if (!Number.isInteger(n) || n < 0 || n > MAX_QTY) return refuse('A whole number, please.')
    if (mode === 'count') {
      void run(() => client.mutate('stock.set', { modelId: s.modelId, placeId: s.placeId, caseId: s.caseId, qty: n })).then((ok) => ok && setMode(undefined))
      return
    }
    if (n < 1) return refuse('How many to move?')
    if (n > s.qty) return refuse(`Only ${s.qty.toLocaleString('en-IE')} counted ${atLabel(s, w)}.`)
    const known = findWhere(to, w)
    if (known && stockId(s.modelId, known) === s.id) return refuse("That's where they are already.")
    const go = () =>
      void run(async () => {
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
      }).then((ok) => {
        if (!ok) return
        setMode(undefined)
        setTo('')
      })
    if (!ask(to, go)) go()
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
            <input type="number" inputMode="numeric" min={0} max={MAX_QTY} value={qty} onChange={(e) => setQty(e.target.value)} required disabled={asking} />
          </label>
          {mode === 'move' && (
            <label>
              To <input list="where-choices" value={to} onChange={(e) => setTo(e.target.value)} placeholder="A place, or a case's number" required disabled={asking} />
            </label>
          )}
          <Refusal error={error} className="wide" />
          {question ?? (
            <button type="submit" className="primary wide">
              {mode === 'count' ? 'Save count' : `Move ${name}`}
            </button>
          )}
        </form>
      )}
    </div>
  )
}

/** Count a product at a place or in a case, picking it by name. For a numbered product, it's the ones not labelled yet. */
export function CountHere({ w, at, title }: { w: WarehouseView; at: Where; title: string }) {
  const [name, setName] = useState('')
  const [qty, setQty] = useState('')
  // A count that would replace one already made waits here until the office says so.
  const [asking, setAsking] = useState<{ m: ModelView; n: number; already: number } | undefined>()
  const { run, error, refuse } = useAct()
  const save = (m: ModelView, n: number) => {
    setAsking(undefined)
    void run(() => client.mutate('stock.set', { modelId: m.id, ...at, qty: n })).then((ok) => {
      if (!ok) return
      setName('')
      setQty('')
    })
  }
  const submit = (e: FormEvent) => {
    e.preventDefault()
    const m = w.models.find((x) => same(x.name, name))
    if (!m) return refuse(`No product is called ${name.trim()}. Add it on the Stock page first.`)
    const n = Number(qty)
    if (!Number.isInteger(n) || n < 1 || n > MAX_QTY) return refuse('How many are there? A whole number, please.')
    const already = m.counted.find((s) => s.id === stockId(m.id, at))
    if (already) return setAsking({ m, n, already: already.qty })
    save(m, n)
  }
  return (
    <form className="grid-form" onSubmit={submit}>
      <h3 className="wide">{title}</h3>
      <label>
        Product <input list="product-names" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. XLR 10 m" required autoComplete="off" disabled={!!asking} />
      </label>
      <label>
        How many <input type="number" inputMode="numeric" min={1} max={MAX_QTY} value={qty} onChange={(e) => setQty(e.target.value)} required disabled={!!asking} />
      </label>
      <Refusal error={error} className="wide" />
      {asking ? (
        <Confirm
          className="wide"
          question={`${asking.already.toLocaleString('en-IE')} × ${asking.m.name} are counted ${atLabel(at, w)} already. Make it ${asking.n.toLocaleString('en-IE')}?`}
          yes={`Make it ${asking.n.toLocaleString('en-IE')}`}
          no="Leave the count"
          onYes={() => save(asking.m, asking.n)}
          onNo={() => setAsking(undefined)}
        />
      ) : (
        <button type="submit" className="wide">
          Save count
        </button>
      )}
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
