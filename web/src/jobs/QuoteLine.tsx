import {
  dayLabel,
  daysWord,
  euroText,
  lineCents,
  money,
  parseEuro,
  pctWord,
  plural,
  STANDARD_VAT,
  VAT_LABELS,
  VAT_RATES,
  type QuoteLine,
  type VatRate,
  PACKAGE_INCLUDES_LENGTH,
  SUPPLIER_LENGTH,
  type QuoteKitCheck,
  type QuoteMargin,
  type RmsCharge,
  type RmsLastCharged,
} from '@sh/shared'
import { useEffect, useId, useState, type ReactNode } from 'react'
import { Icon } from '../Icon.tsx'
import { CHARGE_LABELS, chargeOf, num, type Charge, type LineDraft, type LineFault, type LineField } from './lineDraft.ts'

/**
 * One line of a draft quote (ADR 0042, redrawn in ADR 0100): its row, its
 * editor, its cost and margin folded under it, what's short of its kit, what
 * it was last charged in Current RMS, and a discount on every line of a
 * department.
 */

/**
 * A number with its unit in the box (€ before it, % or km after), never typed. The unit stays in the field's accessible
 * name, since what's drawn beside the input isn't read out with it.
 */
export function UnitBox({ unit, before, needs, children }: { unit: string; before?: boolean; needs?: boolean; children: ReactNode }) {
  return (
    <span className={`unit-box${before ? ' before' : ''}${needs ? ' needs' : ''}`}>
      {before && (
        <span className="unit" aria-hidden="true">
          {unit}
        </span>
      )}
      {children}
      {!before && (
        <span className="unit" aria-hidden="true">
          {unit}
        </span>
      )}
    </span>
  )
}

/** Puts one discount on every line of a department, which each line can still change on its own. */
export function GroupDiscount({ group, onApply, onCancel, refuse }: { group: string; onApply: (off: string) => void; onCancel: () => void; refuse: (why: string) => void }) {
  const [off, setOff] = useState('')
  const apply = () => {
    const n = num(off.replace(/%$/, ''))
    if (!(n >= 0 && n <= 100 && Number.isInteger(n * 10))) return refuse('A discount is a percentage from 0 to 100, such as 30 or 12.5.')
    onApply(n ? String(n) : '')
    setOff('')
  }
  return (
    <div className="group-discount">
      <label>
        Discount every {group} line
        <UnitBox unit="%">
          <input
            inputMode="decimal"
            value={off}
            onChange={(e) => setOff(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                apply()
              }
            }}
            aria-label={`Discount on every ${group} line, %`}
            autoFocus
          />
        </UnitBox>
      </label>
      <button type="button" onClick={apply} disabled={!off.trim()}>
        Apply
      </button>
      <button type="button" className="link" onClick={onCancel}>
        Cancel
      </button>
    </div>
  )
}

/** "4 × €45.00 a day × 3 days", "12 × €55.00 a week × 1 week", "€150.00 once", with a line's discount after. */
export function chargeWords(r: QuoteLine) {
  const each = r.unitCents ? money(r.unitCents) : 'no price'
  const off = r.discountPct ? `, less ${pctWord(r.discountPct)}` : ''
  if (r.per === 'once') return `${r.qty === 1 ? '' : `${r.qty} × `}${each} once${off}`
  if (r.rate === 'weekly') return `${r.qty} × ${each} a week × ${r.days} week${r.days === 1 ? '' : 's'}${off}`
  const rule = r.rate === 'week3' && r.out !== undefined && r.out !== r.days ? ` (${daysWord(r.out)} out, 3 Day Week)` : ''
  return `${r.qty} × ${each} a day × ${daysWord(r.days)}${rule}${off}`
}

/** A line's margin (ADR 0089): what it's charged, after its own discount, less what it costs; undefined while its cost isn't known. */
export const lineMargin = (l: QuoteLine, cost: number | undefined) => (cost === undefined ? undefined : lineCents(l) - cost)

/** "Margin €3,400.00, 62%", with the lines whose cost isn't known yet unless told not to: on the screen only, never printed. */
export function MarginWords({ margin, unknown = true }: { margin: QuoteMargin; unknown?: boolean }) {
  return (
    <span className={`margin-words${margin.margin < 0 ? ' bad' : ''}`}>
      Margin <b>{money(margin.margin)}</b>
      {margin.pct !== null && `, ${pctWord(margin.pct)}`}
      {unknown && margin.unknown > 0 && <small> ({plural(margin.unknown, 'line')} with no cost yet)</small>}
    </span>
  )
}

