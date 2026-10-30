import {
  changesFromJob,
  dayLabel,
  DEPARTMENT_LABELS,
  eachDay,
  euroText,
  irishToday,
  linesByGroup,
  MAX_LINES,
  money,
  newId,
  parseEuro,
  pctWord,
  plural,
  quoteTotals,
  STANDARD_VAT,
  type JobView,
  type QuoteLine,
  type QuoteView,
  type View,
  DEFAULT_VALID_DAYS,
  depositCents,
  validUntil,
  packageIncludes,
  extrasFor,
  travelSettingsOf,
  type Pin,
  lineCostOf,
  quoteKit,
  quoteMargin,
  quoteWants,
  suggestionLine,
  type AskedLine,
  MOST_LAST_CHARGED_NAMES,
} from '@sh/shared'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Refusal, useAct } from '../act.tsx'
import { Empty } from '../Empty.tsx'
import { ProductPicker } from '../ProductPicker.tsx'
import { useAccess } from '../role.ts'
import { client } from '../sync.ts'
import { useLate } from '../useLate.ts'
import { useToday } from '../view.ts'
import { useUnderTop } from '../useUnderTop.ts'
import { AdviceCard, AskClaude, useClaude, type Advice } from './Claude.tsx'
import { useLastCharged } from './rms.ts'
import { QuotePill } from './QuoteStatus.tsx'
import { num, readLine, sameLine, toDraft, type LineDraft } from './lineDraft.ts'
import {
  CostFields,
  GroupDiscount,
  KitNote,
  LastCharged,
  lastOf,
  LineEditor,
  lineMargin,
  linesShort,
  LineSummary,
  MarginWords,
  rmsNames,
} from './QuoteLine.tsx'
import { Totals } from './QuoteSheet.tsx'
import { AddCrew, AddPackage, AddTransport, JobChangesCard, transportWords, TravelAndSubsistence } from './QuoteAdd.tsx'

/**
 * A quote while it's a draft (ADR 0042): every line open to change, saving
 * itself as it's typed, and marked sent when it goes to the client.
 */

/**
 * Sent to the client, and so the job is quoted (ADR 0081): an enquiry moves on by itself, since that's all "quoted"
 * means. A job already confirmed, or stopped, stays as it is.
 */
async function markSent(id: string, job: JobView, on: string) {
  await client.mutate('quote.sent', { id, on })
  if (job.status === 'enquiry') await client.mutate('project.update', { id: job.id, status: 'quoted' })
}

/** A tidy figure under the lines' total to offer as an agreed price: down to the nearest €50. */
const roundDown = (cents: number) => Math.floor(cents / 5000) * 5000

/** How long the draft waits after the last key before it saves itself. */
const SAVE_AFTER_MS = 1_200

/**
 * What's typed on a draft that can't save yet (a line with nothing to say what it's for, a price that isn't one) is kept on
 * this device for the tab's life, as places.ts keeps scroll places, so going to another screen and coming back doesn't
 * lose it (audit, 20 October 2026, finding 27). Kept against the draft as it's saved: once that changes, from here or
 * another device, what was typed over the older one is let go. What can save saves itself, so nothing is kept for it.
 */
const TYPED_STORE = 'session-hire-quote-typed'
interface Typed {
  base: string
  lines: LineDraft[]
  meals: boolean
  kmTyped: string
  discount: string
  agreed: string
  notes: string
  validFor: string
  deposit: string
}
const baseOf = (q: QuoteView) =>
  JSON.stringify([q.lines, q.discountPct, q.agreedCents ?? null, q.notes, q.validDays ?? null, q.depositPct ?? null, q.mealsProvided ?? false, q.travelKm ?? null])
function readTyped(): Record<string, Typed> {
  try {
    return JSON.parse(sessionStorage.getItem(TYPED_STORE) ?? '{}') as Record<string, Typed>
  } catch {
    return {}
  }
}
function typedOf(q: QuoteView): Typed | undefined {
  const t = readTyped()[q.id]
  return t && t.base === baseOf(q) && Array.isArray(t.lines) ? t : undefined
}
function keepTyped(id: string, t: Typed | undefined) {
  const all = readTyped()
  if (!t && !(id in all)) return
  if (t) all[id] = t
  else delete all[id]
  try {
    sessionStorage.setItem(TYPED_STORE, JSON.stringify(all))
  } catch {
    // Storage that's off or full keeps it for as long as the quote stays open.
  }
}

