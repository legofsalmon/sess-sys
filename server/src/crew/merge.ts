import { holdsARole, mayChangeWhoSignsIn, mergedPerson, mergeRefusal, offerKept, ROLE_LABELS, type CommandArgs, type EntityName, type Offer, type Person } from '@sh/shared'
import { getDocument } from '../documents/store.ts'
import { emit, emitAll, emitRemoved, emitRemovedAll, Refused, type Ctx } from '../kernel.ts'
import { getAllowanceById, getEntry, getRequest } from '../leave/store.ts'
import { getPhases } from '../projects/store.ts'
import { getCount } from '../stock/counts.ts'
import { getBooking } from '../vehicles/store.ts'
import { getLate } from './late.ts'
import { getOwnCalendar } from './own-calendars.ts'
import { getAway, getOffers, getPerson } from './store.ts'

/**
 * Combining people brought in twice (ADR 0055): one is kept, and every
 * record of the others becomes theirs, told to devices as it moves. The
 * list is every place a person's id is kept (the same places erasing
 * reads, erasure/places.ts); a new one goes here too, or combining leaves
 * it pointing at someone who is gone. The others' rows are deleted at the
 * end, which their foreign keys would refuse if one were missed.
 */

/** Records that name a person by a column, with how devices are told: by reading each record again. */
const MOVED: readonly { table: string; column: string; entity?: EntityName; read?: (tx: Ctx['tx'], id: string) => Promise<unknown> }[] = [
  { table: 'unavailability', column: 'person_id', entity: 'unavailability', read: getAway },
  { table: 'documents', column: 'person_id', entity: 'document', read: getDocument },
  { table: 'leave_requests', column: 'person_id', entity: 'leaveRequest', read: getRequest },
  { table: 'leave_requests', column: 'decided_by', entity: 'leaveRequest', read: getRequest },
  { table: 'lieu_entries', column: 'person_id', entity: 'lieuEntry', read: getEntry },
  { table: 'lieu_entries', column: 'decided_by', entity: 'lieuEntry', read: getEntry },
  { table: 'running_late', column: 'person_id', entity: 'runningLate', read: getLate },
  { table: 'counts', column: 'counted_by', entity: 'count', read: getCount },
  { table: 'vehicle_bookings', column: 'driver_id', entity: 'vehicleBooking', read: getBooking },
  // Their own calendar (ADR 0044) and leave allowances have one a person, and are handled first; guests on Google
  // Calendar (ADR 0009) are one a person a day, and devices never see them.
  { table: 'calendar_guests', column: 'person_id' },
  // Someone made part of a person who is now made part of another: their old link opens whoever is kept now.
  { table: 'person_merges', column: 'into_id' },
]

