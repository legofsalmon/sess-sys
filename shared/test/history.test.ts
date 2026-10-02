import { describe, expect, it } from 'vitest'
import { historyDays, historyTime, runLabel } from '../src/history.ts'
import type { HistoryEntry } from '../src/protocol.ts'

/**
 * The History tab's days and runs (ADR 0006, amended 2 October 2026): the
 * Irish day the server took each change on, across midnight and the night
 * the clocks go back; one person's changes one after another as one run,
 * or one device's while there are no names; and pages that join up rather
 * than showing a day or a run twice.
 */

let made = 0
const colly = { kind: 'staff', name: 'Colly Hewson', key: 'user:colly' } as const
const aoife = { kind: 'staff', name: 'Aoife Byrne', key: 'user:aoife' } as const
const someone = { kind: 'unknown', name: 'Someone' } as const

/** A change that reached the server at `at`, made then unless `madeAt` says otherwise. */
function entry(at: string, who: HistoryEntry['who'], more: Partial<HistoryEntry> = {}): HistoryEntry {
  return {
    id: `e${++made}`,
    what: `Change ${made}`,
    command: 'place.upsert',
    outcome: 'done',
    who,
    device: 'Safari on iPhone',
    deviceCode: 'c0ffee',
    madeAt: at,
    arrivedAt: at,
    madeOffline: false,
    records: [],
    ...more,
  }
}

describe('the days', () => {
  it('are Irish days, so a change at half past midnight in summer is the next day though UTC says otherwise', () => {
    // Proves: days are by the Irish date the server took each change, named Today, Yesterday, or in full, with the year only when it isn't this one.
    const now = new Date('2026-10-02T10:00:00Z')
    const entries = [
      entry('2026-10-01T23:50:00Z', colly),
      entry('2026-10-01T23:30:00Z', colly),
      entry('2026-10-01T22:30:00Z', colly),
      entry('2026-09-30T10:00:00Z', colly),
      entry('2025-12-01T10:00:00Z', colly),
    ]
    const days = historyDays(entries, now)
    expect(days.map((d) => [d.day, d.label, d.runs.flatMap((r) => r.entries.length)])).toEqual([
      ['2026-10-02', 'Today', [2]],
      ['2026-10-01', 'Yesterday', [1]],
      ['2026-09-30', 'Wednesday 30 September', [1]],
      ['2025-12-01', 'Monday 1 December 2025', [1]],
    ])
    expect(days[0]!.runs[0]).toMatchObject({ from: '00:30', to: '00:50' })
  })

  it('follow the clocks going back on 25 October, when one hour on the clock happens twice', () => {
    // Proves: 00:30 UTC is 01:30 summer time and 01:30 UTC is 01:30 winter time, both on Sunday 25 October; 23:30 UTC that night is still the 25th.
    const now = new Date('2026-10-26T12:00:00Z')
    const entries = [
      entry('2026-10-26T00:10:00Z', aoife),
      entry('2026-10-25T23:30:00Z', colly),
      entry('2026-10-25T01:30:00Z', aoife),
      entry('2026-10-25T00:30:00Z', aoife),
      entry('2026-10-24T23:30:00Z', aoife),
      entry('2026-10-24T22:30:00Z', aoife),
    ]
    const days = historyDays(entries, now)
    expect(days.map((d) => [d.label, d.runs.map((r) => [r.who, r.entries.length, r.from, r.to])])).toEqual([
      ['Today', [['Aoife Byrne', 1, '00:10', '00:10']]],
      [
        'Yesterday',
        [
          ['Colly Hewson', 1, '23:30', '23:30'],
          // An hour apart by the sun, the same time on the clock, and the start of the day half an hour before.
          ['Aoife Byrne', 3, '00:30', '01:30'],
        ],
      ],
      ['Saturday 24 October', [['Aoife Byrne', 1, '23:30', '23:30']]],
    ])
    expect(historyTime('2026-10-25T00:30:00Z', '2026-10-25')).toBe('01:30')
    expect(historyTime('2026-10-25T01:30:00Z', '2026-10-25')).toBe('01:30')
  })

  it('go by when the server took a change, so one made offline last night sits with this morning and says when it was made', () => {
    // Proves: a change made offline before midnight that arrived this morning is in Today, which shows only once, with its time and day.
    const now = new Date('2026-10-02T10:00:00Z')
    const entries = [
      entry('2026-10-02T08:05:00Z', colly),
      entry('2026-10-02T08:00:00Z', colly, { madeAt: '2026-10-01T22:50:00.000Z', madeOffline: true, waitedSeconds: 33_000 }),
      entry('2026-10-01T21:00:00Z', colly),
    ]
    const days = historyDays(entries, now)
    expect(days.map((d) => d.label)).toEqual(['Today', 'Yesterday'])
    expect(days[0]!.runs).toHaveLength(2)
    expect(days[0]!.runs[1]).toMatchObject({ from: 'Thu 1 Oct, 23:50', to: 'Thu 1 Oct, 23:50' })
  })
})

