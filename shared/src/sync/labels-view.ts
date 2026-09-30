import type { CommandArgs, Mutation } from '../commands.ts'
import { MAX_NUMBER, numberText, numberValue, type LabelEntities, type LabelRun } from '../labels.ts'
import type { WarehouseView } from './stock-view.ts'

/**
 * Labels (ADR 0015) on a device: the numbers set aside for printing, with
 * this person's own waiting changes laid over them, how many of each run's
 * labels are on items so far, and the next free number as far as this
 * device knows.
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
  /** Newest first; ones waiting to be set aside at the top. */
  runs: LabelRunView[]
  /** The next free number as far as this device knows: one after the highest used or set aside. The server has the last word. Empty once all are used. */
  next: string
  /** The run a number was set aside in, if any. */
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
  for (const r of Object.values(entities.labelRun ?? {})) runs.set(r.id, { ...r, pending: false })
  for (const m of outbox) {
    if (m.appliedSeq !== undefined && m.appliedSeq <= cursor) continue
    if (m.name === 'labels.reserve') {
      const a = m.args as CommandArgs<'labels.reserve'>
      if (!runs.has(a.id)) runs.set(a.id, { ...a, first: null, createdAt: m.createdAt, pending: true })
    } else if (m.name === 'labels.update') {
      const a = m.args as CommandArgs<'labels.update'>
      const found = runs.get(a.id)
      if (found) runs.set(a.id, { ...found, name: a.name ?? found.name, notes: a.notes ?? found.notes, pending: true })
    }
  }

  const views: LabelRunView[] = [...runs.values()].map((r) => ({
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

  let highest = 0
  for (const number of warehouse.byNumber.keys()) {
    const n = numberValue(number)
    highest = Math.max(highest, n)
    const run = runAt(n)
    if (run) run.used++
  }
  for (const r of placed) highest = Math.max(highest, r.first! + r.count - 1)

  return {
    runs: views.sort((a, b) => Number(b.pending) - Number(a.pending) || b.createdAt.localeCompare(a.createdAt) || (b.first ?? 0) - (a.first ?? 0)),
    next: highest < MAX_NUMBER ? numberText(highest + 1) : '',
    runOf: (number: string) => runAt(numberValue(number)),
  }
}