/** The job's days, which a line added on the quote is charged for until changed. */
const jobDays = (job: JobView) => (job.span ? Math.max(1, eachDay(job.span.start, job.span.end).length) : 1)

export function Draft({ q, view, job, onPrint }: { q: QuoteView; view: View; job: JobView; onPrint: () => void }) {
  const today = useToday()
  const m = view.money
  const under = useUnderTop<HTMLFormElement>(true)
  // What was typed and couldn't save yet, when the quote was left (finding 27).
  const [kept] = useState(() => typedOf(q))
  // Travel and subsistence (ADR 0086) aren't typed: they're worked out below from the rest, so they're kept apart.
  const [lines, setLines] = useState<LineDraft[]>(() => kept?.lines ?? q.lines.filter((l) => !l.extra).map(toDraft))
  const [meals, setMeals] = useState(kept?.meals ?? q.mealsProvided ?? false)
  const [kmTyped, setKmTyped] = useState(kept?.kmTyped ?? (q.travelKm == null ? '' : String(q.travelKm)))
  const [discount, setDiscount] = useState(kept?.discount ?? String(q.discountPct))
  // A price agreed for the whole (ADR 0085) stands in for the discount percentage while it's there.
  const [agreed, setAgreed] = useState(kept?.agreed ?? (q.agreedCents == null ? '' : euroText(q.agreedCents)))
  const [notes, setNotes] = useState(kept?.notes ?? q.notes)
  const [validFor, setValidFor] = useState(kept?.validFor ?? String(q.validDays ?? DEFAULT_VALID_DAYS))
  const [deposit, setDeposit] = useState(kept?.deposit ?? (q.depositPct ? String(q.depositPct) : ''))
  const [kitDays, setKitDays] = useState('')
  const [sentOn, setSentOn] = useState(today)
  const [answering, setAnswering] = useState(false)
  // One line is open to change at a time; the rest read as a list, as they'll print.
  const [open, setOpen] = useState<string>()
  // The line just shut, which keeps the focus so the keyboard carries on from it.
  const [shut, setShut] = useState<string>()
  const [removed, setRemoved] = useState<{ line: LineDraft; at: number }>()
  const [adding, setAdding] = useState<'kit' | 'crew' | 'package' | 'transport'>()
  const { run, error, refuse } = useAct()
  const set = (id: string, changes: Partial<LineDraft>) => setLines((ls) => ls.map((l) => (l.id === id ? { ...l, ...changes } : l)))

  // What it comes to as typed, with anything not yet a number left out.
  const read = lines.map((l, i) => readLine(l, i + 1))
  const pct = num(discount)
  const pctOk = pct >= 0 && pct <= 100 && Number.isInteger(pct * 10)
  const good = read.filter((l): l is QuoteLine => typeof l !== 'string')
  const agreedRead = agreed.trim() ? parseEuro(agreed) : undefined
  const agreedCents = agreedRead?.cents ?? null
  const kmRead = kmTyped.trim() ? num(kmTyped) : null
  const kmOk = kmRead === null || (Number.isInteger(kmRead) && kmRead >= 0 && kmRead <= 2000)
  const extras = extrasFor({
    lines: good,
    settings: travelSettingsOf(m.quoting),
    pin: pinOf(job),
    typedKm: kmOk ? kmRead : null,
    mealsProvided: meals,
    ids: Object.fromEntries(q.lines.filter((l) => l.extra).map((l) => [l.extra!, l.id])),
    newId: useStableIds(),
  })
  const all = [...good, ...extras.lines]
  const totals = quoteTotals({ lines: all, discountPct: pctOk ? pct : 0, agreedCents })
  const valid = num(validFor)
  const validOk = Number.isInteger(valid) && valid >= 1 && valid <= 365
  const dep = deposit.trim() ? num(deposit) : null
  const depOk = dep === null || (Number.isInteger(dep) && dep >= 1 && dep <= 100)
  const problem =
    read.find((l): l is string => typeof l === 'string') ??
    (agreedRead?.reason
      ? `The price agreed: ${agreedRead.reason}`
      : agreedCents !== null && agreedCents > totals.subtotal
        ? `The price agreed is more than the lines come to (${money(totals.subtotal)}). Agree a lower price, or change the lines.`
        : !kmOk
        ? 'The distance is a whole number of km from 0 to 2,000, or nothing to take it from the map.'
        : !pctOk
      ? 'A discount is a percentage from 0 to 100, such as 10 or 12.5.'
      : !validOk
        ? 'Prices hold for a whole number of days from 1 to 365.'
        : !depOk
          ? 'A deposit is a whole percentage from 1 to 100, such as 25 or 50, or nothing for none.'
          : undefined)
  // Saved: what's typed comes to what the draft holds.
  const saved =
    read.length + extras.lines.length === q.lines.length &&
    read.every((l) => typeof l !== 'string') &&
    all.every((l, i) => sameLine(l, q.lines[i]!)) &&
    meals === (q.mealsProvided ?? false) &&
    kmRead === (q.travelKm ?? null) &&
    pct === q.discountPct &&
    agreedCents === (q.agreedCents ?? null) &&
    q.notes.trim() === notes.trim() &&
    valid === (q.validDays ?? DEFAULT_VALID_DAYS) &&
    dep === (q.depositPct ?? null)
  const unpriced = good.filter((l) => l.unitCents === 0).length
  // Whether there's enough of each product on the job's days (ADR 0089), as the job's kit is checked.
  const checks = quoteKit(job, quoteWants(good, (id) => m.package(id)?.items), today, {
    kit: view.kit,
    models: (id) => view.warehouse.models.find((x) => x.id === id),
    unusable: view.faults.unusable,
    lateOut: view.moves.lateOut,
  })
  const shortLines = good.filter((l) => linesShort(l, checks, m.package(l.packageId ?? '')?.items).length > 0).length
  // What it makes (ADR 0089), for the office and directors, who see quotes at all.
  const boss = useAccess().can('money')
  const costOf = (l: QuoteLine) => lineCostOf(l, l.kind === 'crew' ? m.bookedRate(job.id, l) : undefined)
  const margin = quoteMargin(totals.net, all.map(costOf))
  // What each line was last charged in Current RMS (ADR 0092), by the names it goes by there.
  const namesOf = (l: LineDraft) => rmsNames(l, (id) => view.warehouse.models.find((x) => x.id === id))
  const last = useLastCharged(boss, job.id, lines.flatMap(namesOf).slice(0, MOST_LAST_CHARGED_NAMES))

  // The draft saves itself a moment after typing stops, once it reads as a quote: there's no Save to forget. Leaving
  // the page saves what's waiting at once. Saving goes through the device's queue, so it works with no signal.
  const payload =
    !saved && !problem
      ? { id: q.id, projectId: job.id, lines: all.slice(0, MAX_LINES), discountPct: pct, agreedCents, notes, validDays: valid, depositPct: dep, mealsProvided: meals, travelKm: kmRead }
      : undefined
  const waiting = useRef(payload)
  waiting.current = payload
  const flush = () => {
    const p = waiting.current
    if (!p) return
    waiting.current = undefined
    void run(() => client.mutate('quote.save', p))
  }
  const key = payload ? JSON.stringify(payload) : ''
  useEffect(() => {
    if (!key) return
    const t = setTimeout(flush, SAVE_AFTER_MS)
    return () => clearTimeout(t)
  }, [key])
  useEffect(() => () => flush(), [])
  const late = useLate(!!payload)
  // Kept on the device while it can't save (finding 27), and let go once it can.
  const typed = !saved && problem ? JSON.stringify({ base: baseOf(q), lines, meals, kmTyped, discount, agreed, notes, validFor, deposit } satisfies Typed) : ''
  useEffect(() => keepTyped(q.id, typed ? (JSON.parse(typed) as Typed) : undefined), [typed])

  const days = jobDays(job)
  const addLine = (
    l: Omit<LineDraft, 'id' | 'rate' | 'out' | 'discount' | 'packageId' | 'includes' | 'subhire' | 'supplier' | 'cost'> & Partial<Pick<LineDraft, 'rate' | 'packageId' | 'includes' | 'cost'>>
  ) => {
    const id = newId()
    setLines((ls) => [...ls, { rate: null, out: l.days, discount: '', packageId: null, includes: '', subhire: '', supplier: '', cost: '', id, ...l }])
    setOpen(id)
    setAdding(undefined)
  }
  const addKit = (modelId: string) => {
    const model = view.warehouse.models.find((x) => x.id === modelId)
    if (!model) return
    const cents = m.productPrice(modelId)
    // Charged by the product's rule (ADR 0085), for the job's days out.
    const rate = m.productRate(modelId)
    addLine({
      kind: 'kit',
      what: model.name,
      ref: null,
      modelId,
      group: DEPARTMENT_LABELS[model.department],
      qty: '1',
      days: String(days),
      price: cents === undefined ? '' : euroText(cents),
      vat: STANDARD_VAT,
      per: 'day',
      rate: rate && rate !== 'daily' ? rate : null,
    })
  }
  // A package (ADR 0087) goes on as one line at its price and rule, with what it holds now written on the line, so the
  // quote prints as it was made however the package changes after.
  const addPackage = (packageId: string) => {
    const p = m.package(packageId)
    if (!p) return
    addLine({
      kind: 'kit',
      what: p.name,
      ref: null,
      modelId: null,
      group: DEPARTMENT_LABELS[p.department],
      qty: '1',
      days: String(days),
      price: euroText(p.dayCents),
      vat: STANDARD_VAT,
      per: 'day',
      rate: p.rate && p.rate !== 'daily' ? p.rate : null,
      packageId: p.id,
      includes: packageIncludes(p, (id) => view.warehouse.models.find((x) => x.id === id)?.name),
    })
  }
  const addCrew = (role: string) => {
    const r = m.roles.find((x) => x.role === role)
    const cents = r?.cents ?? r?.booked
    addLine({ kind: 'crew', what: role, ref: null, modelId: null, group: 'Crew', qty: '1', days: String(days), price: cents === undefined ? '' : euroText(cents), vat: STANDARD_VAT, per: 'day' })
  }
  const addOther = () => addLine({ kind: 'other', what: '', ref: null, modelId: null, group: '', qty: '1', days: '1', price: '', vat: STANDARD_VAT, per: 'once' })
  // Transport (ADR 0089): charged once, with what it costs us beside it; named for a van booked on the job when there is one.
  const addTransport = (what: string, ref: string | null) =>
    addLine({ kind: 'other', what, ref, modelId: null, group: 'Transport', qty: '1', days: '1', price: '', vat: STANDARD_VAT, per: 'once' })
  const vans = view.vehicles.ofJob(job.id).filter((b) => b.vehicle && !lines.some((l) => l.ref === b.id))
  const remove = (l: LineDraft) => {
    setRemoved({ line: l, at: lines.indexOf(l) })
    setLines((ls) => ls.filter((x) => x.id !== l.id))
    if (open === l.id) setOpen(undefined)
  }
  // A short line hires in what it's short of (ADR 0089), then opens for who from and what it costs.
  const hireIn = (l: LineDraft, n: number) => {
    set(l.id, { subhire: String(Math.min(num(l.qty), (num(l.subhire) || 0) + n)) })
    setOpen(l.id)
  }
  const undoRemove = () => {
    if (!removed) return
    setLines((ls) => [...ls.slice(0, removed.at), removed.line, ...ls.slice(removed.at)])
    setRemoved(undefined)
  }
  const allKitDays = () => {
    const d = num(kitDays)
    if (!(d >= 0.5 && d <= 365 && Number.isInteger(d * 2))) return refuse('Days charged is a number of days, in halves, from 0.5 to 365.')
    // Lines charged by a rule work theirs out from their days out (ADR 0085), so this is for those charged by the day.
    setLines((ls) => ls.map((l) => (l.kind === 'kit' && l.per === 'day' && !l.rate ? { ...l, days: String(d) } : l)))
    setKitDays('')
  }
  // A department's discount (ADR 0085) is put on each of its lines, so each line still says what it's charged.
  const groupDiscount = (group: string, off: string) => setLines((ls) => ls.map((l) => (l.group === group ? { ...l, discount: off } : l)))
  const groups = linesByGroup(lines)
  const kitLines = lines.filter((l) => l.kind === 'kit' && l.per === 'day' && !l.rate).length
  const source = m.sourceOf(job.id)
  // Every line counts here, finished or not, so one being typed isn't offered again as new on the job.
  const asLines = lines.map((l): QuoteLine => ({ id: l.id, kind: l.kind, what: l.what, ref: l.ref, group: l.group, qty: num(l.qty), days: 1, unitCents: 0, vat: l.vat }))
  const changes = changesFromJob(asLines, source.kit, source.crew, { product: m.productPrice, role: m.rolePrice, rate: m.productRate }, newId)
  // Claude (ADR 0096) is shown the lines as they read, and what it suggests is taken here as if typed.
  const claude = useClaude(view)
  const [advice, setAdvice] = useState<Advice>()
  const asked: AskedLine[] = good.map((l) => ({ id: l.id, kind: l.kind, what: l.what, group: l.group, qty: l.qty, days: l.out ?? l.days, per: l.per ?? 'day', unitCents: l.unitCents, discountPct: l.discountPct ?? 0 }))
  const takeAdvice = () => {
    const a = advice
    if (!a) return
    setLines((ls) => [
      ...ls
        .filter((l) => !a.remove[l.id])
        .map((l) => {
          const c = a.change[l.id] ? a.advice.change.find((x) => x.lineId === l.id) : undefined
          if (!c) return l
          return {
            ...l,
            ...(c.qty != null ? { qty: String(c.qty) } : {}),
            // A line charged by a rule (ADR 0085) is shown its days out, so those are what change.
            ...(c.days != null && l.per === 'day' ? (l.rate ? { out: String(c.days) } : { days: String(c.days) }) : {}),
            ...(c.discountPct != null ? { discount: c.discountPct ? String(c.discountPct) : '' } : {}),
            ...(c.priceCents != null ? { price: euroText(c.priceCents) } : {}),
          }
        }),
      ...a.add.filter((x) => x.take).map((x) => toDraft(suggestionLine(x.s, newId()))),
    ])
    if (a.discount && a.advice.discountPct !== null) setDiscount(String(a.advice.discountPct))
    setAdvice(undefined)
  }

  return (
    <form
      ref={under}
      className="card quote-draft"
      aria-label={`Version ${q.version}, a draft`}
      onSubmit={(e: FormEvent) => {
        e.preventDefault()
        flush()
      }}
    >
      <header className="title">
        <h2>Version {q.version}</h2>
        <QuotePill q={q} />
      </header>
      {/* What it comes to, in view while the lines are changed below. */}
      <div className="quote-summary" role="group" aria-label="What it comes to">
        <span>
          Before VAT <b>{money(totals.net)}</b>
        </span>
        <span>
          Total <b>{money(totals.gross)}</b>
        </span>
        {unpriced > 0 && <span className="warn">{plural(unpriced, 'line')} with no price</span>}
        {shortLines > 0 && <span className="warn">{plural(shortLines, 'line')} short of kit</span>}
        {boss && <MarginWords margin={margin} />}
        <span className="save-state" aria-live="polite">
          {problem ? 'Not saved yet' : payload ? (late ? 'Saving…' : '') : q.pending ? 'Saved on this device' : 'Saved'}
        </span>
      </div>

      <JobChangesCard changes={changes} quoteId={q.id} onTake={(next) => setLines((ls) => next(ls))} />
      {claude.offered &&
        (advice ? (
          <AdviceCard view={view} a={advice} lines={asked} discountPct={pctOk ? pct : 0} onChange={setAdvice} onTake={takeAdvice} onLeave={() => setAdvice(undefined)} />
        ) : (
          <AskClaude view={view} status={claude.status} name={job.name} jobDays={days} discountPct={pctOk ? pct : 0} lines={asked} onAdvice={setAdvice} />
        ))}

      {lines.length === 0 && <Empty>No lines yet. Add kit, crew or anything else the quote is for.</Empty>}
      {groups.map((g) => (
        <fieldset key={g.group} className="quote-group">
          <legend>{g.group}</legend>
          {g.lines.map((l) => {
            const n = lines.indexOf(l) + 1
            const r = read[n - 1]
            const done = r !== undefined && typeof r !== 'string' ? r : undefined
            const kit = done && <KitNote l={done} checks={checks} items={m.package(l.packageId ?? '')?.items} names={(id) => view.warehouse.models.find((x) => x.id === id)?.name} onHire={l.modelId ? (k) => hireIn(l, k) : undefined} full={open === l.id} />
            const cost = done ? costOf(done) : undefined
            return open !== l.id ? (
              <div key={l.id} className="quote-line-row">
                <LineSummary l={l} n={n} r={r} onOpen={() => setOpen(l.id)} focus={shut === l.id} margin={boss && done ? lineMargin(done, cost) : undefined} />
                {kit}
              </div>
            ) : (
              <LineEditor key={l.id} l={l} n={n} r={r} set={(c) => set(l.id, c)} onRemove={() => remove(l)} onDone={() => {
                  setShut(l.id)
                  setOpen(undefined)
                }}
                kit={kit}
                cost={<CostFields l={l} n={n} r={done} cost={cost} boss={boss} suppliers={view.kit.suppliers} set={(c) => set(l.id, c)} />}
                last={<LastCharged found={lastOf(last, namesOf(l))} n={n} price={l.price} onUse={(cents) => set(l.id, { price: euroText(cents) })} />}
              />
            )
          })}
          {g.lines.length > 1 && <GroupDiscount group={g.group} onApply={(off) => groupDiscount(g.group, off)} refuse={refuse} />}
        </fieldset>
      ))}
      <TravelAndSubsistence extras={extras} meals={meals} setMeals={setMeals} km={kmTyped} setKm={setKmTyped} fuelSetOn={m.quoting.fuelSetOn ?? null} today={today} />
      {removed && (
        <p className="undo-line" aria-live="polite">
          Removed “{removed.line.what || 'a line'}”.{' '}
          <button type="button" className="link" onClick={undoRemove}>
            Undo
          </button>
        </p>
      )}

      <div className="quote-add" role="group" aria-label="Add to the quote">
        {adding === 'kit' ? (
          <div className="adding">
            <ProductPicker label="Kit to add" products={view.warehouse.models} value="" onPick={addKit} hint="Priced from the price list, for the job's days." />
            <button type="button" className="link" onClick={() => setAdding(undefined)}>
              Cancel
            </button>
          </div>
        ) : adding === 'package' ? (
          <AddPackage packages={m.packages} onAdd={addPackage} onCancel={() => setAdding(undefined)} />
        ) : adding === 'transport' ? (
          <AddTransport
            vans={vans.map((b) => ({ id: b.id, what: transportWords(b.vehicle!.kind, !!b.driver), name: `${b.vehicle!.name}${b.driver ? `, ${b.driver.name} driving` : ''}` }))}
            onAdd={addTransport}
            onCancel={() => setAdding(undefined)}
          />
        ) : adding === 'crew' ? (
          <AddCrew roles={m.roles.map((r) => r.role)} onAdd={addCrew} onCancel={() => setAdding(undefined)} />
        ) : (
          <>
            <button type="button" onClick={() => setAdding('kit')} disabled={lines.length >= MAX_LINES}>
              Add kit
            </button>
            {m.packages.length > 0 && (
              <button type="button" onClick={() => setAdding('package')} disabled={lines.length >= MAX_LINES}>
                Add a package
              </button>
            )}
            <button type="button" onClick={() => setAdding('crew')} disabled={lines.length >= MAX_LINES}>
              Add crew
            </button>
            <button type="button" onClick={() => setAdding('transport')} disabled={lines.length >= MAX_LINES}>
              Add transport
            </button>
            <button type="button" onClick={addOther} disabled={lines.length >= MAX_LINES}>
              Add something else
            </button>
          </>
        )}
      </div>
      {kitLines > 0 && (
        <div className="kit-days-all">
          <label>
            Charge all kit for
            <input inputMode="decimal" value={kitDays} onChange={(e) => setKitDays(e.target.value)} placeholder="3" aria-label="Days charged for all kit" />
            days
          </label>
          <button type="button" onClick={allKitDays} disabled={!kitDays.trim()}>
            Apply
          </button>
          <p className="hint">A week's hire charged as three days, say. Each line's days can still be changed on its own.</p>
        </div>
      )}
      <div className="quote-terms quote-discount">
        {agreedCents === null ? (
          <label className="field">
            Discount, %
            <input inputMode="decimal" value={discount} onChange={(e) => setDiscount(e.target.value)} aria-label="Discount, %" />
            {m.discountOf(job.clientId) !== undefined && <small>{job.client?.name} usually gets {pctWord(m.discountOf(job.clientId)!)} off.</small>}
          </label>
        ) : (
          <div className="field">
            Discount
            <p className="agreed-note">
              {money(totals.discount)} off, {pctWord(totals.discountPct)}, to come to the price agreed.
            </p>
          </div>
        )}
        <label className="field">
          Agree a total
          <span className="with-unit">
            €
            <input inputMode="decimal" value={agreed} onChange={(e) => setAgreed(e.target.value)} placeholder="None" aria-label="Agreed price before VAT, €" />
          </span>
          <small>{agreed.trim() ? 'Before VAT. Clear it to go back to a discount percentage.' : `The price agreed before VAT, say ${money(roundDown(totals.subtotal))}. The discount becomes whatever comes to it.`}</small>
        </label>
      </div>
      <label className="field">
        Notes for the client
        <textarea value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={2000} rows={3} placeholder="Load in from 8am. Prices include delivery to the venue." />
      </label>
      <div className="quote-terms">
        <label className="field">
          Prices hold for
          <span className="with-unit">
            <input inputMode="numeric" value={validFor} onChange={(e) => setValidFor(e.target.value)} aria-label="Prices hold for, days" />
            days
          </span>
          <small>Printed as “Valid until” {dayLabel(validUntil({ sentOn: null, validDays: validOk ? valid : DEFAULT_VALID_DAYS }, today))}, counted from the day it's sent.</small>
        </label>
        <label className="field">
          Deposit, %
          <input inputMode="numeric" value={deposit} onChange={(e) => setDeposit(e.target.value)} placeholder="None" aria-label="Deposit, %" />
          {dep !== null && depOk && <small>{money(depositCents(totals.gross, dep))} before the job, of {money(totals.gross)}.</small>}
        </label>
      </div>
      <Totals totals={totals} agreed={agreedCents !== null} />
      <Refusal error={error} />
      <div className="actions">
        <button type="button" onClick={onPrint} disabled={!saved}>
          Print a draft
        </button>
      </div>
      {!saved && problem && <p className="warn-line">{problem} It saves once that's put right.</p>}
      {saved && q.lines.length > 0 && (
        <div className="quote-send">
          <label>
            Sent to the client on
            <input type="date" value={sentOn} max={irishToday()} onChange={(e) => setSentOn(e.target.value)} />
          </label>
          <button type="button" className="primary" onClick={() => void run(() => markSent(q.id, job, sentOn || today))}>
            Mark as sent
          </button>
          {!answering ? (
            <button type="button" className="link" onClick={() => setAnswering(true)}>
              Accepted already, by phone?
            </button>
          ) : (
            <button type="button" onClick={() => void run(() => client.mutate('quote.answer', { id: q.id, answer: 'accepted', on: sentOn || today }))}>
              Record it as accepted
            </button>
          )}
          <p className="hint">
            Marked sent, it becomes quote {m.quotesOf(job.id).find((v) => v.number)?.number ?? m.nextNumber} and stays as it is. Then print it as a PDF and send it yourself: the app sends
            nothing.
          </p>
        </div>
      )}
    </form>
  )
}

/** Where a job is on the map: its venue's pin, or else the first of its phases' venues that has one. */
const pinOf = (job: JobView): Pin | null => job.venue?.pin ?? job.phases.find((p) => p.venue?.pin)?.venue?.pin ?? null

/** New ids that stay the same from one draw to the next, so a line worked out afresh isn't a change each time. */
function useStableIds() {
  const made = useRef<string[]>([])
  let n = 0
  return () => (made.current[n++] ??= newId())
}
