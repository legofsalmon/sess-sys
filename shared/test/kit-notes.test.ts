import { describe, expect, it } from 'vitest'
import { fromNotes, KitMatcher, kitNameId, noteRows, notesPlan, notesSum, readKitLines, type KitLine, type Model } from '../src/index.ts'

/**
 * Kit lists in jobs' notes (ADR 0043): which lines are kit, which product
 * each is, and what goes on the job, without doubling what's there.
 */

const product = (id: string, name: string, department: Model['department'] = 'audio') => ({ id, name, department })
const STOCK = [
  product('y10p', 'd&b Y10P'),
  product('d20', 'd&b D20'),
  product('sm58', 'Shure SM58'),
  product('ulxd', 'Shure ULXD4D'),
  product('xlr', 'XLR 10 m'),
  product('spiider', 'Robe Spiider', 'lighting'),
  product('deck', 'Stage deck 2 × 1 m', 'staging'),
  product('led', 'ROE BP2 LED panel', 'video'),
]
const matcher = new KitMatcher(STOCK)
let n = 0
const ids = () => `new-${++n}`

const JOB_SHEET = `Audio
4 x d&b Y10P
2x d20 amp
1 no. Allen & Heath SQ5 desk
x4 SM58
Shure ULXD x 2 (spare in the van)

Lighting:
8 Spiider

Video
- 12 × ROE BP2

Transport and labour
1 x Luton van
2 x Stagehands

Run of show
5.00pm - Crew Call
9:00pm - Doors
12 Oct - build
Access from the north gate; 2 parking spaces.`

describe('reading the notes', () => {
  it('finds the lines of kit under their headings, and nothing in the running order or the access notes', () => {
    const lines = readKitLines(JOB_SHEET)
    expect(lines.map((l) => [l.qty, l.name, l.section])).toEqual([
      [4, 'd&b Y10P', 'audio'],
      [2, 'd20 amp', 'audio'],
      [1, 'Allen & Heath SQ5 desk', 'audio'],
      [4, 'SM58', 'audio'],
      [2, 'Shure ULXD', 'audio'],
      [8, 'Spiider', 'lighting'],
      [12, 'ROE BP2', 'video'],
      [1, 'Luton van', 'labour'],
      [2, 'Stagehands', 'labour'],
    ])
    expect(lines.find((l) => l.name === 'Shure ULXD')?.note).toBe('spare in the van')
    expect(lines[0]!.text).toBe('4 x d&b Y10P')
  })

  it('reads "4 XLR 10 m" as four XLRs under a heading, not four "LR 10 m"', () => {
    expect(readKitLines('Audio\n4 XLR 10 m').map((l) => [l.qty, l.name])).toEqual([[4, 'XLR 10 m']])
    expect(readKitLines('4 XLR 10 m')).toEqual([])
    expect(readKitLines('Stage deck 2 x 1')).toEqual([])
  })
})

describe('matching a line to a product', () => {
  const m = (name: string, section?: 'audio' | 'lighting' | 'video' | 'labour') => matcher.match(name, section)
  it('by name, capitals, spacing and the × aside', () => {
    expect(m('D&B y10p')).toMatchObject({ how: 'name', modelId: 'y10p' })
    expect(m('stage deck 2x1m')).toMatchObject({ how: 'name', modelId: 'deck' })
  })
  it('by the model or a code in the name', () => {
    expect(m('Y10P')).toMatchObject({ how: 'code', modelId: 'y10p' })
    expect(m('d20 amp')).toMatchObject({ how: 'code', modelId: 'd20' })
    expect(m('SM58')).toMatchObject({ how: 'code', modelId: 'sm58' })
    expect(m('Spiider', 'lighting')).toMatchObject({ how: 'code', modelId: 'spiider' })
  })
  it('forgivingly, as a guess to check', () => {
    expect(m('Shure ULXD')).toMatchObject({ how: 'close', modelId: 'ulxd' })
    expect(m('ROE BP2', 'video')).toMatchObject({ modelId: 'led' })
  })
  it('and says so when nothing is like it', () => {
    expect(m('Allen & Heath SQ5 desk')).toMatchObject({ how: 'none', modelId: undefined })
  })
})

