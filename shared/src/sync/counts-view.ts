import type { CommandArgs, Mutation } from '../commands.ts'
import { countSetTo, ROLLING_WEEKS, unknownCode, type Count, type CountDraft, type CountEntities, type CountItem, type CountProduct, type CountSummary } from '../counts.ts'
import type { Where } from '../stock.ts'
import type { CrewView, PersonView } from './crew-view.ts'
import type { FaultsView } from './faults-view.ts'
import type { MovesView } from './pick-view.ts'
import { addDays, mondayOf } from './plan.ts'
import type { AssetView, PlaceView, WarehouseView } from './stock-view.ts'

/**
 * Counts (ADR 0030) as a device sees them: what the server has said, with
 * this phone's own counts still on their way laid over it; when each place
 * and case was last counted; what each count said of an item, for its log;
 * and which places to count this week. And the comparison itself, worked
 * out at Finish (and as the count goes, for the tally) from what the phone
 * holds, so it needs no signal.
 */

export interface CountView extends Count {
  pending: boolean
  place: PlaceView | undefined
  inCase: AssetView | undefined
  /** "Bay A3", or "SH-000200 (Amp rack)". */
  what: string
  person: PersonView | undefined
  /** The day it finished in Ireland. */
  day: string
}

/** A place on the week's list, with its last count if it has one. */
export interface CountDue {
  place: PlaceView
  last: CountView | undefined
}

export interface WeekList {
  /** How many places a week keeps every one counted within a quarter. */
  perWeek: number
  /** Every place never counted, by name, then those counted longest ago, to make up this week's number. */
  due: CountDue[]
  /** Places counted since Monday, the latest first. */
  done: (CountDue & { last: CountView })[]
  /** Once this week's are done: the one counted longest ago, to get ahead. */
  next: CountDue | undefined
  /** Places counted in the last 13 weeks, and how many places there are. */
  counted: number
  places: number
}

export interface CountsView {
  /** Newest first. */
  all: CountView[]
  byId(id: string): CountView | undefined
  /** A place's or a case's counts, newest first. */
  of(where: { placeId?: string | null; caseId?: string | null }): CountView[]
  /** What counts said of an item, newest first: only where it was found, or expected and not found. */
  ofItem(assetId: string): { count: CountView; item: CountItem }[]
  week: WeekList
}

type Tables = { [E in keyof CountEntities]: Record<string, CountEntities[E]> }

const newest = (a: Count, b: Count) => b.finishedAt.localeCompare(a.finishedAt) || b.id.localeCompare(a.id)
// Made once: a formatter per count was the slow part of a long list.
const IRISH_DAY = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Dublin' })
/** Places in order, "Bay 2" before "Bay 10". */
const byName = new Intl.Collator('en-IE', { numeric: true, sensitivity: 'base' })

/** "SH-000200 (Amp rack)", as a case is named. */
const caseName = (c: AssetView | undefined) => (c ? `${c.number || 'a case'}${c.model ? ` (${c.model.name})` : ''}` : 'a case')