/** What a line wants that there isn't enough of on the job's days: the product itself, or a package's pieces. */
export function linesShort(l: QuoteLine, checks: ReadonlyMap<string, QuoteKitCheck>, items: readonly { modelId: string }[] | undefined): QuoteKitCheck[] {
  if (l.kind !== 'kit') return []
  const ids = l.modelId ? [l.modelId] : l.packageId ? (items ?? []).map((i) => i.modelId) : []
  return ids.map((id) => checks.get(id)).filter((c): c is QuoteKitCheck => !!c && c.short > 0)
}

/**
 * Whether there's enough of a kit line's product on the job's days (ADR 0089), under the line: said only when it's
 * short, or would be if pencilled jobs went ahead, unless the line is open. Short, it offers to hire in what's short.
 */
export function KitNote(p: {
  l: QuoteLine
  checks: ReadonlyMap<string, QuoteKitCheck>
  items: readonly { modelId: string; qty: number }[] | undefined
  names: (modelId: string) => string | undefined
  onHire?: (n: number) => void
  full: boolean
}) {
  const { l, checks } = p
  if (l.kind !== 'kit') return null
  if (!l.modelId) {
    const short = linesShort(l, checks, p.items)
    if (!short.length) return null
    return (
      <p className="kit-note warn-line">
        Short on the job's days: {short.map((c) => `${c.short} × ${p.names(c.modelId) ?? 'a product'} on ${dayLabel(c.shortDay!)}`).join(', ')}. Hire them in, or quote fewer.
      </p>
    )
  }
  const c = checks.get(l.modelId)
  if (!c) return null
  const others = (o: QuoteKitCheck['others']) => o.slice(0, 2).map((x) => `${x.name} has ${x.qty}`).join(', ')
  if (c.short > 0) {
    const own = l.qty - (l.subhireQty ?? 0)
    return (
      <p className="kit-note warn-line">
        Short by {c.short} on {dayLabel(c.shortDay!)}
        {c.wanted > own ? `, across the quote's ${c.wanted}` : ''}
        {c.others.length ? `: ${others(c.others)} out` : ''}.{' '}
        {p.onHire && own > 0 && (
          <button type="button" className="link" onClick={() => p.onHire!(Math.min(c.short, own))}>
            Hire {Math.min(c.short, own)} in
          </button>
        )}
      </p>
    )
  }
  if (c.ifPencilled > 0) {
    // A maybe, said quietly: amber is kept for a real shortfall.
    const names = c.others.filter((o) => !o.held).map((o) => o.name).slice(0, 2)
    return (
      <p className="kit-note hint">
        Enough, unless {names.join(' and ') || 'the jobs pencilled in'} {names.length === 1 ? 'goes' : 'go'} ahead: then {c.ifPencilled} short on {dayLabel(c.pencilledDay!)}.
      </p>
    )
  }
  return p.full ? <p className="kit-note hint">Enough on the job's days: {c.wanted} of the {c.owned} we have.</p> : null
}

/** What a line costs us, in a few words for the cost fold's summary, so it says what's inside before it's opened. */
function costWords(l: LineDraft, r: QuoteLine | undefined, cost: number | undefined, typed: boolean) {
  const hired = r?.subhireQty ?? 0
  if (l.kind === 'kit') {
    if (hired) return `${hired} hired in${r?.supplier ? ` from ${r.supplier}` : ''}, ${cost === undefined ? 'no cost yet' : money(cost)}`
    return typed && cost !== undefined ? `Costs us ${money(cost)}` : 'Our own kit, costs nothing'
  }
  if (l.kind === 'crew') return cost === undefined ? 'No one booked at a rate yet' : typed ? `Costs us ${money(cost)}` : `${money(cost)} at the booked rate`
  return cost === undefined ? 'No cost yet' : `Costs us ${money(cost)}`
}

/**
 * The cost side of a line (ADR 0089), never printed, folded under it: how many are hired in and who from for kit, and
 * what the line costs us, set against its price. The fold's summary says what it holds. It opens on its own where the
 * cost is the point: transport and other typed lines, anything hired in, a cost typed, or a press on "no cost yet".
 */
