import {
  compareCount,
  countSetTo,
  countSummaryWords,
  dayLabel,
  holdsCount,
  itemByCode,
  keptWithin,
  MAX_QTY,
  mondayOf,
  newId,
  normaliseNumber,
  plural,
  RETIRED_LABELS,
  unknownCode,
  type AssetView,
  type CountDraft,
  type CountItem,
  type CountProduct,
  type CountView,
  type View,
  type WarehouseView,
  type Where,
} from '@sh/shared'
import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type FormEvent, type ReactNode } from 'react'
import { Confirm, Refusal, useAct } from '../act.tsx'
import { useMe } from '../crew/Leave.tsx'
import { Empty } from '../Empty.tsx'
import { ShowAll } from '../Fold.tsx'
import { Top } from '../jobs/common.tsx'
import { Pending } from '../StatusPill.tsx'
import { client } from '../sync.ts'
import { useToday } from '../view.ts'
import { atLabel, numberLabel, ProductChoices } from './common.tsx'
import { reportFault } from './Faults.tsx'
import { CameraScanner, primeSound } from './Scanner.tsx'

/**
 * Stocktakes and rolling counts (ADR 0030): the Counts card on the Stock
 * tab with this week's places, counting a place or a case (#stock/count),
 * a count's page with the differences and their fixes (#stock/count/<id>),
 * and when a place or case was last counted. A count in progress is kept in
 * this phone's browser storage on every scan and number, so a reload or a
 * dropped signal loses nothing; Finish sends it as one command.
 */

const KEY = 'sh.count'

function readDraft(): CountDraft | undefined {
  try {
    const d = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Partial<CountDraft> | null
    if (!d || typeof d.id !== 'string' || typeof d.startedAt !== 'string' || !(d.placeId || d.caseId)) return undefined
    return {
      id: d.id,
      placeId: d.placeId ?? null,
      caseId: d.caseId ?? null,
      startedAt: d.startedAt,
      by: d.by ?? null,
      scanned: Array.isArray(d.scanned) ? d.scanned : [],
      unknown: Array.isArray(d.unknown) ? d.unknown : [],
      counted: d.counted && typeof d.counted === 'object' ? d.counted : {},
      added: Array.isArray(d.added) ? d.added : [],
    }
  } catch {
    return undefined
  }
}

// The one count on this phone, here rather than in a screen, so the Counts card and the place's page hear of it at once.
let draft = readDraft()
/** Whether the last save reached the phone's storage; if not, a reload would lose the count, and the screen says so. */
let kept = true
const listeners = new Set<() => void>()

function saveDraft(next: CountDraft | undefined) {
  draft = next
  try {
    if (next) localStorage.setItem(KEY, JSON.stringify(next))
    else localStorage.removeItem(KEY)
    kept = true
  } catch {
    kept = false
  }
  for (const fn of listeners) fn()
}

/** Signing out forgets a count in progress too, so whoever signs in next can't finish it as their own. */
export const forgetCountDraft = () => saveDraft(undefined)

// A second tab of the app on this phone counts the same count: each hears the other's scans, so neither writes over them.
try {
  addEventListener('storage', (e) => {
    if (e.key !== KEY && e.key !== null) return
    draft = readDraft()
    for (const fn of listeners) fn()
  })
} catch {
  // No window to listen on: one tab, nothing to hear.
}

function useDraft(): CountDraft | undefined {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn)
      return () => void listeners.delete(fn)
    },
    () => draft
  )
}

/** "Bay A3", or "SH-000200 (Amp rack)". */
function targetName(w: WarehouseView, x: Where): string {
  if (x.placeId) return w.places.find((p) => p.id === x.placeId)?.name ?? 'a place since removed'
  const c = x.caseId ? w.assets.get(x.caseId) : undefined
  return c ? `${numberLabel(c)} (${c.model?.name ?? 'a case'})` : 'a case'
}

