import { describe, expect, it } from 'vitest'
import type { Mutation } from '../src/commands.ts'
import { offerMessage, tellMessage, type CrewCall, type Offer, type Person } from '../src/crew.ts'
import { officeContact, officeLine, telHref } from '../src/office.ts'
import { answersToCheck, crewView } from '../src/sync/crew-view.ts'
import { officeView } from '../src/sync/office-view.ts'

/**
 * Telling people (audit findings 9 and 10): which answers wait for the
 * office and until when, the messages the office is prompted with after
 * what it does, and the office's own details as the pages show them.
 */

const person = (id: string, name: string): Person => ({
  id,
  name,
  kind: 'freelancer',
  email: `${id}@example.com`,
  phone: '+353871234567',
  skills: [],
  dayRateCents: 30000,
  notes: '',
  linkToken: `${id}-link-token-000000000000`,
  archived: false,
  approvesLeave: false,
  department: null,
  level: 1,
  knownAs: null,
  certificates: {},
  company: null,
})
const call = (id: string, start: string, end: string, needed = 2): CrewCall => ({
  id,
  projectId: 'harbour',
  phaseId: 'show',
  project: 'Harbour Lights Festival',
  phase: 'Show',
  venue: 'Riverside Park, Limerick',
  role: 'Sound No.1',
  start,
  end,
  callTime: '12:00',
  needed,
  dayRateCents: 32000,
  details: '',
  replyBy: null,
  status: 'open',
})
const offer = (id: string, callId: string, personId: string, status: Offer['status'], over: Partial<Offer> = {}): Offer => ({
  id,
  callId,
  personId,
  status,
  days: ['2026-10-10', '2026-10-11'],
  dayRateCents: 32000,
  counterRateCents: null,
  note: '',
  respondedAt: null,
  respondedVia: 'link',
  override: false,
  seenAt: null,
  ...over,
})
const m = (name: Mutation['name'], args: object, createdAt = '2026-10-01T09:00:00.000Z'): Mutation => ({ id: `m-${name}-${JSON.stringify(args)}`, name, args, createdAt }) as Mutation

const today = '2026-10-01'

describe('answers to check', () => {
  it('holds a yes and a counter, and a decline or a pull-out until the office notes it, saying how short the call is', () => {
    const entities = {
      person: { aoife: person('aoife', 'Aoife Byrne'), niall: person('niall', 'Niall Kerr'), dara: person('dara', 'Dara Kelly'), eimear: person('eimear', 'Eimear Nolan') },
      crewCall: { show: call('show', '2026-10-10', '2026-10-11'), gone: call('gone', '2026-09-20', '2026-09-21') },
      offer: {
        yes: offer('yes', 'show', 'aoife', 'accepted'),
        more: offer('more', 'show', 'niall', 'countered', { counterRateCents: 35000 }),
        no: offer('no', 'show', 'dara', 'declined', { note: 'At a wedding.' }),
        out: offer('out', 'show', 'eimear', 'pulled-out'),
        noted: offer('noted', 'show', 'eimear', 'declined', { seenAt: '2026-09-30T10:00:00.000Z' }),
        old: offer('old', 'gone', 'dara', 'declined'),
      },
    }
    const crew = crewView(entities, [], 0)
    const queue = answersToCheck(crew, today)
    // A pull-out first, since a booking is lost; nothing from a call that's over, nor a decline already noted.
    expect(queue.map((a) => [a.offer.id, a.kind, a.short])).toEqual([
      ['out', 'pulled-out', 1],
      ['yes', 'accepted', 1],
      ['more', 'countered', 1],
      ['no', 'declined', 1],
    ])

    // Noted on this device: it leaves the queue before the server answers, and comes back if the server says no.
    const noted = crewView(entities, [m('offer.seen', { id: 'no' })], 0)
    expect(answersToCheck(noted, today).map((a) => a.offer.id)).toEqual(['out', 'yes', 'more'])
    expect(noted.calls.find((c) => c.id === 'show')!.offers.find((o) => o.id === 'no')).toMatchObject({ seenAt: '2026-10-01T09:00:00.000Z', pending: true })
  })

  it('shows a pull-out made on this device: the place is free again and the answer waits to be noted', () => {
    const entities = {
      person: { aoife: person('aoife', 'Aoife Byrne') },
      crewCall: { show: call('show', '2026-10-10', '2026-10-11', 1) },
      offer: { booked: offer('booked', 'show', 'aoife', 'confirmed', { seenAt: '2026-09-30T10:00:00.000Z' }) },
    }
    const before = crewView(entities, [], 0)
    expect(before.calls[0]!.openDays).toEqual([])
    const after = crewView(entities, [m('offer.respond', { id: 'booked', answer: 'pullOut', note: 'Double booked, sorry.' })], 0)
    expect(after.calls[0]!.openDays).toEqual(['2026-10-10', '2026-10-11'])
    expect(after.calls[0]!.offers[0]).toMatchObject({ status: 'pulled-out', note: 'Double booked, sorry.', seenAt: null, pending: true })
    expect(answersToCheck(after, today).map((a) => [a.kind, a.short])).toEqual([['pulled-out', 1]])
  })
})

