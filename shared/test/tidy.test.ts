import { describe, expect, it } from 'vitest'
import { clientWords, jobsNaming, joinedPhaseName, namedFromAddress, sameJobs, tailOf, venueGuesses, withCapital, type TidyJob } from '../src/index.ts'

/**
 * Tidying what came in from the calendars (ADR 0050), against the shapes the
 * real bring-in made on 16 October 2026: a festival as a job a department,
 * people named from their address, venues in titles.
 */

let n = 0
const job = (name: string, start: string, end = start, over: Partial<TidyJob> = {}): TidyJob => ({
  id: `j${++n}`,
  name,
  status: 'confirmed',
  kind: 'gig',
  clientId: null,
  venueId: null,
  sourceCalendar: 'adam@sessionhire.com',
  span: { start, end },
  ...over,
})
const venue = (name: string) => ({ id: `v-${name}`, name, address: '', notes: '' })

describe('the same job brought in as several', () => {
  it('puts a festival back together from its department days, and leaves another job at the same time alone', () => {
    const groups = sameJobs([
      job('EP - LX', '2026-08-20', '2026-08-23'),
      job('EP - Audio', '2026-08-20', '2026-08-22'),
      job('EP - Smirnoff LX', '2026-08-23', '2026-08-28'),
      job('Supercar show dundrum', '2026-08-20', '2026-08-23'),
    ])
    expect(groups).toHaveLength(1)
    expect(groups[0]).toMatchObject({ name: 'EP', sure: true })
    expect(groups[0]!.jobs.map((j) => j.name)).toEqual(['EP - LX', 'EP - Audio', 'EP - Smirnoff LX'])
  })

  it('suggests one name starting another, without ticking it, and keeps apart what is weeks apart or another kind', () => {
    const groups = sameJobs([
      job('Addison Rae', '2026-06-02'),
      job('Addison Rae Show', '2026-06-03'),
      job('Block', '2026-02-06'),
      job('Block', '2026-06-13'),
      job('Murt', '2026-09-16'),
      job('Murt lx hire', '2026-09-16', '2026-09-16', { kind: 'hire' }),
    ])
    expect(groups.map((g) => [g.name, g.sure, g.jobs.length])).toEqual([['Addison Rae', false, 2]])
  })

  it('still finds a job starting late in a long one, past the short jobs between them, and stops looking past the near days (audit, 20 October 2026, finding 2)', () => {
    const between = Array.from({ length: 30 }, (_, i) => job(`Other ${i}`, `2026-07-${String(2 + (i % 20)).padStart(2, '0')}`))
    const groups = sameJobs([job('Longitude - Build', '2026-07-01', '2026-07-25'), ...between, job('Longitude - Show', '2026-07-24'), job('Longitude - Out', '2026-07-31')])
    expect(groups.map((g) => g.jobs.map((j) => j.name))).toEqual([['Longitude - Build', 'Longitude - Show']])
  })

  it("doesn't put a job made in the app with one brought in, nor one not going ahead", () => {
    expect(sameJobs([job('Fuel', '2026-10-25'), job('Fuel - Cupra', '2026-10-25', '2026-10-25', { sourceCalendar: undefined })])).toEqual([])
    expect(sameJobs([job('Fuel', '2026-10-25'), job('Fuel - Cupra', '2026-10-25', '2026-10-25', { status: 'cancelled' })])).toEqual([])
  })

  it('says what each name adds, and names the day for it', () => {
    expect(tailOf('EP - Smirnoff LX', 'EP')).toBe('Smirnoff LX')
    expect(tailOf('EP - EPIX', 'EP')).toBe('EPIX')
    expect(tailOf('Addison Rae Show', 'Addison Rae')).toBe('Show')
    expect(tailOf('ATN', 'ATN')).toBe('')
    expect(tailOf('EP - LX', 'Electric Picnic')).toBe('LX')
    expect(joinedPhaseName('Show', 'Smirnoff LX', 'gig')).toBe('Smirnoff LX')
    expect(joinedPhaseName('Show', 'FLY Show', 'gig')).toBe('FLY Show')
    expect(joinedPhaseName('Load out', 'LX', 'gig')).toBe('Load out (LX)')
    expect(joinedPhaseName('Build', '', 'gig')).toBe('Build')
  })
})

