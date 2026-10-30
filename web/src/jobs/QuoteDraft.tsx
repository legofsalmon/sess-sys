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
import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { Refusal, useAct } from '../act.tsx'
import { Empty } from '../Empty.tsx'
import { Icon } from '../Icon.tsx'
import { ProductPicker } from '../ProductPicker.tsx'
import { useAccess } from '../role.ts'
import { client } from '../sync.ts'
import { useLate } from '../useLate.ts'
import { useToday } from '../view.ts'
import { useUnderTop } from '../useUnderTop.ts'
import { MailOnQuote, useClaude, type Advice } from './Claude.tsx'
import { useLastCharged } from './rms.ts'
import { QuotePill } from './QuoteStatus.tsx'
import { checkLine, num, sameLine, toDraft, type LineDraft } from './lineDraft.ts'
import { GroupDiscount, KitNote, LastCharged, lastOf, LineEditor, lineMargin, linesShort, LineSummary, rmsNames, UnitBox } from './QuoteLine.tsx'
import { Totals } from './QuoteSheet.tsx'
import { SendQuote } from './QuoteEmail.tsx'
import { AddCrew, AddPackage, AddTransport, JobChangesCard, transportWords, TRAVEL_ROW, TravelAndSubsistence } from './QuoteAdd.tsx'

/**
 * A quote while it's a draft (ADR 0042, redrawn in ADR 0100): the lines as
 * rows that open one at a time to change, a readout of what it comes to that
 * stays in view with what needs a look, the terms and the sending beside
 * them, saving itself as it's typed, and marked sent when it goes to the
 * client.
 */

/**
 * Sent to the client, and so the job is quoted (ADR 0081): an enquiry moves on by itself, since that's all "quoted"
 * means. A job already confirmed, or stopped, stays as it is.
 */
async function markSent(id: string, job: JobView, on: string) {
  await client.mutate('quote.sent', { id, on })
  if (job.status === 'enquiry') await client.mutate('project.update', { id: job.id, status: 'quoted' })
}

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

