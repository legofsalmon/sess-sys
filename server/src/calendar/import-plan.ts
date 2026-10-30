import {
  addDays,
  daysLabel,
  eachDay,
  MAX_PHASE_DAYS,
  nameKey,
  nameFromEmail,
  KIND_PHASE,
  PHASE_NAMES,
  type GuestResponse,
  type ImportChanged,
  type ImportLeftOut,
  type LeftOutReason,
  type ProjectKind,
} from '@sh/shared'
import type { AppData, Chosen, EventDay, NewPerson, Noted, PersonRef, Plan, PlanJob, PlanRun, SourceEvent, SourceGuest, VenueRef } from './import-plan-types.ts'
import { fit, parseTitle, plainText, tidy } from './import-titles.ts'

export * from './import-plan-types.ts'
export { departmentDay, kindFromName, parseTitle, phasesAndNote, phasesOf, plainText, type ParsedTitle } from './import-titles.ts'

/**
 * Working out what the events on a calendar are as jobs (ADR 0011): titles
 * into jobs and phases, events into jobs, locations into venues, guests
 * into crew, and what is left out and why. Pure, so every guess can be
 * tested; import.ts reads the calendar and the app, and saves the result.
 *
 * What the first real calendars taught it (ADR 0037): a title says what
 * kind of job it is (a hire, a collection, a meeting), a phase word can
 * have a note after it, and days gone are the record of who worked, not
 * offers still waiting.
 */

/**
 * A job's key: its name and the first of its events as it was looked at, so
 * a job found again with an earlier day added, or a later one, is still the
 * job chosen (audit, 20 October 2026, finding 52). The name never holds "|".
 */
const jobKey = (name: string, uid: string) => `${name}|${uid}`
/** The event a job's key names. */
export const keyEvent = (key: string) => key.slice(key.indexOf('|') + 1)

/** Events more than this many days apart are separate jobs, even with the same name. */
export const GAP_DAYS = 14
/** An all-day event longer than this is not a gig day. */
export const LONGEST_EVENT_DAYS = 31
/** Phase notes and job notes hold at most this much (ADR 0007). */
const PHASE_NOTES = 2000
const JOB_NOTES = 4000

export { nameKey, nameFromEmail, KIND_PHASE }

/** Addresses of people's own email, rather than a company's: guests there are likely crew. */
const OWN_EMAIL = new Set([
  'gmail.com',
  'googlemail.com',
  'hotmail.com',
  'hotmail.co.uk',
  'hotmail.ie',
  'outlook.com',
  'outlook.ie',
  'live.com',
  'live.ie',
  'live.co.uk',
  'msn.com',
  'icloud.com',
  'me.com',
  'mac.com',
  'yahoo.com',
  'yahoo.co.uk',
  'yahoo.ie',
  'ymail.com',
  'gmx.com',
  'gmx.net',
  'gmx.de',
  'gmx.ie',
  'eircom.net',
  'proton.me',
  'protonmail.com',
  'aol.com',
])

/** A shared mailbox rather than a person, at any domain: never crew. */
const MAILBOXES = /^(?:info|accounts|office|hello|admin|bookings?|sales|support|hire|enquiries|contact|mail|team|noreply|no-reply)$/i

/** "info@sessionhire.com": a company's mailbox, not someone who can be on a crew. */
export function isMailbox(email: string): boolean {
  return MAILBOXES.test(email.split('@')[0] ?? '')
}

const RANK: Record<GuestResponse, number> = { declined: 0, needsAction: 1, tentative: 2, accepted: 3 }

/** A guest on one event, as a day's answer: a Yes on any event that day beats waiting, which beats a No. */
const better = (a: GuestResponse | undefined, b: GuestResponse): GuestResponse => (a && RANK[a] >= RANK[b] ? a : b)

interface Entry {
  day: string
  event: SourceEvent
  job: string
  key: string
  phases: string[]
  note: string
  guessed: boolean
  pencilled: boolean
  kind: ProjectKind
}

interface Cluster {
  key: string
  name: string
  kind: ProjectKind
  entries: Entry[]
  /** Its entries before those the job already has were dropped. */
  seen: Entry[]
  existing: AppData['jobs'][number] | null
}

