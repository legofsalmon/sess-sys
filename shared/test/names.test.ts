import { describe, expect, it } from 'vitest'
import { firstName, fullName, nameParts, namesAfter, namesOfRow, readCrewList, splitName } from '../src/index.ts'

/** A first and a last name in place of one name (ADR 0063). */
describe('a name in two', () => {
  it('is split at the last name, with the words that start one', () => {
    expect(splitName('Aoife Byrne')).toEqual({ firstName: 'Aoife', lastName: 'Byrne' })
    expect(splitName('Mary Ann Smith')).toEqual({ firstName: 'Mary Ann', lastName: 'Smith' })
    expect(splitName('Seán Ó Briain')).toEqual({ firstName: 'Seán', lastName: 'Ó Briain' })
    expect(splitName('Áine Nic Dhonnchadha')).toEqual({ firstName: 'Áine', lastName: 'Nic Dhonnchadha' })
    expect(splitName('Jan van der Berg')).toEqual({ firstName: 'Jan', lastName: 'van der Berg' })
    expect(splitName('  Dara   Quinn ')).toEqual({ firstName: 'Dara', lastName: 'Quinn' })
    // There's always a first name: one word is one, and so is a word that would start a last name.
    expect(splitName('Ó Briain')).toEqual({ firstName: 'Ó', lastName: 'Briain' })
    expect(splitName('Cher')).toEqual({ firstName: 'Cher', lastName: '' })
    expect(splitName('')).toEqual({ firstName: '', lastName: '' })
  })

  it('makes the whole name, and reads a copy from before as split', () => {
    expect(fullName({ firstName: ' Seán ', lastName: 'Ó Briain' })).toBe('Seán Ó Briain')
    expect(fullName({ firstName: 'Cher', lastName: '' })).toBe('Cher')
    expect(nameParts({ name: 'Mary Ann Smith' })).toEqual({ firstName: 'Mary Ann', lastName: 'Smith' })
    expect(nameParts({ name: 'Mary Ann Smith', firstName: 'Mary', lastName: 'Ann Smith' })).toEqual({ firstName: 'Mary', lastName: 'Ann Smith' })
    // A greeting uses the name they go by, then their first name.
    expect(firstName({ name: 'Mary Ann Smith', firstName: 'Mary Ann' })).toBe('Mary Ann')
    expect(firstName({ name: 'Mary Ann Smith', firstName: 'Mary Ann', knownAs: 'Mazz' })).toBe('Mazz')
  })

  it('keeps the two a person has when only their unchanged name is sent', () => {
    const was = { name: 'Mary Ann Smith', firstName: 'Mary', lastName: 'Ann Smith' }
    expect(namesAfter({ name: 'Mary Ann Smith' }, was)).toEqual({ name: 'Mary Ann Smith', firstName: 'Mary', lastName: 'Ann Smith' })
    expect(namesAfter({ name: 'Mary Smith' }, was)).toEqual({ name: 'Mary Smith', firstName: 'Mary', lastName: 'Smith' })
    expect(namesAfter({ name: 'Mary Ann  Smith', firstName: 'Mary Ann', lastName: 'Smith' }, was)).toEqual({ name: 'Mary Ann Smith', firstName: 'Mary Ann', lastName: 'Smith' })
    // Two that don't make the name sent are from an older copy: the name is what was meant.
    expect(namesAfter({ name: 'Mary Byrne', firstName: 'Mary', lastName: 'Ann Smith' }, was)).toEqual({ name: 'Mary Byrne', firstName: 'Mary', lastName: 'Byrne' })
  })

  it("comes from a crew list's own columns while they still make the row's name", () => {
    const { rows } = readCrewList('First Name,Last Name,Email\nSeán Óg,Ó Briain,sean@example.com\n', null)
    expect(rows[0]).toMatchObject({ name: 'Seán Óg Ó Briain', firstName: 'Seán Óg', lastName: 'Ó Briain' })
    expect(namesOfRow(rows[0]!)).toEqual({ firstName: 'Seán Óg', lastName: 'Ó Briain' })
    // Retyped by the office, the name is split as any other.
    expect(namesOfRow({ ...rows[0]!, name: 'Seán Ó Briain' })).toEqual({})
    expect(namesOfRow(readCrewList('Name\nDara Quinn\n', null).rows[0]!)).toEqual({})
  })
})
