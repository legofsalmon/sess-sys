import { z } from 'zod'
import { CERTIFICATE_KINDS, HOLDING, NOTES_LENGTH, type Certificate, type Certificates, type Offer, type OfferStatus, type Person } from './crew.ts'
import { phoneDigits } from './crew-import.ts'
import { nameFromEmail, nameKey } from './import.ts'

/**
 * Combining people who came in twice (ADR 0055): someone a bring-in met
 * under two addresses (their own and the company's, say) is two people in
 * the app, with half their bookings each. Combining keeps one of them and
 * makes the others part of it: every booking, offer, timesheet, day off,
 * leave record, document and history entry is theirs, and every address
 * they had stays with them, so the next bring-in and their Google sign-in
 * find the one person. Nothing here changes anything; the person page and
 * Jobs › Tidy up send `person.merge` once the office has chosen.
 */

const id = z.string().min(1).max(64)

/** At most this many people made part of one at a time: a person brought in twice or three times, not a list. */
export const MERGE_AT_ONCE = 10
/** The addresses one person can answer to besides their own. */
export const OTHER_EMAILS_MAX = 20

export const mergeCommandSchemas = {
  /**
   * Make `from` part of `id`: `id`'s details are kept, any it lacks filled
   * from the others, and the others are removed. It can't be split again in
   * one go.
   */
  'person.merge': z
    .object({ id, from: z.array(id).min(1, 'Pick someone to combine them with.').max(MERGE_AT_ONCE, `Up to ${MERGE_AT_ONCE} people at a time, please.`) })
    .refine((m) => !m.from.includes(m.id) && new Set(m.from).size === m.from.length, { message: 'Pick each person once.' }),
  /**
   * Make one of the addresses `id` also answers to their main one, the one
   * shown and written to; the main one they had joins the others. They
   * answer to the same addresses as before, so whoever signs in as them
   * still does, with the same role (ADR 0064).
   */
  'person.mainEmail': z.object({ id, email: z.string().min(1).max(200) }),
}

/** A name the bring-in made from their address, archived or not ("Craicaudio" from craicaudio@gmail.com), as Tidy up finds them. */
const namedFromAddress = (p: Pick<Person, 'name' | 'email'>) => !!p.email && nameKey(p.name) === nameKey(nameFromEmail(p.email))

/** An address as it's matched: trimmed, in any case. */
export const emailKey = (e: string | null | undefined) => (e ?? '').trim().toLowerCase()

/** Every address a person answers to: their own first, then those they had as someone they were combined with. */
export function emailsOf(p: Pick<Person, 'email'> & { otherEmails?: readonly string[] }): string[] {
  return [...new Set([p.email, ...(p.otherEmails ?? [])].map(emailKey).filter(Boolean))]
}

/**
 * A person's addresses with one of their others made the main one (ADR
 * 0064): the same addresses, so a bring-in and their sign-in find them as
 * before, with the main one they had first among the others. Nothing when
 * it isn't one of their others.
 */
export function withMainEmail(p: Pick<Person, 'email'> & { otherEmails?: readonly string[] }, email: string): { email: string; otherEmails: string[] } | undefined {
  const wanted = emailKey(email)
  if (!wanted || !(p.otherEmails ?? []).map(emailKey).includes(wanted)) return undefined
  return { email: wanted, otherEmails: emailsOf(p).filter((e) => e !== wanted) }
}

/** A certificate's entry worth keeping of two: one held over one not, then the later expiry, then the one with a note. */
function betterCertificate(a: Certificate | undefined, b: Certificate | undefined): Certificate | undefined {
  if (!a || !b) return a ?? b
  if ((a.held === true) !== (b.held === true)) return a.held === true ? a : b
  if (a.held === null && b.held !== null) return b
  if ((a.expires ?? '') !== (b.expires ?? '')) return (a.expires ?? '') >= (b.expires ?? '') ? a : b
  return a.note || !b.note ? a : b
}

/**
 * The one person, as combining leaves them, on the server and on a device
 * alike. Theirs is kept where they have it, and filled from the others
 * where they don't: the email, phone, rate, department, name they go by
 * and company. A name the bring-in made from an address gives way to a
 * real one. Skills and addresses are all kept, the notes joined, the
 * highest level and the best of each certificate kept; they approve time
 * off if any did, and are archived only if every one was. Their link is
 * the kept person's (the others' links still open it: the server says so).
 * Every field is named, so one added to a person fails to compile here
 * until someone says how it combines.
 */