/** The entries' guessed phases as the kind's own: a hire's day is Hire, not Show. */
const withKind = (entries: Entry[], kind: ProjectKind): Entry[] => entries.map((e) => (e.guessed ? { ...e, phases: [KIND_PHASE[kind]] } : e))

/** Each event's days once, in order. */
const uniqueDays = (entries: Entry[]): EventDay[] => {
  const out = new Map<string, EventDay>()
  for (const e of entries) out.set(`${e.event.uid}/${e.day}`, { uid: e.event.uid, eventId: e.event.id, day: e.day, title: e.event.title })
  return [...out.values()].sort((a, b) => a.day.localeCompare(b.day) || a.uid.localeCompare(b.uid))
}
const daysApart = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000)
const mostCommon = <T,>(items: T[], keyOf: (t: T) => string): T | undefined => {
  const counts = new Map<string, { item: T; n: number }>()
  for (const item of items) {
    const k = keyOf(item)
    const c = counts.get(k)
    if (c) c.n++
    else counts.set(k, { item, n: 1 })
  }
  let best: { item: T; n: number } | undefined
  for (const c of counts.values()) if (!best || c.n > best.n) best = c
  return best?.item
}
const phaseOrder = (name: string) => {
  const i = (PHASE_NAMES as readonly string[]).indexOf(name)
  return i < 0 ? PHASE_NAMES.length : i
}

class LeftOut {
  private readonly by = new Map<LeftOutReason, { count: number; examples: string[] }>()
  add(reason: LeftOutReason, title: string, n = 1) {
    const r = this.by.get(reason) ?? { count: 0, examples: [] }
    this.by.set(reason, r)
    r.count += n
    const t = title.trim()
    if (t && r.examples.length < 3 && !r.examples.includes(t)) r.examples.push(t)
  }
  list(): ImportLeftOut[] {
    return [...this.by].map(([reason, r]) => ({ reason, ...r }))
  }
}

export interface PlanOptions {
  /** The connected Google account: its address is never crew, and people at its domain are staff. */
  account: string
  /** The calendar read, and the days read from it: events brought in from it on those days and gone now have been deleted or moved. */
  calendarId: string
  from: string
  to: string
  /** Days before this are gone: a Yes on them is a booking, and anything else is noted rather than offered. */
  today: string
}

/**
 * What the events are as jobs. Without `chosen`, what the import screen
 * shows first; with it, what the office ticked, under the names they gave,
 * with two jobs given the same new name brought in as one.
 */
