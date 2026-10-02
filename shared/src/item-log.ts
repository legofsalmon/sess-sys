import type { CommandArgs, Mutation } from './commands.ts'
import type { FaultKind, FaultOutcome } from './faults.ts'
import { INSPECTION_SHORT, type InspectionKind } from './inspections.ts'
import { fullDayLabel } from './stock-import.ts'
import { normaliseNumber, RETIRED_LABELS, type RetiredReason, type Where } from './stock.ts'
import type { View } from './sync/client.ts'
import type { WarehouseView } from './sync/stock-view.ts'

/**
 * An item's log (ADR 0026): everything that happened to one numbered item,
 * newest first. Each entry is a typed event, said in words by the one
 * function below, so the page reads the same whether the phone made the
 * entry from what it holds, with no signal, or the server did from its
 * history, with who did it. The two are joined by what each entry is
 * about, so nothing shows twice.
 */

/** Where an item went: a place by name, or a case by its number and product. */
export type LogWhere = { place: string } | { case: string } | null

export type ItemEvent =
  | { kind: 'added'; number: string; where: LogWhere }
  | { kind: 'moved'; where: LogWhere }
  | { kind: 'relabelled'; number: string; before: string | null }
  /** Which details changed, said as the history says them: "its serial to X", "its notes". */
  | { kind: 'edited'; changes: string[] }
  | { kind: 'out' | 'back'; job: string; inCase: string | null }
  | { kind: 'fault'; fault: FaultKind; usable: boolean; note: string; job: string | null }
  /** A fault changed: its repair notes, whether it can go out meanwhile, or what's wrong. */
  | { kind: 'repair'; repair?: string; usable?: boolean; note?: boolean }
  | { kind: 'closed'; fault: FaultKind | null; outcome: FaultOutcome }
  | { kind: 'test'; test: InspectionKind; passed: boolean; by: string; note: string }
  | { kind: 'retired'; reason: RetiredReason; note: string }
  | { kind: 'reinstated' }

export interface ItemLogEntry {
  /**
   * What it's about, the same on the phone and the server: "movement:<id>",
   * "fault:<id>", "closed:<fault id>" or "inspection:<id>" for a record the
   * phone holds too, and "mutation:<id>" for a change itself.
   */
  key: string
  /** When it happened: by the phone's clock for a scan, a fault or a test; when it was made, otherwise. */
  at: string
  event: ItemEvent
  /** Who did it, when the server knows. */
  who?: string
  /** On what, such as "Safari on iPhone", or "Made-up data". */
  device?: string
  /** Made on this phone and not on the server yet. */
  pending?: boolean
  /** Who said it: this phone, or the server. Joined entries are the server's. A tracker's readings would be a third. */
  from: 'device' | 'server'
}

/** GET /api/stock/items/:id/log: newest first, a page at a time. */
export interface ItemLogPage {
  entries: ItemLogEntry[]
  /** Pass as `before` for the next, older page; absent at the start of the item's history. */
  next?: string
}

const inWords = (parts: string[]) => (parts.length < 2 ? (parts[0] ?? 'its details') : `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}`)
const at = (where: LogWhere) => (!where ? '' : 'place' in where ? ` at ${where.place}` : ` in ${where.case}`)

