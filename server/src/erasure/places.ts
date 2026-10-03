import { randomBytes } from 'node:crypto'
import {
  CALENDAR_LINK_ID,
  ERASED_NAME,
  erasedPerson,
  keptArgs,
  leaveRecordKept,
  nameKeptUntil,
  PERSON_COMMANDS,
  phoneDigits,
  type CommandName,
  type EntityName,
  type Erasure,
  type KeptRecords,
  type LeaveRecord,
  type Person,
  type PersonRecord,
} from '@sh/shared'
import { linkEntity, readLink } from '../calendar/store.ts'
import { getOffer, getPerson } from '../crew/store.ts'
import { getTimesheet } from '../crew/timesheets.ts'
import type { Queryable } from '../db.ts'
import { emit, emitRemoved, type Ctx } from '../kernel.ts'
import { getAllowanceById, getEntry, getRequest } from '../leave/store.ts'

/**
 * Everywhere a person's details live on the server, and what erasing them
 * does to each (ADR 0027). This is the one list: a new table or column
 * that holds a person's details goes here, and a new command that carries
 * them goes in PERSON_COMMANDS (shared/src/erasure.ts), or erasing someone
 * leaves it behind. The ADR's table says the same in words.
 */

/** Which rows are a person's, as a condition on the person's id ($1): by `person_id` unless a place says otherwise. */
const BY_PERSON = 'person_id = $1'
/** Through their bookings, for a record keyed by an offer (a booking's timesheet has its offer's id). */
export const BY_BOOKING = (column: string) => `${column} IN (SELECT id FROM offers WHERE person_id = $1)`
/** Today in Ireland, as the database works it out. */
const TODAY = `(now() AT TIME ZONE 'Europe/Dublin')::date`

/** Records of theirs that go: deleted, with every earlier copy in the change feed made a deletion. */
interface Gone {
  table: string
  /** As devices know it; none for a table devices never see. */
  entity?: EntityName
  /** Which rows are theirs; `person_id = $1` when not said. A table devices see needs an `id`. */
  theirs?: string
}

/**
 * Their own records that are about their life, not their work. Copies in
 * the change feed are found by the record's `personId` as well as by the
 * rows still here, so ones removed before (days off taken back, say) go too.
 */
export const GONE: readonly Gone[] = [
  // What they said on their link about running late, in their own words (ADR 0028). First, since its rows point at their
  // offers and calls: nothing that clears those later can trip on them. The office's queue and the contact's call sheet
  // lose the note with it.
  { table: 'running_late', entity: 'runningLate' },
  // Days off, approved leave's included: those have the request's id. The request is the record of the leave (LEAVE, below).
  { table: 'unavailability', entity: 'unavailability' },
  // Their address on Google Calendar invites, which devices never see. While invites are on, a day still to come keeps
  // theirs until the calendar's next run takes them off its event, and that run removes the row: gone now, it would
  // leave them on the event as a guest added by hand. Past events in Google keep theirs (ADR 0027).
  {
    table: 'calendar_guests',
    theirs: `person_id = $1 AND NOT (EXISTS (SELECT 1 FROM calendar_link WHERE state <> 'off' AND invites)
      AND day_id IN (SELECT id FROM calendar_days WHERE day >= ${TODAY} AND state <> 'removed'))`,
  },
]

/** Records of their work that stay, without what they wrote themselves. */
interface Stripped {
  table: string
  entity: EntityName
  /** Which rows are theirs; `person_id = $1` when not said. */
  theirs?: string
  /** Each column cleared, with the value it's cleared to. */
  clear: Record<string, unknown>
  /** The same, as the record's fields, in the copies devices hold and the change feed keeps. */
  fields: Record<string, unknown>
  read: (q: Queryable, id: string) => Promise<unknown>
}

