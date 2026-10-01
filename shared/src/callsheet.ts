import { daysLabel, eachDay, firstName, type OfferStatus } from './crew.ts'
import { mapLink, type Contact, type Venue } from './jobs.ts'
import { DEPARTMENTS, DEPARTMENT_LABELS, type Department } from './stock.ts'

/**
 * Call sheets (ADR 0021): the day sheet for one phase of a job, from what
 * the app already holds. The office sees it in the app, and everyone
 * booked on the phase gets their own on their private link. What each
 * reader is shown is decided here, once:
 *
 * - the office: everything, crew still to answer and their numbers, the
 *   client's contacts and the phase's kit;
 * - the contact on the day: the crew booked and their numbers, and the
 *   kit, as a crew chief needs (docs/architecture.md, "What lives on the
 *   device");
 * - everyone else on it: who else is on by name and role, and the
 *   contact's number. Never another person's number or rate.
 *
 * Job, phase and venue notes are shown to everyone: they already go on the
 * calendar events crew are invited to (ADR 0008).
 */

export type SheetReader = 'office' | 'contact' | 'crew'

export interface SheetPerson {
  id: string
  name: string
  phone: string | null
}

export interface SheetCall {
  id: string
  role: string
  start: string
  end: string
  callTime: string | null
  needed: number
  details: string
  status: 'open' | 'cancelled'
  offers: readonly { personId: string; status: OfferStatus; days: readonly string[] }[]
}

export interface SheetKitLine {
  department: Department
  name: string
  qty: number
  subhireQty: number
  supplier: string
}

export interface SheetInput {
  job: { name: string; notes: string }
  client: { name: string; contacts: readonly Contact[] } | null
  /** Null for a crew call that isn't for one phase. */
  phase: { name: string; start: string; end: string; notes: string } | null
  venue: Pick<Venue, 'name' | 'address' | 'notes'> | null
  contact: SheetPerson | null
  calls: readonly SheetCall[]
  people: ReadonlyMap<string, SheetPerson>
  /** The phase's own kit and the whole job's. */
  kit: readonly SheetKitLine[]
  /** Who is reading, so their own line stands out; not for the office. */
  readerId?: string
}

export type CrewStatus = 'booked' | 'to confirm' | 'offered'

export interface SheetCrew {
  personId: string
  name: string
  /** Only for the office and the contact on the day. */
  phone?: string | null
  /** Only when not all the call's days. */
  days?: string
  status: CrewStatus
  me: boolean
}

export interface SheetCallView {
  id: string
  role: string
  callTime: string | null
  /** Only when not the phase's days. */
  days?: string
  details: string
  crew: SheetCrew[]
  /** Places still to fill on its busiest day; not shown to crew. */
  toFind?: number
}

export interface CallSheet {
  reader: SheetReader
  job: string
  client: { name: string; contacts?: readonly Contact[] } | null
  phase: string
  days: string[]
  /** "Sat 3 Oct to Sun 4 Oct". */
  when: string
  venue: { name: string; address: string; notes: string; map: string } | null
  contact: { name: string; phone: string | null; me: boolean } | null
  notes: { job: string; phase: string }
  calls: SheetCallView[]
  /** By department; only for the office and the contact on the day. */
  kit?: { department: string; lines: { name: string; qty: number; note: string }[] }[]
}

const SHOWN: Record<SheetReader, readonly OfferStatus[]> = {
  office: ['confirmed', 'accepted', 'offered', 'countered'],
  contact: ['confirmed', 'accepted'],
  crew: ['confirmed'],
}

/** The address as typed, without its first line when that's just the venue's name again. */
function addressAfter(name: string, address: string): string {
  const lines = address.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
  if (lines[0]?.toLowerCase() === name.trim().toLowerCase()) lines.shift()
  return lines.join('\n')
}

const statusOf = (s: OfferStatus): CrewStatus => (s === 'confirmed' ? 'booked' : s === 'accepted' ? 'to confirm' : 'offered')

