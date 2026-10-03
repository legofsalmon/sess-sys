import { CERTIFICATE_KINDS, CERTIFICATE_WORDS, certificateName, dayLabel, daysBetween, firstName, needsLabel, tidyNeeds, type CertificateKind, type Person } from './crew.ts'

/**
 * The certificates a crew call needs (ADR 0028), checked against a
 * person's record across the call's days. The device says it in place as
 * Offer is pressed, and the server says it again in the same words when
 * the offer arrives, so an offer made offline is refused as one made
 * online. Not known is allowed, with a warning, since most of the crew
 * list says nothing about most certificates.
 */

/** Why one certificate falls short for some days: not held, run out already, running out before the last day, or not known. */
export type CertificateGap = {
  kind: CertificateKind
  why: 'not-held' | 'ran-out' | 'runs-out' | 'unknown'
  expires: string | null
}

/** What stands between a person and these days, for each certificate needed, in the list's order. Nothing when they hold it all to the last day. */
export function certificateGaps(p: Pick<Person, 'certificates'>, needs: readonly CertificateKind[], days: readonly string[], today: string): CertificateGap[] {
  const last = [...days].sort().at(-1) ?? today
  const out: CertificateGap[] = []
  for (const kind of tidyNeeds(needs)) {
    const c = p.certificates?.[kind]
    if (!c || c.held === null) out.push({ kind, why: 'unknown', expires: null })
    else if (!c.held) out.push({ kind, why: 'not-held', expires: null })
    // Held with no expiry is good for any job; a card is good on its expiry day itself, so one that ran out after a job's last day was good for it.
    else if (c.expires !== null && c.expires < last) out.push({ kind, why: c.expires < today ? 'ran-out' : 'runs-out', expires: c.expires })
  }
  return out
}

/** A gap that stops an offer; not known only warns. */
export const blocks = (g: CertificateGap) => g.why !== 'unknown'

const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

/** "3 November", with the year when it isn't this one: "3 November 2027". */
export function longDate(d: string, today: string): string {
  const date = `${Number(d.slice(8, 10))} ${MONTHS[Number(d.slice(5, 7)) - 1]}`
  return d.slice(0, 4) === today.slice(0, 4) ? date : `${date} ${d.slice(0, 4)}`
}

/** One gap in a sentence, naming the person, the certificate and the day. */
export function gapSentence(name: string, g: CertificateGap, days: readonly string[], today: string): string {
  const words = CERTIFICATE_WORDS[g.kind]
  switch (g.why) {
    case 'not-held':
      return `${name} has no ${words}, which this call needs.`
    case 'ran-out':
      return `${name}'s ${words} ran out on ${longDate(g.expires!, today)}.`
    case 'runs-out': {
      const first = [...days].sort()[0] ?? today
      return `${name}'s ${words} runs out on ${longDate(g.expires!, today)}, before the job ${g.expires! < first ? 'starts' : 'ends'}.`
    }
    case 'unknown':
      return `${capital(certificateName(g.kind))} not known for ${name}: check before the job.`
  }
}

/**
 * Why an offer of these days can't go to this person, or null when it can:
 * every certificate the call needs that they don't hold, or that runs out
 * before the last day, said by name, with the fix. "Send anyway" doesn't
 * pass it: it's a condition of the work, not the office's judgement.
 */
export function certificateRefusal(p: Pick<Person, 'name' | 'certificates'>, needs: readonly CertificateKind[], days: readonly string[], today: string): string | null {
  const gaps = certificateGaps(p, needs, days, today).filter(blocks)
  if (!gaps.length) return null
  return `${gaps.map((g) => gapSentence(p.name, g, days, today)).join(' ')} Update their card if that's changed.`
}

/** The warning for what isn't known, all of it in one sentence: "Working at height and IPAF not known for Dara Quinn: check before the job." */
export function certificateUnknowns(p: Pick<Person, 'name' | 'certificates'>, needs: readonly CertificateKind[], days: readonly string[], today: string): string[] {
  const unknown = certificateGaps(p, needs, days, today)
    .filter((g) => !blocks(g))
    .map((g) => g.kind)
  return unknown.length ? [`${capital(needsLabel(unknown))} not known for ${p.name}: check before the job.`] : []
}

