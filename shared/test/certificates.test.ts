import { describe, expect, it } from 'vitest'
import {
  certificateGaps,
  certificateRefusal,
  certificateReminders,
  certificateUnknowns,
  gapMarks,
  longDate,
  reminderLine,
  renewalMessage,
} from '../src/certificates.ts'
import { certificateState, eachDay, needsLabel, offerMessage, tidyNeeds, type CrewCall, type Person } from '../src/crew.ts'
import { readCrewList } from '../src/crew-import.ts'
import { crewView } from '../src/sync/crew-view.ts'

/**
 * The certificates a call needs (ADR 0028): Safe Pass, working at height
 * and IPAF read as the other kinds do; a person is checked against the
 * call's days, a certificate good on its expiry day itself; the refusal
 * names the person, the certificate and the day; not known only warns;
 * the reminders list what's run out or running out in 30 days, soonest
 * first; and the crew list's new columns are read.
 */

const TODAY = '2026-10-02'
const seán = (certificates: Person['certificates']): Pick<Person, 'name' | 'certificates'> => ({ name: 'Seán Ó Briain', certificates })
const held = (expires: string | null, note = '') => ({ held: true, expires, note })
/** The rigging call's days, Mon 2 Nov to Wed 4 Nov. */
const DAYS = eachDay('2026-11-02', '2026-11-04')

describe('the new kinds', () => {
  it('are held, not held, run out or not known, as the others are', () => {
    // Proves: Safe Pass, working at height and IPAF read through the same states as first aid, with an IPAF card's categories kept in its note.
    const card = { 'safe-pass': held('2027-01-01'), 'working-at-height': { held: false, expires: null, note: '' }, ipaf: held('2026-09-01', '3a, 3b') }
    expect(certificateState(card['safe-pass'], TODAY)).toBe('held')
    expect(certificateState(card['working-at-height'], TODAY)).toBe('not-held')
    expect(certificateState(card.ipaf, TODAY)).toBe('expired')
    expect(certificateState(undefined, TODAY)).toBe('unknown')
    expect(card.ipaf.note).toBe('3a, 3b')
    expect(needsLabel(['ipaf', 'working-at-height'])).toBe('working at height and IPAF')
    expect(tidyNeeds(['ipaf', 'nonsense', 'safe-pass', 'ipaf'])).toEqual(['safe-pass', 'ipaf'])
  })
})

describe('what the call needs, across its days', () => {
  it('passes someone who holds it all to the last day, the expiry day itself included', () => {
    // Proves: a card is good on its expiry day, and one held with no expiry is good for any job.
    const p = seán({ 'working-at-height': held(null), ipaf: held('2026-11-04') })
    expect(certificateGaps(p, ['working-at-height', 'ipaf'], DAYS, TODAY)).toEqual([])
    expect(certificateRefusal(p, ['working-at-height', 'ipaf'], DAYS, TODAY)).toBeNull()
    // Needing nothing passes anyone.
    expect(certificateRefusal(seán({}), [], DAYS, TODAY)).toBeNull()
  })

  it('passes a job that is over for a card that ran out after its last day', () => {
    // Proves: what counts is the job's last day, not today: a card good to the end of last month's job isn't held against it, and one that ran out during it is.
    const september = eachDay('2026-09-20', '2026-09-25')
    expect(certificateGaps(seán({ ipaf: held('2026-09-28') }), ['ipaf'], september, TODAY)).toEqual([])
    expect(certificateRefusal(seán({ ipaf: held('2026-09-22') }), ['ipaf'], september, TODAY)).toBe("Seán Ó Briain's IPAF ran out on 22 September. Update their card if that's changed.")
  })

  it('refuses in plain words, naming the person, the certificate and the day', () => {
    // Proves: one running out before the last day, before the first, already run out, or not held at all, each said as the brief asks.
    const needs = ['ipaf'] as const
    expect(certificateRefusal(seán({ ipaf: held('2026-11-03') }), needs, DAYS, TODAY)).toBe(
      "Seán Ó Briain's IPAF runs out on 3 November, before the job ends. Update their card if that's changed."
    )
    expect(certificateRefusal(seán({ ipaf: held('2026-10-20') }), needs, DAYS, TODAY)).toBe(
      "Seán Ó Briain's IPAF runs out on 20 October, before the job starts. Update their card if that's changed."
    )
    expect(certificateRefusal(seán({ ipaf: held('2026-09-03') }), needs, DAYS, TODAY)).toBe("Seán Ó Briain's IPAF ran out on 3 September. Update their card if that's changed.")
    expect(certificateRefusal(seán({ 'working-at-height': { held: false, expires: null, note: '' } }), ['working-at-height'], DAYS, TODAY)).toBe(
      "Seán Ó Briain has no working at height certificate, which this call needs. Update their card if that's changed."
    )
    // A year that isn't this one is said.
    expect(longDate('2027-03-01', TODAY)).toBe('1 March 2027')
  })

  it('allows what isn’t known, with one warning, and marks each person for the picker', () => {
    // Proves: not known never refuses, is said once for all the kinds, and the picker's marks say what's missing first.
    const p = seán({ ipaf: held('2026-11-03') })
    const needs = ['working-at-height', 'ipaf'] as const
    expect(certificateRefusal(seán({}), needs, DAYS, TODAY)).toBeNull()
    expect(certificateUnknowns(seán({}), needs, DAYS, TODAY)).toEqual(['Working at height and IPAF not known for Seán Ó Briain: check before the job.'])
    expect(gapMarks(certificateGaps(p, needs, DAYS, TODAY))).toBe('IPAF runs out Tue 3 Nov, working at height not known')
    expect(gapMarks(certificateGaps(seán({ ipaf: { held: false, expires: null, note: '' } }), ['ipaf'], DAYS, TODAY))).toBe('no IPAF')
  })

  it('is said in the offer message, so nobody says yes without the card', () => {
    // Proves: the message the office sends names what the call needs, and says nothing for a call that needs nothing.
    const call: CrewCall = {
      id: 'c1',
      projectId: null,
      phaseId: null,
      project: 'Harbour Lights Festival',
      phase: 'Load in',
      venue: 'Riverside Park',
      role: 'Rigger',
      start: '2026-11-02',
      end: '2026-11-04',
      callTime: '07:00',
      needed: 2,
      dayRateCents: 29000,
      details: '',
      replyBy: null,
      status: 'open',
      needsCertificates: ['ipaf', 'working-at-height'],
    }
    expect(offerMessage({ name: 'Seán Ó Briain', kind: 'freelancer' }, call, 'https://x/f/abc')).toContain('Needs working at height and IPAF.')
    expect(offerMessage({ name: 'Seán Ó Briain', kind: 'freelancer' }, { ...call, needsCertificates: undefined }, 'https://x/f/abc')).not.toContain('Needs')
  })
})