export const STRIPPED: readonly Stripped[] = [
  // Bookings and offers are records of work; the note they wrote with each answer is theirs.
  { table: 'offers', entity: 'offer', clear: { note: '' }, fields: { note: '' }, read: getOffer },
  // Timesheets keep their figures, and the office's note on them; the freelancer's own note goes.
  { table: 'timesheets', entity: 'timesheet', theirs: BY_BOOKING('id'), clear: { note: '' }, fields: { note: '' }, read: getTimesheet },
]

/** Records of theirs the law asks the business to keep for a time: stripped like STRIPPED while it lasts, then gone like GONE. */
interface ForATime extends Stripped {
  /** The columns the shared rule reads a leave record by (`LeaveRecord`): which year it belongs to, and its status. */
  record: string
}

/**
 * Their staff leave (ADR 0024). The Working Time Act asks for records of
 * leave to be kept for three years (LEAVE_RECORD_YEARS), so each stays
 * until three whole years after the end of its year, saying whose it is,
 * what, when, how many days, and who decided it and when. The person's
 * note, the approver's reason and the allowance's note go. Once its three
 * years are up it goes (the server looks each day: due.ts), and every one
 * left goes with the name: a record has to say whose it is. One still
 * waiting for a decision goes at once (leaveRecordKept).
 */
export const LEAVE: readonly ForATime[] = [
  { table: 'leave_requests', entity: 'leaveRequest', record: 'end_day::text AS "end", status', clear: { note: '', reason: '' }, fields: { note: '', reason: '' }, read: getRequest },
  { table: 'lieu_entries', entity: 'lieuEntry', record: 'day::text AS day, status', clear: { note: '', reason: '' }, fields: { note: '', reason: '' }, read: getEntry },
  { table: 'leave_allowances', entity: 'leaveAllowance', record: 'year', clear: { note: '' }, fields: { note: '' }, read: getAllowanceById },
]

/**
 * Where a command's record lives, to say whose it is, and the command that
 * made it, whose arguments erasing keeps: a record of theirs that went
 * (leave, say) is still known to be theirs by that.
 */
export const RECORDS: Record<PersonRecord, { table: string; madeBy: CommandName }> = {
  offer: { table: 'offers', madeBy: 'offer.send' },
  leaveRequest: { table: 'leave_requests', madeBy: 'leave.request' },
  lieuEntry: { table: 'lieu_entries', madeBy: 'lieu.log' },
}

/**
 * Each field of a person, by its column. Typed against Person, so a field
 * added to a person fails to compile here until it has a column (and
 * `erasedPerson` says whether it goes). The company is three columns.
 */
const PERSON_COLUMNS: { [K in Exclude<keyof Person, 'id' | 'kind' | 'company'>]: string } = {
  name: 'name',
  email: 'email',
  phone: 'phone',
  skills: 'skills',
  dayRateCents: 'day_rate_cents',
  notes: 'notes',
  linkToken: 'link_token',
  archived: 'archived',
  approvesLeave: 'approves_leave',
  department: 'department',
  level: 'level',
  knownAs: 'known_as',
  certificates: 'certificates',
}

type Row = Record<string, any>

export async function readErasure(q: Queryable, personId: string): Promise<Erasure | undefined> {
  const { rows } = await q.query<Row>(`SELECT person_id, erased_at, name_kept_until::text FROM erasures WHERE person_id = $1`, [personId])
  const r = rows[0]
  return r && { id: r.person_id, erasedAt: new Date(r.erased_at).toISOString(), nameKeptUntil: r.name_kept_until ?? null }
}

/**
 * What they have on record that keeps their name: their approved
 * timesheets and their staff leave, read as a device reads its copy
 * (keptRecordsOf in shared/src/sync/erasure-view.ts), so the two decide
 * the same day with the same rule (nameKept in shared/src/erasure.ts).
 */