export function mergedPerson(into: Person, from: readonly Person[]): Person {
  const all = [into, ...from]
  const first = <T,>(pick: (p: Person) => T | null | undefined): T | null => all.map(pick).find((v) => v !== null && v !== undefined && v !== '') ?? null
  const realName = namedFromAddress(into) ? from.find((p) => !namedFromAddress(p) && p.name.trim()) : undefined
  const email = first((p) => p.email?.trim())
  const emails = all.flatMap(emailsOf)
  const notes = [...new Set(all.map((p) => p.notes.trim()).filter(Boolean))].join('\n\n')
  const certificates: Certificates = {}
  for (const kind of CERTIFICATE_KINDS) {
    const best = all.reduce<Certificate | undefined>((b, p) => betterCertificate(b, p.certificates[kind]), undefined)
    if (best) certificates[kind] = best
  }
  return {
    id: into.id,
    name: realName?.name ?? into.name,
    kind: into.kind,
    email,
    otherEmails: [...new Set(emails)].filter((e) => e !== emailKey(email)).slice(0, OTHER_EMAILS_MAX),
    phone: first((p) => p.phone?.trim()),
    // Each skill once, spelt as the kept person has it.
    skills: all
      .flatMap((p) => p.skills.map((s) => s.trim()))
      .filter((s, i, list) => s && list.findIndex((t) => t.toLowerCase() === s.toLowerCase()) === i)
      .slice(0, 30),
    dayRateCents: first((p) => p.dayRateCents),
    notes: notes.length > NOTES_LENGTH ? `${notes.slice(0, NOTES_LENGTH - 1)}…` : notes,
    linkToken: into.linkToken,
    archived: all.every((p) => p.archived),
    approvesLeave: into.kind === 'staff' && all.some((p) => p.approvesLeave),
    department: first((p) => p.department),
    level: Math.max(...all.map((p) => p.level)),
    knownAs: first((p) => p.knownAs),
    certificates,
    company: first((p) => p.company),
    role: into.kind === 'staff' ? first((p) => (p.kind === 'staff' ? p.role : null)) : null,
  }
}

/**
 * Why these can't be combined as they stand, in words the office can act
 * on, or nothing. Checked on the server and before the question on a
 * device. Who signs in as what stays clear: two different roles, or a
 * role kept on a freelancer, which has none, would change it.
 */
export function mergeRefusal(into: Pick<Person, 'name' | 'kind' | 'role'>, from: readonly Pick<Person, 'name' | 'kind' | 'role'>[]): string | undefined {
  const holders = [into, ...from].filter((p) => p.kind === 'staff' && p.role)
  const roles = new Set(holders.map((p) => p.role))
  if (roles.size > 1) return `${holders.map((p) => p.name).join(' and ')} have different roles. Give them the same role first, so it's clear what the one person signs in as.`
  const lost = into.kind === 'freelancer' ? from.find((p) => p.kind === 'staff' && p.role) : undefined
  if (lost) return `${lost.name} has a role and ${into.name} is a freelancer, who has none. Keep ${lost.name}'s details instead.`
  return undefined
}

/** How far along an offer is, for which of two on the same call the one person keeps: a booking over an answer over a question. */
const STATUS_RANK: Record<OfferStatus, number> = { confirmed: 7, accepted: 6, countered: 5, offered: 4, 'pulled-out': 3, declined: 2, filled: 1, cancelled: 0 }

/**
 * Two of the people offered the same call, which is one person offered it
 * twice once they're combined: the one kept is the one with a timesheet,
 * or else the furthest along, or else the first made. A booking keeps
 * the days the other held as well.
 */
export function offerKept<O extends Pick<Offer, 'id' | 'status' | 'days'>>(offers: readonly O[], hasTimesheet: (o: O) => boolean = () => false): { kept: O; days: string[] } {
  const kept = [...offers].sort((a, b) => Number(hasTimesheet(b)) - Number(hasTimesheet(a)) || STATUS_RANK[b.status] - STATUS_RANK[a.status] || a.id.localeCompare(b.id))[0]!
  const days = HOLDING.includes(kept.status) ? [...new Set(offers.filter((o) => HOLDING.includes(o.status)).flatMap((o) => o.days))].sort() : kept.days
  return { kept, days }
}

/** Why two people look like one. */
export type SameBecause = 'name' | 'phone' | 'address' | 'first-name'

export interface SamePerson<P> {
  /** Stable while the same people are in it: the first person's id. */
  key: string
  people: P[]
  because: SameBecause
  /**
   * The same name, number or address-made name: ticked to start with. A
   * name from an address that is only someone's first name ("Adam" and
   * "Adam Byrne") is left for the office to tick: a wrong tick joins two
   * people's work.
   */
  sure: boolean
}

