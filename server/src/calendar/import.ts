import {
  addDays,
  isDay,
  newId,
  type GuestResponse,
  type ImportCalendar,
  type ImportJob,
  type ImportPreview,
  type ImportResult,
} from '@sh/shared'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { z } from 'zod'
import { crewHandlers } from '../crew/handlers.ts'
import { getOffer } from '../crew/store.ts'
import type { Db, Queryable } from '../db.ts'
import { describeDevice } from '../devices.ts'
import { emit, Refused, serverChange, type Ctx } from '../kernel.ts'
import { projectHandlers } from '../projects/handlers.ts'
import { getProject } from '../projects/store.ts'
import type { GoogleEvent } from './google.ts'
import { GAP_DAYS, planImport, type AppData, type Plan, type PlanJob, type PlanRun, type SourceEvent, type VenueRef } from './import-plan.ts'
import { Halt, type CalendarSync } from './sync.ts'

/**
 * Bringing the jobs already on the organisers' Google calendars into the
 * app (ADR 0011): the calendars the connected account can see, a look at
 * what one of them holds as jobs, and bringing in what the office ticked.
 * Looking changes nothing anywhere; bringing in reads the calendar again
 * and saves it all in one go, as one entry in the history. Nothing is
 * ever written to Google, and nobody is emailed.
 */

/** What the history records bringing jobs in as. Not a command, so no device can send it. */
export const IMPORT_ACTION = 'calendar.import'

/** How far back a look can start, and how far ahead it reads. */
const YEARS_BACK = 5
const DAYS_AHEAD = 2 * 366

/** Where a person added from the guests came from, for their notes. */
const PERSON_NOTE = 'Added from the guests on Google Calendar.'

const day = z.string().refine(isDay, 'Choose the first day to bring jobs in from.')
const lookBody = z.object({ calendarId: z.string().min(1, 'Choose a calendar.').max(1024), from: day })
const bringBody = lookBody.extend({
  jobs: z.array(z.object({ key: z.string().min(1).max(400), name: z.string().max(200), include: z.boolean() })).max(5000),
  people: z.array(z.object({ email: z.string().max(320), include: z.boolean() })).max(5000),
})

export interface ImportRoutes {
  db: Db
  sync: CalendarSync | undefined
  /** Devices have something new to pull. */
  onChange: () => void
}

/** The days looked at: from the day chosen to two years ahead, or why not. */
function window(from: string, today: string) {
  const to = addDays(today, DAYS_AHEAD)
  if (from < addDays(today, -YEARS_BACK * 366)) return `Jobs can be brought in from at most ${YEARS_BACK} years back.`
  if (from >= to) return 'Choose a day before two years from now.'
  return { from, to, times: { timeMin: `${from}T00:00:00Z`, timeMax: `${to}T00:00:00Z` } }
}

/** An event as the plan reads it. The app's own events carry its mark (ADR 0008); a repeating one's days share one id, so each keeps its own. */
export function sourceEvent(ev: GoogleEvent): SourceEvent {
  const start = ev.start?.date
  const endAfter = ev.end?.date
  const last = start && endAfter ? addDays(endAfter, -1) : undefined
  return {
    id: ev.id,
    uid: ev.recurringEventId ? ev.id : (ev.iCalUID ?? ev.id),
    cancelled: ev.status === 'cancelled',
    title: ev.summary ?? '',
    days: start && last ? { start, end: last < start ? start : last } : null,
    location: ev.location ?? '',
    description: ev.description ?? '',
    guests: (ev.attendees ?? [])
      .filter((a) => a.email)
      .map((a) => ({
        email: a.email,
        name: a.displayName ?? null,
        answer: a.responseStatus ?? 'needsAction',
        notCrew: a.organizer === true || a.self === true || a.resource === true,
      })),
    repeating: ev.recurringEventId !== undefined,
    special: ev.eventType !== undefined && ev.eventType !== 'default',
    ours: ev.extendedProperties?.private?.sh !== undefined,
  }
}