export async function keptRecords(q: Queryable, personId: string): Promise<KeptRecords> {
  const { rows } = await q.query<{ approved_at: Date | string }>(
    `SELECT t.approved_at FROM timesheets t JOIN offers o ON o.id = t.id WHERE o.person_id = $1 AND t.status = 'approved' AND t.approved_at IS NOT NULL`,
    [personId]
  )
  const leave: LeaveRecord[] = []
  for (const l of LEAVE) leave.push(...(await q.query<LeaveRecord>(`SELECT ${l.record} FROM ${l.table} WHERE ${BY_PERSON}`, [personId])).rows)
  return { approvedAt: rows.map((r) => new Date(r.approved_at).toISOString()), leave }
}

export interface EraseHow {
  today: string
  /** When it was first done, for a restore doing it again. */
  at?: string
  /** The decision about the name, for a restore doing it again; otherwise worked out from their pay and leave records. */
  nameKeptUntil?: string | null
}

/**
 * Erase a person's details everywhere they live, inside the caller's
 * command or server change. No checks: the command checks first, and a
 * restore applying an erasure again owes the person it whatever the copy
 * says. Doing it again changes nothing more, except that leave records
 * whose three years are up go, and a kept name goes once its day has
 * come, with the leave records still kept for it. A name once gone never
 * comes back.
 */
export async function erasePerson(ctx: Ctx, personId: string, how: EraseHow): Promise<Erasure> {
  const { tx } = ctx
  const before = await getPerson(tx, personId)
  const was = await readErasure(tx, personId)
  let kept = how.nameKeptUntil !== undefined ? how.nameKeptUntil : nameKeptUntil(await keptRecords(tx, personId), how.today)
  if ((kept !== null && kept <= how.today) || (was && was.nameKeptUntil === null)) kept = null
  const erasure: Erasure = { id: personId, erasedAt: was?.erasedAt ?? how.at ?? new Date().toISOString(), nameKeptUntil: kept }

  await tx.query(
    `INSERT INTO erasures (person_id, erased_at, name_kept_until) VALUES ($1, $2, $3)
     ON CONFLICT (person_id) DO UPDATE SET name_kept_until = EXCLUDED.name_kept_until`,
    [personId, erasure.erasedAt, kept]
  )
  if (!before) return erasure
  // Read before the copies that hold them are rewritten.
  const details = await detailsOf(tx, personId)
  // First in the feed, so a device still holds their offers and leave when it hears, and can tell which of its changes were theirs.
  await emit(ctx, 'erasure', personId, erasure)

  const nameNow = kept !== null ? before.name : ERASED_NAME
  // Their records' ids, before any go, for the history.
  const records: Record<PersonRecord, string[]> = {
    offer: await idsOf(tx, `SELECT id FROM offers WHERE ${BY_PERSON}`, personId),
    leaveRequest: await idsOf(tx, `SELECT id FROM leave_requests WHERE ${BY_PERSON}`, personId, 'leaveRequest'),
    lieuEntry: await idsOf(tx, `SELECT id FROM lieu_entries WHERE ${BY_PERSON}`, personId, 'lieuEntry'),
  }

  for (const g of GONE) {
    const theirs = g.theirs ?? BY_PERSON
    if (!g.entity) {
      await tx.query(`DELETE FROM ${g.table} WHERE ${theirs}`, [personId])
      continue
    }
    await remove(ctx, personId, { table: g.table, entity: g.entity, theirs }, await idsOf(tx, `SELECT id FROM ${g.table} WHERE ${theirs}`, personId, g.entity))
  }

  // Their leave: each decided record still in its three years stays, without its words, while the name does; the rest go.
  for (const l of LEAVE) {
    const { rows } = await tx.query<LeaveRecord & { id: string }>(`SELECT id, ${l.record} FROM ${l.table} WHERE ${BY_PERSON}`, [personId])
    const stay = new Set(kept === null ? [] : rows.filter((r) => leaveRecordKept(r, how.today)).map((r) => r.id))
    await remove(ctx, personId, l, (await idsOf(tx, `SELECT id FROM ${l.table} WHERE ${BY_PERSON}`, personId, l.entity)).filter((id) => !stay.has(id)))
    await strip(ctx, l, [...stay])
  }

  for (const s of STRIPPED) await strip(ctx, s, await idsOf(tx, `SELECT id FROM ${s.table} WHERE ${s.theirs ?? BY_PERSON}`, personId))

  // Their own row, and every earlier copy of it, as erasing leaves it. A new link secret matches no old link or feed address.
  const after = erasedPerson(before, kept !== null)
  const values: Record<string, unknown> = {}
  for (const [field, column] of Object.entries(PERSON_COLUMNS)) values[column] = after[field as keyof typeof PERSON_COLUMNS]
  values.skills = JSON.stringify(after.skills)
  values.certificates = JSON.stringify(after.certificates)
  values.link_token = `erased-${randomBytes(18).toString('base64url')}`
  Object.assign(values, { company_name: null, company_vat_number: null, company_cro_number: null })
  const columns = Object.keys(values)
  await tx.query(`UPDATE people SET ${columns.map((c, i) => `${c} = $${i + 2}`).join(', ')} WHERE id = $1`, [personId, ...columns.map((c) => values[c])])
  await tx.query(`UPDATE changes SET data = $2 WHERE entity = 'person' AND entity_id = $1 AND op = 'put'`, [personId, JSON.stringify(after)])
  await emit(ctx, 'person', personId, after)

  for (const userId of await accountsOf(tx, details.emails)) await eraseAccount(ctx, userId)
  await stripHistory(tx, personId, records, nameNow, { name: kept === null && before.name !== ERASED_NAME ? before.name : undefined, ...details })
  return erasure
}