export function planImport(events: readonly SourceEvent[], app: AppData, { account, calendarId, from, to, today }: PlanOptions, chosen?: Chosen): Plan {
  const leftOut = new LeftOut()
  const imported = new Map<string, AppData['imported']>()
  for (const i of app.imported) imported.set(i.uid, [...(imported.get(i.uid) ?? []), i])

  // Events into days of jobs.
  const entries: Entry[] = []
  let read = 0
  for (const ev of events) {
    if (ev.cancelled) continue
    read++
    const reason: LeftOutReason | undefined = ev.ours
      ? 'ours'
      : ev.special
        ? 'special'
        : !ev.days
          ? 'timed'
          : ev.repeating
            ? 'repeating'
            : !ev.title.trim()
              ? 'untitled'
              : imported.has(ev.uid)
                ? 'before'
                : daysApart(ev.days.start, ev.days.end) + 1 > LONGEST_EVENT_DAYS
                  ? 'long'
                  : undefined
    if (reason) {
      leftOut.add(reason, ev.title)
      continue
    }
    const t = parseTitle(ev.title)
    const key = nameKey(t.job)
    for (const day of eachDay(ev.days!.start, ev.days!.end))
      entries.push({ day, event: ev, job: t.job, key, phases: t.phases, note: t.note, guessed: t.guessed, pencilled: t.pencilled, kind: t.kind })
  }
  entries.sort((a, b) => a.day.localeCompare(b.day) || a.event.id.localeCompare(b.event.id))

  // Days into jobs: the same name, unless far apart.
  const clusters: Cluster[] = []
  const open = new Map<string, Cluster>()
  for (const e of entries) {
    const c = open.get(e.key)
    if (c && daysApart(c.entries.at(-1)!.day, e.day) <= GAP_DAYS) {
      c.entries.push(e)
      continue
    }
    const next: Cluster = { key: jobKey(e.key, e.event.uid), name: e.job, kind: e.kind, entries: [e], seen: [], existing: null }
    clusters.push(next)
    open.set(e.key, next)
  }
  for (const c of clusters) {
    c.name = mostCommon(c.entries, (e) => e.job)!.job
    c.kind = mostCommon(c.entries, (e) => e.kind)!.kind
    c.seen = c.entries
  }

  // Jobs already in the app with that name, or brought in from events with it, near those days.
  const broughtIn = new Map<string, Set<string>>()
  for (const i of app.imported) {
    const key = nameKey(parseTitle(i.title).job)
    broughtIn.set(key, (broughtIn.get(key) ?? new Set()).add(i.projectId))
  }
  // The app's jobs by name and by id, looked up rather than searched for each job found (audit, 20 October 2026, finding
  // 18): a season is a few thousand events against several hundred jobs.
  const jobAt = new Map(app.jobs.map((j, i) => [j, i]))
  const jobsNamed = new Map<string, AppData['jobs']>()
  for (const j of app.jobs) {
    const k = nameKey(j.name)
    jobsNamed.set(k, [...(jobsNamed.get(k) ?? []), j])
  }
  const jobById = new Map(app.jobs.map((j) => [j.id, j]))
  const kept: Cluster[] = []
  for (const c of clusters) {
    const first = c.entries[0]!.day
    const last = c.entries.at(-1)!.day
    const key = c.entries[0]!.key
    const named = new Set([...(jobsNamed.get(key) ?? []), ...[...(broughtIn.get(key) ?? [])].flatMap((id) => jobById.get(id) ?? [])])
    // In the order the app listed them, as when each was searched for.
    const near = [...named]
      .sort((a, b) => jobAt.get(a)! - jobAt.get(b)!)
      .filter((j) => j.phases.some((p) => p.end >= addDays(first, -GAP_DAYS) && p.start <= addDays(last, GAP_DAYS)))
    const job = near[0]
    if (job && (job.status === 'cancelled' || job.status === 'lost')) {
      for (const e of c.entries) leftOut.add('stopped', e.event.title, e.phases.length)
      continue
    }
    if (job && job.sourceCalendar === null) {
      for (const e of c.entries) leftOut.add('inApp', e.event.title, e.phases.length)
      continue
    }
    if (job) {
      // Days the job already has, as the same phase, stay as they are; new days are of the job's kind.
      c.existing = job
      c.kind = job.kind
      c.entries = withKind(c.entries, job.kind)
        .map((e) => {
          const has = e.phases.filter((p) => job.phases.some((jp) => nameKey(jp.name) === nameKey(p) && jp.start <= e.day && e.day <= jp.end))
          for (let i = 0; i < has.length; i++) leftOut.add('inApp', e.event.title)
          return { ...e, phases: e.phases.filter((p) => !has.includes(p)) }
        })
        .filter((e) => e.phases.length > 0)
      if (c.entries.length === 0) continue
    }
    kept.push(c)
  }

  // Each job chosen is the job found now that holds one of its events, whatever its first day is now (finding 52).
  const asked = new Set<string>()
  if (chosen) {
    const byEvent = new Map<string, string[]>()
    for (const k of new Set([...chosen.names.keys(), ...chosen.include])) byEvent.set(keyEvent(k), [...(byEvent.get(keyEvent(k)) ?? []), k])
    for (const c of kept) {
      const matched = [...new Set(c.seen.map((e) => e.event.uid))].flatMap((uid) => byEvent.get(uid) ?? [])
      if (matched.length === 0) continue
      for (const k of matched) asked.add(k)
      c.key = matched.find((k) => chosen.include.has(k)) ?? matched[0]!
    }
  }

  // What the office chose: which jobs, what kind each is, and names that bring two in as one.
  let groups: { clusters: Cluster[]; name: string; kind: ProjectKind }[] = kept.map((c) => ({ clusters: [c], name: c.name, kind: c.kind }))
  if (chosen) {
    const renamed = (c: Cluster) => {
      const name = tidy(chosen.names.get(c.key) ?? '')
      return name && !c.existing ? name : c.name
    }
    const kindOf = (c: Cluster) => (c.existing ? c.kind : (chosen.kinds?.get(c.key) ?? c.kind))
    groups = []
    const byName = new Map<string, { clusters: Cluster[]; name: string; kind: ProjectKind }>()
    for (const c of kept) {
      if (!chosen.include.has(c.key)) continue
      const name = renamed(c)
      const changed = name !== c.name
      const merge = changed ? byName.get(nameKey(name)) : undefined
      if (merge) {
        merge.clusters.push(c)
        continue
      }
      const g = { clusters: [c], name, kind: kindOf(c) }
      groups.push(g)
      // Only a name the office gave brings jobs together; two found with the same name stay apart (next year's party).
      if (changed && !byName.has(nameKey(name))) byName.set(nameKey(name), g)
    }
    // A job that kept its name joins one renamed to it.
    for (const g of [...groups]) {
      if (g.clusters.length !== 1 || g.clusters[0]!.existing || renamed(g.clusters[0]!) !== g.clusters[0]!.name) continue
      const into = byName.get(nameKey(g.name))
      if (into && into !== g) {
        into.clusters.push(...g.clusters)
        groups.splice(groups.indexOf(g), 1)
      }
    }
  }

  // Venues: one per place, shared between jobs. The app's by name and by address, the first of each, and each place
  // looked up once (finding 18).
  const venueNamed = new Map<string, number>()
  const venueAt = new Map<string, number>()
  app.venues.forEach((v, i) => {
    if (!venueNamed.has(nameKey(v.name))) venueNamed.set(nameKey(v.name), i)
    if (v.address && !venueAt.has(nameKey(v.address))) venueAt.set(nameKey(v.address), i)
  })
  const newVenues = new Map<string, VenueRef>()
  const places = new Map<string, VenueRef | null>()
  const venueOf = (location: string): VenueRef | null => {
    if (places.has(location)) return places.get(location)!
    const place = location.replace(/\s+/g, ' ').trim()
    let found: VenueRef | null = null
    if (place) {
      const name = place.split(',')[0]!.trim() || place
      const key = nameKey(name)
      const at = Math.min(venueNamed.get(key) ?? Infinity, venueAt.get(nameKey(place)) ?? Infinity)
      const known = app.venues[at]
      if (known) found = { id: known.id, name: known.name }
      else {
        found = newVenues.get(key) ?? { key, name, address: place === name ? '' : place }
        newVenues.set(key, found)
      }
    }
    places.set(location, found)
    return found
  }
  const venueKey = (v: VenueRef | null) => (v === null ? '' : 'id' in v ? `id:${v.id}` : `new:${v.key}`)

  // Guests: people in the app, or people to add. A company's mailbox is never crew. Matched as an account is, trimmed,
  // so nobody here is added again with their own email, which the server refuses (audit finding 12).
  const byEmail = new Map(app.people.flatMap((p) => [p.email?.trim().toLowerCase() ?? '', ...(p.otherEmails ?? [])].filter(Boolean).map((e) => [e, p] as const)).reverse())
  const byName = new Map(app.people.filter((p) => !p.email).map((p) => [nameKey(p.name), p]))
  const byId = new Map(app.people.map((p) => [p.id, p]))
  const own = account.toLowerCase()
  const domain = own.split('@')[1] ?? ''
  const newPeople = new Map<string, NewPerson & { jobKeys: Set<string>; gigs: Set<string> }>()
  const personOf = (g: SourceGuest, jobKey: string, gig: boolean): PersonRef | undefined => {
    const email = g.email.trim().toLowerCase()
    if (g.notCrew || email === own || !email.includes('@') || isMailbox(email)) return undefined
    const known = byEmail.get(email) ?? (g.name ? byName.get(nameKey(g.name)) : undefined)
    if (known) return { id: known.id }
    const at = email.split('@')[1]!
    const kind = at === domain ? 'staff' : 'freelancer'
    const given = chosen?.people?.get(email)?.trim()
    const person = newPeople.get(email) ?? {
      email,
      name: given || g.name?.trim() || nameFromEmail(email),
      kind,
      suggested: false,
      needsName: !given && !g.name?.trim(),
      jobs: 0,
      jobKeys: new Set<string>(),
      gigs: new Set<string>(),
    }
    person.jobKeys.add(jobKey)
    if (gig) person.gigs.add(jobKey)
    // Staff are always crew; a person's own address is, once they're on a gig: a client at a meeting isn't.
    person.suggested = kind === 'staff' || (OWN_EMAIL.has(at) && person.gigs.size > 0)
    newPeople.set(email, person)
    return { email }
  }
  /** Who a guest is, for a note: their name in the app, the one Google has, or their address. */
  const guestLabel = (g: SourceGuest, person: PersonRef | undefined): string => {
    if (person && 'id' in person) return byId.get(person.id)?.name ?? g.email
    if (person) return newPeople.get(person.email)?.name ?? g.email
    return g.name?.trim() || g.email
  }

  const jobs: PlanJob[] = groups.map((g) => {
    const lead = g.clusters[0]!
    const existing = lead.existing
    const gig = g.kind === 'gig'
    const all = g.clusters
      .flatMap((c) => withKind(c.entries, g.kind))
      .sort((a, b) => a.day.localeCompare(b.day) || a.event.id.localeCompare(b.event.id))
    const venues = all.map((e) => venueOf(e.event.location))
    const jobVenue = existing
      ? existing.venueId
        ? { id: existing.venueId, name: '' }
        : null
      : (mostCommon(
          venues.filter((v) => v !== null),
          venueKey
        ) ?? null)

    // A phase's days in a row, whatever events they come from.
    const byPhase = new Map<string, { name: string; days: Map<string, Entry[]> }>()
    for (const e of all)
      for (const p of e.phases) {
        const k = nameKey(p)
        const ph = byPhase.get(k) ?? { name: p, days: new Map<string, Entry[]>() }
        byPhase.set(k, ph)
        ph.days.set(e.day, [...(ph.days.get(e.day) ?? []), e])
      }
    const runs: (PlanRun & { sheet: string; extra: string[] })[] = []
    for (const [k, ph] of byPhase) {
      const days = [...ph.days.keys()].sort()
      let run: string[] = []
      const flush = () => {
        if (!run.length) return
        const es = run.flatMap((d) => ph.days.get(d)!)
        const vs = es.map((e) => venueOf(e.event.location)).filter((v) => v !== null)
        const venue = mostCommon(vs, venueKey) ?? null
        const sheets = [...new Set(es.map((e) => plainText(e.event.description)).filter(Boolean))]
        const titleNotes = [...new Set(es.map((e) => e.note).filter(Boolean))]
        const crew = new Map<string, { person: PersonRef; answers: Record<string, GuestResponse>; name: string }>()
        const with_ = new Map<string, string>()
        for (const e of es)
          for (const guest of e.event.guests) {
            const person = personOf(guest, lead.key, gig)
            const label = guestLabel(guest, person)
            // A hire, an errand or a meeting has no crew: whoever was invited is noted. So is a mailbox, for anyone looking.
            if (!gig || !person) {
              if (!guest.notCrew && guest.email.toLowerCase() !== own) with_.set(guest.email.toLowerCase(), label)
              continue
            }
            // A day naming two phases ("Show Day 2/ Load Out") puts its crew on the first, not on both.
            if (nameKey(e.phases[0]!) !== k) continue
            const pk = 'id' in person ? `id:${person.id}` : `new:${person.email}`
            const c = crew.get(pk) ?? { person, answers: {}, name: label }
            crew.set(pk, c)
            c.answers[e.day] = better(c.answers[e.day], guest.answer)
          }
        // Days gone are the record of who worked: a Yes is a booking, anything else is noted rather than left waiting.
        const noted = new Map<string, Noted>()
        for (const c of crew.values())
          for (const [d, answer] of Object.entries(c.answers)) {
            if (d >= today || answer === 'accepted') continue
            delete c.answers[d]
            const key = `${c.name}|${answer === 'declined' ? 'declined' : 'none'}`
            const n = noted.get(key) ?? { name: c.name, days: [], answer: answer === 'declined' ? 'declined' : 'none' }
            n.days.push(d)
            noted.set(key, n)
          }
        const first = run[0]!
        const last = run.at(-1)!
        const next = existing?.phases.find((p) => nameKey(p.name) === k && (p.end === addDays(first, -1) || p.start === addDays(last, 1)))
        const notedList = [...noted.values()].sort((a, b) => a.name.localeCompare(b.name))
        const extra = [
          ...titleNotes,
          with_.size ? `${gig ? 'Also on the invite' : 'On the invite'}: ${[...with_.values()].sort().join(', ')}` : '',
          notedList.some((n) => n.answer === 'none') ? `No answer on the invite: ${notedList.filter((n) => n.answer === 'none').map((n) => `${n.name} (${daysLabel(n.days)})`).join(', ')}` : '',
          notedList.some((n) => n.answer === 'declined') ? `Said no: ${notedList.filter((n) => n.answer === 'declined').map((n) => `${n.name} (${daysLabel(n.days)})`).join(', ')}` : '',
        ].filter(Boolean)
        runs.push({
          name: ph.name,
          days: run,
          guessed: es.every((e) => e.guessed),
          venue: venueKey(venue) === venueKey(jobVenue) ? null : venue,
          notes: '',
          sheet: sheets.join('\n\n'),
          extra,
          extend: next ? { id: next.id, start: next.start < first ? next.start : first, end: next.end > last ? next.end : last } : null,
          crew: [...crew.values()].filter((c) => Object.keys(c.answers).length > 0).map(({ person, answers }) => ({ person, answers })),
          noted: notedList,
          events: uniqueDays(es),
        })
        run = []
      }
      for (const d of days) {
        if (run.length && (addDays(run.at(-1)!, 1) !== d || run.length === MAX_PHASE_DAYS)) flush()
        run.push(d)
      }
      flush()
    }
    runs.sort((a, b) => a.days[0]!.localeCompare(b.days[0]!) || phaseOrder(a.name) - phaseOrder(b.name) || a.name.localeCompare(b.name))

    // One job sheet for every phase goes on the job instead.
    let notes = ''
    if (!existing && runs.length > 0 && runs[0]!.sheet && runs.every((r) => r.sheet === runs[0]!.sheet)) {
      notes = fit(g.clusters.flatMap((c) => c.entries.map((e) => plainText(e.event.description))).find(Boolean) ?? '', JOB_NOTES)
      for (const r of runs) r.sheet = ''
    }
    for (const r of runs) r.notes = fit([...r.extra, r.sheet].filter(Boolean).join('\n\n'), PHASE_NOTES)
    return {
      key: lead.key,
      name: existing ? existing.name : g.name,
      // Pencilled in only when all of it is: one day marked TBC doesn't make the whole job a maybe.
      status: all.every((e) => e.pencilled) ? 'enquiry' : 'confirmed',
      kind: g.kind,
      existing: existing ? { id: existing.id, name: existing.name, venueId: existing.venueId } : null,
      venue: existing ? null : jobVenue,
      notes,
      runs: runs.map(({ sheet: _s, extra: _e, ...r }) => r),
      events: new Set(all.map((e) => e.event.uid)).size,
      seen: uniqueDays(g.clusters.flatMap((c) => c.seen)),
    }
  })

  // Events brought in from this calendar before, on these days, that have since been deleted or moved in Google.
  const now = new Map(events.map((e) => [e.uid, e]))
  const changed: ImportChanged[] = []
  for (const [uid, all] of imported) {
    const rows = all.filter((r) => r.calendarId === calendarId)
    if (!rows.some((r) => r.day >= from && r.day < to)) continue
    const job = jobById.get(rows[0]!.projectId)
    if (!job || job.status === 'cancelled' || job.status === 'lost') continue
    const was = [...new Set(rows.map((r) => r.day))].sort()
    const ev = now.get(uid)
    const days = ev && !ev.cancelled && ev.days ? eachDay(ev.days.start, ev.days.end) : []
    if (days.join() === was.join()) continue
    changed.push({ jobId: job.id, job: job.name, title: rows[0]!.title, was, now: days })
  }
  changed.sort((a, b) => a.was[0]!.localeCompare(b.was[0]!) || a.job.localeCompare(b.job))

  for (const p of newPeople.values()) p.jobs = p.jobKeys.size
  return {
    events: read,
    jobs,
    people: [...newPeople.values()].map(({ jobKeys: _j, gigs: _g, ...p }) => p).sort((a, b) => Number(b.suggested) - Number(a.suggested) || a.name.localeCompare(b.name)),
    leftOut: leftOut.list(),
    changed,
    found: [...new Set([...kept.map((c) => c.key), ...asked])],
  }
}
