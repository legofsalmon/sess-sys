import { ADDRESS_WORDS, irishToday, type CommandArgs, OWN_CALENDAR_ACTIONS, type BusyTime, type CalendarAddedBy, type OwnCalendar } from '@sh/shared'
import type { Db, Queryable } from '../db.ts'
import { emit, emitRemoved, Refused, serverChange, type Ctx, type ServerAction } from '../kernel.ts'
import { NotACalendar, readBusyApart, TooMuch, type ReadLimits } from './busy.ts'
import { fetchCalendar, NotRead, tidyAddress, type FetchOptions } from './calendar-fetch.ts'
import { getPerson } from './store.ts'

/**
 * Freelancers' own calendars, read only (ADR 0044): sharing one, reading
 * it again on a schedule and when asked, and stopping. The address is
 * kept here, on the server, as a secret: devices get only whose it is,
 * who gave it, when it was last read, what went wrong if anything, and
 * the busy times. Nothing is ever written to anyone's calendar.
 */

export const NOT_A_CALENDAR = "That address gave us something that isn't a calendar. Use the private address in iCal format, the one ending in .ics."
export const TOO_MUCH = "That calendar has more repeating events than can be worked through here. A calendar with only what's coming up will do."
const ARCHIVED = "They're archived, so their calendar isn't read. Bring them back first."

const COLUMNS = 'id, person_id, address, added_by, added_at, read_at, problem, busy, until_day::text AS until_day'

interface Row {
  id: string
  person_id: string
  address: string
  added_by: CalendarAddedBy
  added_at: Date | string
  read_at: Date | string | null
  problem: string | null
  busy: BusyTime[]
  until_day: string
}

const iso = (v: Date | string | null) => (v === null ? null : new Date(v).toISOString())

/** As devices see it: everything but the address. */
export const toOwnCalendar = (r: Row): OwnCalendar => ({
  id: r.id,
  personId: r.person_id,
  addedBy: r.added_by,
  addedAt: iso(r.added_at)!,
  readAt: iso(r.read_at),
  problem: r.problem,
  busy: r.busy,
  until: r.until_day,
})

async function rowOf(q: Queryable, personId: string, lock = false): Promise<Row | undefined> {
  const { rows } = await q.query<Row>(`SELECT ${COLUMNS} FROM own_calendars WHERE person_id = $1${lock ? ' FOR UPDATE' : ''}`, [personId])
  return rows[0]
}

export async function getOwnCalendar(q: Queryable, personId: string): Promise<OwnCalendar | undefined> {
  const r = await rowOf(q, personId)
  return r && toOwnCalendar(r)
}

/** What was read: the busy times, or why not, in words. */
type Read = { busy: BusyTime[]; until: string } | { problem: string }

/** Fetch and read a calendar, with every failure said in words and none with the address in it. The reading is done apart, in a worker thread, so no file holds the server up. */
async function read(address: string, options: OwnCalendarsOptions, today: string): Promise<Read> {
  let text: string
  try {
    text = await fetchCalendar(address, options)
  } catch (err) {
    if (err instanceof NotRead) return { problem: err.words }
    throw err
  }
  try {
    const got = await readBusyApart(text, today, options.reading)
    if (got.ours) return { problem: ADDRESS_WORDS.ours }
    return { busy: got.busy, until: got.until }
  } catch (err) {
    if (err instanceof NotACalendar) return { problem: NOT_A_CALENDAR }
    if (err instanceof TooMuch) return { problem: TOO_MUCH }
    throw err
  }
}

export interface OwnCalendarsOptions extends FetchOptions {
  /** How often each calendar is read again: every three hours. */
  everyMs?: number
  /** How often the server looks for ones due. */
  lookMs?: number
  now?: () => Date
  /** How much work reading one file may take, and how long its worker may run (busy.ts): the defaults, but for tests. */
  reading?: ReadLimits & { timeoutMs?: number }
}

const THREE_HOURS = 3 * 60 * 60 * 1000
const FIFTEEN_MINUTES = 15 * 60 * 1000
/** The longest the schedule goes without looking, though nothing it knows of is due: a restore can bring calendars back. */
const A_DAY = 24 * 60 * 60 * 1000