/** What the app already holds that events could match: everyone still here, every venue, jobs near those days, and what came in before. Exported for the tests. */
export async function readApp(q: Queryable, from: string, to: string): Promise<AppData> {
  // One after another: inside a transaction they share one connection.
  // Someone who has left isn't matched by email, so an old calendar can't book them again.
  const people = await q.query<{ id: string; name: string; email: string | null }>('SELECT id, name, email FROM people WHERE NOT archived ORDER BY id')
  const venues = await q.query<{ id: string; name: string; address: string }>('SELECT id, name, address FROM venues ORDER BY id')
  const jobs = await q.query<AppData['jobs'][number]>(
    `SELECT p.id, p.name, p.status, p.venue_id AS "venueId", p.source_calendar AS "sourceCalendar",
            coalesce(json_agg(json_build_object('id', ph.id, 'name', ph.name, 'start', ph.start_day::text, 'end', ph.end_day::text)
                              ORDER BY ph.start_day, ph.id) FILTER (WHERE ph.id IS NOT NULL), '[]') AS phases
       FROM projects p
       LEFT JOIN phases ph ON ph.project_id = p.id
      WHERE EXISTS (SELECT 1 FROM phases x WHERE x.project_id = p.id AND x.end_day >= $1::date AND x.start_day <= $2::date)
         OR EXISTS (SELECT 1 FROM calendar_imports i WHERE i.project_id = p.id AND i.day >= $3::date AND i.day < $4::date)
      GROUP BY p.id
      ORDER BY p.id`,
    [addDays(from, -GAP_DAYS - 1), addDays(to, GAP_DAYS + 1), from, to]
  )
  const imported = await q.query<AppData['imported'][number]>(
    `SELECT uid, day::text AS day, title, project_id AS "projectId", calendar_id AS "calendarId" FROM calendar_imports ORDER BY uid, day`
  )
  return { people: people.rows, venues: venues.rows, jobs: jobs.rows, imported: imported.rows }
}

/** What a guest's answers on a phase's days make of their offer: a Yes books them, no answer yet offers, a No declines. */
function offerFor(answers: Readonly<Record<string, GuestResponse>>, days: readonly string[]) {
  const on = days.filter((d) => answers[d] !== undefined)
  const yes = on.filter((d) => answers[d] === 'accepted')
  if (yes.length) return { status: 'confirmed' as const, days: yes }
  const waiting = on.filter((d) => answers[d] !== 'declined')
  if (waiting.length) return { status: 'offered' as const, days: waiting }
  return { status: 'declined' as const, days: on }
}

const personKey = (p: PlanRun['crew'][number]['person']) => ('id' in p ? `id:${p.id}` : `new:${p.email}`)

/** The job as the import screen shows it. */
function jobCard(j: PlanJob, newPeople: ReadonlySet<string>): ImportJob {
  const best = new Map<string, 'confirmed' | 'offered' | 'declined'>()
  const rank = { declined: 0, offered: 1, confirmed: 2 }
  for (const r of j.runs)
    for (const c of r.crew) {
      const k = personKey(c.person)
      const { status } = offerFor(c.answers, r.days)
      const was = best.get(k)
      if (!was || rank[status] > rank[was]) best.set(k, status)
    }
  const states = [...best.values()]
  return {
    key: j.key,
    name: j.name,
    status: j.status,
    adds: j.existing ? { id: j.existing.id, name: j.existing.name } : null,
    phases: j.runs.map((r) => ({
      name: r.name,
      start: r.days[0]!,
      end: r.days.at(-1)!,
      guessed: r.guessed,
      venue: r.venue?.name ?? null,
      sheet: r.notes !== '',
      extends: r.extend !== null,
    })),
    start: j.runs.map((r) => r.days[0]!).sort()[0]!,
    end: j.runs
      .map((r) => r.days.at(-1)!)
      .sort()
      .at(-1)!,
    venue: j.venue ? { name: j.venue.name, isNew: !('id' in j.venue) } : null,
    crew: {
      booked: states.filter((s) => s === 'confirmed').length,
      waiting: states.filter((s) => s === 'offered').length,
      declined: states.filter((s) => s === 'declined').length,
      notInApp: [...best.keys()].filter((k) => k.startsWith('new:') && newPeople.has(k.slice(4))).length,
    },
    events: j.events,
  }
}

function preview(plan: Plan, calendar: ImportCalendar, from: string, to: string): ImportPreview {
  const newPeople = new Set(plan.people.map((p) => p.email))
  return {
    calendar,
    from,
    to,
    events: plan.events,
    jobs: plan.jobs.map((j) => jobCard(j, newPeople)),
    people: plan.people,
    leftOut: plan.leftOut,
    changed: plan.changed,
  }
}

/** Nothing ticked is there any more, so nothing is saved and the history has no empty entry. */
class NothingToBring extends Error {}

/**
 * Save what the office ticked, in the order things refer to each other:
 * people, venues, jobs, phases, crew calls and offers, then each event-day
 * as brought in. People and venues go through the same rules as the
 * app's own commands; jobs are marked with the calendar they came from.
 */