export const mergeHandlers = {
  async 'person.merge'(ctx: Ctx, a: CommandArgs<'person.merge'>) {
    const { tx } = ctx
    const into = await getPerson(tx, a.id)
    if (!into) throw new Refused({ code: 'not-found', message: "That person isn't in the app any more. Look at the list again." })
    const from: Person[] = []
    for (const id of a.from) {
      const p = await getPerson(tx, id)
      if (!p) throw new Refused({ code: 'not-found', message: "One of those people isn't in the app any more. Look at the list again." })
      from.push(p)
    }
    const all = [into, ...from]
    const ids = from.map((p) => p.id)
    const { rows: erased } = await tx.query<{ person_id: string }>('SELECT person_id FROM erasures WHERE person_id = ANY($1::text[])', [[into.id, ...ids]])
    if (erased.length) throw new Refused({ code: 'conflict', message: "One of them had their details erased on request, so they can't be combined with anyone." })
    const why = mergeRefusal(into, from)
    if (why) throw new Refused({ code: 'conflict', message: why })
    // Their addresses decide who signs in as what (ADR 0034), so someone with a role is combined only by who can change that.
    const holder = all.find((p) => p.kind === 'staff' && holdsARole(p))
    if (ctx.via !== 'app') throw new Refused({ code: 'forbidden', message: 'Only the office can combine people.' })
    if (holder && !mayChangeWhoSignsIn(ctx.role))
      throw new Refused({
        code: 'forbidden',
        message: `${holder.name} signs in as ${ROLE_LABELS[holder.role!]}, so only the office and directors can combine them with someone.${ctx.role ? ` Your role is ${ROLE_LABELS[ctx.role]}.` : ''}`,
      })

    await moveOffers(ctx, into.id, ids)
    await moveOneEach(ctx, into.id, ids)
    for (const m of MOVED) {
      const { rows } = await tx.query<{ id?: string }>(
        `UPDATE ${m.table} SET ${m.column} = $1 WHERE ${m.column} = ANY($2::text[])${m.entity ? ' RETURNING id' : ''}`,
        [into.id, ids]
      )
      if (m.entity && m.read) for (const id of [...new Set(rows.map((r) => r.id!))].sort()) await emit(ctx, m.entity, id, await m.read(tx, id))
    }
    // Who crew ring on the day (ADR 0021): phases name a person without a foreign key.
    const { rows: phases } = await tx.query<{ id: string }>('UPDATE phases SET contact_id = $1 WHERE contact_id = ANY($2::text[]) RETURNING id', [into.id, ids])
    if (phases.length) await emitAll(ctx, 'phase', (await getPhases(tx, phases.map((p) => p.id).sort())).map((p) => ({ id: p.id, data: p })))

    // Their links open the one person from now on: a freelancer who saved theirs, or subscribed to its calendar feed, loses nothing.
    const { rows: links } = await tx.query<{ id: string; link_token: string }>('SELECT id, link_token FROM people WHERE id = ANY($1::text[]) ORDER BY id', [ids])
    for (const l of links) await tx.query('INSERT INTO person_merges (from_id, into_id, link_token) VALUES ($1, $2, $3) ON CONFLICT (from_id) DO NOTHING', [l.id, into.id, l.link_token])

    const one = mergedPerson(into, from)
    await tx.query('DELETE FROM people WHERE id = ANY($1::text[])', [ids])
    await tx.query(
      `UPDATE people SET name = $2, email = $3, other_emails = $4, phone = $5, skills = $6, day_rate_cents = $7, notes = $8, archived = $9, approves_leave = $10,
         department = $11, level = $12, known_as = $13, certificates = $14, company_name = $15, company_vat_number = $16, company_cro_number = $17, role = $18
       WHERE id = $1`,
      [
        one.id,
        one.name,
        one.email,
        JSON.stringify(one.otherEmails ?? []),
        one.phone,
        JSON.stringify(one.skills),
        one.dayRateCents,
        one.notes,
        one.archived,
        one.approvesLeave,
        one.department,
        one.level,
        one.knownAs,
        JSON.stringify(one.certificates),
        one.company?.name ?? null,
        one.company?.vatNumber ?? null,
        one.company?.croNumber ?? null,
        one.role,
      ]
    )
    // The others' earlier copies stay in the feed, so the history still reads their names as they were.
    await emitRemovedAll(ctx, 'person', ids)
    await emit(ctx, 'person', into.id, await getPerson(tx, into.id))
  },
}

/**
 * Their offers become the one person's. Two of them offered the same call
 * is one person offered it twice: one is kept (offerKept), holding every
 * day either held, and the other goes, its running late and its guest
 * days on Google Calendar moving to the one kept. Two timesheets for one
 * call can't be one, so that is refused.
 */