/** The picker's short mark for a gap: "no IPAF", "IPAF ran out", "IPAF runs out Tue 3 Nov", "IPAF not known". */
export function gapMark(g: CertificateGap): string {
  const name = certificateName(g.kind)
  switch (g.why) {
    case 'not-held':
      return `no ${name}`
    case 'ran-out':
      return `${name} ran out`
    case 'runs-out':
      return `${name} runs out ${dayLabel(g.expires!)}`
    case 'unknown':
      return `${name} not known`
  }
}

/** All of a person's marks for the picker, what isn't known said once: "no IPAF, working at height not known". */
export function gapMarks(gaps: readonly CertificateGap[]): string {
  const unknown = gaps.filter((g) => !blocks(g)).map((g) => g.kind)
  return [...gaps.filter(blocks).map(gapMark), unknown.length ? `${needsLabel(unknown)} not known` : ''].filter(Boolean).join(', ')
}

/** How far ahead a certificate running out is listed (ADR 0028): as inspections due soon are, and time to book a renewal course. */
export const CERTIFICATE_SOON_DAYS = 30

/** A held certificate run out, or running out soon, to ask the person about. */
export interface CertificateReminder<P> {
  person: P
  kind: CertificateKind
  expires: string
  /** Already past its expiry. */
  ranOut: boolean
}

/**
 * Every held certificate whose expiry has passed or falls in the next 30
 * days, for everyone not archived, soonest first, so the longest run out
 * heads the list. One leaves it when the card says a new expiry, or No for
 * someone not renewing.
 */
export function certificateReminders<P extends Pick<Person, 'id' | 'name' | 'certificates'> & { archived?: boolean }>(
  people: readonly P[],
  today: string,
  within = CERTIFICATE_SOON_DAYS
): CertificateReminder<P>[] {
  const out: CertificateReminder<P>[] = []
  for (const person of people) {
    if (person.archived) continue
    for (const kind of CERTIFICATE_KINDS) {
      const c = person.certificates?.[kind]
      if (!c?.held || !c.expires || daysBetween(today, c.expires) > within) continue
      out.push({ person, kind, expires: c.expires, ranOut: c.expires < today })
    }
  }
  return out.sort(
    (a, b) =>
      a.expires.localeCompare(b.expires) ||
      a.person.name.localeCompare(b.person.name) ||
      a.person.id.localeCompare(b.person.id) ||
      CERTIFICATE_KINDS.indexOf(a.kind) - CERTIFICATE_KINDS.indexOf(b.kind)
  )
}

/** "IPAF runs out on Thu 22 Oct", "Manual handling ran out on Wed 2 Sep": a reminder's line. */
export function reminderLine(r: Pick<CertificateReminder<unknown>, 'kind' | 'expires' | 'ranOut'>, today: string): string {
  const what = capital(certificateName(r.kind))
  if (r.expires === today) return `${what} runs out today`
  return `${what} ${r.ranOut ? 'ran' : 'runs'} out on ${dayLabel(r.expires)}${r.expires.slice(0, 4) === today.slice(0, 4) ? '' : ` ${r.expires.slice(0, 4)}`}`
}

/** Where to send the new one, once files can be sent from the link (ADR 0029): their own page. */
export const sendItFrom = (link: string) => `You can send it from your page, under Your documents: ${link}`

/**
 * Asking for the renewed card, for WhatsApp, a text or an email, in the
 * voice of the other prompted messages. The app sends nothing itself.
 */
export function renewalMessage(
  p: Pick<Person, 'name'> & Partial<Pick<Person, 'knownAs'>>,
  r: Pick<CertificateReminder<unknown>, 'kind' | 'expires' | 'ranOut'>,
  today: string,
  /** Their private link, once photos can be sent from it (ADR 0029). */
  link?: string
): { text: string; subject: string; what: string } {
  const words = CERTIFICATE_WORDS[r.kind]
  const when = r.ranOut ? `ran out on ${longDate(r.expires, today)}` : r.expires === today ? 'runs out today' : `runs out on ${longDate(r.expires, today)}`
  return {
    text: [
      `Hi ${firstName(p)}, our records say your ${words} ${when}.`,
      r.ranOut
        ? "If you've renewed it, could you send us a photo of the new card? We need it to offer you work that asks for it."
        : "When you've renewed it, could you send us a photo of the new card? We need it to offer you work that asks for it.",
      link ? sendItFrom(link) : '',
      'Thanks.',
    ]
      .filter(Boolean)
      .join('\n'),
    subject: `Your ${words}`,
    what: `reminder about ${words}`,
  }
}
