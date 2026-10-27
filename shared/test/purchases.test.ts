import { describe, expect, it } from 'vitest'
import { broughtInId, matchAsker, readDay, readPurchaseList, readStatus } from '../src/purchases.ts'

/** Bringing a purchase list in (ADR 0077): a spreadsheet read as requests, with who asked matched to the Crew tab where only one person fits. */

describe('a purchase list from a spreadsheet', () => {
  it('reads each row under its headings, in any order and spelling, and says what it could not read', () => {
    const file = [
      'What,Asked by,Asked on,How many and details,Link,Department,Where it’s at,Notes',
      'NL4T connectors,Smokey,22/04/2026,20,thomann.de/ie/nl4t.htm,audio,Ordered,"Adam: ""I’ll ask them to ship connectors."""',
      ',Oz,2026-04-22,,,,,',
      'Fog machines,Shane,31/09/2026,Many,not a link,SFX,Maybe,',
      '',
    ].join('\r\n')
    const { rows, problem } = readPurchaseList(file)
    expect(problem).toBeUndefined()
    expect(rows.map((r) => r.row)).toEqual([2, 3, 4])
    expect(rows[0]).toMatchObject({
      title: 'NL4T connectors',
      askedBy: 'Smokey',
      askedOn: '2026-04-22',
      details: '20',
      link: 'https://thomann.de/ie/nl4t.htm',
      department: 'audio',
      status: 'ordered',
      notes: 'Adam: "I’ll ask them to ship connectors."',
      problems: [],
      id: broughtInId('2026-04-22', 'Smokey', 'NL4T connectors'),
    })
    expect(rows[1]!.problems).toEqual(['It says nothing under What.'])
    expect(rows[2]!.problems).toEqual([
      '“31/09/2026” isn\'t a date: write it as 22/04/2026.',
      '“Maybe” isn\'t one of Asked for, Agreed, Ordered, Arrived, Not buying.',
      "The link isn't a web address. Copy it from the shop's page.",
    ])
    expect(readPurchaseList('Who,When\nOz,2026-04-22').problem).toBe('The first line needs a heading “What”, over the column saying what to buy.')
    // Saved where a comma is the decimal mark: semicolons.
    expect(readPurchaseList('What;How many\nMic stands;20').rows[0]).toMatchObject({ title: 'Mic stands', details: '20', status: 'asked' })
  })

  it('gives a row the same id each time, so the same list again adds nothing', () => {
    expect(broughtInId('2026-04-22', ' smokey', 'NL4T connectors ')).toBe(broughtInId('2026-04-22', 'Smokey', 'nl4t connectors'))
    expect(broughtInId('2026-04-22', 'Smokey', 'NL4T')).not.toBe(broughtInId('2026-04-23', 'Smokey', 'NL4T'))
    expect(broughtInId('2026-04-22', 'Smokey', 'NL4T')).toMatch(/^buy-[0-9a-z]{14}$/)
  })

  it('reads days and statuses as people write them', () => {
    expect(['22/04/2026', '2026-04-22', '22.4.26', '22/04/2026, 20:05:53', '2026-04-22T19:05:53Z'].map(readDay)).toEqual(Array(5).fill('2026-04-22'))
    expect(readDay('next week')).toBeUndefined()
    expect(['', 'Asked for', 'requested', 'ORDERED', 'bought', 'Not buying', 'have it', 'Agreed'].map(readStatus)).toEqual([
      'asked',
      'asked',
      'asked',
      'ordered',
      'ordered',
      'no',
      'arrived',
      'agreed',
    ])
  })

  it('matches who asked to the one person it can be, and nobody when it could be two', () => {
    const people = [
      { id: 'd', name: 'Dara Kelly', knownAs: 'Smokey' },
      { id: 'g', name: 'Glenn Stankard' },
      { id: 'j1', name: 'Jack Walsh' },
      { id: 'j2', name: 'Jack Byrne' },
      { id: 'o', name: 'Oz Murphy', firstName: 'Oz' },
      { id: 'x', name: 'Shane Doyle', archived: true },
    ]
    expect(matchAsker('Smokey', people)?.id).toBe('d')
    expect(matchAsker('glenn  stankard', people)?.id).toBe('g')
    expect(matchAsker('Glenn', people)?.id).toBe('g')
    expect(matchAsker('Oz', people)?.id).toBe('o')
    // Two Jacks, a Glenn by another surname, and someone archived: the office chooses.
    expect(matchAsker('Jack', people)).toBeUndefined()
    expect(matchAsker('Glenn Byrne', people)).toBeUndefined()
    expect(matchAsker('Shane', people)).toBeUndefined()
  })
})
