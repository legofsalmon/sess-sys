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
import { useId, useState, type ReactNode } from 'react'
import { CHARGE_LABELS, chargeOf, num, type Charge, type LineDraft } from './lineDraft.ts'

/**
 * One line of a draft quote (ADR 0042): its summary, its editor, its cost
 * and margin, what's short of its kit, what it was last charged in Current
 * RMS, and a discount on every line of a department.
 */

/** Puts one discount on every line of a department, which each line can still change on its own. */
export function GroupDiscount({ group, onApply, refuse }: { group: string; onApply: (off: string) => void; refuse: (why: string) => void }) {
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
        Discount on every {group || 'one'} line
        <input inputMode="decimal" value={off} onChange={(e) => setOff(e.target.value)} placeholder="%" aria-label={`Discount on every ${group} line, %`} />
      </label>
      <button type="button" onClick={apply} disabled={!off.trim()}>
        Apply
      </button>
    </div>
  )
}

/** "4 × €45.00 a day × 3 days", or "€150.00 once". */
function lineWords(l: LineDraft, r: QuoteLine | string | undefined) {
  if (r === undefined || typeof r === 'string') return 'Not finished'
  return chargeWords(r)
}

/** "4 × €45.00 a day × 3 days", "12 × €55.00 a week × 1 week", "€150.00 once", with a line's discount after. */
function chargeWords(r: QuoteLine) {
  const each = r.unitCents ? money(r.unitCents) : 'no price'
  const off = r.discountPct ? `, less ${pctWord(r.discountPct)}` : ''
  if (r.per === 'once') return `${r.qty === 1 ? '' : `${r.qty} × `}${each} once${off}`
  if (r.rate === 'weekly') return `${r.qty} × ${each} a week × ${r.days} week${r.days === 1 ? '' : 's'}${off}`
  const rule = r.rate === 'week3' && r.out !== undefined && r.out !== r.days ? ` (${daysWord(r.out)} out, 3 Day Week)` : ''
  return `${r.qty} × ${each} a day × ${daysWord(r.days)}${rule}${off}`
}

/** A line's margin (ADR 0089): what it's charged, after its own discount, less what it costs; undefined while its cost isn't known. */
export const lineMargin = (l: QuoteLine, cost: number | undefined) => (cost === undefined ? undefined : lineCents(l) - cost)