/** The fields of the terms that can be wrong, in the order their faults are said; `km` is the distance on the travel row. */
type TermKey = 'agreed' | 'km' | 'discount' | 'validFor' | 'deposit'
const TERM_KEYS: readonly TermKey[] = ['agreed', 'km', 'discount', 'validFor', 'deposit']

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
  const [kitDaysOpen, setKitDaysOpen] = useState(false)
  const [discounting, setDiscounting] = useState<string>()
  const [sentOn, setSentOn] = useState(today)
  const [answering, setAnswering] = useState(false)
  // Sending by email (ADR 0101), once the office has turned it on: the compose box, or the quiet way to say it went another way.
  const canEmail = !!m.quoting.emailQuotes
  const [sending, setSending] = useState<'email' | 'other'>()
  // One row is open to change at a time, a line's or a worked-out one's; the rest read as a list, as they'll print.
  const [open, setOpen] = useState<string>()
  // Which field the open line starts on, and whether its cost fold is wanted open: set by whatever opened it.
  const [focusField, setFocusField] = useState<'what' | 'price'>('what')
  const [wantCost, setWantCost] = useState(false)
  // The line just shut, which keeps the focus so the keyboard carries on from it.
  const [shut, setShut] = useState<string>()
  const [removed, setRemoved] = useState<{ line: LineDraft; at: number }>()
  const [adding, setAdding] = useState<'kit' | 'crew' | 'package' | 'transport'>()
  // A fault shows only once what holds it has been left (design system rule 18): a line left, or a terms field left. What
  // came back from the device's keeping was left when the screen was, so it shows at once.
  const [touched, setTouched] = useState<ReadonlySet<string>>(() => new Set(kept ? [...kept.lines.map((l) => l.id), ...TERM_KEYS] : []))
  const touch = (k: string) => setTouched((s) => (s.has(k) ? s : new Set(s).add(k)))
  const { run, error, refuse } = useAct()
  const set = (id: string, changes: Partial<LineDraft>) => setLines((ls) => ls.map((l) => (l.id === id ? { ...l, ...changes } : l)))
  const openLine = (id: string | undefined, focus: 'what' | 'price' = 'what', cost = false) => {
    if (open && open !== id) touch(open)
    setFocusField(focus)
    setWantCost(cost)
    setOpen(id)
  }
  const termIds = useId()
  const termRefs = useRef<Partial<Record<TermKey, HTMLInputElement | null>>>({})

  // What it comes to as typed, with anything not yet a number left out.
  const parsed = lines.map((l, i) => checkLine(l, i + 1))
  const faultAt = parsed.findIndex((c) => c.fault)
  const pct = num(discount)
  const pctOk = pct >= 0 && pct <= 100 && Number.isInteger(pct * 10)
  const good = parsed.flatMap((c) => (c.line ? [c.line] : []))
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
  const termProblems: Partial<Record<TermKey, string>> = {}
  if (agreedRead?.reason) termProblems.agreed = `The price agreed: ${agreedRead.reason}`
  else if (agreedCents !== null && agreedCents > totals.subtotal) termProblems.agreed = `The price agreed is more than the lines come to (${money(totals.subtotal)}). Agree a lower price, or change the lines.`
  if (!kmOk) termProblems.km = 'The distance is a whole number of km from 0 to 2,000, or nothing to take it from the map.'
  if (!pctOk) termProblems.discount = 'A discount is a percentage from 0 to 100, such as 10 or 12.5.'
  if (!validOk) termProblems.validFor = 'Prices hold for a whole number of days from 1 to 365.'
  if (!depOk) termProblems.deposit = 'A deposit is a whole percentage from 1 to 100, such as 25 or 50, or nothing for none.'
  const termKey = TERM_KEYS.find((k) => termProblems[k])
  // The first thing that stops the draft saving, where it is, and whether it's been left so it may be said.
  const problem = parsed[faultAt]?.fault?.why ?? (termKey ? termProblems[termKey] : undefined)
  const problemKey = faultAt >= 0 ? lines[faultAt]!.id : termKey
  const problemShown = problemKey !== undefined && touched.has(problemKey)
  const termErr = (k: TermKey) => (touched.has(k) ? termProblems[k] : undefined)
  const bad = (k: TermKey) => (termErr(k) ? { 'aria-invalid': true, 'aria-describedby': `${termIds}-${k}` } : {})
  const termNote = (k: TermKey, hint: ReactNode) => {
    const err = termErr(k)
    if (err)
      return (
        <small className="error" id={`${termIds}-${k}`}>
          {err}
        </small>
      )
    return hint ? <small>{hint}</small> : null
  }
  // Saved: what's typed comes to what the draft holds.
  const saved =
    parsed.length + extras.lines.length === q.lines.length &&
    faultAt < 0 &&
    all.every((l, i) => sameLine(l, q.lines[i]!)) &&
    meals === (q.mealsProvided ?? false) &&
    kmRead === (q.travelKm ?? null) &&
    pct === q.discountPct &&
    agreedCents === (q.agreedCents ?? null) &&
    q.notes.trim() === notes.trim() &&
    valid === (q.validDays ?? DEFAULT_VALID_DAYS) &&
    dep === (q.depositPct ?? null)
  const unpricedLines = good.filter((l) => l.unitCents === 0)
  // Whether there's enough of each product on the job's days (ADR 0089), as the job's kit is checked.
  const checks = quoteKit(job, quoteWants(good, (id) => m.package(id)?.items), today, {
    kit: view.kit,
    models: (id) => view.warehouse.models.find((x) => x.id === id),
    unusable: view.faults.unusable,
    lateOut: view.moves.lateOut,
  })
  const shortLines = good.filter((l) => linesShort(l, checks, m.package(l.packageId ?? '')?.items).length > 0)
  // What it makes (ADR 0089), for the office and directors, who see quotes at all.
  const boss = useAccess().can('money')
  const costOf = (l: QuoteLine) => lineCostOf(l, l.kind === 'crew' ? m.bookedRate(job.id, l) : undefined)
  const margin = quoteMargin(totals.net, all.map(costOf))
  const noCostLines = boss ? good.filter((l) => costOf(l) === undefined) : []
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
    openLine(id)
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
    openLine(l.id, 'what', true)
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
    setKitDaysOpen(false)
  }
  // A department's discount (ADR 0085) is put on each of its lines, so each line still says what it's charged.
  const groupDiscount = (group: string, off: string) => {
    setLines((ls) => ls.map((l) => (l.group === group ? { ...l, discount: off } : l)))
    setDiscounting(undefined)
  }
  const groups = linesByGroup(lines)
  const kitLines = lines.filter((l) => l.kind === 'kit' && l.per === 'day' && !l.rate).length
  const source = m.sourceOf(job.id)
  // Every line counts here, finished or not, so one being typed isn't offered again as new on the job.
  const asLines = lines.map((l): QuoteLine => ({ id: l.id, kind: l.kind, what: l.what, ref: l.ref, group: l.group, qty: num(l.qty), days: 1, unitCents: 0, vat: l.vat }))
  const changes = changesFromJob(asLines, source.kit, source.crew, { product: m.productPrice, role: m.rolePrice, rate: m.productRate }, newId)
  // What the mail asks for since the draft was changed (ADR 0098) is shown against the lines as they read, and taken here as if typed.
  const claude = useClaude(view)
  const asked: AskedLine[] = good.map((l) => ({ id: l.id, kind: l.kind, what: l.what, group: l.group, qty: l.qty, days: l.out ?? l.days, per: l.per ?? 'day', unitCents: l.unitCents, discountPct: l.discountPct ?? 0 }))
  const takeAdvice = (a: Advice) => {
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
  }
  // "Not saved yet" leads to what stops it: the line opens, or the terms field takes the focus, and its fault is said.
  const goToProblem = () => {
    if (problemKey === undefined) return
    touch(problemKey)
    if (faultAt >= 0) return openLine(problemKey)
    if (problemKey === 'km') return openLine(TRAVEL_ROW)
    termRefs.current[problemKey as TermKey]?.focus()
  }
  const full = lines.length >= MAX_LINES
  const nextNumber = m.quotesOf(job.id).find((v) => v.number)?.number ?? m.nextNumber
  const undoLine = removed && (
    <p className="undo-line" aria-live="polite">
      Removed “{removed.line.what || 'a line'}”.{' '}
      <button type="button" className="link" onClick={undoRemove}>
        Undo
      </button>
    </p>
  )
  const removedGroup = removed ? linesByGroup([removed.line])[0]!.group : undefined

  return (
    <form
      ref={under}
      className="quote-draft"
      aria-label={`Version ${q.version}, a draft`}
      onSubmit={(e: FormEvent) => {
        e.preventDefault()
        flush()
      }}
    >
      <section className="card quote-main">
        <header className="title">
          <h2>Version {q.version}</h2>
          <QuotePill q={q} />
        </header>
        {/* What it comes to, in view while the lines are changed below, with what needs a look: each a way to the first such line. */}
        <div className="quote-summary" role="group" aria-label="What it comes to">
          <div className="figures">
            <span className="figure lead">
              <small>Before VAT</small> <b>{money(totals.net)}</b>
            </span>
            <span className="figure">
              <small>Total</small> <b>{money(totals.gross)}</b>
            </span>
            {boss && (
              <span className={`figure${margin.margin < 0 ? ' bad' : ''}`}>
                <small>Margin</small> <b>{money(margin.margin)}</b>
                {margin.pct !== null && <span className="pct">{pctWord(margin.pct)}</span>}
              </span>
            )}
            <span className="save-state" aria-live="polite">
              {problem ? (
                <button type="button" className="link quiet" onClick={goToProblem}>
                  Not saved yet
                </button>
              ) : payload ? (
                late ? (
                  'Saving…'
                ) : (
                  ''
                )
              ) : q.pending ? (
                'Saved on this device'
              ) : (
                'Saved'
              )}
            </span>
          </div>
          {unpricedLines.length + shortLines.length + noCostLines.length > 0 && (
            <div className="chips">
              {unpricedLines.length > 0 && (
                <button type="button" className="chip" onClick={() => openLine(unpricedLines[0]!.id, 'price')}>
                  {plural(unpricedLines.length, 'line')} with no price
                </button>
              )}
              {shortLines.length > 0 && (
                <button type="button" className="chip" onClick={() => openLine(shortLines[0]!.id)}>
                  {plural(shortLines.length, 'line')} short of kit
                </button>
              )}
              {noCostLines.length > 0 && (
                <button type="button" className="chip" onClick={() => openLine(noCostLines[0]!.id, 'what', true)}>
                  {plural(noCostLines.length, 'line')} with no cost yet
                </button>
              )}
            </div>
          )}
        </div>

        <JobChangesCard changes={changes} quoteId={q.id} onTake={(next) => setLines((ls) => next(ls))} />
        {claude.offered && <MailOnQuote view={view} projectId={job.id} jobDays={days} lines={asked} discountPct={pctOk ? pct : 0} onTake={takeAdvice} />}

        {lines.length === 0 && <Empty>No lines yet. Add kit, crew or anything else the quote is for.</Empty>}
        {groups.map((g) => (
          <section key={g.group} className="quote-group" role="group" aria-label={g.group}>
            <div className="group-head">
              <h3>{g.group}</h3>
              {g.lines.length > 1 && discounting !== g.group && (
                <button type="button" className="link quiet" onClick={() => setDiscounting(g.group)}>
                  Discount every line…
                </button>
              )}
            </div>
            {discounting === g.group && <GroupDiscount group={g.group} onApply={(off) => groupDiscount(g.group, off)} onCancel={() => setDiscounting(undefined)} refuse={refuse} />}
            {g.lines.map((l) => {
              const n = lines.indexOf(l) + 1
              const c = parsed[n - 1]!
              const done = c.line
              const kit = done && <KitNote l={done} checks={checks} items={m.package(l.packageId ?? '')?.items} names={(id) => view.warehouse.models.find((x) => x.id === id)?.name} onHire={l.modelId ? (k) => hireIn(l, k) : undefined} full={open === l.id} />
              const cost = done ? costOf(done) : undefined
              return open !== l.id ? (
                <div key={l.id} className="quote-line-row">
                  <LineSummary l={l} n={n} done={done} onOpen={() => openLine(l.id)} focus={shut === l.id} margin={boss && done ? lineMargin(done, cost) : undefined} />
                  {kit}
                </div>
              ) : (
                <div key={l.id} className="quote-line-row open">
                  <LineEditor
                    l={l}
                    n={n}
                    done={done}
                    fault={c.fault}
                    left={touched.has(l.id)}
                    focus={focusField}
                    set={(ch) => set(l.id, ch)}
                    onRemove={() => remove(l)}
                    onDone={() => {
                      touch(l.id)
                      setShut(l.id)
                      setOpen(undefined)
                    }}
                    onLeave={() => touch(l.id)}
                    kit={kit}
                    last={<LastCharged found={lastOf(last, namesOf(l))} n={n} price={l.price} onUse={(cents) => set(l.id, { price: euroText(cents) })} />}
                    cost={cost}
                    boss={boss}
                    suppliers={view.kit.suppliers}
                    wantCost={wantCost}
                  />
                </div>
              )
            })}
            {removedGroup === g.group && undoLine}
          </section>
        ))}
        {removed && !groups.some((g) => g.group === removedGroup) && undoLine}
        <TravelAndSubsistence
          extras={extras}
          meals={meals}
          setMeals={setMeals}
          km={kmTyped}
          setKm={setKmTyped}
          kmProblem={termErr('km')}
          onLeaveKm={() => touch('km')}
          fuelSetOn={m.quoting.fuelSetOn ?? null}
          today={today}
          open={open}
          setOpen={openLine}
        />

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
              <button type="button" onClick={() => setAdding('kit')} disabled={full}>
                <Icon name="add" />
                Add kit
              </button>
              <button type="button" onClick={() => setAdding('crew')} disabled={full}>
                <Icon name="add" />
                Add crew
              </button>
              {m.packages.length > 0 && (
                <button type="button" onClick={() => setAdding('package')} disabled={full}>
                  <Icon name="add" />
                  Add a package
                </button>
              )}
              <button type="button" onClick={() => setAdding('transport')} disabled={full}>
                <Icon name="add" />
                Add transport
              </button>
              <button type="button" onClick={addOther} disabled={full}>
                <Icon name="add" />
                Add something else
              </button>
            </>
          )}
        </div>
        {kitLines > 0 &&
          (kitDaysOpen ? (
            <div className="kit-days-all">
              <label>
                Charge all kit for
                <UnitBox unit="days">
                  <input
                    inputMode="decimal"
                    value={kitDays}
                    onChange={(e) => setKitDays(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault()
                        allKitDays()
                      }
                    }}
                    placeholder="3"
                    aria-label="Days charged for all kit"
                    autoFocus
                  />
                </UnitBox>
              </label>
              <button type="button" onClick={allKitDays} disabled={!kitDays.trim()}>
                Apply
              </button>
              <button type="button" className="link" onClick={() => setKitDaysOpen(false)}>
                Cancel
              </button>
              <p className="hint">A week's hire charged as three days, say. Each line's days can still be changed on its own.</p>
            </div>
          ) : (
            <button type="button" className="link quiet" onClick={() => setKitDaysOpen(true)}>
              Charge all kit for the same days…
            </button>
          ))}
      </section>

      <section className="card quote-side">
        <h3 className="quote-head">Terms</h3>
        <div className="quote-terms quote-discount">
          {agreedCents === null ? (
            <label className="field">
              Discount
              <UnitBox unit="%">
                <input
                  inputMode="decimal"
                  value={discount}
                  onChange={(e) => setDiscount(e.target.value)}
                  onBlur={() => touch('discount')}
                  ref={(el) => {
                    termRefs.current.discount = el
                  }}
                  aria-label="Discount, %"
                  {...bad('discount')}
                />
              </UnitBox>
              {termNote('discount', m.discountOf(job.clientId) !== undefined && `${job.client?.name} usually gets ${pctWord(m.discountOf(job.clientId)!)} off.`)}
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
            <UnitBox unit="€" before>
              <input
                inputMode="decimal"
                value={agreed}
                onChange={(e) => setAgreed(e.target.value)}
                onBlur={() => touch('agreed')}
                ref={(el) => {
                  termRefs.current.agreed = el
                }}
                placeholder="None"
                aria-label="Agreed price before VAT, €"
                {...bad('agreed')}
              />
            </UnitBox>
            {termNote('agreed', agreed.trim() ? 'Before VAT. Clear it to go back to a percentage.' : 'Before VAT: the discount becomes whatever comes to it.')}
          </label>
        </div>
        <div className="quote-terms">
          <label className="field">
            Prices hold for
            <UnitBox unit="days">
              <input
                inputMode="numeric"
                value={validFor}
                onChange={(e) => setValidFor(e.target.value)}
                onBlur={() => touch('validFor')}
                ref={(el) => {
                  termRefs.current.validFor = el
                }}
                aria-label="Prices hold for, days"
                {...bad('validFor')}
              />
            </UnitBox>
            {termNote('validFor', `Printed as valid until ${dayLabel(validUntil({ sentOn: null, validDays: validOk ? valid : DEFAULT_VALID_DAYS }, today))} if sent today.`)}
          </label>
          <label className="field">
            Deposit
            <UnitBox unit="%">
              <input
                inputMode="numeric"
                value={deposit}
                onChange={(e) => setDeposit(e.target.value)}
                onBlur={() => touch('deposit')}
                ref={(el) => {
                  termRefs.current.deposit = el
                }}
                placeholder="None"
                aria-label="Deposit, %"
                {...bad('deposit')}
              />
            </UnitBox>
            {termNote('deposit', dep !== null && depOk && `${money(depositCents(totals.gross, dep))} before the job, of ${money(totals.gross)}.`)}
          </label>
        </div>
        <label className="field">
          Notes for the client
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={2000} rows={3} placeholder="Load in from 8am. Prices include delivery to the venue." />
        </label>

        <Totals totals={totals} agreed={agreedCents !== null} />

        <h3 className="quote-head">Send</h3>
        <Refusal error={error} />
        {!saved && problem && (problemShown ? <p className="warn-line">{problem} It saves once that's put right.</p> : <p className="hint">Not saved yet{faultAt >= 0 ? `: line ${faultAt + 1} isn't finished.` : '.'}</p>)}
        {saved && q.lines.length > 0 && sending === 'email' ? (
          <SendQuote q={q} onSent={() => setSending(undefined)} onCancel={() => setSending(undefined)} />
        ) : (
          <>
            {saved && q.lines.length > 0 && (!canEmail || sending === 'other') && (
              <div className="quote-send">
                <label>
                  Sent to the client on
                  <input type="date" value={sentOn} max={irishToday()} onChange={(e) => setSentOn(e.target.value)} />
                </label>
                <button type="button" className={canEmail ? undefined : 'primary'} onClick={() => void run(() => markSent(q.id, job, sentOn || today))}>
                  Mark as sent
                </button>
              </div>
            )}
            <div className="actions">
              {saved && q.lines.length > 0 && canEmail && (
                <button type="button" className="primary" onClick={() => setSending('email')}>
                  Send to the client
                </button>
              )}
              <button type="button" onClick={onPrint} disabled={!saved}>
                Print a draft
              </button>
              {saved && q.lines.length > 0 && canEmail && sending !== 'other' && (
                <button type="button" className="link quiet" onClick={() => setSending('other')}>
                  Sent another way? Mark as sent
                </button>
              )}
              {saved &&
                q.lines.length > 0 &&
                (!answering ? (
                  <button type="button" className="link quiet" onClick={() => setAnswering(true)}>
                    Accepted already, by phone?
                  </button>
                ) : (
                  <button type="button" onClick={() => void run(() => client.mutate('quote.answer', { id: q.id, answer: 'accepted', on: sentOn || today }))}>
                    Record it as accepted
                  </button>
                ))}
            </div>
            {saved && q.lines.length > 0 && (
              <p className="hint">
                {canEmail
                  ? `Sent to the client, it goes by email from the operations mailbox with the quote as a PDF, becomes quote ${nextNumber}, and stays as it is.`
                  : `Marked sent, it becomes quote ${nextNumber} and stays as it is. Print it as a PDF and send it yourself: the app sends nothing.`}
              </p>
            )}
          </>
        )}
      </section>
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