async function moveOffers(ctx: Ctx, intoId: string, ids: string[]) {
  const { tx } = ctx
  const everyone = [intoId, ...ids]
  const { rows } = await tx.query<{ id: string }>('SELECT id FROM offers WHERE person_id = ANY($1::text[]) ORDER BY id', [everyone])
  const offers = await getOffers(tx, rows.map((r) => r.id))
  const { rows: sheets } = await tx.query<{ id: string }>('SELECT id FROM timesheets WHERE id = ANY($1::text[])', [offers.map((o) => o.id)])
  const hasSheet = new Set(sheets.map((s) => s.id))
  const byCall = new Map<string, Offer[]>()
  for (const o of offers) byCall.set(o.callId, [...(byCall.get(o.callId) ?? []), o])

  const gone: string[] = []
  const changed = new Set<string>()
  for (const [callId, same] of byCall) {
    if (same.length < 2) continue
    if (same.filter((o) => hasSheet.has(o.id)).length > 1) {
      const { rows: call } = await tx.query<{ project: string; role: string }>('SELECT project, role FROM crew_calls WHERE id = $1', [callId])
      throw new Refused({
        code: 'conflict',
        message: `Two of them have a timesheet for ${call[0] ? `${call[0].role} on ${call[0].project}` : 'the same job'}. One person has one timesheet for a booking, so sort those out first.`,
      })
    }
    const { kept, days } = offerKept(same, (o) => hasSheet.has(o.id))
    if (days.join() !== kept.days.join()) {
      await tx.query('UPDATE offers SET days = $2 WHERE id = $1', [kept.id, JSON.stringify(days)])
      changed.add(kept.id)
    }
    for (const o of same) {
      if (o.id === kept.id) continue
      // A day they said they'd be late on stays, unless the one kept already has it.
      const { rows: stays } = await tx.query<{ id: string }>(
        `UPDATE running_late r SET offer_id = $1, person_id = $3 WHERE offer_id = $2 AND NOT EXISTS (SELECT 1 FROM running_late k WHERE k.offer_id = $1 AND k.day = r.day) RETURNING id`,
        [kept.id, o.id, intoId]
      )
      for (const l of stays) await emit(ctx, 'runningLate', l.id, await getLate(tx, l.id))
      const { rows: late } = await tx.query<{ id: string }>('DELETE FROM running_late WHERE offer_id = $1 RETURNING id', [o.id])
      for (const l of late) await emitRemoved(ctx, 'runningLate', l.id)
      await tx.query(
        `UPDATE calendar_guests g SET offer_id = $1 WHERE offer_id = $2 AND NOT EXISTS (SELECT 1 FROM calendar_guests k WHERE k.offer_id = $1 AND k.day_id = g.day_id)`,
        [kept.id, o.id]
      )
      await tx.query('DELETE FROM calendar_guests WHERE offer_id = $1', [o.id])
      gone.push(o.id)
    }
  }
  if (gone.length) {
    await tx.query('DELETE FROM offers WHERE id = ANY($1::text[])', [gone])
    await emitRemovedAll(ctx, 'offer', gone)
  }
  const { rows: moved } = await tx.query<{ id: string }>('UPDATE offers SET person_id = $1 WHERE person_id = ANY($2::text[]) RETURNING id', [intoId, ids])
  for (const m of moved) changed.add(m.id)
  const sorted = [...changed].sort()
  if (sorted.length) await emitAll(ctx, 'offer', (await getOffers(tx, sorted)).map((o) => ({ id: o.id, data: o })))
}

/**
 * What a person has one of. Their own calendar (ADR 0044): the one kept
 * keeps theirs, or else takes the first of the others', whose id becomes
 * theirs. A leave allowance for a year (ADR 0024): the one kept keeps
 * theirs for a year both have, as it's a setting, not leave taken.
 */
async function moveOneEach(ctx: Ctx, intoId: string, ids: string[]) {
  const { tx } = ctx
  const { rows: cals } = await tx.query<{ id: string }>('SELECT id FROM own_calendars WHERE person_id = ANY($1::text[]) ORDER BY id', [ids])
  const has = await getOwnCalendar(tx, intoId)
  for (const [i, c] of cals.entries()) {
    if (!has && i === 0) {
      await tx.query(
        `INSERT INTO own_calendars (id, person_id, address, added_by, added_at, read_at, tried_at, problem, busy, until_day)
         SELECT $2, $2, address, added_by, added_at, read_at, tried_at, problem, busy, until_day FROM own_calendars WHERE id = $1`,
        [c.id, intoId]
      )
    }
    await tx.query('DELETE FROM own_calendars WHERE id = $1', [c.id])
    await emitRemoved(ctx, 'ownCalendar', c.id)
  }
  if (!has && cals.length) await emit(ctx, 'ownCalendar', intoId, await getOwnCalendar(tx, intoId))

  const { rows: dropped } = await tx.query<{ id: string }>(
    `DELETE FROM leave_allowances a WHERE person_id = ANY($1::text[])
       AND (EXISTS (SELECT 1 FROM leave_allowances k WHERE k.person_id = $2 AND k.year = a.year)
         OR EXISTS (SELECT 1 FROM leave_allowances o WHERE o.person_id = ANY($1::text[]) AND o.year = a.year AND o.id < a.id))
     RETURNING id`,
    [ids, intoId]
  )
  if (dropped.length) await emitRemovedAll(ctx, 'leaveAllowance', dropped.map((d) => d.id))
  const { rows: moved } = await tx.query<{ id: string }>('UPDATE leave_allowances SET person_id = $1 WHERE person_id = ANY($2::text[]) RETURNING id', [intoId, ids])
  for (const m of moved.sort((x, y) => x.id.localeCompare(y.id))) await emit(ctx, 'leaveAllowance', m.id, await getAllowanceById(tx, m.id))
}