/** Ids from a query on the person's id, and, given an entity, every id of theirs in the change feed, including records since removed. */
async function idsOf(tx: Queryable, sql: string, personId: string, entity?: EntityName): Promise<string[]> {
  const { rows } = await tx.query<{ id: string }>(sql, [personId])
  const ids = new Set(rows.map((r) => r.id))
  if (entity) {
    const { rows: copies } = await tx.query<{ id: string }>(`SELECT DISTINCT entity_id AS id FROM changes WHERE entity = $1 AND data->>'personId' = $2`, [entity, personId])
    for (const r of copies) ids.add(r.id)
  }
  return [...ids]
}

/**
 * Records of theirs deleted, and every earlier copy of them in the change
 * feed made a deletion, so a new device's first sync finds none. `ids`
 * holds the feed's copies as well as the rows still here.
 */
async function remove(ctx: Ctx, personId: string, place: { table: string; entity: EntityName; theirs?: string }, ids: string[]) {
  if (!ids.length) return
  const { table, entity } = place
  const { rows } = await ctx.tx.query<{ id: string }>(`DELETE FROM ${table} WHERE ${place.theirs ?? BY_PERSON} AND id = ANY($2::text[]) RETURNING id`, [personId, ids])
  await ctx.tx.query(`UPDATE changes SET op = 'delete', data = NULL WHERE entity = $1 AND entity_id = ANY($2::text[])`, [entity, ids])
  for (const { id } of rows) await emitRemoved(ctx, entity, id)
}

/** Records kept without what was written in them, in the rows and in every earlier copy in the change feed; devices are sent each one that changed. */
async function strip(ctx: Ctx, s: Stripped, ids: string[]) {
  if (!ids.length) return
  const cols = Object.keys(s.clear)
  const { rows } = await ctx.tx.query<{ id: string }>(
    `UPDATE ${s.table} SET ${cols.map((c, i) => `${c} = $${i + 2}`).join(', ')}
      WHERE id = ANY($1::text[]) AND (${cols.map((c, i) => `${c} IS DISTINCT FROM $${i + 2}`).join(' OR ')}) RETURNING id`,
    [ids, ...cols.map((c) => s.clear[c])]
  )
  await ctx.tx.query(`UPDATE changes SET data = data || $3::jsonb WHERE entity = $1 AND entity_id = ANY($2::text[]) AND op = 'put'`, [s.entity, ids, JSON.stringify(s.fields)])
  for (const { id } of rows) await emit(ctx, s.entity, id, await s.read(ctx.tx, id))
}