/** "John Murphy", "john.murphy@…" and "johnmurphy@…" alike: letters and digits only. */
const squashed = (s: string) => nameKey(s).replace(/ /g, '')

/**
 * People who look like one person brought in twice (ADR 0055): the same
 * name, the same phone number, or an address that spells another's name
 * ("johnmurphy@gmail.com" and John Murphy). Someone named from their
 * address whose name is one word is also offered beside the one other
 * person whose first name it is. Archived people are left out, as they
 * are everywhere crew are offered.
 */
export function samePeople<P extends Pick<Person, 'id' | 'name' | 'email' | 'phone' | 'archived'> & { otherEmails?: readonly string[] }>(all: readonly P[]): SamePerson<P>[] {
  const people = all.filter((p) => !p.archived).sort((a, b) => a.id.localeCompare(b.id))
  const parent = people.map((_, i) => i)
  const why = people.map((): SameBecause | undefined => undefined)
  const root = (i: number): number => (parent[i] === i ? i : (parent[i] = root(parent[i]!)))
  const join = (i: number, j: number, because: SameBecause) => {
    const [a, b] = [root(i), root(j)].sort((x, y) => x - y) as [number, number]
    if (a === b) return
    parent[b] = a
    // A group is as sure as its weakest link; otherwise it says the first reason found.
    const reasons = [why[a], why[b], because].filter((w): w is SameBecause => w !== undefined)
    why[a] = reasons.includes('first-name') ? 'first-name' : reasons[0]
  }
  const byKey = (key: (p: P) => string[], because: SameBecause) => {
    const seen = new Map<string, number>()
    people.forEach((p, i) => {
      for (const k of new Set(key(p).filter(Boolean))) {
        const at = seen.get(k)
        if (at === undefined) seen.set(k, i)
        else join(at, i, because)
      }
    })
  }
  // A one-word name is too often shared ("Adam") to say two people are one by itself; a full name isn't.
  byKey((p) => [nameKey(p.name).includes(' ') ? nameKey(p.name) : ''], 'name')
  byKey((p) => [phoneDigits(p.phone).length >= 7 ? phoneDigits(p.phone) : ''], 'phone')
  // Each name, and each address's own part as a name, squashed: "johnmurphy" is John Murphy, and j.murphy@ is j.murphy@ wherever.
  byKey((p) => [squashed(p.name).length >= 6 ? squashed(p.name) : '', ...emailsOf(p).map((e) => squashed(nameFromEmail(e))).filter((k) => k.length >= 6)], 'address')

  // "Adam", named from adam@…, beside the one Adam with a surname.
  const firstNames = new Map<string, number[]>()
  people.forEach((p, i) => {
    const words = nameKey(p.name).split(' ')
    if (words.length > 1) firstNames.set(words[0]!, [...(firstNames.get(words[0]!) ?? []), i])
  })
  people.forEach((p, i) => {
    const key = nameKey(p.name)
    if (key.includes(' ') || key.length < 3 || !namedFromAddress(p)) return
    const them = firstNames.get(key)
    if (them?.length === 1) join(them[0]!, i, 'first-name')
  })

  const groups = new Map<number, P[]>()
  people.forEach((p, i) => groups.set(root(i), [...(groups.get(root(i)) ?? []), p]))
  return [...groups.entries()]
    .filter(([, g]) => g.length > 1)
    .map(([r, g]) => ({ key: g[0]!.id, people: g, because: why[r] ?? 'name', sure: why[r] !== 'first-name' }))
    .sort((a, b) => nameKey(a.people[0]!.name).localeCompare(nameKey(b.people[0]!.name)))
}

/** Why a group was put together, in a few words for the Tidy up page. */
export const SAME_BECAUSE_WORDS: Record<SameBecause, string> = {
  name: 'The same name',
  phone: 'The same phone number',
  address: 'An address that spells the name',
  'first-name': 'A first name, from an address',
}

/**
 * Which of a group is kept as the one person, to start with: staff over
 * freelancer (the company gave them an address), a real name over one
 * made from an address, then whoever has more offers.
 */
export function keptOf<P extends Pick<Person, 'id' | 'kind' | 'name' | 'email' | 'archived'>>(group: readonly P[], offers: (p: P) => number = () => 0): P {
  return [...group].sort(
    (a, b) =>
      Number(b.kind === 'staff') - Number(a.kind === 'staff') ||
      Number(namedFromAddress(a)) - Number(namedFromAddress(b)) ||
      offers(b) - offers(a) ||
      a.id.localeCompare(b.id),
  )[0]!
}