describe('the message after what the office did', () => {
  const aoife = person('aoife', 'Aoife Byrne')
  const show = call('show', '2026-10-10', '2026-10-11')
  const link = 'https://app.example/f/aoife-link'

  it('names the job, the days and what happens next, in the voice of the offer', () => {
    const confirmed = tellMessage('confirmed', aoife, { call: show, days: ['2026-10-10'], offerId: 'o1' }, link)
    expect(confirmed.text).toBe(
      [
        "Hi Aoife, you're confirmed for Harbour Lights Festival (Show).",
        'Sound No.1, Sat 10 Oct, call 12:00',
        'At Riverside Park, Limerick',
        '€320 a day',
        `Your call sheet, with who's on and who to ring on the day, is here: ${link}/sheet/show`,
        'If anything changes on your side, let us know.',
      ].join('\n')
    )
    expect(confirmed).toMatchObject({ subject: 'Confirmed: Harbour Lights Festival (Show), Sat 10 Oct, call 12:00', what: 'confirmation' })
    // No rate on the call: the confirmation says nothing about it rather than "rate to agree".
    expect(tellMessage('confirmed', aoife, { call: { ...show, dayRateCents: null } }, link).text).not.toContain('rate to agree')

    expect(tellMessage('withdrawn', aoife, { call: show }, link).text).toContain("we've withdrawn the offer of Sound No.1 on Harbour Lights Festival (Show), Sat 10 Oct to Sun 11 Oct, call 12:00")
    expect(tellMessage('released', aoife, { call: show }, link).text).toContain('we no longer need you for Harbour Lights Festival (Show)')
    expect(tellMessage('job-stopped', aoife, { call: show }, link).text).toMatch(/^Hi Aoife, Harbour Lights Festival isn't going ahead, so Sound No\.1 on Sat 10 Oct to Sun 11 Oct, call 12:00 is off\./)
    expect(tellMessage('call-cancelled', aoife, { call: show }, link).text).toContain('we no longer need Sound No.1 on Harbour Lights Festival (Show)')
    expect(tellMessage('call-changed', aoife, { call: { ...show, callTime: '11:00' } }, link).text).toContain('Sound No.1 is now Sat 10 Oct to Sun 11 Oct, call 11:00, at Riverside Park, Limerick, €320 a day.')
    expect(tellMessage('phase-moved', aoife, { call: { ...show, start: '2026-10-17', end: '2026-10-18' } }, link).text).toContain('has moved: Sound No.1 is now Sat 17 Oct to Sun 18 Oct, call 12:00.')
  })

  it('tells a freelancer what was approved on their timesheet, and what changed from what they sent', () => {
    const approved = tellMessage(
      'timesheet-approved',
      aoife,
      { call: show, offerId: 'o1', summary: '1 day at €320, and €18.10 of extras: €338.10', changes: ['Parking: €15, not €18', 'Left out: Dinner €22'] },
      link
    )
    expect(approved.text).toBe(
      [
        'Hi Aoife, your timesheet for Harbour Lights Festival (Show) is approved: 1 day at €320, and €18.10 of extras: €338.10.',
        'We changed what you sent: Parking: €15, not €18; Left out: Dinner €22.',
        `It's here, with any note from us: ${link}/timesheet/o1`,
        'Payment follows the usual way.',
      ].join('\n')
    )
    const reopened = tellMessage('timesheet-reopened', aoife, { call: show, offerId: 'o1' }, link)
    expect(reopened.text).toBe(`Hi Aoife, we've reopened your timesheet for Harbour Lights Festival (Show) to sort something out. You can change it again until we approve it: ${link}/timesheet/o1`)
  })

  it('names no rate to staff, who are paid through payroll', () => {
    // Proves: the offer and every message the office is prompted with leave the rate out for a member of staff, as their page does (audit finding 21), and still say it to a freelancer.
    const orla = { ...person('orla', 'Orla Hayes'), kind: 'staff' as const }
    const offered = offerMessage(orla, { ...show, replyBy: '2026-10-08' }, link)
    expect(offered).toBe(
      [
        'Hi Orla, are you free for Harbour Lights Festival (Show)?',
        'Sound No.1, Sat 10 Oct to Sun 11 Oct, call 12:00',
        'At Riverside Park, Limerick',
        'Please answer by Thu 8 Oct.',
        `Accept, decline or pick days here: ${link}`,
      ].join('\n')
    )
    expect(offerMessage(orla, { ...show, dayRateCents: null }, link)).not.toContain('rate to agree')
    const events = ['confirmed', 'withdrawn', 'released', 'job-stopped', 'call-cancelled', 'call-changed', 'phase-moved'] as const
    for (const event of events) {
      const said = tellMessage(event, orla, { call: show, offerId: 'o1' }, link)
      expect(said.text, event).not.toMatch(/€|a day\b|\brate\b/)
      expect(said.subject, event).not.toContain('€')
    }
    expect(tellMessage('call-changed', orla, { call: show }, link).text).toContain('Sound No.1 is now Sat 10 Oct to Sun 11 Oct, call 12:00, at Riverside Park, Limerick.')
    // A freelancer still hears the rate.
    expect(offerMessage(aoife, show, link)).toContain('€320 a day')
  })
})

describe('the office’s details', () => {
  it('are shown only once there is a phone or an email, as one line and as links', () => {
    expect(officeContact(undefined)).toBeNull()
    expect(officeContact({ name: 'Session Hire office', phone: '', email: null })).toBeNull()
    expect(officeLine({ name: 'Session Hire office', phone: '01 234 5678', email: 'office@sessionhire.com' })).toBe('Session Hire office · 01 234 5678 · office@sessionhire.com')
    expect(officeLine({ name: '', phone: null, email: 'office@sessionhire.com' })).toBe('The office · office@sessionhire.com')
    expect(telHref('+353 (0)1 234 5678')).toBe('tel:+35312345678')
    expect(telHref('01 234 5678')).toBe('tel:012345678')
  })

  it('lay this device’s own change over what the server said', () => {
    const entities = { setting: { office: { id: 'office', name: 'Session Hire office', phone: '01 234 5678', email: null } } }
    expect(officeView(entities, [], 0)).toEqual({ details: entities.setting.office, pending: false })
    const changed = officeView(entities, [m('office.update', { name: 'Session Hire office', phone: '01 234 5678', email: 'office@sessionhire.com' })], 0)
    expect(changed).toEqual({ details: { id: 'office', name: 'Session Hire office', phone: '01 234 5678', email: 'office@sessionhire.com' }, pending: true })
    expect(officeView({}, [], 0)).toEqual({ details: undefined, pending: false })
  })
})
