import { dayLabel, ERASED_NAME, ERASED_REFUSAL, irishToday, keptArgs, nameKept, PERSON_COMMANDS, type CommandArgs, type CommandName, type NameKept, type Person } from '@sh/shared'
import { getPerson } from '../crew/store.ts'
import type { Queryable } from '../db.ts'
import { Refused, type Ctx } from '../kernel.ts'
import { erasePerson, keptRecords, readErasure, RECORDS } from './places.ts'

/**
 * Erasing a person on request (ADR 0027): the command, what has to be
 * settled first, and the rule that nothing more is put on record about
 * someone once they're erased.
 */

/**
 * Whom a command is about, by the server's own tables, if it's one that
 * can be. A record that has gone, such as leave whose three years were up
 * when they were erased, is still theirs by the command that made it, so
 * a decision on it sent afterwards is turned down and stored without its
 * reason, as one on leave still kept is.
 */
async function personNamed(tx: Queryable, name: string, args: unknown): Promise<string | undefined> {
  const rule = PERSON_COMMANDS[name as CommandName]
  if (!rule || !args || typeof args !== 'object') return undefined
  const value = (args as Record<string, unknown>)[rule.names.field]
  if (typeof value !== 'string') return undefined
  if (!rule.names.via) return value
  const record = RECORDS[rule.names.via]
  const { rows } = await tx.query<{ person_id: string }>(`SELECT person_id FROM ${record.table} WHERE id = $1`, [value])
  if (rows[0]) return rows[0].person_id
  const { rows: made } = await tx.query<{ person_id: string }>(
    `SELECT args->>'personId' AS person_id FROM mutations WHERE name = $1 AND args->>'id' = $2 AND status = 'applied' LIMIT 1`,
    [record.madeBy, value]
  )
  return made[0]?.person_id ?? undefined
}

/** The erased person a command is about, with their name as it now is, or undefined. */
async function erasedNamed(tx: Queryable, name: string, args: unknown): Promise<{ id: string; name: string } | undefined> {
  const id = await personNamed(tx, name, args)
  if (!id || !(await readErasure(tx, id))) return undefined
  return { id, name: (await getPerson(tx, id))?.name ?? ERASED_NAME }
}

/**
 * Once erased, a change that would put something about them on record
 * again is turned down: an edit, their contact details, days off, an
 * answer or a timesheet, leave. That includes one waiting on a device
 * from before, or sent again after a restore.
 */
export async function refuseIfErased(tx: Queryable, name: string, args: unknown) {
  if (!PERSON_COMMANDS[name as CommandName]?.refused) return
  if (await erasedNamed(tx, name, args)) throw new Refused({ code: 'conflict', message: ERASED_REFUSAL })
}

/**
 * What the history keeps of a command's arguments: all of them, unless
 * it's about someone already erased, when only what erasing keeps. Read
 * before the command runs, so even one turned down never stores their
 * details.
 */
export async function argsToStore(tx: Queryable, name: string, args: unknown): Promise<unknown> {
  if (!PERSON_COMMANDS[name as CommandName]) return args
  const erased = await erasedNamed(tx, name, args)
  return erased ? keptArgs(name, args, erased.name) : args
}

/**
 * Why someone can't be erased yet, in words that say what to do, or
 * undefined. Anything unsettled is settled first: an offer or a booking on
 * a job that hasn't ended, being the contact on the day for a phase that
 * hasn't, a timesheet waiting for approval (so the pay is on record under
 * their name), leave or a day in lieu waiting for a decision (so the leave
 * records kept say how it ended), and their Google account writing the
 * jobs to Google Calendar. The device asks the same before it sends
 * (eraseRefusal), and both name the earliest of several by its first day,
 * then its id, so they say it in the same words.
 */