export function countsView(
  entities: Partial<Tables>,
  outbox: readonly (Mutation & { appliedSeq?: number })[],
  cursor: number,
  warehouse: WarehouseView,
  crew: Pick<CrewView, 'people'>,
  today: string
): CountsView {
  const counts = new Map<string, Count & { pending: boolean }>()
  for (const c of Object.values(entities.count ?? {})) counts.set(c.id, { ...c, pending: false })
  for (const m of outbox) {
    if (m.appliedSeq !== undefined && m.appliedSeq <= cursor) continue
    if (m.name !== 'count.record') continue
    const a = m.args as CommandArgs<'count.record'>
    if (counts.has(a.id)) continue
    counts.set(a.id, { ...a, startedAt: new Date(a.startedAt).toISOString(), finishedAt: new Date(a.finishedAt).toISOString(), pending: true })
  }

  const people = new Map(crew.people.map((p) => [p.id, p]))
  const places = new Map(warehouse.places.map((p) => [p.id, p]))
  const all: CountView[] = [...counts.values()]
    .map((c) => {
      const place = c.placeId ? places.get(c.placeId) : undefined
      const inCase = c.caseId ? warehouse.assets.get(c.caseId) : undefined
      return {
        ...c,
        place,
        inCase,
        what: c.placeId ? (place?.name ?? 'a place since removed') : caseName(inCase),
        person: c.by ? people.get(c.by) : undefined,
        day: IRISH_DAY.format(new Date(c.finishedAt)),
      }
    })
    .sort(newest)

  const byWhere = new Map<string, CountView[]>()
  const byItem = new Map<string, { count: CountView; item: CountItem }[]>()
  const add = <T>(map: Map<string, T[]>, key: string, value: T) => {
    const list = map.get(key)
    if (list) list.push(value)
    else map.set(key, [value])
  }
  for (const c of all) {
    add(byWhere, c.placeId ? `p:${c.placeId}` : `c:${c.caseId}`, c)
    // Kit away and not scanned gets no line: the count said nothing new about it.
    for (const item of c.items) if (item.scanned || item.said === 'not-found') add(byItem, item.assetId, { count: c, item })
  }
  const of = (w: { placeId?: string | null; caseId?: string | null }) => (w.placeId ? byWhere.get(`p:${w.placeId}`) : w.caseId ? byWhere.get(`c:${w.caseId}`) : undefined) ?? []

  // The week's list (ADR 0030): places only; cases are counted when they're opened.
  const monday = mondayOf(today)
  const quarter = addDays(today, -ROLLING_WEEKS * 7)
  const withLast = warehouse.places.map((place) => ({ place, last: of({ placeId: place.id })[0] }))
  const done = withLast.filter((d): d is CountDue & { last: CountView } => !!d.last && d.last.day >= monday).sort((a, b) => newest(a.last, b.last))
  const never = withLast.filter((d) => !d.last).sort((a, b) => byName.compare(a.place.name, b.place.name) || a.place.id.localeCompare(b.place.id))
  const older = withLast
    .filter((d) => d.last && d.last.day < monday)
    .sort((a, b) => a.last!.finishedAt.localeCompare(b.last!.finishedAt) || byName.compare(a.place.name, b.place.name))
  const perWeek = Math.ceil(warehouse.places.length / ROLLING_WEEKS)
  const due = [...never, ...older.slice(0, Math.max(0, perWeek - done.length - never.length))]

  return {
    all,
    byId: (id) => all.find((c) => c.id === id),
    of,
    ofItem: (id) => byItem.get(id) ?? [],
    week: {
      perWeek,
      due,
      done,
      next: due.length === 0 ? older[0] : undefined,
      counted: withLast.filter((d) => d.last && d.last.day > quarter).length,
      places: warehouse.places.length,
    },
  }
}

/** What a count found against the record: the record's own parts, worked out as `count.record` carries them. */
export type CountResult = Pick<Count, 'placeId' | 'caseId' | 'items' | 'unknown' | 'products' | 'summary'>

/** An item's or a product's own open faults, as a count reads them. */
const openOf = (faults: Pick<FaultsView, 'ofAsset'>, assetId: string) => faults.ofAsset(assetId).filter((f) => f.open)

/**
 * Whether an item is kept at the place or in the case counted, directly or
 * in a case that is, however deep. One in a case here is where the record
 * says, so no fix ever takes it out of its case.
 */
export function keptWithin(a: AssetView, where: Where): boolean {
  const seen = new Set<string>()
  for (let x: AssetView | undefined = a; x && x.status === 'active' && !seen.has(x.id); x = x.inCase) {
    seen.add(x.id)
    if (where.caseId ? x.caseId === where.caseId : x.placeId === where.placeId) return true
  }
  return false
}

/** In a case's count, the case itself or a case it's in: what holds the count, so never part of it. */
export function holdsCount(w: WarehouseView, where: Where, a: AssetView): boolean {
  if (!where.caseId) return false
  const counted = w.assets.get(where.caseId)
  return a.id === where.caseId || (!!counted && keptWithin(counted, { placeId: null, caseId: a.id }))
}

/**
 * The comparison (ADR 0030): what's expected at the place or in the case,
 * what was scanned and counted, and what each difference is. Kit out with
 * a job, already reported missing, or in repair is said as that, never as
 * newly missing; an item scanned that's kept elsewhere says where.
 */
