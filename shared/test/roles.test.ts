import { describe, expect, it } from 'vitest'
import { ABILITIES, COMMAND_NAMES, COMMAND_NEEDS, emailTakenBy, holdsARole, mayChangeWhoSignsIn, refusalFor, ROLES, ROLE_CAN, roleForEmail, roleMayRun, whoSignsInRefusal, type RolePerson } from '../src/index.ts'

const p = (id: string, email: string | null, extra: Partial<RolePerson> = {}): RolePerson => ({ id, kind: 'staff', email, archived: false, role: null, ...extra })

describe('roles', () => {
  it('say which ability every command needs', () => {
    for (const name of COMMAND_NAMES) expect(ABILITIES, name).toContain(COMMAND_NEEDS[name])
  })

  it('go from most to least: a director can do all, staff crew only their own leave and a fault', () => {
    expect(ROLE_CAN.director).toEqual(ABILITIES)
    for (const r of ROLES) for (const a of ROLE_CAN[r]) expect(ROLE_CAN.director).toContain(a)
    expect(ROLE_CAN.crew).toEqual(['fault', 'leave'])
    expect(roleMayRun('head', 'move.record')).toBe(true)
    expect(roleMayRun('head', 'project.update')).toBe(false)
    // A freelancer signed in reports a fault; their own offers, timesheets and days off go through their link (ADR 0050).
    expect(ROLE_CAN.freelancer).toEqual(['fault'])
    expect(roleMayRun('freelancer', 'leave.request')).toBe(false)
    expect(roleMayRun('freelancer', 'move.record')).toBe(false)
    expect(roleMayRun('office', 'person.role')).toBe(false)
  })

  it('are off until someone not archived is a director', () => {
    expect(roleForEmail([p('a', 'a@x.ie', { role: 'office' })], 'a@x.ie')).toEqual({ role: 'director', on: false })
    expect(roleForEmail([p('d', 'd@x.ie', { role: 'director', archived: true }), p('a', 'a@x.ie', { role: 'office' })], 'a@x.ie').on).toBe(false)
    expect(roleForEmail([p('d', 'd@x.ie', { role: 'director', kind: 'freelancer' })], 'd@x.ie').on).toBe(false)
  })

  it('find the account on the Crew tab by its email, and make anyone else staff crew', () => {
    const people = [p('d', 'd@x.ie', { role: 'director' }), p('w', ' W@X.ie ', { role: 'head' }), p('old', 'o@x.ie', { role: 'office', archived: true }), p('s', 's@x.ie'), p('f', 'f@x.ie', { kind: 'freelancer' }), p('sf', 'sf@x.ie', { role: 'freelancer' })]
    expect(roleForEmail(people, 'w@x.ie')).toEqual({ role: 'head', on: true, personId: 'w' })
    // A freelancer on the Crew tab, or a member of staff given the role, signs in as a freelancer, not staff crew.
    expect(roleForEmail(people, 'f@x.ie')).toEqual({ role: 'freelancer', on: true, personId: 'f' })
    expect(roleForEmail(people, 'sf@x.ie').role).toBe('freelancer')
    expect(roleForEmail(people, 's@x.ie').role).toBe('crew')
    expect(roleForEmail(people, 'o@x.ie').role).toBe('crew')
    expect(roleForEmail(people, 'stranger@x.ie')).toEqual({ role: 'crew', on: true })
  })

  it('say who can, and who to ask', () => {
    expect(refusalFor('freelancer', 'jobs')).toBe('Only the office and directors can change jobs, clients and venues. Your role is Freelancer; a director can change it on your person on the Crew tab.')
    expect(refusalFor('crew', 'stock')).toMatch(/^Only the office, heads of department and directors can change stock and the warehouse\./)
    expect(refusalFor('office', 'company')).toMatch(/^Only directors can change roles, erase a person or start fresh\./)
  })

  it("keep the email and type of someone who holds a role to the office and directors, and each email to one person (audit finding 12)", () => {
    expect([null, 'crew', 'freelancer', 'head', 'director'].map((role) => holdsARole({ role: role as RolePerson['role'] }))).toEqual([false, false, false, true, true])
    expect([undefined, 'director', 'office', 'head', 'crew', 'freelancer'].map((r) => mayChangeWhoSignsIn(r as RolePerson['role']))).toEqual([true, true, true, false, false, false])
    expect(whoSignsInRefusal('Colly', 'director', 'head')).toBe("Only the office and directors can change Colly's email or type: it's how they sign in as Director. Your role is Head of department.")
    const people = [p('a', ' Colly@SessionHire.com '), p('b', 'sean@sessionhire.com', { archived: true }), p('c', null)]
    expect(emailTakenBy(people, 'x', 'colly@sessionhire.com')?.id).toBe('a')
    expect(emailTakenBy(people, 'a', 'colly@sessionhire.com')).toBeUndefined()
    // Someone who has left, or no email at all, takes nothing.
    expect(emailTakenBy(people, 'x', 'sean@sessionhire.com')).toBeUndefined()
    expect(emailTakenBy(people, 'x', null)).toBeUndefined()
  })
})