async function notYet(tx: Queryable, person: Person, today: string): Promise<string | undefined> {
  const job = (r: { project: string; phase: string | null }) => (r.phase ? `${r.project} (${r.phase})` : r.project)
  const { rows: held } = await tx.query<{ status: string; project: string; phase: string }>(
    `SELECT o.status, c.project, c.phase FROM offers o JOIN crew_calls c ON c.id = o.call_id
      WHERE o.person_id = $1 AND c.status = 'open' AND c.end_day >= $2::date AND o.status IN ('offered', 'countered', 'accepted', 'confirmed')
      ORDER BY c.start_day, c.id LIMIT 1`,
    [person.id, today]
  )
  const h = held[0]
  if (h) {
    if (h.status === 'offered' || h.status === 'countered') return `${person.name} has an open offer for ${job(h)}; withdraw it first.`
    return `${person.name} ${h.status === 'confirmed' ? 'is booked on' : 'has accepted'} ${job(h)}, which hasn't ended. Erase their details once it has, or release them first.`
  }
  const { rows: contact } = await tx.query<{ project: string; phase: string }>(
    `SELECT pr.name AS project, ph.name AS phase FROM phases ph JOIN projects pr ON pr.id = ph.project_id
      WHERE ph.contact_id = $1 AND ph.end_day >= $2::date ORDER BY ph.start_day, ph.id LIMIT 1`,
    [person.id, today]
  )
  if (contact[0]) return `${person.name} is the contact on the day for ${job(contact[0])}, which hasn't ended. Choose someone else first.`
  const { rows: waiting } = await tx.query<{ project: string }>(
    `SELECT c.project FROM timesheets t JOIN offers o ON o.id = t.id JOIN crew_calls c ON c.id = o.call_id
      WHERE o.person_id = $1 AND t.status = 'sent' ORDER BY t.sent_at, t.id LIMIT 1`,
    [person.id]
  )
  if (waiting[0]) return `${person.name} has a timesheet waiting on ${waiting[0].project}: approve it first, so their pay is on record.`
  // Their leave is kept once they're erased, and nothing more can be decided for them, so one left waiting would sit in
  // the approvers' queue for good. A request is named before a day in lieu, as the device names them.
  const { rows: undecided } = await tx.query<{ what: string }>(
    `SELECT 1 AS first, 'leave' AS what FROM leave_requests WHERE person_id = $1 AND status = 'waiting'
     UNION ALL SELECT 2, 'a day in lieu' FROM lieu_entries WHERE person_id = $1 AND status = 'waiting' ORDER BY first LIMIT 1`,
    [person.id]
  )
  if (undecided[0]) return `${person.name} has ${undecided[0].what} waiting for a decision: decide it on the Leave screen first, so their leave records say how it ended.`
  if (person.email?.trim()) {
    const { rows: link } = await tx.query(`SELECT 1 FROM calendar_link WHERE state <> 'off' AND lower(trim(account_email)) = lower(trim($1))`, [person.email])
    if (link.length) return `${person.name}'s Google account writes the jobs to Google Calendar: connect another account on the Account tab first.`
  }
  return undefined
}

/** What a name is kept for, in a few words: "Revenue's records", "their leave records under the Working Time Act", or both. */
function keptFor(k: NameKept): string {
  const why = [k.pay && "Revenue's records", k.leave && 'their leave records under the Working Time Act'].filter(Boolean)
  return why.length ? why.join(' and ') : "the business's records"
}

type Handler<N extends 'person.erase'> = (ctx: Ctx, args: CommandArgs<N>) => Promise<void>

export const erasureHandlers: { 'person.erase': Handler<'person.erase'> } = {
  async 'person.erase'(ctx, a) {
    const person = await getPerson(ctx.tx, a.id)
    if (!person) throw new Refused({ code: 'not-found', message: 'That person no longer exists.' })
    const today = irishToday()
    const was = await readErasure(ctx.tx, a.id)
    if (was) {
      // Erased already: sent again, it takes a kept name once its day has come, and the leave records kept with it, as
      // the server does by itself that day (due.ts).
      if (was.nameKeptUntil === null) return
      if (was.nameKeptUntil > today) {
        // Why, as it was decided: the records themselves don't change once they're erased.
        const why = keptFor(nameKept(await keptRecords(ctx.tx, a.id), irishToday(new Date(was.erasedAt))))
        throw new Refused({ code: 'conflict', message: `${person.name}'s name is kept for ${why} until ${dayLabel(was.nameKeptUntil)} ${was.nameKeptUntil.slice(0, 4)}, and the app erases it that day.` })
      }
      await erasePerson(ctx, a.id, { today, nameKeptUntil: null })
      return
    }
    // Two deliberate steps: archived first, so nobody is erased by a slip.
    if (!person.archived) throw new Refused({ code: 'conflict', message: `${person.name} isn't archived. Archive them first, then erase their details.` })
    const why = await notYet(ctx.tx, person, today)
    if (why) throw new Refused({ code: 'conflict', message: why })
    await erasePerson(ctx, a.id, { today })
  },
}