/**
 * Every email address and phone number on their record, now or in an
 * earlier copy, so one they changed goes too and finds an account made
 * with it. One someone else in the app still has is left out: it is
 * theirs as well (a shared number, or a second record for the same
 * person), so their history and their sign-in keep it.
 */
async function detailsOf(tx: Queryable, personId: string): Promise<{ emails: string[]; phones: string[] }> {
  const { rows } = await tx.query<{ email: string | null; phone: string | null }>(
    `SELECT data->>'email' AS email, data->>'phone' AS phone FROM changes WHERE entity = 'person' AND entity_id = $1 AND op = 'put'
     UNION SELECT email, phone FROM people WHERE id = $1`,
    [personId]
  )
  const { rows: others } = await tx.query<{ email: string | null; phone: string | null }>(`SELECT email, phone FROM people WHERE id <> $1`, [personId])
  const address = (e: string | null) => e?.trim().toLowerCase() ?? ''
  const shared = { emails: new Set(others.map((o) => address(o.email))), phones: new Set(others.map((o) => phoneDigits(o.phone))) }
  const emails = rows.map((r) => address(r.email)).filter((e) => e && !shared.emails.has(e))
  const phones = rows.map((r) => r.phone?.trim() ?? '').filter((p) => p && !shared.phones.has(phoneDigits(p)))
  return { emails: [...new Set(emails)], phones: [...new Set(phones)] }
}

/** Their staff accounts: any that signs in with one of their addresses. */
async function accountsOf(tx: Queryable, emails: string[]): Promise<string[]> {
  if (!emails.length) return []
  const { rows } = await tx.query<{ id: string }>(`SELECT id FROM users WHERE lower(trim(email)) = ANY($1::text[]) ORDER BY id`, [emails])
  return rows.map((r) => r.id)
}

/**
 * A staff account of theirs: every session ended, so their devices are
 * signed out at once; the name the history shows becomes "Erased person",
 * even while their name is kept with their timesheets or leave, which
 * need it only on their person; the email, picture and Google id go, and
 * it is switched off, so signing in again with Google starts a new
 * account rather than this one.
 */
async function eraseAccount(ctx: Ctx, userId: string) {
  const { tx } = ctx
  const { rows } = await tx.query<{ name: string }>(`SELECT name FROM users WHERE id = $1`, [userId])
  const was = rows[0]
  if (!was) return
  await tx.query(`DELETE FROM sessions WHERE user_id = $1`, [userId])
  await tx.query(`UPDATE users SET name = $2, email = '', picture = NULL, google_sub = 'erased:' || id, disabled = true WHERE id = $1`, [userId, ERASED_NAME])
  // The calendar connection names who connected it, by the account's name: devices are sent it again, and its earlier copies lose it.
  if (was.name !== ERASED_NAME) {
    await tx.query(`UPDATE changes SET data = jsonb_set(data, '{connectedBy}', to_jsonb($2::text)) WHERE entity = 'calendarLink' AND op = 'put' AND data->>'connectedBy' = $1`, [
      was.name,
      ERASED_NAME,
    ])
    const link = await readLink(tx)
    if (link?.connectedBy === userId) await emit(ctx, 'calendarLink', CALENDAR_LINK_ID, linkEntity(link))
  }
}

/** A regular expression that matches the text exactly, whatever is in it. */
const literally = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
/** As the text sits inside JSON, so it can be found in a stored record. */
const inJson = (s: string) => JSON.stringify(s).slice(1, -1)
/**
 * A name as a whole name: not inside a longer word or a double-barrelled
 * name ("Mary Kelly" in "Mary Kelly-Byrne"), nor after an O' ("Brien
 * Smith" in "Seán Ó'Brien Smith"), but with an 's after it ("Ciara's").
 */