export function compareCount(
  view: { warehouse: WarehouseView; moves: Pick<MovesView, 'outOf' | 'countedOut'>; faults: Pick<FaultsView, 'ofAsset' | 'ofModel'> },
  d: Pick<CountDraft, 'placeId' | 'caseId' | 'scanned' | 'unknown' | 'counted' | 'added'>
): CountResult {
  const w = view.warehouse
  const where = { placeId: d.placeId, caseId: d.caseId }
  // A case is seen when something in it is: what's in it can't be in it anywhere else.
  const scanned = new Set(d.scanned)
  for (const id of d.scanned) for (let c = w.assets.get(id)?.inCase; c && !scanned.has(c.id); c = c.inCase) scanned.add(c.id)
  const missing = (id: string) => openOf(view.faults, id).some((f) => f.kind === 'missing')
  const repair = (id: string) => openOf(view.faults, id).some((f) => f.kind === 'damaged' && f.stops)
  const keptHere = (a: AssetView) => a.status === 'active' && (d.placeId ? a.placeId === d.placeId : a.caseId === d.caseId)

  const items: CountItem[] = []
  for (const a of w.assets.values()) {
    if (!keptHere(a)) continue
    const out = view.moves.outOf(a.id)
    const seen = scanned.has(a.id)
    if (out) items.push({ assetId: a.id, said: 'out', scanned: seen, projectId: out.projectId })
    else if (missing(a.id)) items.push({ assetId: a.id, said: 'missing', scanned: seen })
    else if (seen) items.push({ assetId: a.id, said: 'found', scanned: true })
    else items.push({ assetId: a.id, said: repair(a.id) ? 'repair' : 'not-found', scanned: false })
  }
  const listed = new Set(items.map((i) => i.assetId))
  for (const id of d.scanned) {
    const a = w.assets.get(id)
    if (!a || listed.has(id) || holdsCount(w, where, a)) continue
    listed.add(id)
    const kept = { placeId: a.placeId, caseId: a.caseId }
    const out = a.status === 'active' ? view.moves.outOf(id) : undefined
    if (a.status !== 'active') items.push({ assetId: id, said: 'retired', scanned: true })
    else if (out) items.push({ assetId: id, said: 'out', scanned: true, ...kept, projectId: out.projectId })
    else if (missing(id)) items.push({ assetId: id, said: 'missing', scanned: true, ...kept })
    else if (keptWithin(a, where)) items.push({ assetId: id, said: 'in-case', scanned: true, ...kept })
    else items.push({ assetId: id, said: 'elsewhere', scanned: true, ...kept })
  }
  const number = (id: string) => w.assets.get(id)?.number ?? ''
  items.sort((a, b) => number(a.assetId).localeCompare(number(b.assetId)) || a.assetId.localeCompare(b.assetId))

  // Counted kit: what the record has here directly, what was counted, and how many of each are away.
  const recordedHere = (d.placeId ? w.places.find((p) => p.id === d.placeId)?.counted : w.assets.get(d.caseId ?? '')?.counted) ?? []
  const recorded = new Map(recordedHere.map((s) => [s.modelId, s.qty]))
  const names = new Map([...w.mistakes.values(), ...w.models].map((m) => [m.id, m.name]))
  const name = (id: string) => names.get(id) ?? ''
  const products: CountProduct[] = [...new Set([...recorded.keys(), ...d.added, ...Object.keys(d.counted)])]
    .map((modelId) => {
      const missingCounted = view.faults.ofModel(modelId).reduce((n, f) => n + (f.open && f.kind === 'missing' ? f.qty : 0), 0)
      return { modelId, recorded: recorded.get(modelId) ?? 0, counted: d.counted[modelId] ?? null, away: view.moves.countedOut(modelId) + missingCounted }
    })
    // One added and then left blank says nothing.
    .filter((p) => p.recorded > 0 || p.counted !== null)
    .sort((a, b) => name(a.modelId).localeCompare(name(b.modelId)) || a.modelId.localeCompare(b.modelId))

  // As the record keeps them, so a draft holding a long code from before still finishes.
  const unknown = [...new Set(d.unknown.map(unknownCode))].filter(Boolean)
  const said = (...kinds: CountItem['said'][]) => items.filter((i) => kinds.includes(i.said)).length
  const setTo = products.map((p) => [p, countSetTo(p)] as const)
  const summary: CountSummary = {
    expected: said('found', 'not-found', 'repair'),
    found: said('found'),
    notFound: said('not-found'),
    elsewhere: said('elsewhere'),
    unexpected: items.filter((i) => i.scanned && (i.said === 'retired' || i.said === 'missing' || i.said === 'out')).length + unknown.length,
    uncounted: products.filter((p) => p.counted === null).length,
    short: setTo.filter(([p, n]) => n !== null && n < p.recorded).length,
    over: setTo.filter(([p, n]) => n !== null && n > p.recorded).length,
  }
  return { placeId: d.placeId, caseId: d.caseId, items, unknown, products, summary }
}
