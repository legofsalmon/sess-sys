import { describe, expect, it } from 'vitest'
import { addSkills, firstPick, skillsInUse, suggestSkills } from '../src/skills.ts'

describe('skills in use', () => {
  it('counts each once per person whatever its case, most used first, in the spelling most have', () => {
    const people = [{ skills: ['Audio', 'Rigger'] }, { skills: ['audio', 'AUDIO'] }, { skills: ['Audio', 'LX', ' '] }, { skills: ['Rigger'] }]
    expect(skillsInUse(people)).toEqual(['Audio', 'Rigger', 'LX'])
  })
})

describe('suggesting skills', () => {
  const known = ['Audio', 'Rigger', 'Monitor engineer', 'Stage manager', 'Audio No.2', 'LX']
  it('offers the most used when nothing is typed, leaving out those chosen', () => {
    expect(suggestSkills(known, '', ['rigger'], 3)).toEqual(['Audio', 'Monitor engineer', 'Stage manager'])
  })
  it('puts those starting with it before those with a word starting with it', () => {
    expect(suggestSkills(known, 'man', [])).toEqual(['Stage manager'])
    expect(suggestSkills(known, 'au', ['Audio'])).toEqual(['Audio No.2'])
    expect(suggestSkills(known, 'eng', [])).toEqual(['Monitor engineer'])
  })
})

describe('the offer Enter takes', () => {
  it('is the one spelt as typed, else the first starting with it', () => {
    expect(firstPick(['Audio No.2', 'Audio'], 'audio', [], false)).toBe(1)
    expect(firstPick(['Audio', 'Audio No.2'], 'au', [], true)).toBe(0)
  })
  it('is the new one when none starts with what is typed', () => {
    expect(firstPick(['Monitor engineer'], 'eng', [], true)).toBe(1)
    expect(firstPick([], 'Pyro', [], true)).toBe(0)
  })
  it('is none with nothing typed, or with what is typed already chosen', () => {
    expect(firstPick(['Audio'], '  ', [], false)).toBe(-1)
    expect(firstPick(['Audio No.2'], 'AUDIO', ['Audio'], false)).toBe(-1)
  })
})

describe('adding skills', () => {
  it('splits a pasted list, keeps each once and uses the list’s own spelling', () => {
    expect(addSkills(['Audio'], 'audio, rigger; Forklift', ['Rigger'])).toEqual(['Audio', 'Rigger', 'Forklift'])
  })
  it('stops at thirty', () => {
    const many = Array.from({ length: 30 }, (_, i) => `S${i}`)
    expect(addSkills(many, 'one more')).toHaveLength(30)
  })
})
