import type { CommandArgs, Mutation } from '../commands.ts'
import { newId } from '../ids.ts'
import { STOPPED } from '../jobs.ts'
import { kitNameId, matcherFor, noteRows, notesPlan, notesSum, type KitName, type KitOnJob, type NoteRow, type NotesKitEntities, type NotesPlan, type NotesRead } from '../kit-notes.ts'
import type { JobsView, JobView } from './jobs-view.ts'
import type { KitView } from './kit-view.ts'
import type { WarehouseView } from './stock-view.ts'

/**
 * Kit in jobs' notes (ADR 0043), worked out on a device from what it holds:
 * each job's notes read for lines of kit, matched to the stock list with
 * the names remembered from before, and what that would put on the job.
 * Reading every job's notes is left until a screen asks, as most screens
 * never do.
 */

export interface JobNotesKit {
  job: JobView
  rows: NoteRow[]
  /** What its notes say now, as `notesSum`. */
  sum: string
  /** Read and turned into kit with its notes as they are now. */
  read: boolean
  /** What it would do with nothing chosen yet. */
  plan: NotesPlan
  /** The kit on the job now, by phase and product. */
  kit: KitOnJob[]
}

export interface NotesKitView {
  /** Names the notes use, remembered against a product or as not kit, by id. */
  names: ReadonlyMap<string, KitName & { pending: boolean }>
  /** Jobs whose notes have been turned into kit, by job. */
  read: ReadonlyMap<string, NotesRead & { pending: boolean }>
  /** A job's notes read for kit; undefined when they hold none. */
  forJob(jobId: string): JobNotesKit | undefined
  /**
   * The jobs to work through: notes holding kit that isn't on the job yet,
   * or a line to choose a product for, and not turned into kit since they
   * last changed. Not jobs cancelled or lost. Coming up first, soonest
   * first; then those gone by, latest first; then those with no dates.
   */
  readonly toDo: JobNotesKit[]
  /** Of those, the ones with nothing to check: every line matched by its name or as chosen before, or already on the job. */
  readonly ready: JobNotesKit[]
}

type Tables = { [E in keyof NotesKitEntities]: Record<string, NotesKitEntities[E]> }

export function notesKitView(
  entities: Partial<Tables>,
  outbox: readonly (Mutation & { appliedSeq?: number })[],
  cursor: number,
  jobs: JobsView,
  warehouse: WarehouseView,
  kit: KitView,
  today: string
): NotesKitView {
  const names = new Map<string, KitName & { pending: boolean }>()
  for (const n of Object.values(entities.kitName ?? {})) names.set(n.id, { ...n, pending: false })
  const read = new Map<string, NotesRead & { pending: boolean }>()
  for (const r of Object.values(entities.notesRead ?? {})) read.set(r.id, { ...r, pending: false })
  for (const m of outbox) {
    if (m.appliedSeq !== undefined && m.appliedSeq <= cursor) continue
    if (m.name !== 'kit.fromNotes') continue
    const a = m.args as CommandArgs<'kit.fromNotes'>
    for (const n of a.names) {
      const id = kitNameId(n.text)
      names.set(id, { id, text: names.get(id)?.text ?? n.text, modelId: n.modelId, pending: true })
    }
    for (const j of a.jobs) read.set(j.projectId, { id: j.projectId, sum: j.sum, pending: true })
  }

  const inStock = new Set(warehouse.models.map((m) => m.id))
  const has = (modelId: string) => inStock.has(modelId)
  let matcher: ReturnType<typeof matcherFor> | undefined
  const byJob = new Map<string, JobNotesKit | undefined>()

  const forJob = (jobId: string): JobNotesKit | undefined => {
    if (byJob.has(jobId)) return byJob.get(jobId)
    const job = jobs.jobs.find((j) => j.id === jobId)
    let out: JobNotesKit | undefined
    if (job) out = build(job)
    byJob.set(jobId, out)
    return out
  }
  const build = (job: JobView): JobNotesKit | undefined => {
    if (!job.notes.trim() && !job.phases.some((p) => p.notes.trim())) return undefined
    matcher ??= matcherFor(warehouse.models)
    const rows = noteRows(job, job.phases, matcher, names, has)
    if (rows.length === 0) return undefined
    const sum = notesSum(job, job.phases)
    const kitNow: KitOnJob[] = (kit.byJob.get(job.id) ?? []).map((l) => ({ phaseId: l.phaseId, modelId: l.modelId, qty: l.qty }))
    return { job, rows, sum, read: read.get(job.id)?.sum === sum, plan: notesPlan(rows, kitNow, {}, newId), kit: kitNow }
  }

  let toDo: JobNotesKit[] | undefined
  let ready: JobNotesKit[] | undefined
  const listToDo = () => {
    if (toDo) return toDo
    const found: JobNotesKit[] = []
    for (const job of jobs.jobs) {
      if (STOPPED.includes(job.status)) continue
      const n = forJob(job.id)
      if (n && !n.read && (n.plan.adding > 0 || n.plan.choosing > 0)) found.push(n)
    }
    // Coming up, soonest first; then gone by, latest first; then no dates.
    const rank = (n: JobNotesKit) => (!n.job.span ? 2 : n.job.span.end >= today ? 0 : 1)
    toDo = found.sort((a, b) => {
      const ra = rank(a)
      const rb = rank(b)
      if (ra !== rb) return ra - rb
      if (ra === 0) return a.job.span!.start.localeCompare(b.job.span!.start) || a.job.name.localeCompare(b.job.name)
      if (ra === 1) return b.job.span!.end.localeCompare(a.job.span!.end) || a.job.name.localeCompare(b.job.name)
      return a.job.name.localeCompare(b.job.name)
    })
    return toDo
  }

  return {
    names,
    read,
    forJob,
    get toDo() {
      return listToDo()
    },
    get ready() {
      return (ready ??= listToDo().filter((n) => n.plan.checking === 0 && n.plan.choosing === 0 && n.plan.adding > 0))
    },
  }
}
