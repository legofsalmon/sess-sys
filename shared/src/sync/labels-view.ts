import type { CommandArgs, Mutation } from '../commands.ts'
import { MAX_NUMBER, numberText, numberValue, type LabelEntities, type LabelRun } from '../labels.ts'
import type { WarehouseView } from './stock-view.ts'

/**
 * Labels (ADR 0015) on a device: the numbers set aside for printing, with
 * this person's own waiting changes laid over them, how many of each run's
 * labels are on items so far, and the next free number as far as this
 * device knows. A cancelled run is off the list, but its numbers still
 * count as set aside, since they're never given out again.
 */

export interface LabelRunView extends LabelRun {
  pending: boolean
  /** "SH-000101", or empty until the server has set the numbers aside. */
  firstNumber: string
  /** "SH-000600", or empty as above. */
  lastNumber: string
  /** How many of its numbers are on items, or were before a new label replaced them. */
  used: number
}

export interface LabelsView {
  /** Newest first; ones waiting to be set aside at the top. Not the cancelled ones. */
  runs: LabelRunView[]
  /** The next free number as far as this device knows: one after the highest used or set aside, cancelled runs too. The server has the last word. Empty once all are used. */
  next: string
  /** The run on the list a number was set aside in, if any. */
  runOf(number: string): LabelRunView | undefined
}

type Tables = { [E in keyof LabelEntities]: Record<string, LabelEntities[E]> }

export function labelsView(
  entities: Partial<Tables>,
  outbox: readonly (Mutation & { appliedSeq?: number })[],
  cursor: number,
  warehouse: WarehouseView
): LabelsView {
  const runs = new Map<string, LabelRun & { pending: boolean }>()
  // Runs saved before audit finding 19 have no cancelled flag yet.
  for (const r of Object.values(entities.labelRun ?? {})) runs.set(r.id, { ...r, cancelled: r.cancelled ?? false, pending: false })
  for (const m of outbox) {
    if (m.appliedSeq !== undefined && m.appliedSeq <= cursor) continue
    if (m.name === 'labels.reserve') {
      const a = m.args as CommandArgs<'labels.reserve'>
      if (!runs.has(a.id)) runs.set(a.id, { ...a, first: null, createdAt: m.createdAt, cancelled: false, pending: true })
    } else if (m.name === 'labels.update') {
      const a = m.args as CommandArgs<'labels.update'>
      const found = runs.get(a.id)
      if (found) runs.set(a.id, { ...found, name: a.name ?? found.name, notes: a.notes ?? found.notes, pending: true })
    } else if (m.name === 'labels.cancel') {
      const found = runs.get((m.args as CommandArgs<'labels.cancel'>).id)
      if (found) runs.set(found.id, { ...found, cancelled: true, pending: true })
    }
  }

  // A cancelled run's numbers are never given out again, so they still raise the next free number.
  let highest = 0
  for (const r of runs.values()) if (r.first !== null) highest = Math.max(highest, r.first + r.count - 1)

  const views: LabelRunView[] = [...runs.values()]
    .filter((r) => !r.cancelled)
    .map((r) => ({
      ...r,
      firstNumber: r.first === null ? '' : numberText(r.first),
      lastNumber: r.first === null ? '' : numberText(r.first + r.count - 1),
      used: 0,
    }))
  const placed = views.filter((r) => r.first !== null).sort((a, b) => a.first! - b.first!)
  /** The run holding a number: runs never overlap, so the last one starting at or before it. */
  const runAt = (n: number) => {
    let lo = 0
    let hi = placed.length - 1
    let found: LabelRunView | undefined
    while (lo <= hi) {
      const mid = (lo + hi) >> 1
      if (placed[mid]!.first! <= n) {
        found = placed[mid]
        lo = mid + 1
      } else hi = mid - 1
    }
    return found && n < found.first! + found.count ? found : undefined
  }

  for (const number of warehouse.byNumber.keys()) {
    const n = numberValue(number)
    highest = Math.max(highest, n)
    const run = runAt(n)
    if (run) run.used++
  }

  return {
    runs: views.sort((a, b) => Number(b.pending) - Number(a.pending) || b.createdAt.localeCompare(a.createdAt) || (b.first ?? 0) - (a.first ?? 0) || a.id.localeCompare(b.id)),
    next: highest < MAX_NUMBER ? numberText(highest + 1) : '',
    runOf: (number: string) => runAt(numberValue(number)),
  }
}