describe('the reminders', () => {
  it('list what has run out or runs out in 30 days, soonest first, for everyone not archived', () => {
    // Proves: the window is 30 days, run out comes first, not held and not known never show, and someone archived is left out.
    const people = [
      { id: 'p1', name: 'Pádraig Kenny', archived: false, certificates: { ipaf: held('2026-10-22', '3a'), 'first-aid': held('2027-07-29') } },
      { id: 'p2', name: 'Tadhg Brady', archived: false, certificates: { 'manual-handling': held('2026-09-02'), 'safe-pass': held('2026-11-01') } },
      { id: 'p3', name: 'Laoise Keane', archived: false, certificates: { ipaf: { held: false, expires: '2026-10-05', note: '' }, 'safe-pass': { held: null, expires: '2026-10-05', note: '' } } },
      { id: 'p4', name: 'Old Timer', archived: true, certificates: { 'safe-pass': held('2026-10-03') } },
    ]
    const list = certificateReminders(people, TODAY)
    expect(list.map((r) => [r.person.name, r.kind, r.expires, r.ranOut])).toEqual([
      ['Tadhg Brady', 'manual-handling', '2026-09-02', true],
      ['Pádraig Kenny', 'ipaf', '2026-10-22', false],
      ['Tadhg Brady', 'safe-pass', '2026-11-01', false],
    ])
    expect(list.map((r) => reminderLine(r, TODAY))).toEqual(['Manual handling ran out on Wed 2 Sep', 'IPAF runs out on Thu 22 Oct', 'Safe Pass runs out on Sun 1 Nov'])
  })

  it('come with a message asking for the renewed card', () => {
    // Proves: the prompted message greets them by the name they go by and says what ran out, or runs out, and when.
    const soon = renewalMessage({ name: 'Pádraig Kenny', knownAs: 'Podge' }, { kind: 'ipaf', expires: '2026-10-22', ranOut: false }, TODAY)
    expect(soon.text).toMatch(/^Hi Podge, our records say your IPAF runs out on 22 October\.\nWhen you've renewed it, could you send us a photo of the new card\?/)
    expect(soon.subject).toBe('Your IPAF')
    const gone = renewalMessage({ name: 'Tadhg Brady' }, { kind: 'manual-handling', expires: '2026-09-02', ranOut: true }, TODAY)
    expect(gone.text).toMatch(/^Hi Tadhg, our records say your manual handling certificate ran out on 2 September\.\nIf you've renewed it/)
  })
})

describe('an edit on a device', () => {
  it('lays the certificates sent over what is held as the server does', () => {
    // Proves: an edit from a version that knows only the first three kinds, leaving out first aid to clear it, shows first aid cleared and IPAF kept before it syncs.
    const pádraig: Person = {
      id: 'p1',
      name: 'Pádraig Kenny',
      kind: 'freelancer',
      email: null,
      phone: null,
      skills: [],
      dayRateCents: null,
      notes: '',
      linkToken: 'abcdefghijklmnopqrstuvwx',
      archived: false,
      approvesLeave: false,
      department: null,
      level: 3,
      knownAs: null,
      certificates: { 'first-aid': held(null), ipaf: held('2027-01-01', '3a') },
      company: null,
    }
    const { id, name, kind, email, phone, skills, dayRateCents, notes } = pádraig
    const edit = { id: 'm1', name: 'person.upsert', args: { id, name, kind, email, phone, skills, dayRateCents, notes, certificates: {} }, createdAt: '2026-10-02T09:00:00.000Z' } as const
    const view = crewView({ person: { p1: pádraig } }, [edit], 0, TODAY)
    expect(view.people[0]!.certificates).toEqual({ ipaf: held('2027-01-01', '3a') })
  })
})

describe('the crew list', () => {
  it('reads Safe Pass, working at height and IPAF under the names a spreadsheet gives them', () => {
    // Proves: the new columns are found by their aliases, Yes is held and No not, and a blank says nothing.
    for (const [safe, wah, ipaf] of [
      ['Safe Pass', 'Working at height', 'IPAF'],
      ['Safepass', 'WAH', 'PAL card'],
    ]) {
      const { rows } = readCrewList(`First Name,Last Name,Email,${safe},${wah},${ipaf}\r\nSeán,Ó Briain,sean@example.com,Yes,No,\r\n`, null)
      expect(rows[0]!.certificates).toEqual({ 'safe-pass': { held: true, expires: null, note: '' }, 'working-at-height': { held: false, expires: null, note: '' } })
    }
  })
})
