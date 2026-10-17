import { describe, expect, it } from 'vitest'
import { parseCsv } from '../src/csv.ts'
import type { SheetInput, SheetPerson } from '../src/callsheet.ts'
import {
  boxConnectUrl,
  LIGHTING_COLUMNS,
  PATCH_COLUMNS,
  runningOrder,
  showPack,
  showPackFileName,
  showPackKit,
  SHOW_PACK_FORMAT,
  SHOW_PACK_VERSION,
  type PackPerson,
  type ShowPackInput,
} from '../src/showpack.ts'

/**
 * The Crewbox show pack (ADR 0045): the files for the on-site box, who's
 * on them and whose numbers, the running order read from a phase's notes,
 * and nothing about money.
 */

const people: SheetPerson[] = [
  { id: 'aoife', name: 'Aoife Brennan', phone: '+44 7700 900101' },
  { id: 'dara', name: 'Dara Quinn', phone: '+44 7700 900102' },
  { id: 'eimear', name: 'Eimear Nolan', phone: '+44 7700 900103' },
  { id: 'fionn', name: 'Fionn Gallagher', phone: '+44 7700 900104' },
]
const profiles = new Map<string, PackPerson>([
  ['aoife', { name: 'Aoife Brennan', knownAs: 'Aoife', department: 'Production' }],
  ['dara', { name: 'Dara Quinn', knownAs: 'D', department: 'Audio' }],
  ['eimear', { name: 'Eimear Nolan', knownAs: 'Eimear', department: 'Lighting' }],
  ['fionn', { name: 'Fionn Gallagher', knownAs: 'Fionn', department: 'Lighting' }],
])

const sheet: SheetInput = {
  job: { name: 'Harbour Lights Festival', notes: 'Two stages; the main stage is ours.' },
  client: { name: 'Shannonside Festivals', contacts: [{ name: 'Niamh Walsh', role: 'Producer', email: 'niamh@example.com', phone: '+44 7700 900200' }] },
  phase: { name: 'Show', start: '2026-10-08', end: '2026-10-09', notes: '12:00 Crew call\n17:30 Doors\nBring ear defenders\nFriday\n18:00–19:00 First act\n23:00 Curfew' },
  venue: { name: 'Riverside Park', address: 'Riverside Park\nLimerick', notes: 'Load in from the north gate.' },
  contact: people[0]!,
  people: new Map(people.map((p) => [p.id, p])),
  calls: [
    {
      id: 'sound',
      role: 'Sound No.1',
      start: '2026-10-08',
      end: '2026-10-09',
      callTime: '12:00',
      needed: 2,
      details: 'Bring your own in-ears.',
      status: 'open',
      offers: [
        { personId: 'dara', status: 'confirmed', days: ['2026-10-08', '2026-10-09'] },
        { personId: 'eimear', status: 'accepted', days: ['2026-10-09'] },
        { personId: 'fionn', status: 'offered', days: ['2026-10-08', '2026-10-09'] },
      ],
    },
  ],
  kit: [],
}

function input(over: Partial<ShowPackInput> = {}): ShowPackInput {
  return {
    job: { id: 'job1', name: 'Harbour Lights Festival', client: 'Shannonside Festivals' },
    scope: 'phase',
    phases: [{ id: 'show', name: 'Show', start: '2026-10-08', end: '2026-10-09', sheet }],
    people: profiles,
    kit: [
      { department: 'audio', category: 'Speakers', product: 'd&b Y10P', qty: 12, subhireQty: 0, supplier: '', numbers: ['SH-000012', 'SH-000003'], countedOut: 0 },
      { department: 'power', category: 'Cables', product: '16A extension', qty: 20, subhireQty: 4, supplier: 'Cable Co', numbers: [], countedOut: 10 },
    ],
    office: { name: 'Session Hire office', phone: '+353 1 234 5678', email: 'office@example.com' },
    phones: true,
    made: '2026-10-07T09:00:00.000Z',
    appVersion: 'abc123',
    ...over,
  }
}

const file = (pack: ReturnType<typeof showPack>, path: string) => pack.find((f) => f.path === path)!
const rows = (text: string) => parseCsv(text).filter((r) => r.some(Boolean))

