import { describe, expect, it } from 'vitest'
import type { Mutation } from '../src/commands.ts'
import type { Person } from '../src/crew.ts'
import { crewView } from '../src/sync/crew-view.ts'

/**
 * The crew screen's view of people (audit finding 7): a device's own edit,
 * archive or contact change is laid over what the server said, the way a
 * new person is, keeping what the device doesn't own.
 */

const aoife: Person = {
  id: 'p1',
  name: 'Aoife Byrne',
  kind: 'freelancer',
  email: 'aoife@example.com',
  phone: '+353871234567',
  skills: ['audio'],
  dayRateCents: 25000,
  notes: '',
  linkToken: 'abcdefghijklmnopqrstuvwx',
  archived: false,
  approvesLeave: false,
}

const pending = <N extends Mutation['name']>(name: N, args: Mutation<N>['args']): Mutation => ({ id: `m-${name}`, name, args, createdAt: '2026-10-01T09:00:00Z' }) as Mutation

describe('a pending change to a person', () => {
  it('lays an edit over them like a new person, keeping their link and whether they are archived', () => {
    const edit = pending('person.upsert', { id: 'p1', name: 'Aoife Byrne-Walsh', kind: 'freelancer', email: null, phone: '+353871234568', skills: ['audio', 'rf'], dayRateCents: 27500, notes: 'Has a van' })
    const view = crewView({ person: { p1: { ...aoife, archived: true } } }, [edit], 0)
    expect(view.people).toEqual([{ ...aoife, name: 'Aoife Byrne-Walsh', email: null, phone: '+353871234568', skills: ['audio', 'rf'], dayRateCents: 27500, notes: 'Has a van', archived: true, pending: true }])
    // Once the server has applied it and the device has pulled past it, the server's record stands.
    expect(crewView({ person: { p1: aoife } }, [{ ...edit, appliedSeq: 5 }], 5).people[0]).toMatchObject({ name: 'Aoife Byrne', pending: false })
  })

  it('archives and brings back, and changes only the contact details sent', () => {
    const away = crewView({ person: { p1: aoife } }, [pending('person.archive', { id: 'p1', archived: true })], 0)
    expect(away.people[0]).toMatchObject({ archived: true, pending: true })
    const back = crewView({ person: { p1: { ...aoife, archived: true } } }, [pending('person.archive', { id: 'p1', archived: false })], 0)
    expect(back.people[0]).toMatchObject({ archived: false, pending: true })

    const phone = crewView({ person: { p1: aoife } }, [pending('person.contact', { id: 'p1', phone: null })], 0)
    expect(phone.people[0]).toMatchObject({ phone: null, email: 'aoife@example.com', pending: true })
    // A change for someone this device hasn't heard of yet is nothing to show.
    expect(crewView({}, [pending('person.contact', { id: 'p9', phone: null })], 0).people).toEqual([])
  })

  it('reads people synced before archiving existed as not archived', () => {
    const { archived: _, ...before } = aoife
    const view = crewView({ person: { p1: before as Person } }, [], 0)
    expect(view.people[0]).toMatchObject({ archived: false, pending: false })
  })
})