export function CostFields({
  l,
  n,
  r,
  cost,
  boss,
  suppliers,
  set,
  wantOpen,
  left,
  mark,
  problem,
}: {
  l: LineDraft
  n: number
  r: QuoteLine | undefined
  cost: number | undefined
  boss: boolean
  suppliers: readonly string[]
  set: (c: Partial<LineDraft>) => void
  wantOpen: boolean
  left: (f: LineField) => () => void
  mark: (f: LineField) => Record<string, unknown>
  problem: ReactNode
}) {
  const listId = useId()
  const typed = l.cost.trim() !== ''
  const worked = r && !typed ? cost : undefined
  const hiring = l.subhire.trim() !== '' && l.subhire.trim() !== '0'
  const [open, setOpen] = useState(() => wantOpen || l.kind === 'other' || hiring || typed)
  useEffect(() => {
    if (hiring || wantOpen) setOpen(true)
  }, [hiring, wantOpen])
  const m = r && boss ? lineMargin(r, cost) : undefined
  return (
    <details className="line-cost" open={open} onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary>
        <Icon name="next" className="chevron" />
        <b>{boss ? 'Cost and margin' : 'Cost'}</b>
        <small>Not printed</small>
        <span className={`words${m !== undefined && m < 0 ? ' bad' : ''}`}>
          {costWords(l, r, cost, typed)}
          {boss && ` · ${m === undefined ? 'margin not known' : `makes ${money(m)}`}`}
        </span>
      </summary>
      <div className="cost-fields">
        {l.kind === 'kit' && (
          <>
            <label>
              Hired in
              <input inputMode="numeric" value={l.subhire} onChange={(e) => set({ subhire: e.target.value })} placeholder="None" aria-label={`Line ${n}: hired in`} onBlur={left('subhire')} {...mark('subhire')} />
            </label>
            {hiring && (
              <label className="supplier">
                From
                <input list={listId} value={l.supplier} onChange={(e) => set({ supplier: e.target.value })} maxLength={SUPPLIER_LENGTH} placeholder="Who we hire them from" aria-label={`Line ${n}: supplier`} />
                <datalist id={listId}>
                  {suppliers.map((x) => (
                    <option key={x} value={x} />
                  ))}
                </datalist>
              </label>
            )}
          </>
        )}
        <label>
          Costs us
          <UnitBox unit="€" before>
            <input inputMode="decimal" value={l.cost} onChange={(e) => set({ cost: e.target.value })} placeholder={worked !== undefined ? euroText(worked) : ''} aria-label={`Line ${n}: costs us`} onBlur={left('cost')} {...mark('cost')} />
          </UnitBox>
          {typed && <small>As typed. Clear it to work it out again.</small>}
        </label>
      </div>
      {problem}
    </details>
  )
}

/** A line, shut: what it is, how it's charged and what it comes to, with the mark that says it opens; pressing it opens it to change. */
export function LineSummary({ l, n, done, onOpen, focus, margin }: { l: LineDraft; n: number; done: QuoteLine | undefined; onOpen: () => void; focus: boolean; margin?: number | undefined }) {
  const unpriced = done !== undefined && done.unitCents === 0
  const how = done === undefined ? 'Not finished' : chargeWords(done)
  return (
    <button type="button" className={`quote-line-shut${done === undefined || unpriced ? ' needs' : ''}`} onClick={onOpen} autoFocus={focus} aria-label={`Line ${n}: ${l.what || 'not named yet'}, change it`}>
      <span className="what">
        {l.what || 'Not named yet'}
        {l.includes && <small className="includes">{l.includes}</small>}
      </span>
      <span className="how">
        {unpriced ? `${how}: needs a price` : how}
        {done?.subhireQty ? `, ${done.subhireQty} hired in${done.supplier ? ` from ${done.supplier}` : ''}` : ''}
      </span>
      <span className="amount">
        {done === undefined ? '–' : money(lineCents(done))}
        {margin !== undefined && <small className={`line-margin${margin < 0 ? ' bad' : ''}`}>makes {money(margin)}</small>}
      </span>
      <Icon name="edit" className="opener" />
    </button>
  )
}

/**
 * A line open to change: what it is across the top, its numbers in one row (two on a phone), what it comes to, then
 * what's short, what it was last charged, and the cost fold. A field's fault shows once that field, or the line, has
 * been left (design system rule 18), beside its cause, and goes the moment it's put right.
 */