/** "Margin €3,400.00, 62%", with the lines whose cost isn't known yet: on the screen only, never printed. */
export function MarginWords({ margin }: { margin: QuoteMargin }) {
  return (
    <span className={`margin-words${margin.margin < 0 ? ' bad' : ''}`}>
      Margin <b>{money(margin.margin)}</b>
      {margin.pct !== null && `, ${pctWord(margin.pct)}`}
      {margin.unknown > 0 && <small> ({plural(margin.unknown, 'line')} with no cost yet)</small>}
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
  if (c.ifPencilled > 0)
    return (
      <p className="kit-note hint">
        Enough for now. If {c.others.filter((o) => !o.held).map((o) => o.name).slice(0, 2).join(' and ') || 'the jobs pencilled in'} went ahead, {c.ifPencilled} short on {dayLabel(c.pencilledDay!)}.
      </p>
    )
  return p.full ? <p className="kit-note hint">Enough on the job's days: {c.wanted} of the {c.owned} we have.</p> : null
}

/**
 * The cost side of a line (ADR 0089), never printed: how many are hired in and who from for kit, and what the line
 * costs us, set against its price.
 */
export function CostFields({ l, n, r, cost, boss, suppliers, set }: { l: LineDraft; n: number; r: QuoteLine | undefined; cost: number | undefined; boss: boolean; suppliers: readonly string[]; set: (c: Partial<LineDraft>) => void }) {
  const listId = useId()
  const typed = l.cost.trim() !== ''
  const worked = r && !typed ? cost : undefined
  const hint =
    l.kind === 'crew'
      ? worked !== undefined
        ? `${money(worked)} at their booked rate`
        : "Nobody's booked at a rate for this role yet"
      : l.kind === 'kit'
        ? r?.subhireQty
          ? 'What the hire company charges us'
          : 'Nothing: our own kit'
        : 'What it costs us, a van and driver, say'
  const m = r && boss ? lineMargin(r, cost) : undefined
  return (
    <fieldset className="line-cost">
      <legend>Not printed</legend>
      {l.kind === 'kit' && (
        <>
          <label>
            Hired in
            <input inputMode="numeric" value={l.subhire} onChange={(e) => set({ subhire: e.target.value })} placeholder="None" aria-label={`Line ${n}: hired in`} />
          </label>
          {l.subhire.trim() !== '' && l.subhire.trim() !== '0' && (
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
        Costs us, €
        <input inputMode="decimal" value={l.cost} onChange={(e) => set({ cost: e.target.value })} placeholder={worked !== undefined ? euroText(worked) : ''} aria-label={`Line ${n}: costs us`} />
        <small>{typed ? 'As typed. Clear it to work it out again.' : hint}</small>
      </label>
      {boss && <p className={`line-margin${m !== undefined && m < 0 ? ' bad' : ''}`}>{m === undefined ? 'Margin: not known until it has a cost' : `Margin ${money(m)}`}</p>}
    </fieldset>
  )
}

/** A line, shut: what it is, how it's charged and what it comes to; pressing it opens it to change. */
export function LineSummary({ l, n, r, onOpen, focus, margin }: { l: LineDraft; n: number; r: QuoteLine | string | undefined; onOpen: () => void; focus: boolean; margin?: number | undefined }) {
  const bad = r === undefined || typeof r === 'string'
  const unpriced = !bad && r.unitCents === 0
  return (
    <button type="button" className={`quote-line-shut${bad || unpriced ? ' needs' : ''}`} onClick={onOpen} autoFocus={focus} aria-label={`Line ${n}: ${l.what || 'not named yet'}, change it`}>
      <span className="what">
        {l.what || 'Not named yet'}
        {l.includes && <small className="includes">{l.includes}</small>}
      </span>
      <span className="how">
        {unpriced ? `${lineWords(l, r)}: needs a price` : lineWords(l, r)}
        {!bad && r.subhireQty ? `, ${r.subhireQty} hired in${r.supplier ? ` from ${r.supplier}` : ''}` : ''}
      </span>
      <span className="amount">
        {bad ? '–' : money(lineCents(r))}
        {margin !== undefined && <small className={`line-margin${margin < 0 ? ' bad' : ''}`}>makes {money(margin)}</small>}
      </span>
    </button>
  )
}

export function LineEditor(p: {
  l: LineDraft
  n: number
  r: QuoteLine | string | undefined
  set: (c: Partial<LineDraft>) => void
  onRemove: () => void
  onDone: () => void
  kit: ReactNode
  cost: ReactNode
  last: ReactNode
}) {
  const { l, n, r, set, onRemove, onDone } = p
  const [vatOpen, setVatOpen] = useState(false)
  const unpriced = r !== undefined && typeof r !== 'string' && r.unitCents === 0
  return (
    <div className={`quote-line${unpriced ? ' unpriced' : ''}`}>
      <label className="what">
        What
        <input value={l.what} onChange={(e) => set({ what: e.target.value })} maxLength={200} aria-label={`Line ${n}: what`} autoFocus />
      </label>
      {l.packageId !== null && (
        <label className="what">
          It includes
          <input value={l.includes} onChange={(e) => set({ includes: e.target.value })} maxLength={PACKAGE_INCLUDES_LENGTH} aria-label={`Line ${n}: includes`} />
        </label>
      )}
      <label>
        How many
        <input inputMode="numeric" value={l.qty} onChange={(e) => set({ qty: e.target.value })} aria-label={`Line ${n}: how many`} />
      </label>
      <label>
        Price, €
        <input inputMode="decimal" value={l.price} onChange={(e) => set({ price: e.target.value })} aria-label={`Line ${n}: price`} placeholder="0" aria-invalid={unpriced || undefined} />
      </label>
      <label>
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
      {l.per === 'once' ? (
        <span className="no-days" aria-hidden="true" />
      ) : l.rate ? (
        <label>
          Days out
          <input inputMode="decimal" value={l.out} onChange={(e) => set({ out: e.target.value })} aria-label={`Line ${n}: days out`} />
        </label>
      ) : (
        <label>
          Days
          <input inputMode="decimal" value={l.days} onChange={(e) => set({ days: e.target.value })} aria-label={`Line ${n}: days charged`} />
        </label>
      )}
      <label className="line-discount">
        Discount, %
        <input inputMode="decimal" value={l.discount} onChange={(e) => set({ discount: e.target.value })} placeholder="None" aria-label={`Line ${n}: discount, %`} />
      </label>
      {vatOpen || l.vat !== STANDARD_VAT ? (
        <label className="vat-rate">
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
        <button type="button" className="link vat" onClick={() => setVatOpen(true)} aria-label={`Line ${n}: VAT is 23%, change it`}>
          VAT 23%
        </button>
      )}
      <span className="amount">
        {r === undefined || typeof r === 'string' ? '–' : money(lineCents(r))}
        {unpriced && <small className="warn"> Needs a price</small>}
        {/* What the rule makes of the days out (ADR 0085), by what it comes to. */}
        {l.rate && l.per === 'day' && r !== undefined && typeof r !== 'string' && (
          <small>Charged {l.rate === 'weekly' ? `${r.days} week${r.days === 1 ? '' : 's'}` : daysWord(r.days)}</small>
        )}
      </span>
      {p.kit}
      {p.cost}
      {p.last}
      {typeof r === 'string' && l.what.trim() !== '' && <p className="line-problem">{r}</p>}
      <span className="line-actions">
        <button type="button" className="link" onClick={onRemove} aria-label={`Remove line ${n}`}>
          Remove
        </button>
        <button type="button" className="link" onClick={onDone}>
          Done
        </button>
      </span>
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
