import { describe, expect, it } from 'vitest'
import { ABILITIES, COMMAND_NAMES, COMMAND_NEEDS, refusalFor, ROLES, ROLE_CAN, roleForEmail, roleMayRun, type RolePerson } from '../src/index.ts'

const p = (id: string, email: string | null, extra: Partial<RolePerson> = {}): RolePerson => ({ id, kind: 'staff', email, archived: false, role: null, ...extra })

describe('roles', () => {
  it('say which ability every command needs', () => {
    for (const name of COMMAND_NAMES) expect(ABILITIES, name).toContain(COMMAND_NEEDS[name])
  })

  it('go from most to least: a director can do all, staff crew only their own leave and a fault', () => {
    expect(ROLE_CAN.director).toEqual(ABILITIES)
    for (const r of ROLES) for (const a of ROLE_CAN[r]) expect(ROLE_CAN.director).toContain(a)
    expect(ROLE_CAN.crew).toEqual(['fault', 'leave'])
    expect(roleMayRun('warehouse', 'move.record')).toBe(true)
    expect(roleMayRun('warehouse', 'project.update')).toBe(false)
    expect(roleMayRun('office', 'person.role')).toBe(false)
  })

  it('are off until someone not archived is a director', () => {
    expect(roleForEmail([p('a', 'a@x.ie', { role: 'office' })], 'a@x.ie')).toEqual({ role: 'director', on: false })
    expect(roleForEmail([p('d', 'd@x.ie', { role: 'director', archived: true }), p('a', 'a@x.ie', { role: 'office' })], 'a@x.ie').on).toBe(false)
    expect(roleForEmail([p('d', 'd@x.ie', { role: 'director', kind: 'freelancer' })], 'd@x.ie').on).toBe(false)
  })

  it('find the account on the Crew tab by its email, and make anyone else staff crew', () => {
    const people = [p('d', 'd@x.ie', { role: 'director' }), p('w', ' W@X.ie ', { role: 'warehouse' }), p('old', 'o@x.ie', { role: 'office', archived: true }), p('s', 's@x.ie')]
    expect(roleForEmail(people, 'w@x.ie')).toEqual({ role: 'warehouse', on: true, personId: 'w' })
    expect(roleForEmail(people, 's@x.ie').role).toBe('crew')
    expect(roleForEmail(people, 'o@x.ie').role).toBe('crew')
    expect(roleForEmail(people, 'stranger@x.ie')).toEqual({ role: 'crew', on: true })
  })

  it('say who can, and who to ask', () => {
    expect(refusalFor('warehouse', 'jobs')).toBe('Only the office and directors can change jobs, clients and venues. Your role is Warehouse; a director can change it on your person on the Crew tab.')
    expect(refusalFor('office', 'company')).toMatch(/^Only directors can change roles, erase a person or start fresh\./)
  })
})