const wholeName = (name: string) =>
  new RegExp(`(?<![\\p{L}\\p{N}'’-])${literally(inJson(name))}(?![\\p{L}\\p{N}-]|['’](?!s(?![\\p{L}\\p{N}]))[\\p{L}\\p{N}])`, 'gu')
/** An address as a whole address, for the database: "dan@gmail.com" is not in "jordan@gmail.com" or "dan@gmail.com.au". */
const wholeEmail = (email: string) => `(?<![[:alnum:]._%+-])${literally(inJson(email))}(?![[:alnum:]_%+-]|\\.[[:alnum:]])`
/** A number as a whole number, for the database: "000000" is not in a day rate of 1000000. */
const wholePhone = (phone: string) => `(?<![0-9])${literally(inJson(phone))}(?![0-9])`

/**
 * The history (ADR 0006), and anything else stored as text that held
 * their details. Each command about them keeps only what the rules in
 * PERSON_COMMANDS keep. A refusal that named them names "Erased person"
 * (refusals are written by the server from the person's name, so it
 * appears exactly; as a whole word, so "Al" never touches "Already").
 * Their email and phone go from every stored command and refusal, and
 * from earlier copies of the calendar connection, which named the account
 * it was made with. Their link's device goes from the answers they made
 * on it.
 */
async function stripHistory(
  tx: Queryable,
  personId: string,
  records: Record<PersonRecord, string[]>,
  nameNow: string,
  details: { name?: string; emails: string[]; phones: string[] }
) {
  for (const [command, rule] of Object.entries(PERSON_COMMANDS)) {
    const ids = rule.names.via ? records[rule.names.via] : [personId]
    if (!ids.length) continue
    const { rows } = await tx.query<{ id: string; args: unknown }>(`SELECT id, args FROM mutations WHERE name = $1 AND args->>$2::text = ANY($3::text[])`, [
      command,
      rule.names.field,
      ids,
    ])
    for (const r of rows) {
      const kept = keptArgs(command as CommandName, r.args, nameNow)
      if (JSON.stringify(kept) !== JSON.stringify(r.args)) await tx.query(`UPDATE mutations SET args = $2 WHERE id = $1`, [r.id, JSON.stringify(kept)])
    }
  }
  if (details.name) {
    // Matched here rather than by the database, whose idea of a letter depends on its locale: "Mhurchú" ends in one.
    const word = wholeName(details.name)
    const { rows } = await tx.query<{ id: string; result: string }>(`SELECT id, result::text AS result FROM mutations WHERE status = 'rejected' AND strpos(result::text, $1) > 0`, [
      inJson(details.name),
    ])
    for (const r of rows) {
      const result = r.result.replace(word, inJson(ERASED_NAME))
      if (result !== r.result) await tx.query(`UPDATE mutations SET result = $2::jsonb WHERE id = $1`, [r.id, result])
    }
  }
  for (const found of [...details.emails.map(wholeEmail), ...details.phones.map(wholePhone)]) {
    await tx.query(
      `UPDATE mutations SET args = regexp_replace(args::text, $1, '', 'gi')::jsonb, result = regexp_replace(result::text, $1, '', 'gi')::jsonb
        WHERE args::text ~* $1 OR result::text ~* $1`,
      [found]
    )
    await tx.query(`UPDATE changes SET data = regexp_replace(data::text, $1, '', 'gi')::jsonb WHERE entity = 'calendarLink' AND op = 'put' AND data::text ~* $1`, [found])
  }
  await tx.query(`UPDATE mutations SET device = NULL WHERE client_id = ANY($1::text[])`, [[`link:${personId}`, `calendar:${personId}`]])
}