describe('people named from their address', () => {
  it('finds the ones nobody has named yet', () => {
    expect(namedFromAddress({ name: 'Craicaudio', email: 'craicaudio@gmail.com', archived: false })).toBe(true)
    expect(namedFromAddress({ name: 'Abbierea', email: 'abbierea188@gmail.com', archived: false })).toBe(true)
    expect(namedFromAddress({ name: 'Ciarán Doyle', email: 'ciandoeslights@gmail.com', archived: false })).toBe(false)
    expect(namedFromAddress({ name: 'Info', email: 'info@sessionhire.com', archived: true })).toBe(false)
  })

  it('lets go of one the office named, even where the address spells their name (ADR 0068)', () => {
    expect(namedFromAddress({ name: 'Aoife Byrne', email: 'aoife.byrne@gmail.com', archived: false })).toBe(true)
    expect(namedFromAddress({ name: 'Aoife Byrne', email: 'aoife.byrne@gmail.com', archived: false, nameChecked: true })).toBe(false)
  })
})

describe('venues and clients from names', () => {
  it('finds a venue the app has in a job name, however it is written', () => {
    const venues = [venue('Button Factory'), venue('3Arena'), venue('Royal Dublin Society (RDS)'), venue('The National Stadium'), venue('House')]
    const guesses = venueGuesses(
      [job('Real events button factory', '2026-05-07'), job('Jazzy 3 arena dj booth', '2026-05-08'), job('Bill palmer projector plus screen Rds', '2026-05-09'), job('Boney M national stadium', '2026-05-10'), job('bekah archetype store house', '2026-05-11')],
      venues
    )
    expect(guesses.map((g) => [g.job.name, g.venue.name])).toEqual([
      ['Real events button factory', 'Button Factory'],
      ['Jazzy 3 arena dj booth', '3Arena'],
      ['Bill palmer projector plus screen Rds', 'Royal Dublin Society (RDS)'],
      ['Boney M national stadium', 'The National Stadium'],
    ])
  })

  it("offers where other jobs of the same name were, and leaves a job that has its venue", () => {
    const at = venue('Button Factory')
    const guesses = venueGuesses([job('Tulio', '2026-05-07', '2026-05-07', { venueId: at.id }), job('tulio', '2026-08-07'), job('Weze', '2026-08-08', '2026-08-08', { phaseVenues: [at.id] })], [venue('3Arena'), at])
    expect(guesses.map((g) => [g.job.name, g.why])).toEqual([['tulio', 'before']])
  })

  it('lists words in many names that could be a client, and the jobs with one', () => {
    const jobs = [job('Joanna verve KPMG', '2026-05-01'), job('Verve google job', '2026-05-02'), job('Ollie Verve - LX', '2026-05-03'), job('Button factory show', '2026-05-04')]
    expect(clientWords(jobs, { clients: [], venues: [venue('Button Factory')] })).toEqual([{ word: 'Verve', jobs: 3 }])
    expect(jobsNaming(jobs, 'verve').map((j) => j.name)).toEqual(['Joanna verve KPMG', 'Verve google job', 'Ollie Verve - LX'])
    expect(jobsNaming(jobs, 'ver')).toEqual([])
  })

  it('gives a name a capital only where it starts with a small letter', () => {
    expect(withCapital('cms uplighter shop hire')).toBe('Cms uplighter shop hire')
    expect(withCapital('iPhone launch')).toBe('iPhone launch')
    expect(withCapital('ATN')).toBe('ATN')
  })
})
