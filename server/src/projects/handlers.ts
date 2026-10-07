import { kitDaysOf, MAX_PHASE_DAYS, STOPPED, type CommandArgs } from '@sh/shared'
import { cancelCall, moveCallsWithPhase } from '../crew/handlers.ts'
import { getCall, getPerson, openCallsFor } from '../crew/store.ts'
import { emit, emitRemoved, Refused, type Ctx } from '../kernel.ts'
import { kitOnPhase } from '../stock/kit.ts'
import { getClient, getPhase, getProject, getVenue, namesForCall } from './store.ts'

/**
 * The job rules the server keeps, whichever device a change comes from
 * (ADR 0007):
 *
 * - jobs and phases change field by field, so two people changing
 *   different things both keep theirs;
 * - crew calls carry today's names for their job, phase and venue;
 * - stopping a job (cancelled, lost) cancels its crew calls with it;
 * - a phase with crew or kit still on it can't be removed.
 */

type JobCommand = 'client.upsert' | 'venue.upsert' | 'project.create' | 'project.update' | 'phase.add' | 'phase.update' | 'phase.remove'
type Handler<N extends JobCommand> = (ctx: Ctx, args: CommandArgs<N>) => Promise<void>

/** The columns each field of a job or phase is kept in. */
const PROJECT_COLUMNS = {
  name: 'name',
  clientId: 'client_id',
  venueId: 'venue_id',
  status: 'status',
  notes: 'notes',
  prepDays: 'prep_days',
  returnDays: 'return_days',
} as const
const PHASE_COLUMNS = { name: 'name', start: 'start_day', end: 'end_day', venueId: 'venue_id', notes: 'notes', contactId: 'contact_id' } as const

/** Set only the fields given; the rest stay as they are. */
async function setFields(ctx: Ctx, table: 'projects' | 'phases', columns: Record<string, string>, a: { id: string } & Record<string, unknown>) {
  const fields = Object.keys(columns).filter((k) => a[k] !== undefined)
  await ctx.tx.query(
    `UPDATE ${table} SET ${fields.map((k, i) => `${columns[k]} = $${i + 2}`).join(', ')} WHERE id = $1`,
    [a.id, ...fields.map((k) => a[k])]
  )
}

async function checkClient(ctx: Ctx, id: string | null | undefined) {
  if (id && !(await getClient(ctx.tx, id))) throw new Refused({ code: 'not-found', message: 'That client no longer exists.' })
}
async function checkVenue(ctx: Ctx, id: string | null | undefined) {
  if (id && !(await getVenue(ctx.tx, id))) throw new Refused({ code: 'not-found', message: 'That venue no longer exists.' })
}
async function checkContact(ctx: Ctx, id: string | null | undefined) {
  if (!id) return
  const person = await getPerson(ctx.tx, id)
  if (!person) throw new Refused({ code: 'not-found', message: "That person isn't in the app any more." })
  // Someone who has left can't be the contact on the day; a phase that already names them keeps them until it's changed.
  if (person.archived) throw new Refused({ code: 'conflict', message: `${person.name} has been archived; pick someone else as the contact.` })
}

/**
 * Keep the names on crew calls in step with their job, its phases and the
 * venues they use, so freelancers' pages, offer messages and calendar feeds
 * say what the job is called today.
 */
async function renameCalls(ctx: Ctx, by: { projectId: string } | { phaseId: string } | { venueId: string }) {
  const [where, value] =
    'projectId' in by
      ? ['c.project_id = $1', by.projectId]
      : 'phaseId' in by
        ? ['c.phase_id = $1', by.phaseId]
        : ['coalesce(ph.venue_id, p.venue_id) = $1', by.venueId]
  const { rows } = await ctx.tx.query<{ id: string; project_id: string; phase_id: string | null }>(
    `SELECT c.id, c.project_id, c.phase_id
       FROM crew_calls c
       JOIN projects p ON p.id = c.project_id
       LEFT JOIN phases ph ON ph.id = c.phase_id
      WHERE ${where}
      ORDER BY c.id`,
    [value]
  )
  for (const r of rows) {
    const [names, call] = [await namesForCall(ctx.tx, r.project_id, r.phase_id), await getCall(ctx.tx, r.id)]
    if (!names || !call) continue
    const next = { project: names.project, phase: names.phase ?? call.phase, venue: names.venue ?? call.venue }
    if (next.project === call.project && next.phase === call.phase && next.venue === call.venue) continue
    await ctx.tx.query('UPDATE crew_calls SET project = $2, phase = $3, venue = $4 WHERE id = $1', [r.id, next.project, next.phase, next.venue])
    await emit(ctx, 'crewCall', r.id, await getCall(ctx.tx, r.id))
  }
}

const tooLong = (start: string, end: string) => (Date.parse(end) - Date.parse(start)) / 86_400_000 + 1 > MAX_PHASE_DAYS