async function bring(ctx: Ctx, plan: Plan, people: ReadonlySet<string>, calendar: ImportCalendar): Promise<Omit<ImportResult, 'missing'>> {
  const personIds = new Map<string, string>()
  for (const p of plan.people) {
    if (!people.has(p.email)) continue
    const id = newId()
    await crewHandlers['person.upsert'](ctx, {
      id,
      name: p.name.slice(0, 200),
      kind: p.kind,
      email: p.email,
      phone: null,
      skills: [],
      dayRateCents: null,
      notes: PERSON_NOTE,
    })
    personIds.set(p.email, id)
  }

  const venueIds = new Map<string, string>()
  const venueId = async (v: VenueRef | null) => {
    if (!v) return null
    if ('id' in v) return v.id
    const known = venueIds.get(v.key)
    if (known) return known
    const id = newId()
    await projectHandlers['venue.upsert'](ctx, { id, name: v.name.slice(0, 200), address: v.address.slice(0, 500), notes: '' })
    venueIds.set(v.key, id)
    return id
  }

  const counts = { jobs: 0, added: 0, days: 0, crew: 0 }
  const extents = new Map<string, { start: string; end: string }>()
  for (const j of plan.jobs) {
    let projectId = j.existing?.id
    if (projectId) counts.added++
    else {
      projectId = newId()
      await ctx.tx.query(
        `INSERT INTO projects (id, name, client_id, venue_id, status, notes, source_calendar) VALUES ($1, $2, NULL, $3, $4, $5, $6)`,
        [projectId, j.name.slice(0, 200), await venueId(j.venue), j.status, j.notes, calendar.name]
      )
      await emit(ctx, 'project', projectId, await getProject(ctx.tx, projectId))
      counts.jobs++
    }

    const phaseOf = new Map<string, string>()
    for (const r of j.runs) {
      const start = r.days[0]!
      const end = r.days.at(-1)!
      let phaseId: string
      if (r.extend) {
        // Two runs can extend one phase, one either side of it.
        const was = extents.get(r.extend.id) ?? r.extend
        const span = { start: was.start < start ? was.start : start, end: was.end > end ? was.end : end }
        await projectHandlers['phase.update'](ctx, { id: r.extend.id, ...span })
        extents.set(r.extend.id, span)
        phaseId = r.extend.id
      } else {
        phaseId = newId()
        await projectHandlers['phase.add'](ctx, {
          id: phaseId,
          projectId,
          name: r.name.slice(0, 100),
          start,
          end,
          venueId: await venueId(r.venue),
          notes: r.notes,
        })
      }
      counts.days += r.days.length
      for (const e of r.events) if (!phaseOf.has(`${e.uid}/${e.day}`)) phaseOf.set(`${e.uid}/${e.day}`, phaseId)
      counts.crew += await bringCrew(ctx, { id: projectId, name: j.name }, phaseId, r, personIds)
    }

    for (const e of j.seen)
      await ctx.tx.query(
        `INSERT INTO calendar_imports (uid, day, calendar_id, event_id, title, project_id, phase_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT (uid, day) DO NOTHING`,
        [e.uid, e.day, calendar.id, e.eventId, e.title.slice(0, 1000), projectId, phaseOf.get(`${e.uid}/${e.day}`) ?? null]
      )
  }
  return { ...counts, venues: venueIds.size, people: personIds.size }
}

/**
 * One crew call for a phase's run of days, for everyone on its events, as
 * many as were on the busiest day; each person's offer holds the days
 * they were on. Returns the offers made.
 */
async function bringCrew(ctx: Ctx, job: { id: string; name: string }, phaseId: string, r: PlanRun, personIds: ReadonlyMap<string, string>): Promise<number> {
  const offers = r.crew
    .map((c) => ({ personId: 'id' in c.person ? c.person.id : personIds.get(c.person.email), ...offerFor(c.answers, r.days) }))
    .filter((o): o is typeof o & { personId: string } => o.personId !== undefined && o.days.length > 0)
  if (offers.length === 0) return 0
  const busiest = Math.max(1, ...r.days.map((d) => offers.filter((o) => o.status !== 'declined' && o.days.includes(d)).length))
  const callId = newId()
  await crewHandlers['call.create'](ctx, {
    id: callId,
    projectId: job.id,
    phaseId,
    project: job.name.slice(0, 200),
    phase: r.name.slice(0, 100),
    venue: '',
    role: 'Crew',
    start: r.days[0]!,
    end: r.days.at(-1)!,
    callTime: null,
    needed: Math.min(busiest, 100),
    dayRateCents: null,
    details: '',
    replyBy: null,
  })
  const answered = new Date().toISOString()
  for (const o of offers) {
    const id = newId()
    await ctx.tx.query(
      `INSERT INTO offers (id, call_id, person_id, status, days, day_rate_cents, override, responded_at, responded_via)
       VALUES ($1, $2, $3, $4, $5, NULL, false, $6, $7)`,
      [id, callId, o.personId, o.status, JSON.stringify(o.days), o.status === 'offered' ? null : answered, o.status === 'offered' ? null : 'calendar']
    )
    await emit(ctx, 'offer', id, await getOffer(ctx.tx, id))
  }
  return offers.length
}