export function LineEditor(p: {
  l: LineDraft
  n: number
  done: QuoteLine | undefined
  fault: LineFault | undefined
  /** Whether the line has been left since it was opened or added, so its fault may show wherever it is. */
  left: boolean
  focus: 'what' | 'price'
  set: (c: Partial<LineDraft>) => void
  onRemove: () => void
  onDone: () => void
  onLeave: () => void
  kit: ReactNode
  last: ReactNode
  cost: number | undefined
  boss: boolean
  suppliers: readonly string[]
  wantCost: boolean
}) {
  const { l, n, done, fault, set, onRemove, onDone } = p
  const [vatOpen, setVatOpen] = useState(false)
  const [leftFields, setLeftFields] = useState<ReadonlySet<LineField>>(() => new Set())
  const leave = (f: LineField) => () => setLeftFields((s) => (s.has(f) ? s : new Set(s).add(f)))
  const pid = useId()
  // Said once the line has been left, or once the field has, if something was typed in it: a field skipped over isn't
  // faulted for being empty until the line is done with (Baymard, inline validation).
  const typedIn: Record<LineField, string> = { what: l.what, price: l.price, qty: l.qty, out: l.out, days: l.days, discount: l.discount, subhire: l.subhire, cost: l.cost }
  const shown = fault !== undefined && (p.left || (leftFields.has(fault.field) && typedIn[fault.field].trim() !== ''))
  const mark = (f: LineField) => (shown && fault.field === f ? { 'aria-invalid': true, 'aria-describedby': pid } : {})
  const problem = (fields: LineField[]) =>
    shown && fields.includes(fault.field) ? (
      <p className="line-problem" id={pid}>
        {fault.why}
      </p>
    ) : null
  const unpriced = done !== undefined && done.unitCents === 0
  return (
    <div
      className={`quote-line${unpriced ? ' unpriced' : ''}`}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) p.onLeave()
      }}
    >
      <label className="what">
        What
        <input value={l.what} onChange={(e) => set({ what: e.target.value })} maxLength={200} aria-label={`Line ${n}: what`} autoFocus={p.focus === 'what'} onBlur={leave('what')} {...mark('what')} />
      </label>
      {problem(['what'])}
      {l.packageId !== null && (
        <label className="what">
          It includes
          <input value={l.includes} onChange={(e) => set({ includes: e.target.value })} maxLength={PACKAGE_INCLUDES_LENGTH} aria-label={`Line ${n}: includes`} />
        </label>
      )}
      <div className="numbers">
        <label className="qty">
          How many
          <input inputMode="numeric" value={l.qty} onChange={(e) => set({ qty: e.target.value })} aria-label={`Line ${n}: how many`} onBlur={leave('qty')} {...mark('qty')} />
        </label>
        {l.per === 'once' ? null : l.rate ? (
          <label className="days">
            Days out
            <input inputMode="decimal" value={l.out} onChange={(e) => set({ out: e.target.value })} aria-label={`Line ${n}: days out`} onBlur={leave('out')} {...mark('out')} />
          </label>
        ) : (
          <label className="days">
            Days
            <input inputMode="decimal" value={l.days} onChange={(e) => set({ days: e.target.value })} aria-label={`Line ${n}: days charged`} onBlur={leave('days')} {...mark('days')} />
          </label>
        )}
        <label className={`price${l.per === 'once' ? ' wide' : ''}`}>
          Price
          <UnitBox unit="€" before needs={unpriced}>
            <input inputMode="decimal" value={l.price} onChange={(e) => set({ price: e.target.value })} aria-label={`Line ${n}: price`} placeholder="0" autoFocus={p.focus === 'price'} onBlur={leave('price')} {...mark('price')} />
          </UnitBox>
        </label>
        <label className="charged">
          Charged
          <select
            value={chargeOf(l)}
            onChange={(e) => {
              const c = e.target.value as Charge
              // Moving to a rule starts its days out from the days charged so far.
              set(c === 'once' ? { per: 'once' } : c === 'daily' ? { per: 'day', rate: null } : { per: 'day', rate: c, out: l.rate ? l.out : l.days })
            }}
            aria-label={`Line ${n}: charged`}
          >
            {(['daily', 'week3', 'weekly', 'once'] as const).map((c) => (
              <option key={c} value={c}>
                {CHARGE_LABELS[c]}
              </option>
            ))}
          </select>
        </label>
        <label className="discount">
          Discount
          <UnitBox unit="%">
            <input inputMode="decimal" value={l.discount} onChange={(e) => set({ discount: e.target.value })} placeholder="None" aria-label={`Line ${n}: discount, %`} onBlur={leave('discount')} {...mark('discount')} />
          </UnitBox>
        </label>
        {vatOpen || l.vat !== STANDARD_VAT ? (
          <label className="vat">
            VAT
            <select value={l.vat} onChange={(e) => set({ vat: e.target.value as VatRate })} aria-label={`Line ${n}: VAT`}>
              {VAT_RATES.map((v) => (
                <option key={v} value={v}>
                  {VAT_LABELS[v]}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <span className="vat vat-cell">
            VAT
            <button type="button" className="link" onClick={() => setVatOpen(true)} aria-label={`Line ${n}: VAT is 23%, change it`}>
              23%
            </button>
          </span>
        )}
        <span className="amount">
          {done === undefined ? '–' : money(lineCents(done))}
          {unpriced && <small className="warn">Needs a price</small>}
          {/* What the rule makes of the days out (ADR 0085), by what it comes to. */}
          {l.rate && l.per === 'day' && done !== undefined && <small>Charged {l.rate === 'weekly' ? `${done.days} week${done.days === 1 ? '' : 's'}` : daysWord(done.days)}</small>}
        </span>
      </div>
      {problem(['qty', 'out', 'days', 'price', 'discount'])}
      {p.kit}
      {p.last}
      <CostFields l={l} n={n} r={done} cost={p.cost} boss={p.boss} suppliers={p.suppliers} set={set} wantOpen={p.wantCost} left={leave} mark={mark} problem={problem(['subhire', 'cost'])} />
      <div className="line-actions">
        <button type="button" className="link quiet" onClick={onRemove} aria-label={`Remove line ${n}`}>
          Remove
        </button>
        <button type="button" onClick={onDone}>
          Done
        </button>
      </div>
    </div>
  )
}

/** The names a line goes by in Current RMS (ADR 0092): a product's own and its other names, a crew role without the phase, or what it says. */
export function rmsNames(l: Pick<LineDraft, 'kind' | 'what' | 'modelId'>, model: (id: string) => { name: string; aliases: readonly string[] } | undefined): string[] {
  const found = l.modelId ? model(l.modelId) : undefined
  if (found) return [found.name, ...found.aliases]
  const what = l.kind === 'crew' ? l.what.replace(/\s*\([^)]*\)\s*$/, '') : l.what
  return what.trim() ? [what] : []
}

