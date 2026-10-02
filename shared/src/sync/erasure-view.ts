import type { Mutation } from '../commands.ts'
import { HOLDING, OPEN, type Offer, type Person } from '../crew.ts'
import { ERASED_REFUSAL, erasedPerson, keptArgs, nameKeptUntil, PERSON_COMMANDS, personNamedBy, type Erasure, type KeptRecords, type PersonRecord } from '../erasure.ts'
import type { LeaveAllowance, LeaveRequest, LieuEntry } from '../leave.ts'
import type { Timesheet } from '../timesheets.ts'
import type { Snapshot, View } from './client.ts'
import type { CrewView, PersonView } from './crew-view.ts'
import type { LeaveView } from './leave-view.ts'

/**
 * Erasing a person (ADR 0027) on a device: who has been erased, with an
 * erasure still waiting to send laid over them as the server will do it,
 * and what the device forgets when the server says someone was erased.
 */

export interface ErasureView extends Erasure {
  pending: boolean
}

/** Erasures by person. */
export type ErasuresView = Readonly<Record<string, ErasureView>>

type Entities = {
  erasure?: Record<string, Erasure>
  offer?: Record<string, Offer>
  timesheet?: Record<string, Timesheet>
  leaveRequest?: Record<string, LeaveRequest>
  lieuEntry?: Record<string, LieuEntry>
  leaveAllowance?: Record<string, LeaveAllowance>
}

/**
 * What a person has on record that keeps their name, from this device's
 * copy: their approved timesheets and their staff leave, read as the
 * server reads its tables (`keptRecords` in server/src/erasure/places.ts),
 * so both decide the same day from the same records.
 */
export function keptRecordsOf(entities: Entities, personId: string): KeptRecords {
  const approvedAt: string[] = []
  for (const o of Object.values(entities.offer ?? {})) {
    const t = o.personId === personId ? entities.timesheet?.[o.id] : undefined
    if (t?.status === 'approved' && t.approvedAt) approvedAt.push(t.approvedAt)
  }
  // Snapshots saved before leave existed have no tables for it.
  const theirs = <T extends { personId: string }>(table: Record<string, T> | undefined) => Object.values(table ?? {}).filter((r) => r.personId === personId)
  return { approvedAt, leave: [...theirs(entities.leaveRequest), ...theirs(entities.lieuEntry), ...theirs(entities.leaveAllowance)] }
}

export function erasuresView(entities: Entities, outbox: readonly (Mutation & { appliedSeq?: number })[], cursor: number, today: string): ErasuresView {
  const out: Record<string, ErasureView> = {}
  // Snapshots saved before erasure existed have no table for it.
  for (const e of Object.values(entities.erasure ?? {})) out[e.id] = { ...e, pending: false }
  for (const m of outbox) {
    if (m.appliedSeq !== undefined && m.appliedSeq <= cursor) continue
    if (m.name !== 'person.erase') continue
    const id = (m.args as { id: string }).id
    out[id] = { id, erasedAt: out[id]?.erasedAt ?? m.createdAt, nameKeptUntil: nameKeptUntil(keptRecordsOf(entities, id), today), pending: true }
  }
  return out
}

/**
 * The crew as it will be once the server has erased whoever is waiting to
 * be: their details gone, their days off with them, and their own notes
 * on their answers. The server sends an erased person with no link
 * secret, so one still holding one has an erasure on its way.
 */
export function withErasures(crew: CrewView, erasures: ErasuresView): CrewView {
  const changed = new Map<string, PersonView>()
  for (const p of crew.people) {
    const e = erasures[p.id]
    if (!e || (!e.pending && p.linkToken === '')) continue
    changed.set(p.id, { ...erasedPerson(p, e.nameKeptUntil !== null), pending: p.pending || e.pending, worked: p.worked })
  }
  if (changed.size === 0) return crew
  return {
    people: crew.people.map((p) => changed.get(p.id) ?? p),
    calls: crew.calls.map((c) =>
      c.offers.some((o) => changed.has(o.personId)) ? { ...c, offers: c.offers.map((o) => (changed.has(o.personId) ? { ...o, note: '', person: changed.get(o.personId) } : o)) } : c
    ),
    unavailability: crew.unavailability.filter((u) => !changed.has(u.personId)),
  }
}

/**
 * Their leave still waiting on an approver, as the refusal says it: a
 * request before a day in lieu, as the server looks. Their leave is kept
 * once they're erased, and nothing more can be decided for them, so one
 * left waiting would sit in the approvers' queue for good.
 */
function undecidedLeave(personId: string, leave: Pick<LeaveView, 'requests' | 'entries'>): string | undefined {
  if (leave.requests.some((r) => r.personId === personId && r.status === 'waiting')) return 'leave'
  if (leave.entries.some((e) => e.personId === personId && e.status === 'waiting')) return 'a day in lieu'
  return undefined
}