export interface Sharing {
  personId: string
  /** As pasted: webcal:// is fine. */
  address: string
  by: CalendarAddedBy
  /** Who did it, for the history: the person's own link, or the app's device and the member of staff. */
  who: Pick<ServerAction, 'clientId' | 'userId' | 'device' | 'link'>
}

export class OwnCalendars {
  private timer?: ReturnType<typeof setInterval>
  private running?: Promise<void>
  /**
   * When the schedule next needs to look, by this server's clock: when the next calendar it knows of is due, or a day on
   * when none is shared. Until then it asks the database nothing, which with nobody sharing was a query every quarter of
   * an hour, all night, for nothing (audit finding 15).
   */
  private nextLook = 0

  constructor(
    private readonly db: Db,
    private readonly options: OwnCalendarsOptions & {
      /** Devices have something new to pull. */
      onChange: () => void
      /** A fault of the server's own, never with the address in it. */
      report?: (err: unknown) => void
    }
  ) {}

  private today() {
    return irishToday(this.options.now?.() ?? new Date())
  }

  /**
   * Share someone's calendar: read there and then, so a wrong address is
   * said at once, beside where it was pasted, and nothing is kept unless
   * it's a calendar. Sharing again replaces the address. Throws Refused
   * with the reason in words.
   */
  async share(s: Sharing): Promise<OwnCalendar> {
    const tidy = tidyAddress(s.address, this.options)
    if ('reason' in tidy) throw new Refused({ code: 'invalid', message: tidy.reason })
    const person = await getPerson(this.db, s.personId)
    if (!person) throw new Refused({ code: 'not-found', message: "That person isn't on the Crew tab any more." })
    if (person.archived) throw new Refused({ code: 'invalid', message: ARCHIVED })
    const got = await read(tidy.address, this.options, this.today())
    if ('problem' in got) throw new Refused({ code: 'invalid', message: got.problem })
    const before = await rowOf(this.db, s.personId)
    const saved = await serverChange(this.db, { name: OWN_CALENDAR_ACTIONS.share, args: { personId: s.personId, by: s.by, replaced: !!before }, ...s.who }, async (ctx) => {
      const now = await getPerson(ctx.tx, s.personId)
      if (!now || now.archived) throw new Refused({ code: 'invalid', message: ARCHIVED })
      const { rows } = await ctx.tx.query<Row>(
        `INSERT INTO own_calendars (id, person_id, address, added_by, added_at, read_at, tried_at, problem, busy, until_day)
         VALUES ($1, $1, $2, $3, now(), now(), now(), NULL, $4, $5)
         ON CONFLICT (id) DO UPDATE SET address = EXCLUDED.address, added_by = EXCLUDED.added_by, added_at = EXCLUDED.added_at,
           read_at = EXCLUDED.read_at, tried_at = EXCLUDED.tried_at, problem = NULL, busy = EXCLUDED.busy, until_day = EXCLUDED.until_day
         RETURNING ${COLUMNS}`,
        [s.personId, tidy.address, s.by, JSON.stringify(got.busy), got.until]
      )
      const cal = toOwnCalendar(rows[0]!)
      await emit(ctx, 'ownCalendar', cal.id, cal)
      return cal
    })
    // Read just now, so due again in three hours, if nothing else is sooner.
    this.nextLook = Math.min(this.nextLook, Date.now() + (this.options.everyMs ?? THREE_HOURS))
    this.options.onChange()
    return saved
  }