export const projectHandlers: { [N in JobCommand]: Handler<N> } = {
  async 'client.upsert'(ctx, a) {
    await ctx.tx.query(
      `INSERT INTO clients (id, name, contacts, notes) VALUES ($1, $2, $3, $4)
       ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, contacts = EXCLUDED.contacts, notes = EXCLUDED.notes`,
      [a.id, a.name, JSON.stringify(a.contacts), a.notes]
    )
    await emit(ctx, 'client', a.id, await getClient(ctx.tx, a.id))
  },

  async 'venue.upsert'(ctx, a) {
    await ctx.tx.query(
      `INSERT INTO venues (id, name, address, notes) VALUES ($1, $2, $3, $4)
       ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, address = EXCLUDED.address, notes = EXCLUDED.notes`,
      [a.id, a.name, a.address, a.notes]
    )
    await emit(ctx, 'venue', a.id, await getVenue(ctx.tx, a.id))
    await renameCalls(ctx, { venueId: a.id })
  },

  async 'project.create'(ctx, a) {
    if (await getProject(ctx.tx, a.id)) throw new Refused({ code: 'conflict', message: 'This job already exists.' })
    await checkClient(ctx, a.clientId)
    await checkVenue(ctx, a.venueId)
    await ctx.tx.query(
      'INSERT INTO projects (id, name, client_id, venue_id, status, notes, prep_days, return_days) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
      [a.id, a.name, a.clientId, a.venueId, a.status, a.notes, kitDaysOf(a).prep, kitDaysOf(a).back]
    )
    await emit(ctx, 'project', a.id, await getProject(ctx.tx, a.id))
  },

  async 'project.update'(ctx, a) {
    const before = await getProject(ctx.tx, a.id, true)
    if (!before) throw new Refused({ code: 'not-found', message: 'That job no longer exists.' })
    await checkClient(ctx, a.clientId)
    await checkVenue(ctx, a.venueId)
    await setFields(ctx, 'projects', PROJECT_COLUMNS, a)
    await emit(ctx, 'project', a.id, await getProject(ctx.tx, a.id))
    if (a.name !== undefined || a.venueId !== undefined) await renameCalls(ctx, { projectId: a.id })
    // Stopping a job takes its crew with it; starting it again doesn't bring them back.
    if (a.status && STOPPED.includes(a.status) && !STOPPED.includes(before.status))
      for (const c of await openCallsFor(ctx.tx, { projectId: a.id })) await cancelCall(ctx, c.id)
  },

  async 'phase.add'(ctx, a) {
    if (await getPhase(ctx.tx, a.id)) throw new Refused({ code: 'conflict', message: 'This phase already exists.' })
    if (!(await getProject(ctx.tx, a.projectId))) throw new Refused({ code: 'not-found', message: 'That job no longer exists.' })
    await checkVenue(ctx, a.venueId)
    await checkContact(ctx, a.contactId)
    await ctx.tx.query(
      'INSERT INTO phases (id, project_id, name, start_day, end_day, venue_id, notes, contact_id) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
      [a.id, a.projectId, a.name, a.start, a.end, a.venueId, a.notes, a.contactId ?? null]
    )
    await emit(ctx, 'phase', a.id, await getPhase(ctx.tx, a.id))
  },

  async 'phase.update'(ctx, a) {
    const before = await getPhase(ctx.tx, a.id)
    if (!before) throw new Refused({ code: 'not-found', message: 'That phase no longer exists.' })
    // One end may have moved on another device, so check the phase as it will be.
    const start = a.start ?? before.start
    const end = a.end ?? before.end
    if (start > end) throw new Refused({ code: 'invalid', message: `${before.name} would end before it starts.` })
    if (tooLong(start, end)) throw new Refused({ code: 'invalid', message: `A phase can be at most ${MAX_PHASE_DAYS} days.` })
    await checkVenue(ctx, a.venueId)
    await checkContact(ctx, a.contactId)
    await setFields(ctx, 'phases', PHASE_COLUMNS, a)
    await emit(ctx, 'phase', a.id, await getPhase(ctx.tx, a.id))
    if (a.name !== undefined || a.venueId !== undefined) await renameCalls(ctx, { phaseId: a.id })
    // Asked to, the phase takes its crew with it: its open calls move by the same shift, and their offers' days too.
    if (a.moveCrew && (start !== before.start || end !== before.end)) await moveCallsWithPhase(ctx, a.id, before, { start, end })
  },

  async 'phase.remove'(ctx, a) {
    const phase = await getPhase(ctx.tx, a.id)
    if (!phase) return
    const open = await openCallsFor(ctx.tx, { phaseId: a.id })
    if (open.length)
      throw new Refused({
        code: 'conflict',
        message: `${phase.name} still has crew: ${open.map((c) => `${c.needed} × ${c.role}`).join(', ')}. Cancel ${open.length === 1 ? 'that' : 'those'} first.`,
      })
    const kit = await kitOnPhase(ctx.tx, a.id)
    if (kit.length)
      throw new Refused({
        code: 'conflict',
        message: `${phase.name} still has kit: ${kit.join(', ')}. Put ${kit.length === 1 ? 'it' : 'them'} on the whole job or take ${kit.length === 1 ? 'it' : 'them'} off first.`,
      })
    // Its cancelled calls stay with the job, without the phase.
    const { rows: kept } = await ctx.tx.query<{ id: string }>('UPDATE crew_calls SET phase_id = NULL WHERE phase_id = $1 RETURNING id', [a.id])
    await ctx.tx.query('DELETE FROM phases WHERE id = $1', [a.id])
    await emitRemoved(ctx, 'phase', a.id)
    for (const { id } of kept) await emit(ctx, 'crewCall', id, await getCall(ctx.tx, id))
  },
}
