import { departmentInWords, joinedPhaseName, kindOf, kitDaysOf, MAX_PHASE_DAYS, stepId, STOPPED, tailOf, type CommandArgs, type JobStep } from '@sh/shared'
import { cancelCall, moveCallsWithPhase } from '../crew/handlers.ts'
import { getCall, getCalls, getPerson, openCallsFor } from '../crew/store.ts'
import { emit, emitAll, emitRemoved, emitRemovedAll, Refused, type Ctx } from '../kernel.ts'
import { getKitLine, kitOnPhase } from '../stock/kit.ts'
import { getFault } from '../stock/faults.ts'
import { getMovement } from '../stock/moves.ts'
import { dayEntity, readDaysById } from '../calendar/store.ts'
import { getQuote } from '../finance/store.ts'
import { getClient, getPhase, getPhases, getProject, getVenue, namesForCall } from './store.ts'
import { getBooking, vehiclesOnPhase } from '../vehicles/store.ts'
import { getStep } from '../steps/store.ts'

/**
 * The job rules the server keeps, whichever device a change comes from
 * (ADR 0007):
 *
 * - jobs and phases change field by field, so two people changing
 *   different things both keep theirs;
 * - crew calls carry today's names for their job, phase and venue;
 * - stopping a job (cancelled, lost) cancels its crew calls with it;
 * - a phase with crew or kit still on it can't be removed;
 * - jobs a calendar brought in as several are made one with everything on
 *   them, and the others go (ADR 0050).
 */

type JobCommand = 'client.upsert' | 'venue.upsert' | 'venue.pin' | 'project.create' | 'project.update' | 'phase.add' | 'phase.update' | 'phase.remove' | 'project.merge'
type Handler<N extends JobCommand> = (ctx: Ctx, args: CommandArgs<N>) => Promise<void>

/** The columns each field of a job or phase is kept in. */
const PROJECT_COLUMNS = {
  name: 'name',
  clientId: 'client_id',
  venueId: 'venue_id',
  status: 'status',
  kind: 'kind',
  notes: 'notes',
  prepDays: 'prep_days',
  returnDays: 'return_days',
} as const
const PHASE_COLUMNS = { name: 'name', start: 'start_day', end: 'end_day', venueId: 'venue_id', notes: 'notes', contactId: 'contact_id', localCrew: 'local_crew' } as const

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

/** Job notes hold at most this much (ADR 0007). */
const JOB_NOTES = 4000

const tooLong = (start: string, end: string) => (Date.parse(end) - Date.parse(start)) / 86_400_000 + 1 > MAX_PHASE_DAYS