/** What an entry says, about the item: "Out to Nissan launch", "Moved to Bay A3". */
export function itemLogWords(e: ItemEvent): string {
  switch (e.kind) {
    case 'added':
      return `Added as ${e.number || 'a new item'}${at(e.where)}`
    case 'moved':
      if (!e.where) return 'Taken off where it was kept'
      return 'place' in e.where ? `Moved to ${e.where.place}` : `Put in ${e.where.case}`
    case 'relabelled':
      return `New label${e.number ? ` ${e.number}` : ''}${e.before ? `, replacing ${e.before}` : ''}`
    case 'edited':
      return `Changed ${inWords(e.changes)}`
    case 'out':
      return `Out to ${e.job}${e.inCase ? `, in ${e.inCase}` : ''}`
    case 'back':
      return `Back in from ${e.job}${e.inCase ? `, in ${e.inCase}` : ''}`
    case 'fault': {
      const note = e.note.trim() ? `: ${e.note.trim()}` : ''
      if (e.fault === 'missing') return `Reported missing${e.job ? ` from ${e.job}` : ''}${note}`
      return `Reported damaged${e.job ? ` back from ${e.job}` : ''}, ${e.usable ? 'fit to go out' : "can't go out"}${note}`
    }
    case 'repair': {
      const parts: string[] = []
      if (e.repair !== undefined) parts.push(e.repair.trim() ? `Repair notes: ${e.repair.trim()}` : 'Repair notes cleared')
      if (e.usable !== undefined) parts.push(e.usable ? 'Marked fit to go out' : "Marked as can't go out")
      if (e.note) parts.push("Changed what's wrong")
      return parts.join('; ') || 'Changed the fault'
    }
    case 'closed':
      if (e.outcome === 'written-off') return `Written off${e.fault === 'missing' ? ' as lost' : e.fault === 'damaged' ? ' as scrapped' : ''}`
      return { fixed: 'Marked fixed', 'not-faulty': 'Marked not faulty', found: 'Found' }[e.outcome]
    case 'test': {
      const by = e.by.trim() ? `, ${e.test === 'pat' ? 'tested' : 'examined'} by ${e.by.trim()}` : ''
      return `${e.passed ? 'Passed' : 'Failed'} its ${INSPECTION_SHORT[e.test]}${by}${e.note.trim() ? `: ${e.note.trim()}` : ''}`
    }
    case 'retired':
      if (e.reason === 'mistake') return 'Marked as added by mistake'
      return `Retired: ${RETIRED_LABELS[e.reason].toLowerCase()}${e.note.trim() ? ` (${e.note.trim()})` : ''}`
    case 'reinstated':
      return 'Brought back into stock'
  }
}

/** "SH-000200 (Amp rack)", as a case is named in the log. */
export const caseNamed = (c: { number: string; model?: { name: string } | undefined } | undefined) =>
  c ? `${c.number || 'a case'}${c.model ? ` (${c.model.name})` : ''}` : 'a case'

/** Where, as the log says it, from what a device holds. */
function whereOn(w: WarehouseView, x: Partial<Where>): LogWhere {
  if (x.placeId) return { place: w.places.find((p) => p.id === x.placeId)?.name ?? 'a place since removed' }
  if (x.caseId) return { case: caseNamed(w.assets.get(x.caseId)) }
  return null
}

/** What an item's details change said, as the history says it, for the log's "Changed …" (the server says it the same way). */
export function editWords(a: Partial<CommandArgs<'asset.update'>>, productName: (id: string) => string): string[] {
  const parts: string[] = []
  if (a.modelId !== undefined) parts.push(`its product to ${productName(a.modelId)}`)
  if (a.serial !== undefined) parts.push(a.serial.trim() ? `its serial to ${a.serial.trim()}` : 'its serial to none')
  if (a.oldNumber !== undefined) parts.push(a.oldNumber.trim() ? `its old number to ${a.oldNumber.trim()}` : 'its old number to none')
  if (a.patDue !== undefined) parts.push(a.patDue ? `its PAT due day to ${fullDayLabel(a.patDue)}` : 'its PAT due day to none')
  if (a.notes !== undefined) parts.push('its notes')
  return parts
}

/**
 * What this phone knows of an item's past, with no signal: its scans out and
 * back (and its case's), its faults and how they ended, its tests, and this
 * phone's own changes to it still waiting to sync. Not who did each, nor
 * when it was added, moved or relabelled: those are on the server.
 */