describe('the running order from a phase’s notes', () => {
  it('makes an act of each line that starts with a time, and keeps the rest out', () => {
    const r = runningOrder(sheet.phase!.notes, ['2026-10-08', '2026-10-09'], 'show')
    expect(r.acts.map((a) => [a.id, a.date, a.start, a.end, a.name])).toEqual([
      ['show-1', '2026-10-08', '12:00', '', 'Crew call'],
      ['show-2', '2026-10-08', '17:30', '', 'Doors'],
      // "Friday" moves the lines after it to the phase's Friday, its second day.
      ['show-3', '2026-10-09', '18:00', '19:00', 'First act'],
      ['show-4', '2026-10-09', '23:00', '', 'Curfew'],
    ])
    expect(r.unread).toBe(1)
  })

  it('reads a day by name, by number or by date, and a stage', () => {
    // 3 and 4 October 2026 are a Saturday and a Sunday.
    const days = ['2026-10-03', '2026-10-04']
    const r = runningOrder('Stage: Main\n12:00 Line check\nSun 4 Oct\n9.30 Doors\nDay 1\n14:00 - 15:15 Soundcheck\nBig top stage:\n2026-10-04\n20:00 Headliner', days, 'p')
    expect(r.acts.map((a) => [a.date, a.start, a.end, a.stage, a.name])).toEqual([
      ['2026-10-03', '12:00', '', 'Main', 'Line check'],
      ['2026-10-04', '09:30', '', 'Main', 'Doors'],
      ['2026-10-03', '14:00', '15:15', 'Main', 'Soundcheck'],
      ['2026-10-04', '20:00', '', 'Big top stage', 'Headliner'],
    ])
    expect(r.unread).toBe(0)
  })

  it('repeats notes with no day line on every day of a phase of several days', () => {
    const r = runningOrder('17:30 Doors\n23:00 Curfew', ['2026-10-03', '2026-10-04'], 'p')
    expect(r.acts.map((a) => [a.id, a.date, a.start])).toEqual([
      ['p-1', '2026-10-03', '17:30'],
      ['p-2', '2026-10-03', '23:00'],
      ['p-3', '2026-10-04', '17:30'],
      ['p-4', '2026-10-04', '23:00'],
    ])
  })

  it('makes up no times that are not times', () => {
    const r = runningOrder('25:00 Never\n12:75 Nor this\n1200 Nor this', ['2026-10-03'], 'p')
    expect(r.acts).toEqual([])
    expect(r.unread).toBe(3)
  })
})