/** "SH-000123 d&b Y10P". */
const itemName = (a: AssetView | undefined) => (a ? [numberLabel(a), a.model?.name].filter(Boolean).join(' ') : 'An item')
/** "at Bay B1", "in SH-000200 (Amp rack)", or "not placed yet", for where an item was kept. */
const keptWords = (x: Partial<Where>, w: WarehouseView) => (x.placeId || x.caseId ? `kept ${atLabel({ placeId: x.placeId ?? null, caseId: x.caseId ?? null }, w)}` : 'not placed yet')
const jobName = (view: View, id: string | null | undefined) => view.jobs.jobs.find((j) => j.id === id)?.name ?? 'a job'
const isHere = (a: AssetView, x: Where) => (x.placeId ? a.placeId === x.placeId : a.caseId === x.caseId)
const openMissing = (view: View, id: string) => view.faults.ofAsset(id).find((f) => f.open && f.kind === 'missing')
/** "10:05", in Irish time. */
const time = (iso: string) => new Date(iso).toLocaleTimeString('en-IE', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Dublin' })

/**
 * Start counting a place or a case, or carry on with the count under way
 * here. One count at a time on a phone: starting another asks first, in
 * place, whether to carry on with that one or discard it.
 */
export function StartCount({ view, where, label, className }: { view: View; where: Where; label: string; className?: string }) {
  const d = useDraft()
  const { me } = useMe(view)
  const [asking, setAsking] = useState(false)
  const w = view.warehouse
  const same = d && d.placeId === where.placeId && d.caseId === where.caseId
  const start = () => {
    saveDraft({ id: newId(), ...where, startedAt: new Date().toISOString(), by: me?.id ?? null, scanned: [], unknown: [], counted: {}, added: [] })
    location.hash = '#stock/count'
  }
  if (asking && d && !same) {
    const other = targetName(w, d)
    return (
      <Confirm
        className="wide"
        question={`A count of ${other} is under way on this phone${d.scanned.length ? `, with ${plural(d.scanned.length, 'item')} scanned` : ''}. Discard it to count ${targetName(w, where)}?`}
        yes="Discard it and start"
        no={`Carry on with ${other}`}
        onYes={start}
        onNo={() => {
          setAsking(false)
          location.hash = '#stock/count'
        }}
      />
    )
  }
  return (
    <button type="button" className={className} onClick={() => (same ? (location.hash = '#stock/count') : d ? setAsking(true) : start())}>
      {same ? 'Carry on counting' : label}
    </button>
  )
}

/** The Stock tab's Counts card: a count under way, this week's places, how far the quarter has got, and what's been counted this week. */
export function CountsCard({ view }: { view: View }) {
  const d = useDraft()
  const today = useToday()
  const week = view.counts.week
  const w = view.warehouse
  if (week.places === 0 && !d) return null
  // Places and cases alike: a case counted this week is on its page, and here.
  const monday = mondayOf(today)
  const thisWeek = view.counts.all.filter((c) => c.day >= monday)
  const due = (x: { place: { id: string; name: string }; last: CountView | undefined }) => (
    <li key={x.place.id} className="count-due">
      <a className="count-link" href={`#stock/place/${x.place.id}`}>
        <div>
          <b>{x.place.name}</b>
          <p>{x.last ? `Last counted ${dayLabel(x.last.day)} ${x.last.day.slice(0, 4)}` : 'Never counted'}</p>
        </div>
      </a>
      <StartCount view={view} where={{ placeId: x.place.id, caseId: null }} label="Count" />
    </li>
  )
  return (
    <section className="card counts" aria-label="Counts">
      <h2>Counts</h2>
      {d && (
        <div className="under-way">
          <p>
            A count of <b>{targetName(w, d)}</b> is under way on this phone{d.scanned.length ? `: ${plural(d.scanned.length, 'item')} scanned` : ''}.
          </p>
          <a className="button primary" href="#stock/count">
            Carry on counting
          </a>
        </div>
      )}
      {week.places > 0 && (
        <p className="hint">
          {week.counted.toLocaleString('en-IE')} of {plural(week.places, 'place')} counted in the last 13 weeks. {plural(week.perWeek, 'place')} a week keeps
          each one within a quarter.
        </p>
      )}
      {week.due.length > 0 ? (
        <>
          <h3>To count this week</h3>
          {/* "places to count", not "places": the Places card below has its own "Show all 9 places". */}
          <ShowAll items={week.due} limit={5} what="places to count">
            {(rows) => <ul className="job-list">{rows.map(due)}</ul>}
          </ShowAll>
        </>
      ) : (
        week.places > 0 && (
          <>
            <p className="done-line">This week's counts are done.</p>
            {week.next && (
              <>
                <h3>Next, to get ahead</h3>
                <ul className="job-list">{due(week.next)}</ul>
              </>
            )}
          </>
        )
      )}
      {thisWeek.length > 0 && (
        <>
          <h3>Counted this week</h3>
          <CountList counts={thisWeek} />
        </>
      )}
    </section>
  )
}

/** Counts, newest first, each opening its page: the day and who, then what it found. */
function CountList({ counts, limit = 5, named = true }: { counts: readonly CountView[]; limit?: number; named?: boolean }) {
  return (
    <ShowAll items={counts} limit={limit} what="counts">
      {(rows) => (
        <ul className="job-list">
          {rows.map((c) => (
            <li key={c.id}>
              <a className="count-link" href={`#stock/count/${c.id}`}>
                <div>
                  <b>{named ? c.what : `${dayLabel(c.day)} ${c.day.slice(0, 4)}`}</b>
                  <p>
                    {[named && dayLabel(c.day), c.person?.name, countSummaryWords(c.summary)].filter(Boolean).join(' · ')}
                  </p>
                </div>
                <div className="side">
                  <Pending pending={c.pending} />
                </div>
              </a>
            </li>
          ))}
        </ul>
      )}
    </ShowAll>
  )
}

/** On a place's page and a case's: when it was last counted and by whom, a way to count it, and its counts. */
export function CountsOf({ view, where }: { view: View; where: Where }) {
  const counts = view.counts.of(where)
  const last = counts[0]
  return (
    <section className="card counts" aria-label="Counts">
      <h2>Counts</h2>
      <p className="last-counted">
        {last
          ? `Last counted ${dayLabel(last.day)} ${last.day.slice(0, 4)}${last.person ? ` by ${last.person.name}` : ''}: ${countSummaryWords(last.summary)}.`
          : where.caseId
            ? "Never counted. Count what's in it when it's opened."
            : 'Never counted.'}
      </p>
      <StartCount view={view} where={where} label={where.caseId ? "Count what's in it" : 'Count this place'} />
      {counts.length > 0 && <CountList counts={counts} limit={3} named={false} />}
    </section>
  )
}

type Tone = 'ok' | 'warn' | 'quiet'

/** #stock/count: the count under way on this phone, or a line saying there's none. */
export function CountScreen({ view }: { view: View }) {
  const d = useDraft()
  if (!d)
    return (
      <div className="app warehouse counting">
        <Top view={view} title="Stock" />
        <a className="back" href="#stock">
          ‹ All stock
        </a>
        <section className="card">
          <header className="title">
            <h1>Counting</h1>
          </header>
          <p className="empty">No count is under way on this phone. Start one from a place's page, a case's page, or the Counts card on the Stock tab.</p>
        </section>
      </div>
    )
  return <Counting key={d.id} view={view} d={d} />
}

function Counting({ view, d }: { view: View; d: CountDraft }) {
  const w = view.warehouse
  const name = targetName(w, d)
  const known = d.placeId ? w.places.some((p) => p.id === d.placeId) : !!d.caseId && w.assets.has(d.caseId)
  const result = useMemo(() => compareCount(view, d), [view, d])
  const { me, signedIn, pick } = useMe(view)
  const [said, setSaid] = useState<{ tone: Tone; text: string; at: number }>()
  const [typed, setTyped] = useState('')
  const [camera, setCamera] = useState(false)
  const [discarding, setDiscarding] = useState(false)
  const { run, error } = useAct()
  const say = (tone: Tone, text: string) => setSaid({ tone, text, at: Date.now() })
  // The count as last saved, not as this render saw it: two labels read before the screen redraws both count.
  const latest = () => (draft?.id === d.id ? draft : d)
  const update = (change: Partial<CountDraft>) => saveDraft({ ...latest(), ...change })

  // A label, an old number or a maker's serial, read by the camera or typed by a scanner, as the Stock search reads it.
  const read = (code: string) => {
    const a = itemByCode(w, code)
    const was = latest()
    if (!a) {
      const shown = unknownCode(code)
      if (!shown) return
      if (!was.unknown.includes(shown)) update({ unknown: [...was.unknown, shown] })
      return say('warn', `No item has ${shown}. It's noted on the count; put the label on its item from the Stock search afterwards.`)
    }
    const what = itemName(a)
    // A case's own label, read as it's opened, isn't something in it.
    if (holdsCount(w, d, a)) return say('quiet', a.id === d.caseId ? `${what} is the case being counted.` : `${what} holds the case being counted.`)
    if (was.scanned.includes(a.id)) return say('quiet', `${what} is counted already.`)
    const next = { ...was, scanned: [...was.scanned, a.id] }
    saveDraft(next)
    const now = compareCount(view, next)
    const item = now.items.find((i) => i.assetId === a.id)
    const tally = `${now.summary.found} of ${now.summary.expected} found.`
    switch (item?.said) {
      case 'found':
        return say('ok', `${what}: found. ${tally}`)
      case 'elsewhere':
        return say('warn', `${what}: ${keptWords(item, w)}. Move it here once you finish, or leave it.`)
      case 'in-case':
        return say('quiet', `${what}: ${keptWords(item, w)}, which is kept here. ${tally}`)
      case 'out':
        return say('warn', `${what}: recorded as out with ${jobName(view, item.projectId)}. Scan it back in on the job's pick list.`)
      case 'missing':
        return say('warn', `${what}: reported missing. Mark it found once you finish.`)
      default:
        return say(
          'warn',
          a.retiredReason === 'mistake'
            ? `${what} was added by mistake.`
            : `${what}: marked as ${a.retiredReason ? RETIRED_LABELS[a.retiredReason].toLowerCase() : 'retired'}. Bring it back once you finish.`
        )
    }
  }
  const submit = (e: FormEvent) => {
    e.preventDefault()
    const code = typed.trim()
    if (!code) return
    setTyped('')
    read(code)
  }

  const finish = () => {
    const now = latest()
    const by = signedIn ? (me?.id ?? null) : now.by
    const args = { id: now.id, startedAt: now.startedAt, finishedAt: new Date().toISOString(), by, ...compareCount(view, now) }
    void run(() => client.mutate('count.record', args)).then((ok) => {
      if (!ok) return
      saveDraft(undefined)
      location.hash = `#stock/count/${d.id}`
    })
  }

  const toFind = result.items.filter((i) => i.said === 'not-found' || i.said === 'repair')
  const found = result.items.filter((i) => i.said === 'found' || i.said === 'in-case')
  const extra = result.items.filter((i) => i.scanned && i.said !== 'found' && i.said !== 'in-case')
  const away = (said: CountItem['said']) => result.items.filter((i) => !i.scanned && i.said === said).length
  const awayWords = [away('out') && `${away('out')} out with jobs`, away('missing') && `${away('missing')} reported missing`].filter(Boolean)
  const recorded = (d.placeId ? w.places.find((p) => p.id === d.placeId)?.counted : w.assets.get(d.caseId ?? '')?.counted) ?? []
  const products = [...new Set([...recorded.map((s) => s.modelId), ...d.added])]

  return (
    <div className="app warehouse counting">
      <Top view={view} title="Stock" />
      <a className="back" href={d.placeId ? `#stock/place/${d.placeId}` : `#stock/item/${d.caseId}`}>
        ‹ {name}
      </a>
      <section className="card" aria-label="Scanning">
        <header className="title">
          <h1>Counting {name}</h1>
        </header>
        <p className="hint">
          Started {time(d.startedAt)}. Kept on this phone until you finish, with or without signal.
          {!kept && ' This phone isn’t keeping it: its storage is full or blocked, so a reload would lose it.'}
        </p>
        {!known && <p className="warn-line">{d.placeId ? 'That place' : 'That case'} isn't on this phone. It may still be on its way, or it was removed.</p>}
        <Who view={view} d={d} signedIn={signedIn} me={me?.name} onPick={(id) => (update({ by: id || null }), id && pick(id))} />
        <p className="count-tally">
          {result.summary.expected ? `${result.summary.found} of ${result.summary.expected} found` : 'No numbered items expected'}
        </p>
        <form className="scan-row" onSubmit={submit}>
          <input
            type="search"
            enterKeyHint="go"
            autoComplete="off"
            placeholder="Scan or type a number"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            aria-label="Number or serial"
          />
          <button
            type="button"
            aria-pressed={camera}
            onClick={() => {
              if (!camera) primeSound()
              setCamera(!camera)
            }}
          >
            Scan
          </button>
        </form>
        {camera && <CameraScanner onRead={read} onStop={() => setCamera(false)} small />}
        {said && (
          <p key={said.at} className={`said ${said.tone}`} role="status" aria-label="Last scan">
            {said.text}
          </p>
        )}
        {toFind.length > 0 && <Numbers title={`Still to find (${toFind.length})`} items={toFind} view={view} />}
        {extra.length + d.unknown.length > 0 && (
          <div className="group">
            <h3>Not as recorded ({extra.length + d.unknown.length})</h3>
            <ul className="said-list">
              {extra.map((i) => (
                <li key={i.assetId}>
                  <b>{itemName(w.assets.get(i.assetId))}</b> {itemWords(view, i)}
                </li>
              ))}
              {d.unknown.map((code) => (
                <li key={code}>
                  <b>{code}</b> No item has this number.
                </li>
              ))}
            </ul>
          </div>
        )}
        {found.length > 0 && (
          <details>
            <summary>Found ({found.length})</summary>
            <Numbers items={found} view={view} />
          </details>
        )}
        {awayWords.length > 0 && <p className="hint">Not expected on the shelf: {awayWords.join(', ')}.</p>}
      </section>

      <CountedKit view={view} d={d} products={products} onChange={(counted) => update({ counted })} onAdd={(id) => update({ added: [...latest().added, id] })} />

      <section className="card finish">
        <Refusal error={error} />
        {discarding ? (
          <Confirm
            question={`Discard the count of ${name}? What was scanned and typed goes, and nothing is recorded.`}
            yes="Discard it"
            no="Keep counting"
            onYes={() => {
              saveDraft(undefined)
              location.hash = d.placeId ? `#stock/place/${d.placeId}` : `#stock/item/${d.caseId}`
            }}
            onNo={() => setDiscarding(false)}
          />
        ) : (
          <>
            <button type="button" className="primary big" onClick={finish} disabled={!known}>
              Finish the count
            </button>
            <p className="hint">Finishing compares it with the record and keeps it. What's different is put right afterwards, one tap each.</p>
            <button type="button" className="link" onClick={() => setDiscarding(true)}>
              Discard this count
            </button>
          </>
        )}
      </section>
    </div>
  )
}

/** Who's counting: the signed-in person, or picked from the staff while sign-in is off, as the Leave screen does. */
function Who({ view, d, signedIn, me, onPick }: { view: View; d: CountDraft; signedIn: boolean; me: string | undefined; onPick: (id: string) => void }) {
  if (signedIn) return <p className="hint">{me ? `Counted by ${me}.` : "Your account isn't matched to anyone on the Crew tab, so the count won't say who did it."}</p>
  return (
    <label className="field">
      Who's counting
      <select value={d.by ?? ''} onChange={(e) => onPick(e.target.value)}>
        <option value="">Not said</option>
        {view.leave.staff.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>
    </label>
  )
}

/** Items by product, each number a link to its page, as on a place's page. */
function Numbers({ title, items, view }: { title?: string; items: readonly CountItem[]; view: View }) {
  const w = view.warehouse
  const groups = new Map<string, AssetView[]>()
  for (const i of items) {
    const a = w.assets.get(i.assetId)
    if (a) groups.set(a.modelId, [...(groups.get(a.modelId) ?? []), a])
  }
  return (
    <div className="group">
      {title && <h3>{title}</h3>}
      {[...groups.values()].map((list) => (
        <div key={list[0]!.modelId}>
          <p className="group-name">{list[0]!.model?.name ?? 'A product since removed'}</p>
          <ul className="numbers">
            {list.map((a) => (
              <li key={a.id}>
                <a href={`#stock/item/${a.id}`}>{numberLabel(a)}</a>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  )
}

/** What a count said of an item scanned that wasn't as recorded, in words. */
function itemWords(view: View, i: CountItem): string {
  const w = view.warehouse
  const a = w.assets.get(i.assetId)
  switch (i.said) {
    case 'elsewhere':
    case 'in-case':
      return `Found here, ${keptWords(i, w)}.`
    case 'out':
      return `Recorded as out with ${jobName(view, i.projectId)}.`
    case 'missing':
      return 'Reported missing.'
    case 'retired':
      return a?.retiredReason === 'mistake' ? 'Added by mistake.' : `Marked as ${a?.retiredReason ? RETIRED_LABELS[a.retiredReason].toLowerCase() : 'retired'}.`
    default:
      return ''
  }
}

/**
 * Counted kit: a number per product, without the record beside it (a blind
 * count, as the research says: a counter shown 120 tends to find 120). One
 * left blank isn't counted; 0 is none there. A product that's there but
 * wasn't expected is added by name.
 */
function CountedKit({
  view,
  d,
  products,
  onChange,
  onAdd,
}: {
  view: View
  d: CountDraft
  products: string[]
  onChange: (counted: Record<string, number>) => void
  onAdd: (modelId: string) => void
}) {
  const w = view.warehouse
  const [adding, setAdding] = useState('')
  // What's typed here; a number typed in another tab shows from the count itself.
  const [typed, setTyped] = useState<Record<string, string>>({})
  const added = useRef<string>('')
  const { error, refuse } = useAct()
  const model = (id: string) => w.models.find((m) => m.id === id)
  useEffect(() => {
    if (!added.current) return
    document.getElementById(`count-${added.current}`)?.focus()
    added.current = ''
  }, [products.length])
  const set = (modelId: string, text: string) => {
    setTyped({ ...typed, [modelId]: text })
    const n = Number(text)
    const counted = { ...d.counted }
    if (text.trim() === '' || !Number.isInteger(n) || n < 0 || n > MAX_QTY) delete counted[modelId]
    else counted[modelId] = n
    onChange(counted)
  }
  const add = (e: FormEvent) => {
    e.preventDefault()
    const m = w.models.find((x) => x.name.trim().toLowerCase() === adding.trim().toLowerCase())
    if (!m) return refuse(`No product is called ${adding.trim()}. Add it on the Stock page first.`)
    if (products.includes(m.id)) return refuse(`${m.name} is on the count already.`)
    refuse('')
    added.current = m.id
    onAdd(m.id)
    setAdding('')
  }
  return (
    <section className="card counted-kit" aria-label="Counted kit">
      <h2>Counted kit</h2>
      <p className="hint">Type how many you count of each, without looking at the record: they're compared when you finish. Leave one blank if you didn't count it.</p>
      {products.length === 0 && <Empty>Nothing counted is recorded here. Add a product below if there is some.</Empty>}
      {products.map((id) => {
        const m = model(id)
        return (
          <label key={id} className="count-field">
            <span>
              <b>{m?.name ?? 'A product since removed'}</b>
              {m?.tracking === 'serialised' && <small>Not labelled yet</small>}
            </span>
            <input
              id={`count-${id}`}
              type="number"
              inputMode="numeric"
              min={0}
              max={MAX_QTY}
              value={typed[id] ?? String(d.counted[id] ?? '')}
              onChange={(e) => set(id, e.target.value)}
              placeholder="How many"
            />
          </label>
        )
      })}
      <form className="add-product" onSubmit={add}>
        <label className="field">
          A product that's here but not on the list
          <input list="product-names" value={adding} onChange={(e) => setAdding(e.target.value)} placeholder="e.g. XLR 10 m" autoComplete="off" />
        </label>
        <button type="submit">Add</button>
      </form>
      <Refusal error={error} />
      <ProductChoices w={w} />
    </section>
  )
}

/** #stock/count/<id>: what a count found, each difference with its fix, worked out against what this phone holds now. */
export function CountPage({ view, id }: { view: View; id: string }) {
  const c = view.counts.byId(id)
  const back = (
    <a className="back" href={c ? (c.placeId ? `#stock/place/${c.placeId}` : `#stock/item/${c.caseId}`) : '#stock'}>
      ‹ {c ? c.what : 'All stock'}
    </a>
  )
  if (!c)
    return (
      <div className="app warehouse counting">
        <Top view={view} title="Stock" />
        {back}
        <section className="card">
          <header className="title">
            <h1>A count</h1>
          </header>
          <p className="empty">This count isn't on this device. It may still be on its way: check again once it says “Up to date”.</p>
        </section>
      </div>
    )
  const at: Where = { placeId: c.placeId, caseId: c.caseId }
  const items = (...kinds: CountItem['said'][]) => c.items.filter((i) => kinds.includes(i.said))
  return (
    <div className="app warehouse counting">
      <Top view={view} title="Stock" />
      {back}
      <section className="card">
        <header className="title">
          <h1>Count of {c.what}</h1>
          <Pending pending={c.pending} />
        </header>
        <dl className="facts">
          <div>
            <dt>When</dt>
            <dd>
              {dayLabel(c.day)}, {time(c.startedAt)} to {time(c.finishedAt)}
            </dd>
          </div>
          <div>
            <dt>Counted by</dt>
            <dd>{c.person?.name ?? 'Not said'}</dd>
          </div>
          <div className="wide">
            <dt>What it found</dt>
            <dd>{countSummaryWords(c.summary)}</dd>
          </div>
        </dl>
      </section>
      <NotFound view={view} c={c} at={at} list={items('not-found')} />
      <Elsewhere view={view} at={at} list={items('elsewhere')} />
      <NotExpected view={view} c={c} at={at} />
      <Products view={view} c={c} at={at} />
      <Rest view={view} c={c} />
    </div>
  )
}

/** A fix: one existing command (or two), with its refusal under it. Held while it's being kept, so a second tap can't send it twice. */
function Fix({ label, act, className }: { label: string; act: () => Promise<unknown>; className?: string }) {
  const { run, error } = useAct()
  const [busy, setBusy] = useState(false)
  const go = () => {
    setBusy(true)
    void run(act).finally(() => setBusy(false))
  }
  return (
    <>
      <button type="button" className={className} onClick={go} disabled={busy}>
        {label}
      </button>
      <Refusal error={error} />
    </>
  )
}

/** A row on a count's page: what, what the count said, and its fix or what's become of it since. */
function Line({ title, href, said, children }: { title: string; href?: string; said: ReactNode; children?: ReactNode }) {
  return (
    <li className="count-line">
      <div>
        {href ? <a href={href}>{title}</a> : <b>{title}</b>}
        <p>{said}</p>
      </div>
      <div className="actions">{children}</div>
    </li>
  )
}

/** What's become of an item since, for a fix that's no longer to do; undefined while it is. */
function since(view: View, a: AssetView | undefined, missingIsDone: boolean): string | undefined {
  if (!a) return 'Not on this phone.'
  if (a.status !== 'active') return 'Retired since.'
  const out = view.moves.outOf(a.id)
  if (out) return `Out with ${jobName(view, out.projectId)} now.`
  if (openMissing(view, a.id)) return missingIsDone ? 'Reported missing.' : undefined
  return undefined
}

function NotFound({ view, c, at, list }: { view: View; c: CountView; at: Where; list: CountItem[] }) {
  if (list.length === 0) return null
  const w = view.warehouse
  const report = (a: AssetView) => reportFault({ kind: 'missing', assetId: a.id, modelId: a.modelId, qty: 1, projectId: null, usable: false, note: `Not found in the count of ${c.what}.` })
  const rows = list.map((i) => {
    const a = w.assets.get(i.assetId)
    const done = since(view, a, true) ?? (a && !isHere(a, at) ? `Now ${keptWords(a, w)}.` : undefined)
    return { i, a, done }
  })
  const toDo = rows.filter((r) => !r.done && r.a).map((r) => r.a!)
  return (
    <section className="card count-fixes" aria-label="Not found">
      <h2>Not found ({list.length})</h2>
      <p className="hint">Expected here and not scanned. Look again, or report it missing: it joins the repair list, and scanning it later marks it found.</p>
      <ul className="count-lines">
        {rows.map(({ i, a, done }) => (
          <Line key={i.assetId} title={itemName(a)} href={a && `#stock/item/${a.id}`} said={done ?? 'Not scanned.'}>
            {!done && a && <Fix label="Report missing" act={() => report(a)} />}
          </Line>
        ))}
      </ul>
      {toDo.length > 1 && <Fix className="all" label={`Report all ${toDo.length} missing`} act={async () => { for (const a of toDo) await report(a) }} />}
    </section>
  )
}

function Elsewhere({ view, at, list }: { view: View; at: Where; list: CountItem[] }) {
  if (list.length === 0) return null
  const w = view.warehouse
  const move = (a: AssetView) => client.mutate('asset.move', { id: a.id, ...at })
  const doneOf = (i: CountItem, a: AssetView | undefined) => {
    if (a && keptWithin(a, at)) return 'Moved here.'
    const gone = since(view, a, false)
    if (gone || !a) return gone
    // Moved somewhere else since the count: that's newer word than the count's, so it isn't moved back.
    return a.placeId !== (i.placeId ?? null) || a.caseId !== (i.caseId ?? null) ? `Now ${keptWords(a, w)}.` : undefined
  }
  const rows = list.map((i) => {
    const a = w.assets.get(i.assetId)
    return { i, a, done: doneOf(i, a) }
  })
  const toDo = rows.filter((r) => !r.done && r.a).map((r) => r.a!)
  return (
    <section className="card count-fixes" aria-label="In the wrong place">
      <h2>In the wrong place ({list.length})</h2>
      <p className="hint">Scanned here, but recorded somewhere else. Move it here, or leave it.</p>
      <ul className="count-lines">
        {rows.map(({ i, a, done }) => (
          <Line key={i.assetId} title={itemName(a)} href={a && `#stock/item/${a.id}`} said={done ?? `Was ${keptWords(i, w)}.`}>
            {!done && a && <Fix label="Move here" act={() => move(a)} />}
          </Line>
        ))}
      </ul>
      {toDo.length > 1 && <Fix className="all" label={`Move all ${toDo.length} here`} act={async () => { for (const a of toDo) await move(a) }} />}
    </section>
  )
}

/** Scanned, but retired, reported missing or out with a job; and numbers no item has. */
function NotExpected({ view, c, at }: { view: View; c: CountView; at: Where }) {
  const w = view.warehouse
  const list = c.items.filter((i) => i.scanned && (i.said === 'retired' || i.said === 'missing' || i.said === 'out'))
  if (list.length === 0 && c.unknown.length === 0) return null
  const line = (i: CountItem) => {
    const a = w.assets.get(i.assetId)
    const title = itemName(a)
    const href = a && `#stock/item/${a.id}`
    if (i.said === 'retired') {
      const mistake = a?.retiredReason === 'mistake' || !!(a && w.mistakes.has(a.modelId))
      const still = a?.status === 'retired'
      return (
        <Line key={i.assetId} title={title} href={href} said={!still ? 'Brought back.' : mistake ? 'Added by mistake, so it stays out of the stock list.' : `Marked as ${a?.retiredReason ? RETIRED_LABELS[a.retiredReason].toLowerCase() : 'retired'}, but it's here.`}>
          {still && !mistake && a && (
            <Fix
              label="Bring it back and keep it here"
              act={async () => {
                await client.mutate('asset.reinstate', { id: a.id })
                await client.mutate('asset.move', { id: a.id, ...at })
              }}
            />
          )}
        </Line>
      )
    }
    if (i.said === 'missing') {
      const fault = a && openMissing(view, a.id)
      const elsewhere = !!a && a.status === 'active' && !keptWithin(a, at)
      return (
        <Line key={i.assetId} title={title} href={href} said={fault ? `Reported missing, but it's here${elsewhere ? `. It was ${keptWords(i, w)}` : ''}.` : 'Marked found.'}>
          {fault && a && (
            <Fix
              label={elsewhere ? 'Mark found and keep it here' : 'Mark found'}
              act={async () => {
                await client.mutate('fault.close', { id: fault.id, outcome: 'found', at: new Date().toISOString() })
                if (elsewhere) await client.mutate('asset.move', { id: a.id, ...at })
              }}
            />
          )}
        </Line>
      )
    }
    const out = a ? view.moves.outOf(a.id) : undefined
    return (
      <Line
        key={i.assetId}
        title={title}
        href={href}
        said={
          out ? (
            <>
              Recorded as out with {jobName(view, out.projectId)}, but it's here. Scan it back in on <a href={`#jobs/${out.projectId}/pick`}>the job's pick list</a>.
            </>
          ) : (
            'Recorded as out with a job when counted; scanned back in since.'
          )
        }
      />
    )
  }
  return (
    <section className="card count-fixes" aria-label="Not expected">
      <h2>Not expected ({list.length + c.unknown.length})</h2>
      <ul className="count-lines">
        {list.map(line)}
        {c.unknown.map((code) => {
          const now = normaliseNumber(code) ? w.byNumber.get(normaliseNumber(code)!) : undefined
          return (
            <Line
              key={code}
              title={code}
              said={
                now ? (
                  `Now on ${itemName(now)}.`
                ) : (
                  <>
                    No item has this number. Scan or type it in <a href="#stock">the Stock search</a> to put it on its item.
                  </>
                )
              }
            />
          )
        })}
      </ul>
    </section>
  )
}

/** "XLR 10 m", or "d&b Y10P, not labelled yet" for a numbered product's counted ones. */
function productLabel(w: WarehouseView, modelId: string): string {
  const m = w.models.find((x) => x.id === modelId)
  return m ? `${m.name}${m.tracking === 'serialised' ? ', not labelled yet' : ''}` : 'A product since removed'
}

/** Counted kit: counted against recorded, how many were away, and what the fix sets it to (ADR 0030). */
function Products({ view, c, at }: { view: View; c: CountView; at: Where }) {
  if (c.products.length === 0) return null
  const w = view.warehouse
  const here = (at.placeId ? w.places.find((p) => p.id === at.placeId)?.counted : w.assets.get(at.caseId ?? '')?.counted) ?? []
  const now = (modelId: string) => here.find((s) => s.modelId === modelId)?.qty ?? 0
  const set = (p: CountProduct, qty: number) => client.mutate('stock.set', { modelId: p.modelId, ...at, qty })
  const rows = c.products.map((p) => {
    const setTo = countSetTo(p)
    const off = setTo !== null && setTo !== p.recorded
    const n = now(p.modelId)
    // Set only while the record is what the count was compared with: changed since (counted again, say), it's newer than the count.
    return { p, setTo, off, toDo: off && n === p.recorded, changed: off && n !== p.recorded && n !== setTo }
  })
  const toDo = rows.filter((r) => r.toDo)
  const words = ({ p, setTo, off, changed }: (typeof rows)[number]) => {
    if (p.counted === null) return `Not counted; ${p.recorded.toLocaleString('en-IE')} recorded.`
    const away = p.away ? `, ${p.away.toLocaleString('en-IE')} out with jobs or reported missing` : ''
    const base = `${p.counted.toLocaleString('en-IE')} counted, ${p.recorded.toLocaleString('en-IE')} recorded${away}`
    // Fewer on the shelf than recorded, but no more than are away: a loss, if any, waits until they're back, and the next count finds it.
    if (!off || setTo === null)
      return p.counted < p.recorded
        ? `${base}: the ${(p.recorded - p.counted).toLocaleString('en-IE')} not here may be among those away, so it stays as recorded.`
        : `${base}: as recorded.`
    const said = `${base}: ${Math.abs(setTo - p.recorded).toLocaleString('en-IE')} ${setTo < p.recorded ? 'short' : 'over'}.`
    return changed ? `${said} The record has changed since: ${now(p.modelId).toLocaleString('en-IE')} now.` : said
  }
  return (
    <section className="card count-fixes" aria-label="Counted kit">
      <h2>Counted kit</h2>
      <p className="hint">Kit out with a job, or reported missing, stays in the count it came from, so a count is never lowered for it.</p>
      <ul className="count-lines">
        {rows.map((r) => (
          <Line key={r.p.modelId} title={productLabel(w, r.p.modelId)} href={`#stock/product/${r.p.modelId}`} said={words(r)}>
            {r.off && r.setTo !== null && !r.changed && (r.toDo ? <Fix label={`Set to ${r.setTo.toLocaleString('en-IE')}`} act={() => set(r.p, r.setTo!)} /> : <span className="done">Set to {r.setTo.toLocaleString('en-IE')}</span>)}
          </Line>
        ))}
      </ul>
      {toDo.length > 1 && <Fix className="all" label={`Set all ${toDo.length} counts`} act={async () => { for (const r of toDo) await set(r.p, r.setTo!) }} />}
    </section>
  )
}

/** What was as recorded, folded: found, and kit away (out with a job, already missing, in repair) that the count said nothing new about. */
function Rest({ view, c }: { view: View; c: CountView }) {
  const w = view.warehouse
  const found = c.items.filter((i) => i.said === 'found' || i.said === 'in-case')
  const away = c.items.filter((i) => !i.scanned && (i.said === 'out' || i.said === 'missing' || i.said === 'repair'))
  if (found.length === 0 && away.length === 0) return null
  const fault = (id: string) => view.faults.ofAsset(id).find((f) => f.kind === 'damaged' && f.open)
  return (
    <section className="card">
      {found.length > 0 && (
        <details>
          <summary>Found ({found.length})</summary>
          <Numbers items={found} view={view} />
        </details>
      )}
      {away.length > 0 && (
        <details>
          <summary>Out with jobs, missing or in repair ({away.length})</summary>
          <ul className="count-lines">
            {away.map((i) => {
              const a = w.assets.get(i.assetId)
              const said =
                i.said === 'out'
                  ? `Out with ${jobName(view, i.projectId)}.`
                  : i.said === 'missing'
                    ? 'Already reported missing.'
                    : `In repair${a && fault(a.id)?.note ? `: ${fault(a.id)!.note}` : ''}.`
              return <Line key={i.assetId} title={itemName(a)} href={a && `#stock/item/${a.id}`} said={said} />
            })}
          </ul>
        </details>
      )}
    </section>
  )
}
