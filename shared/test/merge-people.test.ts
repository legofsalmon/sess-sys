import { describe, expect, it } from 'vitest'
import { crewView, emailTakenBy, keptOf, mergedPerson, mergeRefusal, offerKept, personForEmail, samePeople, withMainEmail, type Mutation, type Person } from '../src/index.ts'

/**
 * Combining people brought in twice (ADR 0055): who looks like one person,
 * which is kept, and what the one person holds, against the shapes the two
 * bring-ins of October 2026 made: a company address and a personal one,
 * a name made from an address, the same number twice.
 */

let n = 0
const person = (name: string, over: Partial<Person> = {}): Person => ({
  id: `p${String(++n).padStart(3, '0')}`,
  name,
  kind: 'freelancer',
  email: null,
  phone: null,
  skills: [],
  dayRateCents: null,
  notes: '',
  linkToken: `link-${n}`,
  archived: false,
  approvesLeave: false,
  department: null,
  level: 1,
  knownAs: null,
  certificates: {},
  company: null,
  role: null,
  ...over,
})

describe('who looks like one person', () => {
  it('finds the same full name, the same number, and an address that spells a name', () => {
    const groups = samePeople([
      person('Aoife Byrne', { email: 'aoife@sessionhire.com' }),
      person('Aoifebyrne', { email: 'aoifebyrne@gmail.com' }),
      person('Cian Walsh', { phone: '+353 87 123 4567' }),
      person('C Walsh', { phone: '0871234567' }),
      person('Dara Nolan'),
      person('Dara Nolan', { email: 'dara.nolan@gmail.com' }),
      person('Someone Else'),
    ])
    expect(groups.map((g) => [g.people.map((p) => p.name), g.because, g.sure])).toEqual([
      [['Aoife Byrne', 'Aoifebyrne'], 'address', true],
      [['Cian Walsh', 'C Walsh'], 'phone', true],
      [['Dara Nolan', 'Dara Nolan'], 'name', true],
    ])
  })

  it('offers a first name from an address beside the one person it could be, unticked, and not beside two', () => {
    const groups = samePeople([person('Adam Byrne'), person('Adam', { email: 'adam@gmail.com' }), person('Olan Kelly'), person('Olan Ryan'), person('Olan', { email: 'olan@gmail.com' })])
    expect(groups.map((g) => [g.people.map((p) => p.name), g.because, g.sure])).toEqual([[['Adam Byrne', 'Adam'], 'first-name', false]])
  })

  it("leaves out the archived, and a one-word name shared by two who aren't named from an address", () => {
    expect(samePeople([person('Aoife Byrne'), person('Aoife Byrne', { archived: true }), person('Jay'), person('Jay')])).toEqual([])
  })
})

describe('the one person', () => {
  it('keeps theirs, fills what they lack from the others, and keeps every address', () => {
    const into = person('Aoife Byrne', { kind: 'staff', email: 'aoife@sessionhire.com', skills: ['Audio'], level: 2, certificates: { 'first-aid': { held: false, expires: null, note: '' } } })
    const from = person('Aoifebyrne', {
      email: ' AoifeByrne@Gmail.com',
      phone: '+353871234567',
      skills: ['audio', 'LX'],
      dayRateCents: 25000,
      notes: 'Has a van.',
      level: 3,
      certificates: { 'first-aid': { held: true, expires: '2027-01-01', note: '' } },
      otherEmails: ['aoife.b@hotmail.com'],
    })
    expect(mergedPerson(into, [from])).toMatchObject({
      id: into.id,
      name: 'Aoife Byrne',
      kind: 'staff',
      email: 'aoife@sessionhire.com',
      otherEmails: ['aoifebyrne@gmail.com', 'aoife.b@hotmail.com'],
      phone: '+353871234567',
      skills: ['Audio', 'LX'],
      dayRateCents: 25000,
      notes: 'Has a van.',
      level: 3,
      certificates: { 'first-aid': { held: true, expires: '2027-01-01', note: '' } },
      linkToken: into.linkToken,
    })
  })

  it('takes a real name over one made from an address, and is archived only if all were', () => {
    const one = mergedPerson(person('Craicaudio', { email: 'craicaudio@gmail.com', archived: true }), [person('Ciarán Óg', { archived: false })])
    expect(one).toMatchObject({ name: 'Ciarán Óg', archived: false })
  })

  it('keeps staff first, then a real name, as the one kept to start with', () => {
    const free = person('Aoife Byrne', { email: 'aoife.byrne@gmail.com' })
    const staff = person('Aoife', { kind: 'staff', email: 'aoife@sessionhire.com' })
    expect(keptOf([free, staff]).id).toBe(staff.id)
    expect(keptOf([person('Craic', { email: 'craic@gmail.com' }), free]).id).toBe(free.id)
  })

  it('refuses two roles, or a role on a freelancer', () => {
    expect(mergeRefusal(person('A', { kind: 'staff', role: 'director' }), [person('B', { kind: 'staff', role: 'office' })])).toContain('different roles')
    expect(mergeRefusal(person('A'), [person('B', { kind: 'staff', role: 'office' })])).toContain("Keep B's details instead")
    expect(mergeRefusal(person('A', { kind: 'staff' }), [person('B', { kind: 'staff', role: 'office' })])).toBeUndefined()
  })

  it('is found by any of their addresses, which nobody else can be given', () => {
    const one = person('Aoife Byrne', { email: 'aoife@sessionhire.com', otherEmails: ['aoifebyrne@gmail.com'] })
    expect(personForEmail([one], 'AoifeByrne@gmail.com ')?.id).toBe(one.id)
    expect(emailTakenBy([one], 'someone', 'aoifebyrne@gmail.com')?.id).toBe(one.id)
  })
})