describe('what goes on the job', () => {
  const job = { id: 'j', notes: JOB_SHEET }
  const rows = noteRows(job, [], matcher, new Map(), () => true)

  it('adds what matched, leaves crew and vans out, and asks about what found nothing', () => {
    const plan = notesPlan(rows, [], {}, ids)
    const state = Object.fromEntries(plan.rows.map((r) => [r.row.line.name, r.state]))
    expect(state).toMatchObject({ 'd&b Y10P': 'add', 'd20 amp': 'add', 'Allen & Heath SQ5 desk': 'choose', 'Luton van': 'not-kit', Stagehands: 'not-kit' })
    expect(plan.choosing).toBe(1)
    expect(plan.lines.find((l) => l.modelId === 'y10p')).toMatchObject({ phaseId: null, qty: 4 })
    // The guesses taken as they are are remembered for the next job's notes.
    expect(plan.names.map((x) => x.text)).toEqual(expect.arrayContaining(['d20 amp', 'Shure ULXD']))
  })

  it("doesn't double what the job has: the same notes twice change nothing", () => {
    const first = notesPlan(rows, [], {}, ids)
    const lines = new Map<string, KitLine & { pending: boolean }>()
    fromNotes(lines, 'j', first.lines)
    const kit = [...lines.values()].map((l) => ({ phaseId: l.phaseId, modelId: l.modelId, qty: l.qty }))
    const again = notesPlan(rows, kit, {}, ids)
    expect(again.adding).toBe(0)
    expect(again.rows.filter((r) => r.modelId).every((r) => r.state === 'already')).toBe(true)
    // And sent twice, the second adds nothing.
    fromNotes(lines, 'j', first.lines)
    expect([...lines.values()].reduce((s, l) => s + l.qty, 0)).toBe(kit.reduce((s, l) => s + l.qty, 0))
  })

  it('adds only the difference to what is on the job, for a phase counting the whole job’s', () => {
    const phased = noteRows({ id: 'j', notes: '' }, [{ id: 'show', notes: 'Audio\n6 x d&b Y10P' }], matcher, new Map(), () => true)
    const plan = notesPlan(phased, [{ phaseId: null, modelId: 'y10p', qty: 4 }], {}, ids)
    expect(plan.rows[0]).toMatchObject({ state: 'add', adds: 2, onJob: 4 })
    expect(plan.lines).toEqual([expect.objectContaining({ phaseId: 'show', modelId: 'y10p', qty: 2 })])
  })

  it('takes a choice of product or not kit, and remembers it', () => {
    const sq5 = rows.find((r) => r.line.name.startsWith('Allen'))!
    const van = rows.find((r) => r.line.name === 'Luton van')!
    const plan = notesPlan(rows, [], { [sq5.key]: { pick: 'not-kit' }, [van.key]: { pick: 'not-kit' } }, ids)
    expect(plan.choosing).toBe(0)
    expect(plan.names).toEqual(expect.arrayContaining([{ text: 'Allen & Heath SQ5 desk', modelId: null }]))
    const remembered = new Map(plan.names.map((x) => [kitNameId(x.text), { modelId: x.modelId }]))
    const next = noteRows({ id: 'k', notes: 'Audio\n1 x allen & heath sq5 desk\n2 x D20 amp' }, [], matcher, remembered, () => true)
    expect(next.map((r) => [r.match.how, r.match.notKit, r.match.modelId])).toEqual([
      ['chosen', true, undefined],
      ['chosen', false, 'd20'],
    ])
  })

  it('knows when the notes change', () => {
    expect(notesSum({ notes: 'a' }, [{ id: 'p', notes: 'b' }])).toBe(notesSum({ notes: 'a' }, [{ id: 'p', notes: 'b' }]))
    expect(notesSum({ notes: 'a' }, [{ id: 'p', notes: 'c' }])).not.toBe(notesSum({ notes: 'a' }, [{ id: 'p', notes: 'b' }]))
  })
})