/**
 * Why a person can't be erased yet, as the server will say it, or
 * undefined when they can. Only someone archived is offered it at all.
 */
export function eraseRefusal(person: Pick<Person, 'id' | 'name' | 'email' | 'archived'>, view: Pick<View, 'crew' | 'jobs' | 'timesheets' | 'leave' | 'calendar'>, today: string): string | undefined {
  if (!person.archived) return `${person.name} isn't archived. Archive them first, then erase their details.`
  // The earliest of several, as the server picks it, so both say the same job.
  const first = <T extends { start: string; id: string }>(a: T | undefined, b: T) => (!a || b.start < a.start || (b.start === a.start && b.id < a.id) ? b : a)
  let held: { start: string; id: string; job: string; status: Offer['status'] } | undefined
  for (const c of view.crew.calls) {
    if (c.status !== 'open' || c.end < today) continue
    const o = c.offers.find((x) => x.personId === person.id && (OPEN.includes(x.status) || HOLDING.includes(x.status)))
    if (o) held = first(held, { start: c.start, id: c.id, job: c.phase ? `${c.project} (${c.phase})` : c.project, status: o.status })
  }
  if (held) {
    if (OPEN.includes(held.status)) return `${person.name} has an open offer for ${held.job}; withdraw it first.`
    return `${person.name} ${held.status === 'confirmed' ? 'is booked on' : 'has accepted'} ${held.job}, which hasn't ended. Erase their details once it has, or release them first.`
  }
  let contact: { start: string; id: string; job: string } | undefined
  for (const j of view.jobs.jobs)
    for (const p of j.phases) if (p.contactId === person.id && p.end >= today) contact = first(contact, { start: p.start, id: p.id, job: `${j.name} (${p.name})` })
  if (contact) return `${person.name} is the contact on the day for ${contact.job}, which hasn't ended. Choose someone else first.`
  const waiting = view.timesheets.toApprove.find((r) => r.offer.personId === person.id)
  if (waiting) return `${person.name} has a timesheet waiting on ${waiting.call.project}: approve it first, so their pay is on record.`
  const leave = undecidedLeave(person.id, view.leave)
  if (leave) return `${person.name} has ${leave} waiting for a decision: decide it on the Leave screen first, so their leave records say how it ended.`
  const account = view.calendar.link?.state !== 'off' ? view.calendar.link?.account : undefined
  if (account && person.email && account.trim().toLowerCase() === person.email.trim().toLowerCase())
    return `${person.name}'s Google account writes the jobs to Google Calendar: connect another account on the Account tab first.`
  return undefined
}

/**
 * The server has erased someone: forget what this device still holds
 * about them outside its copy of the records, which arrive erased on their
 * own. A change of theirs still waiting to send would only be turned down,
 * so it's set aside now as a problem saying why; one sent already is
 * forgotten if sending it again could only be turned down, and stripped
 * otherwise; problems are stripped. Called as the erasure arrives, which
 * the server sends before the records it removes, so their offers and
 * leave are still here to say whose a change was.
 */
export function forgetErased(state: Snapshot, erasure: Erasure, at: string) {
  const entities = state.entities as Snapshot['entities'] & Entities
  const personOf = (record: PersonRecord, id: string) => entities[record]?.[id]?.personId
  const theirs = (m: Mutation) => personNamedBy(m.name, m.args, personOf) === erasure.id
  // Their record as it was, still: it arrives erased after this.
  const held = entities.person?.[erasure.id]
  const nameNow = erasedPerson({ id: erasure.id, kind: 'freelancer', name: held?.name ?? '' }, erasure.nameKeptUntil !== null).name
  const strip = <M extends Mutation>(m: M): M => ({ ...m, args: keptArgs(m.name, m.args, nameNow) as M['args'] })
  const refused = (m: Mutation) => PERSON_COMMANDS[m.name]?.refused === true

  const outbox: typeof state.outbox = []
  for (const m of state.outbox) {
    if (!theirs(m)) outbox.push(m)
    else if (m.appliedSeq === undefined && refused(m))
      state.problems.push({ mutation: strip({ id: m.id, name: m.name, args: m.args, createdAt: m.createdAt }), reason: { code: 'conflict', message: ERASED_REFUSAL }, at })
    else if (!refused(m)) outbox.push(strip(m))
  }
  state.outbox = outbox
  if (state.sent) state.sent = state.sent.filter((m) => !(theirs(m) && refused(m))).map((m) => (theirs(m) ? strip(m) : m))
  state.problems = state.problems.map((p) => (theirs(p.mutation) ? { ...p, mutation: strip(p.mutation) } : p))
}