describe('the show pack', () => {
  it('starts with a manifest saying what it is, which version, and every file', () => {
    const pack = showPack(input())
    expect(pack[0]!.path).toBe('manifest.json')
    const m = JSON.parse(pack[0]!.text)
    expect(m).toMatchObject({ format: SHOW_PACK_FORMAT, formatVersion: SHOW_PACK_VERSION, madeBy: { app: 'Session Hire', version: 'abc123' }, scope: 'phase', joinQr: false })
    expect(m.phases).toEqual([{ id: 'show', name: 'Show', start: '2026-10-08', end: '2026-10-09' }])
    expect(m.files.map((f: { path: string }) => f.path).sort()).toEqual(pack.slice(1).map((f) => f.path).sort())
    expect(m.files.find((f: { path: string }) => f.path === 'patch.csv')).toEqual({ path: 'patch.csv', kind: 'patch', rows: 0, template: true })
    expect(m.files.find((f: { path: string }) => f.path === 'crew.csv').rows).toBe(2)
  })

  it('lists who has said yes, with their numbers, for someone who can change crew', () => {
    const crew = rows(file(showPack(input()), 'crew.csv').text)
    expect(crew[0]).toEqual(['phase_id', 'phase', 'name', 'known_as', 'role', 'department', 'call_time', 'days', 'status', 'phone'])
    expect(crew.slice(1)).toEqual([
      ['show', 'Show', 'Dara Quinn', 'D', 'Sound No.1', 'Audio', '12:00', '2026-10-08 2026-10-09', 'booked', '+44 7700 900102'],
      ['show', 'Show', 'Eimear Nolan', 'Eimear', 'Sound No.1', 'Lighting', '12:00', '2026-10-09', 'to confirm', '+44 7700 900103'],
    ])
  })

  it('for anyone else, lists those confirmed by name, and no number but the contact’s', () => {
    const pack = showPack(input({ phones: false }))
    const crew = rows(file(pack, 'crew.csv').text)
    expect(crew.slice(1).map((r) => [r[2], r[9]])).toEqual([['Dara Quinn', '']])
    const everything = pack.map((f) => f.text).join('\n')
    expect(everything.match(/\+44 7700 9001\d\d/g)).toEqual(expect.arrayContaining(['+44 7700 900101']))
    expect(everything).not.toMatch(/\+44 7700 90010[234]/)
    expect(JSON.parse(pack[0]!.text).phones).toBe("the contact on the day's only")
  })

  it('never carries a rate, a price, a client’s contact or someone only offered', () => {
    const everything = showPack(input())
      .map((f) => f.text)
      .join('\n')
      // The README says so, in those words.
      .replace('No rates or prices are in it.', '')
    expect(everything).not.toMatch(/€|rate|price/i)
    expect(everything).not.toContain('Niamh Walsh')
    expect(everything).not.toContain('Fionn Gallagher')
  })

  it('has the running order in Crewbox’s act columns, and the notes as typed', () => {
    const pack = showPack(input())
    const acts = rows(file(pack, 'running-order.csv').text)
    expect(acts[0]).toEqual(['id', 'name', 'stage', 'date', 'start', 'end', 'changeover', 'phase_id'])
    expect(acts[1]).toEqual(['show-1', 'Crew call', '', '2026-10-08', '12:00', '', '', 'show'])
    const notes = file(pack, 'running-order.txt').text
    expect(notes).toContain('Bring ear defenders')
    expect(notes).toContain('12:00 Sound No.1: Dara Quinn, Eimear Nolan')
    expect(file(pack, 'README.txt').text).toContain("1 line of the notes had no time at the start, so it isn't in running-order.csv")
  })

  it('has the kit with Session Hire’s numbers out, the venue and who to ring', () => {
    const pack = showPack(input())
    expect(rows(file(pack, 'kit.csv').text).slice(1)).toEqual([
      ['audio', 'Speakers', 'd&b Y10P', '12', '0', '', '2', 'SH-000003 SH-000012'],
      ['power', 'Cables', '16A extension', '20', '4', 'Cable Co', '10', ''],
    ])
    expect(rows(file(pack, 'contacts.csv').text).slice(1)).toEqual([
      ['show', 'Show', 'Contact on the day', 'Aoife Brennan', '+44 7700 900101', ''],
      ['', '', 'Office', 'Session Hire office', '+353 1 234 5678', 'office@example.com'],
    ])
    const event = JSON.parse(file(pack, 'event.json').text)
    expect(event).toMatchObject({ name: 'Harbour Lights Festival: Show', start: '2026-10-08', end: '2026-10-09', departments: ['Audio', 'Lighting'], box: null })
    expect(event.phases[0].venue).toMatchObject({ name: 'Riverside Park', address: 'Limerick', notes: 'Load in from the north gate.' })
  })

  it('has empty patch and lighting sheets with their columns, as the app holds neither', () => {
    const pack = showPack(input())
    expect(rows(file(pack, 'patch.csv').text)).toEqual([[...PATCH_COLUMNS]])
    expect(rows(file(pack, 'lighting.csv').text)).toEqual([[...LIGHTING_COLUMNS]])
  })

  it('puts the join QR and PIN on the crew list only when the box is given', () => {
    const without = file(showPack(input()), 'crew-list.html').text
    expect(without).not.toContain('<svg')
    const pack = showPack(input({ box: { address: 'crewbox.local', pin: '4821' } }))
    const list = file(pack, 'crew-list.html').text
    expect(list).toContain('<svg')
    expect(list).toContain('http://crewbox.local/connect')
    expect(list).toContain('4821')
    expect(JSON.parse(pack[0]!.text).joinQr).toBe(true)
    expect(JSON.parse(file(pack, 'event.json').text).box).toEqual({ connect: 'http://crewbox.local/connect' })
  })

  it('names the box’s join page from the address as typed', () => {
    expect(boxConnectUrl('crewbox.local')).toBe('http://crewbox.local/connect')
    expect(boxConnectUrl('10.0.0.2:8080/')).toBe('http://10.0.0.2:8080/connect')
    expect(boxConnectUrl('https://box.example/connect')).toBe('https://box.example/connect')
    expect(boxConnectUrl('')).toBeUndefined()
    expect(boxConnectUrl('not an address')).toBeUndefined()
  })

  it('names the file for the job and phase', () => {
    expect(showPackFileName('Harbour Lights Festival', 'Show')).toBe('show-pack-harbour-lights-festival-show.zip')
    expect(showPackFileName('Céilí Mór')).toBe('show-pack-ceili-mor.zip')
  })
})

describe('the pack’s kit', () => {
  const model = (name: string) => ({ name, department: 'audio' as const, category: 'Speakers' })
  const lines = [
    { modelId: 'y10', phaseId: null, qty: 8, subhireQty: 0, supplier: '', model: model('d&b Y10P') },
    { modelId: 'y10', phaseId: 'show', qty: 4, subhireQty: 2, supplier: 'Hire Co', model: model('d&b Y10P') },
    { modelId: 'sub', phaseId: 'in', qty: 2, subhireQty: 0, supplier: '', model: model('d&b B22') },
  ]
  const pick = {
    rows: [
      { modelId: 'y10', model: model('d&b Y10P'), items: [{ number: 'SH-000001' }, { number: '' }], counted: 0 },
      { modelId: 'mic', model: model('SM58'), items: [{ number: 'SH-000009' }], counted: 0 },
    ],
  }

  it('for a phase, adds its lines to the whole job’s and leaves out the other phases’', () => {
    expect(showPackKit(lines, pick, 'show')).toEqual([
      { department: 'audio', category: 'Speakers', product: 'd&b Y10P', qty: 12, subhireQty: 2, supplier: 'Hire Co', numbers: ['SH-000001'], countedOut: 0 },
    ])
  })

  it('for the job, has every line and what went out that isn’t on the kit', () => {
    expect(showPackKit(lines, pick, null).map((k) => [k.product, k.qty, k.numbers])).toEqual([
      ['d&b Y10P', 12, ['SH-000001']],
      ['d&b B22', 2, []],
      ['SM58', 0, ['SH-000009']],
    ])
  })
})
