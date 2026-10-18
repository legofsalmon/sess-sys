import { describe, expect, it } from 'vitest'
import type { CallView } from '../src/sync/crew-view.ts'
import { crewByDay, jobsByMonth, jobsByWeek, kitByDay, moneyByMonth, myWeeks } from '../src/sync/home-charts.ts'
import type { JobView } from '../src/sync/jobs-view.ts'
import type { KitLineView } from '../src/sync/kit-view.ts'

/**
 * The charts on Home (ADR 0054): a column per week, day or month, its parts
 * stacked settled first; work only (no errands, meetings, cancelled or
 * lost jobs); a job across two weeks counted in each; crew short only for
 * the days a call has them short.
 */

const today = '2026-10-21' // a Wednesday
const job = (id: string, status: JobView['status'], days: [string, string][], kind?: JobView['kind']) =>
  ({ id, status, kind, phases: days.map(([start, end]) => ({ start, end })) }) as unknown as JobView

describe('jobs by week', () => {
  it('counts work on in each week from this Monday, confirmed then not yet decided', () => {
    const cols = jobsByWeek(
      [
        job('a', 'confirmed', [['2026-10-19', '2026-10-19']]),
        job('b', 'enquiry', [['2026-10-25', '2026-10-27']]),
        job('c', 'cancelled', [['2026-10-21', '2026-10-21']]),
        job('d', 'confirmed', [['2026-10-22', '2026-10-22']], 'meeting'),
        job('e', 'confirmed', [['2026-10-22', '2026-10-22']], 'hire'),
      ],
      today,
      3,
    )
    expect(cols.map((c) => c.key)).toEqual(['2026-10-19', '2026-10-26', '2026-11-02'])
    expect(cols.map((c) => c.parts)).toEqual([[2, 1], [0, 1], [0, 0]])
    expect(cols[0]!.now).toBe(true)
    expect(cols[0]!.name).toBe('This week')
    expect(cols[1]!.name).toBe('Week of 26 October')
    expect(cols[2]!.tick).toBe('2 Nov')
  })
})

describe('jobs by month', () => {
  it('runs six months back to five ahead, this one marked', () => {
    const cols = jobsByMonth([job('a', 'confirmed', [['2026-05-30', '2026-06-02']])], today)
    expect(cols).toHaveLength(12)
    expect(cols[0]!.key).toBe('2026-04')
    expect(cols[6]).toMatchObject({ key: '2026-10', now: true, name: 'October 2026' })
    expect(cols.filter((c) => c.parts[0] === 1).map((c) => c.key)).toEqual(['2026-05', '2026-06'])
  })
})

describe('crew by day', () => {
  const call = (over: Partial<CallView>) =>
    ({ status: 'open', start: today, end: '2026-10-22', days: [today, '2026-10-22'], needed: 3, heldByDay: { [today]: 2, '2026-10-22': 3 }, offers: [], department: 'Audio', ...over }) as unknown as CallView
  it('splits each day into booked, waiting to confirm and still needed', () => {
    const offers = [
      { status: 'confirmed', days: [today, '2026-10-22'] },
      { status: 'accepted', days: [today, '2026-10-22'] },
      { status: 'confirmed', days: ['2026-10-22'] },
    ]
    const cols = crewByDay([call({ offers } as Partial<CallView>)], today, 3)
    expect(cols.map((c) => c.parts)).toEqual([[1, 1, 1], [2, 1, 0], [0, 0, 0]])
    expect(cols[0]!.name).toBe('Today')
  })
  it('keeps to one department when asked', () => {
    expect(crewByDay([call({})], today, 1, 'lighting')[0]!.parts).toEqual([0, 0, 0])
    expect(crewByDay([call({})], today, 1, 'audio')[0]!.parts).toEqual([0, 2, 1])
  })
})

describe('kit by day', () => {
  it('adds up items held each day, confirmed jobs then pencilled', () => {
    const line = (hold: string, own: number, start: string, end: string) => ({ hold, own, held: { start, end } }) as unknown as KitLineView
    const cols = kitByDay([line('held', 4, '2026-10-20', today), line('pencilled', 2, '2026-10-22', '2026-10-23'), line('none', 9, today, today)], today, 3)
    expect(cols.map((c) => c.parts)).toEqual([[4, 0], [0, 2], [0, 2]])
  })
})

describe('my weeks', () => {
  it('counts the days from today on, each once', () => {
    const call = {
      status: 'open',
      end: '2026-10-30',
      offers: [
        { personId: 'me', status: 'confirmed', days: ['2026-10-20', today, '2026-10-22'] },
        { personId: 'me', status: 'confirmed', days: ['2026-10-22', '2026-10-27'] },
        { personId: 'me', status: 'accepted', days: ['2026-10-28'] },
        { personId: 'you', status: 'confirmed', days: ['2026-10-23'] },
      ],
    } as unknown as CallView
    expect(myWeeks([call], 'me', today, 2).map((c) => c.parts)).toEqual([[2, 0], [1, 1]])
  })
})

describe('money by month', () => {
  it('splits quoted into confirmed and still a quote, three months back to two ahead', () => {
    const cols = moneyByMonth([{ key: '2026-10', label: '', quoted: 5000, confirmed: 3000, invoiced: 0, costs: 0 }], today)
    expect(cols.map((c) => c.key)).toEqual(['2026-07', '2026-08', '2026-09', '2026-10', '2026-11', '2026-12'])
    expect(cols[3]!.parts).toEqual([3000, 2000])
    expect(cols[0]!.parts).toEqual([0, 0])
  })
})