export const lastOf = (last: RmsLastCharged, names: readonly string[]) => {
  for (const n of names) {
    const hit = last[n.trim().toLowerCase()]
    if (hit) return hit
  }
  return undefined
}

/** A day in Current RMS's past, with its year, since it may be years back. */
export const pastDay = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-IE', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Europe/Dublin' })

const chargeLine = (c: RmsCharge) =>
  [
    `${money(c.priceCents)}${c.rate ? ` on the ${c.rate.toLowerCase()}` : ''}`,
    c.discountPct ? `${c.discountPct.toLocaleString('en-IE')}% off` : '',
    c.on ? pastDay(c.on) : '',
    `quote ${c.number}`,
  ]
    .filter(Boolean)
    .join(', ')

/** What a line was last charged in Current RMS (ADR 0092), to this client and to anyone, with a press to use the price. A hint only: nothing without signal. */
export function LastCharged({ found, n, price, onUse }: { found: RmsLastCharged[string] | undefined; n: number; price: string; onUse: (cents: number) => void }) {
  if (!found || (!found.client && !found.any)) return null
  const use = found.client ?? found.any!
  const already = parseEuro(price).cents === use.priceCents
  return (
    <div className="last-charged" aria-label={`Line ${n}: last charged in Current RMS`}>
      {found.client && (
        <p>
          Last charged to {found.client.client}: {chargeLine(found.client)}.
        </p>
      )}
      {found.any && found.any.opportunityId !== found.client?.opportunityId && (
        <p className="hint">
          {found.client ? 'Last to anyone' : 'Last charged'}: {chargeLine(found.any)}, {found.any.client}.
        </p>
      )}
      {!already && (
        <button type="button" className="link" onClick={() => onUse(use.priceCents)}>
          Use {money(use.priceCents)}
        </button>
      )}
    </div>
  )
}
