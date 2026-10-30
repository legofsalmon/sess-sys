import {
  compareCount,
  countSummaryWords,
  dayLabel,
  holdsCount,
  itemByCode,
  mondayOf,
  newId,
  plural,
  RETIRED_LABELS,
  unknownCode,
  type CountDraft,
  type CountItem,
  type CountView,
  type View,
  type Where,
} from '@sh/shared'
import { useMemo, useState, useSyncExternalStore, type FormEvent } from 'react'
import { useScanKeys } from '../scanKeys.ts'
import { Confirm, Refusal, useAct } from '../act.tsx'
import { useMe } from '../crew/Leave.tsx'
import { ShowAll } from '../Fold.tsx'
import { Top } from '../jobs/common.tsx'
import { useAccess } from '../role.ts'
import { Pending } from '../StatusPill.tsx'
import { client } from '../sync.ts'
import { useToday } from '../view.ts'
import { CameraScanner, primeSound } from './Scanner.tsx'
import { Heading } from '../Icon.tsx'
import { STOCK } from '../Up.tsx'
import { StockViews } from '../Views.tsx'
import { itemName, jobName, keptWords, targetName, time } from './countWords.ts'
import { CountedKit, itemWords, Numbers } from './CountKit.tsx'

export { CountPage } from './CountPage.tsx'

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

/**
 * Start counting a place or a case, or carry on with the count under way
 * here. One count at a time on a phone: starting another asks first, in
 * place, whether to carry on with that one or discard it.
 */
export function StartCount({ view, where, label, className }: { view: View; where: Where; label: string; className?: string }) {
  const d = useDraft()
  const { me } = useMe(view)
  const [asking, setAsking] = useState(false)
  // Counting is stock's (audit finding 9): not offered to a role without it.
  const mayCount = useAccess().can('stock')
  const w = view.warehouse
  const same = d && d.placeId === where.placeId && d.caseId === where.caseId
  const start = () => {
    saveDraft({ id: newId(), ...where, startedAt: new Date().toISOString(), by: me?.id ?? null, scanned: [], unknown: [], counted: {}, added: [] })
    location.hash = '#stock/count'
  }
  if (!mayCount) return null
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
      <Heading icon="count">Counts</Heading>
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
      <Heading icon="count">Counts</Heading>
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
        <Top view={view} title="Stock" views={<StockViews view={view} current="count" />} heading="Counting" />
        <section className="card plain">
          <p className="empty">No count is under way on this phone. Start one from a place's page or a case's page, or from a place due below.</p>
        </section>
        <CountsCard view={view} />
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
  // A scanner's first read goes to the scan field (audit, 20 October 2026, finding 98).
  useScanKeys()
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
      <Top view={view} title="Stock" up={{ steps: [STOCK, { href: d.placeId ? `#stock/place/${d.placeId}` : `#stock/item/${d.caseId}`, label: name }], here: 'Counting' }} />
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
            placeholder="SH-000123"
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
        {toFind.length > 0 && <Numbers title={`Still to find (${toFind.length.toLocaleString('en-IE')})`} items={toFind} view={view} each="to find" />}
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
            <summary>Found ({found.length.toLocaleString('en-IE')})</summary>
            <Numbers items={found} view={view} each="found" />
          </details>
        )}
        {awayWords.length > 0 && <p className="hint">Not expected on the shelf: {awayWords.join(', ')}.</p>}
      </section>

      <CountedKit view={view} d={d} products={products} onChange={(counted) => update({ counted })} onAdd={(id) => update({ added: [...latest().added, id] })} />

      {/* Finish in reach while scrolling through what's still to find, in the bar kit from the notes uses (ADR 0067; audit,
          20 October 2026, finding 43): a full bay's 1,080 numbers put it forty screens down. */}
      {!discarding && (
        <div className="finish-bar">
          <Refusal error={error} />
          <button type="button" className="primary big" onClick={finish} disabled={!known}>
            Finish the count
          </button>
        </div>
      )}
      <section className="card finish">
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