export function registerImportRoutes(app: FastifyInstance, { db, sync, onChange }: ImportRoutes) {
  const noKey = (reply: FastifyReply) => reply.code(409).send({ error: 'Google Calendar needs the Google key on the server first.' })
  /** Why the calendar can't be read just now. */
  const refuse = (reply: FastifyReply, err: unknown) => {
    if (!(err instanceof Halt)) throw err
    return reply.code(err.why === 'busy' ? 503 : 409).send({ error: err.problem ?? "Google isn't answering just now. Try again in a minute." })
  }
  const unseen = "The connected Google account can't see that calendar any more. Choose another, or share it with that account again."

  /** The calendar and the plan for it, read afresh; or the reply already sent. */
  const look = async (req: FastifyRequest, reply: FastifyReply, body: z.infer<typeof lookBody>) => {
    const span = window(body.from, sync!.today())
    if (typeof span === 'string') return { sent: reply.code(400).send({ error: span }) }
    let read
    try {
      read = await sync!.readCalendar(body.calendarId, span.times)
    } catch (err) {
      return { sent: await refuse(reply, err) }
    }
    if (!read) return { sent: reply.code(409).send({ error: unseen }) }
    req.log.info({ events: read.events.length }, 'Calendar import: read the calendar')
    return { ...span, calendar: read.calendar, account: read.account, events: read.events.map(sourceEvent) }
  }

  app.get('/api/calendar/import/calendars', async (_req, reply): Promise<ImportCalendar[] | void> => {
    reply.header('cache-control', 'no-store')
    if (!sync) return noKey(reply)
    try {
      return await sync.readableCalendars()
    } catch (err) {
      return refuse(reply, err)
    }
  })

  /** What the calendar holds as jobs. Saves nothing. */
  app.post('/api/calendar/import/look', async (req, reply): Promise<ImportPreview | void> => {
    reply.header('cache-control', 'no-store')
    if (!sync) return noKey(reply)
    const parsed = lookBody.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? 'Choose a calendar and a day to start from.' })
    const read = await look(req, reply, parsed.data)
    if ('sent' in read) return read.sent
    const plan = planImport(read.events, await readApp(db, read.from, read.to), { account: read.account, calendarId: read.calendar.id, from: read.from, to: read.to })
    return preview(plan, read.calendar, read.from, read.to)
  })

  /** Bring in what the office ticked: the calendar is read again, and everything is saved in one go. */
  app.post<{ Querystring: { client?: string } }>('/api/calendar/import/bring', async (req, reply): Promise<ImportResult | void> => {
    reply.header('cache-control', 'no-store')
    if (!sync) return noKey(reply)
    const parsed = bringBody.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? 'Choose the jobs to bring in.' })
    const choices = parsed.data
    const include = new Set(choices.jobs.filter((j) => j.include).map((j) => j.key))
    if (include.size === 0) return reply.code(400).send({ error: 'Tick at least one job to bring in.' })
    const read = await look(req, reply, choices)
    if ('sent' in read) return read.sent

    const names = new Map(choices.jobs.map((j) => [j.key, j.name]))
    const people = new Set(choices.people.filter((p) => p.include).map((p) => p.email.toLowerCase()))
    const client = typeof req.query.client === 'string' && /^[a-z0-9]{1,64}$/.test(req.query.client) ? req.query.client : undefined
    const options = { account: read.account, calendarId: read.calendar.id, from: read.from, to: read.to }
    let missing: string[] = []
    let result: Omit<ImportResult, 'missing'>
    try {
      result = await serverChange(
        db,
        { name: IMPORT_ACTION, args: { calendar: read.calendar.name }, clientId: client, userId: req.user?.id, device: describeDevice(req.headers['user-agent']) },
        async (ctx) => {
          // Planned again inside the lock, so two people bringing in at once can't bring the same events in twice.
          const app = await readApp(ctx.tx, read.from, read.to)
          const plan = planImport(read.events, app, options, { names, include })
          const found = new Set(planImport(read.events, app, options).jobs.map((j) => j.key))
          missing = choices.jobs.filter((j) => j.include && !found.has(j.key)).map((j) => j.name || j.key)
          if (plan.jobs.length === 0) throw new NothingToBring()
          const done = await bring(ctx, plan, people, read.calendar)
          await ctx.tx.query('UPDATE mutations SET args = $2 WHERE id = $1', [ctx.mutationId, JSON.stringify({ calendar: read.calendar.name, ...done })])
          return done
        }
      )
    } catch (err) {
      if (err instanceof Refused) return reply.code(409).send({ error: err.message })
      if (!(err instanceof NothingToBring)) throw err
      return { jobs: 0, added: 0, days: 0, venues: 0, people: 0, crew: 0, missing }
    }
    req.log.info({ ...result, missing: missing.length }, 'Calendar import: brought jobs in')
    onChange()
    return { ...result, missing }
  })
}