describe('the runs', () => {
  it("are one person's changes one after another, broken by anyone else's or by more than an hour", () => {
    // Proves: a run ends at someone else's change or a gap of over an hour, a turned-down change stays in its run and is counted, and the label says who, how many and when.
    const now = new Date('2026-10-02T17:00:00Z')
    const entries = [
      entry('2026-10-02T13:30:00Z', colly),
      entry('2026-10-02T08:40:00Z', colly),
      entry('2026-10-02T08:35:00Z', colly, { outcome: 'turned-down', reason: 'Only 0 × d&b Y10P counted at Bay A3, not 4.' }),
      entry('2026-10-02T08:12:00Z', colly, { device: 'Edge on Windows', deviceCode: 'a1b2c3' }),
      entry('2026-10-02T08:10:00Z', aoife),
      entry('2026-10-02T08:05:00Z', colly),
    ]
    const [today] = historyDays(entries, now)
    expect(today!.runs.map((r) => [r.who, r.entries.map((e) => e.id)])).toEqual([
      ['Colly Hewson', [entries[0]!.id]],
      ['Colly Hewson', [entries[1]!.id, entries[2]!.id, entries[3]!.id]],
      ['Aoife Byrne', [entries[4]!.id]],
      ['Colly Hewson', [entries[5]!.id]],
    ])
    const morning = today!.runs[1]!
    expect(morning).toMatchObject({ id: entries[1]!.id, byDevice: false, turnedDown: 1, devices: ['Safari on iPhone, device c0ffee', 'Edge on Windows, device a1b2c3'] })
    expect(runLabel(morning)).toBe('Colly Hewson, 3 changes, 09:12 to 09:40')
    expect(runLabel(today!.runs[0]!)).toBe('Colly Hewson, 1 change, 14:30')
  })

  it("are a device's while there are no names, as with sign-in off", () => {
    // Proves: changes with no name (every one "Someone") run by the device they came from, named by its code, and a freelancer's own answers still run under their name.
    const now = new Date('2026-10-02T17:00:00Z')
    const dara = { kind: 'link', name: 'Dara Kelly', key: 'link:p1' } as const
    const entries = [
      entry('2026-10-02T09:30:00Z', someone, { device: 'Chrome on Linux', deviceCode: '0ff1ce' }),
      entry('2026-10-02T09:20:00Z', someone, { device: 'Chrome on Linux', deviceCode: '0ff1ce' }),
      entry('2026-10-02T09:15:00Z', dara, { device: 'Chrome on Android', deviceCode: undefined }),
      entry('2026-10-02T09:10:00Z', someone),
      entry('2026-10-02T09:00:00Z', someone),
      entry('2026-10-02T08:50:00Z', someone, { device: 'Made-up data', deviceCode: undefined }),
    ]
    const [today] = historyDays(entries, now)
    expect(today!.runs.map((r) => [r.who, r.byDevice, r.entries.length])).toEqual([
      ['Device 0ff1ce', true, 2],
      ['Dara Kelly', false, 1],
      ['Device c0ffee', true, 2],
      ['Made-up data', true, 1],
    ])
    expect(runLabel(today!.runs[0]!)).toBe('Device 0ff1ce, 2 changes, 10:20 to 10:30')
  })
})

describe('pages', () => {
  it('join up: a day and a run cut in two by "Show older" are one again, keeping the run by its newest change', () => {
    // Proves: grouping all the pages loaded so far gives each day once and each run once, and a run's id doesn't change as older changes join it.
    const now = new Date('2026-10-02T17:00:00Z')
    const first = [entry('2026-10-02T09:40:00Z', aoife), entry('2026-10-02T09:30:00Z', colly), entry('2026-10-02T09:20:00Z', colly)]
    const older = [entry('2026-10-02T09:10:00Z', colly), entry('2026-10-02T09:00:00Z', colly), entry('2026-10-01T16:00:00Z', colly)]

    const before = historyDays(first, now)
    expect(before.map((d) => d.label)).toEqual(['Today'])
    expect(before[0]!.runs.map((r) => [r.id, r.entries.length])).toEqual([
      [first[0]!.id, 1],
      [first[1]!.id, 2],
    ])

    const after = historyDays([...first, ...older], now)
    expect(after.map((d) => d.label)).toEqual(['Today', 'Yesterday'])
    expect(after[0]!.runs.map((r) => [r.id, r.entries.length, r.from, r.to])).toEqual([
      [first[0]!.id, 1, '10:40', '10:40'],
      [first[1]!.id, 4, '10:00', '10:30'],
    ])
    expect(after[1]!.runs.map((r) => r.entries.length)).toEqual([1])
  })

  it('stay quick with a thousand changes', () => {
    // Proves: grouping is one pass, so a long history loaded page by page costs next to nothing to group again.
    const now = new Date('2026-10-02T17:00:00Z')
    const start = Date.parse('2026-10-02T16:00:00Z')
    const many = Array.from({ length: 1000 }, (_, i) => entry(new Date(start - i * 5 * 60_000).toISOString(), i % 7 === 0 ? aoife : colly))
    const took = performance.now()
    const days = historyDays(many, now)
    expect(performance.now() - took).toBeLessThan(200)
    expect(days.reduce((n, d) => n + d.runs.reduce((m, r) => m + r.entries.length, 0), 0)).toBe(1000)
  })
})