export function deviceItemLog(view: Pick<View, 'warehouse' | 'moves' | 'faults' | 'inspections' | 'jobs'>, assetId: string, waiting: readonly Mutation[] = []): ItemLogEntry[] {
  const w = view.warehouse
  const a = w.assets.get(assetId)
  if (!a) return []
  const jobs = new Map(view.jobs.jobs.map((j) => [j.id, j.name]))
  const job = (id: string) => jobs.get(id) ?? 'a job'
  const product = (id: string) => (w.models.find((m) => m.id === id) ?? w.mistakes.get(id))?.name ?? 'another product'
  const out: ItemLogEntry[] = []

  for (const m of view.moves.ofItem(assetId))
    out.push({
      key: `movement:${m.id}`,
      at: m.at,
      event: { kind: m.direction === 'out' ? 'out' : 'back', job: job(m.projectId), inCase: m.assetId === assetId ? null : caseNamed(w.assets.get(m.assetId!)) },
      pending: m.pending,
      from: 'device',
    })
  for (const f of view.faults.ofAsset(assetId)) {
    const closing = waiting.some((m) => m.name === 'fault.close' && (m.args as { id: string }).id === f.id)
    out.push({
      key: `fault:${f.id}`,
      at: f.at,
      event: { kind: 'fault', fault: f.kind, usable: f.usable, note: f.note, job: f.projectId ? job(f.projectId) : null },
      pending: waiting.some((m) => m.name === 'fault.report' && (m.args as { id: string }).id === f.id),
      from: 'device',
    })
    if (f.outcome && f.closedAt)
      out.push({ key: `closed:${f.id}`, at: f.closedAt, event: { kind: 'closed', fault: f.kind, outcome: f.outcome }, pending: closing, from: 'device' })
  }
  for (const i of view.inspections.ofAsset(assetId))
    out.push({ key: `inspection:${i.id}`, at: i.at, event: { kind: 'test', test: i.kind, passed: i.passed, by: i.by, note: i.note }, pending: i.pending, from: 'device' })

  // This phone's own changes to the item, said as they'll be once they sync.
  const faultIds = new Set(view.faults.ofAsset(assetId).map((f) => f.id))
  for (const m of waiting) {
    const event = waitingEvent(m, a.modelId, assetId, faultIds, w, product)
    if (event) out.push({ key: `mutation:${m.id}`, at: new Date(m.createdAt).toISOString(), event, pending: true, from: 'device' })
  }
  return newestFirst(out)
}

function waitingEvent(
  m: Mutation,
  modelId: string,
  assetId: string,
  faultIds: ReadonlySet<string>,
  w: WarehouseView,
  product: (id: string) => string
): ItemEvent | undefined {
  const args = m.args as { id?: string }
  switch (m.name) {
    case 'asset.add': {
      const a = m.args as CommandArgs<'asset.add'>
      return a.id === assetId ? { kind: 'added', number: (a.number !== null && normaliseNumber(a.number)) || '', where: whereOn(w, a) } : undefined
    }
    case 'asset.move': {
      const a = m.args as CommandArgs<'asset.move'>
      return a.id === assetId ? { kind: 'moved', where: whereOn(w, a) } : undefined
    }
    case 'asset.relabel': {
      const a = m.args as CommandArgs<'asset.relabel'>
      return a.id === assetId ? { kind: 'relabelled', number: (a.number !== null && normaliseNumber(a.number)) || '', before: null } : undefined
    }
    case 'asset.update':
      return args.id === assetId ? { kind: 'edited', changes: editWords(m.args as CommandArgs<'asset.update'>, product) } : undefined
    case 'asset.retire': {
      const a = m.args as CommandArgs<'asset.retire'>
      return a.id === assetId ? { kind: 'retired', reason: a.reason, note: a.note } : undefined
    }
    case 'asset.reinstate':
      return args.id === assetId ? { kind: 'reinstated' } : undefined
    case 'model.mistake':
      return args.id === modelId ? { kind: 'retired', reason: 'mistake', note: '' } : undefined
    case 'fault.update': {
      const a = m.args as CommandArgs<'fault.update'>
      return faultIds.has(a.id) ? { kind: 'repair', repair: a.repair, usable: a.usable, note: a.note !== undefined } : undefined
    }
    default:
      return undefined
  }
}

const newestFirst = (entries: ItemLogEntry[]) => entries.sort((a, b) => b.at.localeCompare(a.at) || b.key.localeCompare(a.key))

/**
 * The phone's part and the server's, as one log: an entry both have is the
 * server's, which knows who did it; the phone's own that the server doesn't
 * have yet stay, waiting; the server's the phone can't make fill in the rest.
 * Without the server's part, the phone's alone.
 */
export function joinItemLog(device: readonly ItemLogEntry[], server: readonly ItemLogEntry[] | undefined): ItemLogEntry[] {
  if (!server) return newestFirst([...device])
  const known = new Set(server.map((e) => e.key))
  return newestFirst([...server, ...device.filter((e) => !known.has(e.key))])
}