describe('one call offered to them twice', () => {
  it('keeps the booking, with every day either held', () => {
    const { kept, days } = offerKept([
      { id: 'o1', status: 'offered' as const, days: ['2026-07-03'] },
      { id: 'o2', status: 'confirmed' as const, days: ['2026-07-01'] },
      { id: 'o3', status: 'accepted' as const, days: ['2026-07-02'] },
    ])
    expect([kept.id, days]).toEqual(['o2', ['2026-07-01', '2026-07-02']])
  })

  it('keeps the one with a timesheet', () => {
    const offers = [
      { id: 'o1', status: 'confirmed' as const, days: ['2026-07-01'] },
      { id: 'o2', status: 'declined' as const, days: ['2026-07-01'] },
    ]
    expect(offerKept(offers, (o) => o.id === 'o2').kept.id).toBe('o2')
  })
})

describe('on a device, before the server answers', () => {
  it('shows one person with the others offers and days off', () => {
    const a = person('Aoife Byrne', { email: 'aoife@sessionhire.com' })
    const b = person('Aoifebyrne', { email: 'aoifebyrne@gmail.com' })
    const merge: Mutation<'person.merge'> = { id: 'm1', name: 'person.merge', args: { id: a.id, from: [b.id] }, createdAt: '2026-10-19T10:00:00Z' }
    const view = crewView(
      {
        person: { [a.id]: a, [b.id]: b },
        unavailability: { u1: { id: 'u1', personId: b.id, start: '2026-10-20', end: '2026-10-20', note: '', source: 'ops' } },
      },
      [merge],
      0,
      '2026-10-19',
    )
    expect(view.people.map((p) => [p.name, p.otherEmails, p.pending])).toEqual([['Aoife Byrne', ['aoifebyrne@gmail.com'], true]])
    expect(view.unavailability.map((u) => u.personId)).toEqual([a.id])
  })
})

describe('making another address the main one (ADR 0063)', () => {
  it('swaps them, keeping every address, and refuses one they are not found by', () => {
    const a = person('Adam Byrne', { email: 'Adam@SessionHire.com', otherEmails: ['adam@gmail.com', 'adambyrne@yahoo.ie'] })
    expect(withMainEmail(a, ' ADAM@gmail.com')).toEqual({ email: 'adam@gmail.com', otherEmails: ['adam@sessionhire.com', 'adambyrne@yahoo.ie'] })
    expect(withMainEmail(a, 'adam@sessionhire.com')).toBeUndefined()
    expect(withMainEmail(a, 'someone@else.ie')).toBeUndefined()
    expect(withMainEmail({ email: null, otherEmails: ['adam@gmail.com'] }, 'adam@gmail.com')).toEqual({ email: 'adam@gmail.com', otherEmails: [] })
  })

  it('shows the swap on a device before the server answers, and the same person found by each address', () => {
    const a = person('Adam Byrne', { kind: 'staff', email: 'adam@sessionhire.com', otherEmails: ['adam@gmail.com'], role: 'office' })
    const swap: Mutation<'person.mainEmail'> = { id: 'm1', name: 'person.mainEmail', args: { id: a.id, email: 'adam@gmail.com' }, createdAt: '2026-10-20T10:00:00Z' }
    const [p] = crewView({ person: { [a.id]: a } }, [swap], 0, '2026-10-20').people
    expect([p!.email, p!.otherEmails, p!.pending]).toEqual(['adam@gmail.com', ['adam@sessionhire.com'], true])
    for (const e of ['adam@gmail.com', 'adam@sessionhire.com']) expect(personForEmail([p!], e)?.id).toBe(a.id)
  })
})
