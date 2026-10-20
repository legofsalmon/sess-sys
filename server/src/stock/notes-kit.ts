import { kitNameId, MAX_QTY, type CommandArgs, type KitName, type NotesRead } from '@sh/shared'
import { emitAll, Refused, type Ctx } from '../kernel.ts'
import { toKitLine } from './kit.ts'

/**
 * Kit read from jobs' notes (ADR 0043), for one job or many at once. Each
 * device reads the notes and matches them; the server keeps the same rules
 * as for kit typed in (ADR 0014), for every line, in one go: the jobs, the
 * phases (of those jobs) and the products must exist, and no line goes over
 * what a line can hold.
 *
 * Each line says how many of a product the job should have for exactly
 * those days, never how many to add, so only what's missing goes in: onto
 * the line already there (the first, by id) or as a new one. The same notes
 * twice change nothing, even from two phones that read them with no signal.
 *
 * A season of jobs is hundreds of lines, so each step is one statement for
 * them all rather than a round trip a line, as the calendar's bring-in
 * learned (ADR 0011).
 */

const KIT = `id, project_id, phase_id, model_id, qty, subhire_qty, supplier, notes`

/** Rows in one statement, at most this many at a time. */
const CHUNK = 400

async function insertMany(ctx: Ctx, table: string, columns: string[], rows: unknown[][], suffix = '') {
  for (let at = 0; at < rows.length; at += CHUNK) {
    const chunk = rows.slice(at, at + CHUNK)
    const values = chunk.map((_, i) => `(${columns.map((_, j) => `$${i * columns.length + j + 1}`).join(', ')})`).join(', ')
    await ctx.tx.query(`INSERT INTO ${table} (${columns.join(', ')}) VALUES ${values} ${suffix}`, chunk.flat())
  }
}

/**
 * Which jobs have gone, by name, from the last the change feed said of each: combined into another, say, while the
 * notes waited on a phone with no signal (audit, P3: words). Unnamed only when the feed no longer has it.
 */
async function goneJobs(ctx: Ctx, projectIds: string[], found: { id: string }[]): Promise<string> {
  const here = new Set(found.map((p) => p.id))
  const gone = projectIds.filter((id) => !here.has(id))
  const { rows } = await ctx.tx.query<{ name: string | null }>(
    `SELECT DISTINCT ON (entity_id) data->>'name' AS name FROM changes
      WHERE entity = 'project' AND entity_id = ANY($1::text[]) AND op = 'put' ORDER BY entity_id, seq DESC`,
    [gone]
  )
  const names = rows.map((r) => r.name).filter((n): n is string => !!n)
  const all = projectIds.length === 1 ? 'nothing was added' : 'nothing was added for any of these jobs'
  if (names.length === 0) return `${projectIds.length === 1 ? 'That job no longer exists' : 'One of these jobs no longer exists'}, so ${all}. Look again at what's left.`
  const named = names.length === 1 ? names[0]! : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`
  return `${named} ${names.length === 1 ? 'is' : 'are'} no longer on the jobs list (combined into another job, or deleted), so ${all}. Look again at what's left.`
}