export function callSheet(input: SheetInput, reader: SheetReader): CallSheet {
  const calls = input.calls.filter((c) => c.status === 'open')
  const first = calls.reduce<string | undefined>((a, c) => (!a || c.start < a ? c.start : a), undefined)
  const last = calls.reduce<string | undefined>((a, c) => (!a || c.end > a ? c.end : a), undefined)
  const start = input.phase?.start ?? first
  const end = input.phase?.end ?? last
  const days = start && end ? eachDay(start, end) : []
  const phones = reader !== 'crew'

  const views: SheetCallView[] = calls
    .map((c) => {
      const callDays = eachDay(c.start, c.end)
      const crew = c.offers
        .filter((o) => SHOWN[reader].includes(o.status) || (o.personId === input.readerId && (o.status === 'accepted' || o.status === 'confirmed')))
        .map((o): SheetCrew => {
          const p = input.people.get(o.personId)
          const own = o.days.filter((d) => callDays.includes(d))
          return {
            personId: o.personId,
            name: p?.name ?? 'Someone',
            ...(phones ? { phone: p?.phone ?? null } : {}),
            ...(own.length && own.length !== callDays.length ? { days: daysLabel(own) } : {}),
            status: statusOf(o.status),
            me: o.personId === input.readerId,
          }
        })
        .sort((a, b) => Number(b.me) - Number(a.me) || a.name.localeCompare(b.name, 'en-IE'))
      const held = callDays.map((d) => c.offers.filter((o) => (o.status === 'accepted' || o.status === 'confirmed') && o.days.includes(d)).length)
      const toFind = Math.max(0, ...held.map((n) => c.needed - n))
      return {
        id: c.id,
        role: c.role,
        callTime: c.callTime,
        ...(c.start !== start || c.end !== end ? { days: daysLabel(callDays) } : {}),
        details: c.details.trim(),
        crew,
        ...(reader !== 'crew' ? { toFind } : {}),
      }
    })
    .sort((a, b) => (a.callTime ?? '99').localeCompare(b.callTime ?? '99') || a.role.localeCompare(b.role, 'en-IE'))

  const sheet: CallSheet = {
    reader,
    job: input.job.name,
    client: input.client ? { name: input.client.name, ...(reader === 'office' ? { contacts: input.client.contacts } : {}) } : null,
    phase: input.phase?.name ?? '',
    days,
    when: daysLabel(days),
    venue: input.venue
      ? { name: input.venue.name, address: addressAfter(input.venue.name, input.venue.address), notes: input.venue.notes.trim(), map: mapLink(input.venue) }
      : null,
    contact: input.contact ? { name: input.contact.name, phone: input.contact.phone, me: input.contact.id === input.readerId } : null,
    notes: { job: input.job.notes.trim(), phase: input.phase?.notes.trim() ?? '' },
    calls: views,
  }
  if (reader !== 'crew') {
    const byDept = new Map<Department, { name: string; qty: number; note: string }[]>()
    for (const l of input.kit) {
      const own = l.qty - l.subhireQty
      const note = l.subhireQty > 0 ? `${own > 0 ? `${own} ours, ` : ''}${l.subhireQty} from ${l.supplier || 'a supplier'}` : ''
      const lines = byDept.get(l.department) ?? []
      const same = lines.find((x) => x.name === l.name && !x.note && !note)
      if (same) same.qty += l.qty
      else lines.push({ name: l.name, qty: l.qty, note })
      byDept.set(l.department, lines)
    }
    sheet.kit = DEPARTMENTS.filter((d) => byDept.has(d)).map((d) => ({
      department: DEPARTMENT_LABELS[d],
      lines: byDept.get(d)!.sort((a, b) => a.name.localeCompare(b.name, 'en-IE')),
    }))
  }
  return sheet
}

/**
 * The sheet as a message, to paste into a crew's WhatsApp group: what
 * everyone on it may see, whoever copies it, so never anyone's number but
 * the contact's.
 */
export function callSheetText(s: CallSheet): string {
  const lines: string[] = [`${s.job}${s.phase ? `: ${s.phase}` : ''}`, s.when]
  if (s.venue) lines.push('', `At ${s.venue.name}${s.venue.address ? `, ${s.venue.address.replace(/\s*\r?\n\s*/g, ', ')}` : ''}`, s.venue.map)
  if (s.venue?.notes) lines.push(s.venue.notes)
  if (s.contact) lines.push('', `On the day, ring ${s.contact.name}${s.contact.phone ? ` on ${s.contact.phone}` : ''}`)
  lines.push('')
  for (const c of s.calls) {
    const booked = c.crew.filter((p) => p.status === 'booked')
    lines.push(`${c.callTime ? `${c.callTime} ` : ''}${c.role}${c.days ? ` (${c.days})` : ''}: ${booked.length ? booked.map((p) => p.name).join(', ') : 'to be confirmed'}`)
  }
  if (s.notes.phase) lines.push('', s.notes.phase)
  if (s.notes.job) lines.push('', s.notes.job)
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim()
}

/** Sending someone the sheet on their private link, by WhatsApp, text or email. */
export function sheetMessage(p: { name: string; knownAs?: string | null }, s: Pick<CallSheet, 'job' | 'phase' | 'when'>, link: string): { text: string; subject: string } {
  const first = firstName(p)
  return {
    text: `Hi ${first}, here's the call sheet for ${s.job}${s.phase ? ` (${s.phase})` : ''}, ${s.when}: who's on, where, and who to ring on the day.\n${link}`,
    subject: `Call sheet: ${s.job}, ${s.when}`,
  }
}