export const projectHandlers: { [N in JobCommand]: Handler<N> } = {
  async 'client.upsert'(ctx, a) {
    await ctx.tx.query(
      `INSERT INTO clients (id, name, contacts, notes) VALUES ($1, $2, $3, $4)
       ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, contacts = EXCLUDED.contacts, notes = EXCLUDED.notes`,
      [a.id, a.name, JSON.stringify(a.contacts), a.notes]
    )
    if (a.address !== undefined) await ctx.tx.query('UPDATE clients SET address = $2 WHERE id = $1', [a.id, a.address.trim()])
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

  /** On its own, so saving a venue's details from an older device leaves its pin where it is (ADR 0057). */
  async 'venue.pin'(ctx, a) {
    await checkVenue(ctx, a.id)
    await ctx.tx.query('UPDATE venues SET lat = $2, lng = $3 WHERE id = $1', [a.id, a.pin?.lat ?? null, a.pin?.lng ?? null])
    await emit(ctx, 'venue', a.id, await getVenue(ctx.tx, a.id))
  },

  async 'project.create'(ctx, a) {
    if (await getProject(ctx.tx, a.id)) throw new Refused({ code: 'conflict', message: 'This job already exists.' })
    await checkClient(ctx, a.clientId)
    await checkVenue(ctx, a.venueId)
    await ctx.tx.query(
      'INSERT INTO projects (id, name, client_id, venue_id, status, kind, notes, prep_days, return_days) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)',
      [a.id, a.name, a.clientId, a.venueId, a.status, kindOf(a), a.notes, kitDaysOf(a).prep, kitDaysOf(a).back]
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
      'INSERT INTO phases (id, project_id, name, start_day, end_day, venue_id, notes, contact_id, local_crew) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)',
      [a.id, a.projectId, a.name, a.start, a.end, a.venueId, a.notes, a.contactId ?? null, a.localCrew ?? 0]
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
    const vans = await vehiclesOnPhase(ctx.tx, a.id)
    if (vans.length)
      throw new Refused({
        code: 'conflict',
        message: `${phase.name} still has ${vans.length === 1 ? 'a vehicle' : 'vehicles'}: ${vans.join(', ')}. Put ${vans.length === 1 ? 'it' : 'them'} on the whole job or take ${vans.length === 1 ? 'it' : 'them'} off first.`,
      })
    // Its cancelled calls stay with the job, without the phase.
    const { rows: kept } = await ctx.tx.query<{ id: string }>('UPDATE crew_calls SET phase_id = NULL WHERE phase_id = $1 RETURNING id', [a.id])
    await ctx.tx.query('DELETE FROM phases WHERE id = $1', [a.id])
    await emitRemoved(ctx, 'phase', a.id)
    for (const { id } of kept) await emit(ctx, 'crewCall', id, await getCall(ctx.tx, id))
  },

  async 'project.merge'(ctx, a) {
    const into = await getProject(ctx.tx, a.id, true)
    if (!into) throw new Refused({ code: 'not-found', message: 'That job no longer exists.' })
    const from = []
    for (const id of a.from) {
      const job = await getProject(ctx.tx, id, true)
      if (!job) throw new Refused({ code: 'not-found', message: 'One of those jobs no longer exists. Look at the list again.' })
      from.push(job)
    }
    const all = [into, ...from]
    // A job brought in is left off the jobs calendar and one made in the app is written to it, so the two can't be one job.
    const made = all.find((j) => !j.sourceCalendar)
    const brought = all.find((j) => j.sourceCalendar)
    if (made && brought)
      throw new Refused({ code: 'conflict', message: `${made.name} was made in the app and ${brought.name} was brought in from Google Calendar, so they stay as separate jobs.` })
    const ids = from.map((j) => j.id)
    const { rows: quoted } = await ctx.tx.query<{ project_id: string }>('SELECT DISTINCT project_id FROM quotes WHERE project_id = ANY($1::text[]) ORDER BY project_id', [[a.id, ...ids]])
    if (quoted.length > 1)
      throw new Refused({ code: 'conflict', message: `${all.filter((j) => quoted.some((q) => q.project_id === j.id)).map((j) => j.name).join(' and ')} each have a quote. A job has one quote, so make them one by hand.` })

    // Each job's days keep what its name said: EP's "Smirnoff LX" Show is the phase Smirnoff LX, and its calls are for LX.
    const { rows: phaseRows } = await ctx.tx.query<{ id: string; project_id: string; name: string }>(
      'SELECT id, project_id, name FROM phases WHERE project_id = ANY($1::text[]) ORDER BY id',
      [[a.id, ...ids]]
    )
    for (const ph of phaseRows) {
      const job = all.find((j) => j.id === ph.project_id)!
      const name = joinedPhaseName(ph.name, tailOf(job.name, a.name), job.kind)
      if (name !== ph.name) await ctx.tx.query('UPDATE phases SET name = $2 WHERE id = $1', [ph.id, name])
    }
    for (const job of all) {
      const department = departmentInWords(tailOf(job.name, a.name))
      if (department) await ctx.tx.query('UPDATE crew_calls SET department = $2 WHERE project_id = $1 AND department IS NULL', [job.id, department])
    }

    // Everything on the others becomes this job's, told to devices as it moves.
    const move = async (table: string) =>
      (await ctx.tx.query<{ id: string }>(`UPDATE ${table} SET project_id = $1 WHERE project_id = ANY($2::text[]) RETURNING id`, [a.id, ids])).rows.map((r) => r.id).sort()
    await move('phases')
    await emitAll(ctx, 'phase', (await getPhases(ctx.tx, phaseRows.map((p) => p.id))).map((p) => ({ id: p.id, data: p })))
    await move('crew_calls')
    const kit = await move('kit_lines')
    for (const id of kit) await emit(ctx, 'kitLine', id, await getKitLine(ctx.tx, id))
    for (const id of await move('faults')) await emit(ctx, 'fault', id, await getFault(ctx.tx, id))
    for (const id of await move('movements')) await emit(ctx, 'movement', id, await getMovement(ctx.tx, id))
    for (const id of await move('vehicle_bookings')) await emit(ctx, 'vehicleBooking', id, await getBooking(ctx.tx, id))
    for (const id of await move('quotes')) await emit(ctx, 'quote', id, await getQuote(ctx.tx, id))
    // A job has one of each step (ADR 0073): this job's stays; a step only another had becomes this job's.
    const { rows: steps } = await ctx.tx.query<{ id: string; project_id: string; step: JobStep }>(
      'SELECT id, project_id, step FROM job_steps WHERE project_id = ANY($1::text[]) ORDER BY project_id = $2 DESC, done_at IS NULL, owner_id IS NULL, id',
      [ids, a.id]
    )
    const { rows: kept } = await ctx.tx.query<{ step: JobStep }>('SELECT step FROM job_steps WHERE project_id = $1', [a.id])
    const taken = new Set(kept.map((r) => r.step))
    for (const r of steps) {
      if (!taken.has(r.step)) {
        taken.add(r.step)
        const to = stepId(a.id, r.step)
        await ctx.tx.query('INSERT INTO job_steps (id, project_id, step, owner_id, done_at, done_by) SELECT $2, $3, step, owner_id, done_at, done_by FROM job_steps WHERE id = $1', [r.id, to, a.id])
        await emit(ctx, 'jobStep', to, await getStep(ctx.tx, to))
      }
      await ctx.tx.query('DELETE FROM job_steps WHERE id = $1', [r.id])
      await emitRemoved(ctx, 'jobStep', r.id)
    }
    const days = await move('calendar_days')
    if (days.length) for (const d of await readDaysById(ctx.tx, days)) await emit(ctx, 'calendarDay', d.id, dayEntity(d))
    await ctx.tx.query('UPDATE calendar_imports SET project_id = $1 WHERE project_id = ANY($2::text[])', [a.id, ids])
    // Their notes are joined below, so what was read of them for kit is read again.
    await ctx.tx.query('DELETE FROM kit_notes_read WHERE project_id = ANY($1::text[])', [[a.id, ...ids]])

    const notes = [...new Set(all.map((j) => j.notes.trim()).filter(Boolean))].join('\n\n')
    const cut = notes.length > JOB_NOTES ? `${notes.slice(0, JOB_NOTES - 1)}…` : notes
    const first = <T,>(pick: (j: (typeof all)[number]) => T | null | undefined) => all.map(pick).find((v) => v !== null && v !== undefined) ?? null
    await ctx.tx.query(
      'UPDATE projects SET name = $2, notes = $3, client_id = $4, venue_id = $5, prep_days = $6, return_days = $7 WHERE id = $1',
      [a.id, a.name, cut, first((j) => j.clientId), first((j) => j.venueId), Math.max(...all.map((j) => kitDaysOf(j).prep)), Math.max(...all.map((j) => kitDaysOf(j).back))]
    )
    await ctx.tx.query('DELETE FROM projects WHERE id = ANY($1::text[])', [ids])
    await emitRemovedAll(ctx, 'project', ids)
    await emit(ctx, 'project', a.id, await getProject(ctx.tx, a.id))
    // The calls carry the job's name and their phases' (renameCalls), and any department just given.
    await renameCalls(ctx, { projectId: a.id })
    const { rows: onJob } = await ctx.tx.query<{ id: string }>('SELECT id FROM crew_calls WHERE project_id = $1 ORDER BY id', [a.id])
    await emitAll(ctx, 'crewCall', (await getCalls(ctx.tx, onJob.map((r) => r.id))).map((c) => ({ id: c.id, data: c })))
  },
}