  /** Read one again now: the office's "Read it now", and the schedule. Says what it found; an address that has since changed or gone is left alone. */
  async readNow(personId: string): Promise<OwnCalendar | undefined> {
    const row = await rowOf(this.db, personId)
    if (!row) return undefined
    const got = await read(row.address, this.options, this.today())
    let changed = false
    const cal = await serverChange(this.db, undefined, async (ctx) => {
      const now = await rowOf(ctx.tx, personId, true)
      // Stopped, or shared again with another address, while it was being read: what was read is no longer theirs to keep.
      if (!now || now.address !== row.address) return now && toOwnCalendar(now)
      const was = toOwnCalendar(now)
      const { rows } = await ctx.tx.query<Row>(
        'problem' in got
          ? `UPDATE own_calendars SET tried_at = now(), problem = $2 WHERE id = $1 RETURNING ${COLUMNS}`
          : `UPDATE own_calendars SET tried_at = now(), read_at = now(), problem = NULL, busy = $2, until_day = $3 WHERE id = $1 RETURNING ${COLUMNS}`,
        'problem' in got ? [personId, got.problem] : [personId, JSON.stringify(got.busy), got.until]
      )
      const after = toOwnCalendar(rows[0]!)
      // Read again with nothing new is only said when it's been a while, so a quiet calendar doesn't fill the feed every three hours.
      if (worthSaying(was, after)) {
        await emit(ctx, 'ownCalendar', after.id, after)
        changed = true
      }
      return after
    })
    if (changed) this.options.onChange()
    return cal
  }

  /** Each calendar due a read, one at a time. */
  async readDue(): Promise<void> {
    if (this.running) return this.running
    this.running = (async () => {
      const every = this.options.everyMs ?? THREE_HOURS
      // Every calendar shared, with how long until each is due (none or less: due now).
      const { rows } = await this.db.query<{ person_id: string; wait_ms: number | null }>(
        `SELECT c.person_id, extract(epoch FROM c.tried_at + ($1::double precision * interval '1 millisecond') - now()) * 1000 AS wait_ms
           FROM own_calendars c JOIN people p ON p.id = c.person_id
          WHERE NOT p.archived
          ORDER BY c.tried_at NULLS FIRST`,
        [every]
      )
      const waits = rows.map((r) => (r.wait_ms === null ? 0 : Number(r.wait_ms)))
      const due = rows.filter((_, i) => waits[i]! <= 0)
      // Each one read now is due again in `every`; the rest when they say.
      this.nextLook = Date.now() + Math.min(A_DAY, ...waits.map((w) => (w <= 0 ? every : w)))
      for (const { person_id } of due) {
        try {
          await this.readNow(person_id)
        } catch (err) {
          // A fault of the server's own (the worker not starting, the database on the way) marks nothing tried, so look
          // again on the next tick rather than in three hours (audit, 20 October 2026, finding 86).
          this.nextLook = Math.min(this.nextLook, Date.now())
          this.options.report?.(err)
        }
      }
    })().finally(() => (this.running = undefined))
    return this.running
  }

  /** Look for calendars due a read now, and every quarter of an hour once one may be. */
  start() {
    void this.readDue().catch((err) => this.options.report?.(err))
    this.timer = setInterval(() => {
      if (Date.now() < this.nextLook) return
      void this.readDue().catch((err) => this.options.report?.(err))
    }, this.options.lookMs ?? FIFTEEN_MINUTES)
    this.timer.unref?.()
  }

  stop() {
    if (this.timer) clearInterval(this.timer)
  }
}

/** A change devices should hear of: different busy times or problem, or a good read the day after the last one said. */
function worthSaying(was: OwnCalendar, now: OwnCalendar): boolean {
  if (JSON.stringify(was.busy) !== JSON.stringify(now.busy) || was.problem !== now.problem || was.until !== now.until) return true
  return (now.readAt ?? '').slice(0, 10) !== (was.readAt ?? '').slice(0, 10)
}

/** Stop reading someone's calendar: the address and busy times deleted, devices told. Nothing to do when it isn't shared. */
export async function stopOwnCalendar(ctx: Ctx, personId: string) {
  const { rows } = await ctx.tx.query(`DELETE FROM own_calendars WHERE person_id = $1 RETURNING id`, [personId])
  if (rows.length) await emitRemoved(ctx, 'ownCalendar', personId)
}

export const ownCalendarHandlers = {
  /** From their link, one tap, or the office: done already reads as done, so a second tap or a resend is no trouble. */
  async 'ownCalendar.stop'(ctx: Ctx, a: CommandArgs<'ownCalendar.stop'>) {
    if (!(await getPerson(ctx.tx, a.personId))) throw new Refused({ code: 'not-found', message: 'That person no longer exists.' })
    await stopOwnCalendar(ctx, a.personId)
  },
}