export const notesKitHandlers = {
  async 'kit.fromNotes'(ctx: Ctx, a: CommandArgs<'kit.fromNotes'>) {
    const projectIds = a.jobs.map((j) => j.projectId)
    const lines = a.jobs.flatMap((j) => j.lines.map((l) => ({ ...l, projectId: j.projectId })))

    const { rows: projects } = await ctx.tx.query<{ id: string; name: string }>(`SELECT id, name FROM projects WHERE id = ANY($1::text[])`, [projectIds])
    if (projects.length < projectIds.length) throw new Refused({ code: 'not-found', message: await goneJobs(ctx, projectIds, projects) })

    const phaseIds = [...new Set(lines.map((l) => l.phaseId).filter((p): p is string => p !== null))]
    const { rows: phases } = await ctx.tx.query<{ id: string; project_id: string; name: string }>(`SELECT id, project_id, name FROM phases WHERE id = ANY($1::text[])`, [phaseIds])
    const phaseById = new Map(phases.map((p) => [p.id, p]))
    for (const l of lines) {
      if (!l.phaseId) continue
      const p = phaseById.get(l.phaseId)
      if (!p) throw new Refused({ code: 'not-found', message: 'A phase whose notes these were no longer exists, so nothing was added. Look again at what the notes say now.' })
      if (p.project_id !== l.projectId) throw new Refused({ code: 'invalid', message: `${p.name} is part of another job.` })
    }

    const modelIds = [...new Set(lines.map((l) => l.modelId))]
    const { rows: models } = await ctx.tx.query<{ id: string; name: string; mistake: boolean }>(`SELECT id, name, mistake FROM models WHERE id = ANY($1::text[])`, [modelIds])
    const modelById = new Map(models.map((m) => [m.id, m]))
    for (const id of modelIds) {
      const m = modelById.get(id)
      if (!m) throw new Refused({ code: 'not-found', message: 'A product chosen for these notes is no longer in the stock list, so nothing was added. Choose another.' })
      if (m.mistake) throw new Refused({ code: 'conflict', message: `${m.name} was added by mistake, so it can't go on a job's kit. Choose another.` })
    }

    // What the jobs have now, for exactly each line's days. Locked, so a change to them waits for this one.
    const { rows: had } = await ctx.tx.query(`SELECT ${KIT} FROM kit_lines WHERE project_id = ANY($1::text[]) ORDER BY id FOR UPDATE`, [projectIds])
    const existing = had.map(toKitLine)
    const fresh: unknown[][] = []
    const raised = new Map<string, number>()
    for (const l of lines) {
      const same = existing.filter((k) => k.projectId === l.projectId && k.phaseId === l.phaseId && k.modelId === l.modelId)
      const has = same.reduce((n, k) => n + k.qty, 0)
      if (has >= l.qty) continue
      const first = same[0]
      if (first) raised.set(first.id, first.qty + l.qty - has)
      else fresh.push([l.id, l.projectId, l.phaseId, l.modelId, l.qty, 0, '', l.notes.trim()])
    }
    const taken = await ctx.tx.query(`SELECT 1 FROM kit_lines WHERE id = ANY($1::text[]) LIMIT 1`, [fresh.map((r) => r[0])])
    if (taken.rows.length) throw new Refused({ code: 'conflict', message: 'This kit is already on the job.' })
    for (const qty of raised.values()) if (qty > MAX_QTY) throw new Refused({ code: 'invalid', message: `That would make ${qty.toLocaleString('en-IE')}, more than a line can hold.` })

    await insertMany(ctx, 'kit_lines', ['id', 'project_id', 'phase_id', 'model_id', 'qty', 'subhire_qty', 'supplier', 'notes'], fresh)
    for (const [id, qty] of raised) await ctx.tx.query('UPDATE kit_lines SET qty = $2 WHERE id = $1', [id, qty])
    const changed = [...fresh.map((r) => r[0] as string), ...raised.keys()]
    if (changed.length) {
      const { rows } = await ctx.tx.query(`SELECT ${KIT} FROM kit_lines WHERE id = ANY($1::text[]) ORDER BY id`, [changed])
      await emitAll(ctx, 'kitLine', rows.map((r) => ({ id: r.id as string, data: toKitLine(r) })))
    }

    // The names to remember, by the id each device makes from the name: the last said for one name stands.
    const names = new Map<string, KitName>()
    for (const n of a.names) names.set(kitNameId(n.text), { id: kitNameId(n.text), text: n.text.trim(), modelId: n.modelId })
    const more = [...new Set([...names.values()].map((n) => n.modelId).filter((m): m is string => m !== null && !modelById.has(m)))]
    if (more.length) for (const m of (await ctx.tx.query<{ id: string; name: string; mistake: boolean }>(`SELECT id, name, mistake FROM models WHERE id = ANY($1::text[])`, [more])).rows) modelById.set(m.id, m)
    for (const n of names.values()) {
      const known = n.modelId === null ? undefined : modelById.get(n.modelId)
      if (n.modelId !== null && (!known || known.mistake)) throw new Refused({ code: 'not-found', message: `The product chosen for “${n.text}” is no longer in the stock list. Choose another.` })
    }
    if (names.size) {
      const list = [...names.values()]
      await insertMany(ctx, 'kit_names', ['id', 'text', 'model_id'], list.map((n) => [n.id, n.text, n.modelId]), 'ON CONFLICT (id) DO UPDATE SET model_id = EXCLUDED.model_id')
      const { rows } = await ctx.tx.query<{ id: string; text: string; model_id: string | null }>(`SELECT id, text, model_id FROM kit_names WHERE id = ANY($1::text[]) ORDER BY id`, [list.map((n) => n.id)])
      await emitAll(ctx, 'kitName', rows.map((r) => ({ id: r.id, data: { id: r.id, text: r.text, modelId: r.model_id } satisfies KitName })))
    }

    // Each job's notes, as they were read.
    await insertMany(ctx, 'kit_notes_read', ['project_id', 'sum'], a.jobs.map((j) => [j.projectId, j.sum]), 'ON CONFLICT (project_id) DO UPDATE SET sum = EXCLUDED.sum, read_at = now()')
    await emitAll(ctx, 'notesRead', a.jobs.map((j) => ({ id: j.projectId, data: { id: j.projectId, sum: j.sum } satisfies NotesRead })))
  },
}
