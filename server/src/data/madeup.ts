import { addDays, newId, venueLabel, type CommandInput, type CommandName, type Mutation } from '@sh/shared'

/**
 * Made-up data (ADR 0019): enough of a small A/V company's weeks to try
 * every part of the app before the real jobs, crew and stock go in. It's
 * all ordinary commands, so the server's rules check it as they would a
 * phone's, the history shows it, and phones get it by syncing.
 *
 * Every name is invented. Emails are at example.com, and phone numbers are
 * from the range Ofcom keeps for TV and radio drama (07700 900000 to
 * 900999), which never ring anyone, so nothing here can reach a real
 * person. Dates are counted from the day it goes in, so the jobs are
 * always in the coming weeks.
 *
 * What it shows:
 * - two confirmed jobs on the same days, with 4 d&b Y10P short between them;
 * - a quote that would leave the Robe Spiiders short if it goes ahead, and
 *   the confirmed job whose spare it would use;
 * - an LED wall hired in, as nothing like it is owned;
 * - crew booked, offered, countered and declined; a freelancer offered a
 *   second job on days they're booked (a check in the planner), and days off;
 * - labelled items, some still counted and not labelled yet, amp racks
 *   holding their amps, counted cables and mics, and a roll of label
 *   numbers set aside;
 * - pick lists for the jobs going out soon, and a job that's over with two
 *   speakers still not back, and one back with a rattle, on the repair list;
 * - call sheets (ADR 0021): a contact on the day and a running order for
 *   the festival's days, and a crew chief booked who sees everyone's number.
 */
export function madeUpData(today: string): Mutation[] {
  const out: Mutation[] = []
  const add = <N extends CommandName>(name: N, args: CommandInput<N>) => {
    out.push({ id: newId(), name, args, createdAt: new Date().toISOString() } as Mutation)
    return args
  }
  const day = (n: number) => addDays(today, n)
  let drama = 100
  const phone = () => `+44 7700 900${String(drama++).padStart(3, '0')}`

  // Clients and venues.
  const client = (name: string, contact: string, role: string) =>
    add('client.upsert', {
      id: newId(),
      name,
      contacts: [{ name: contact, role, email: `${contact.split(' ')[0]!.toLowerCase().normalize('NFD').replace(/[^a-z]/g, '')}@example.com`, phone: phone() }],
      notes: '',
    }).id
  const shannonside = client('Shannonside Festivals', 'Niamh Walsh', 'Producer')
  const brightwater = client('Brightwater Conferences', 'Declan Moore', 'Event manager')
  const corrib = client('Corrib Arts Collective', 'Aisling Byrne', 'Production manager')
  const liffey = client('Liffey Brands', 'Ruairí Kelly', 'Account director')
  const kilbeg = client('Kilbeg Weddings', 'Sinéad Doyle', 'Planner')

  const venue = (name: string, address: string, notes: string) => add('venue.upsert', { id: newId(), name, address, notes })
  const riverside = venue('Riverside Park', 'Riverside Park\nLimerick', 'Load in from the north gate. 63 A three-phase at the stage.')
  const northbank = venue('Northbank Conference Centre', 'North Wall Quay\nDublin 1', 'Loading bay 2, booked by the half hour.')
  const granary = venue('The Granary Hall', 'Quay Street\nGalway', 'Goods lift 2 m deep. Parking for one van.')
  const pier3 = venue('Pier 3 Studio', 'Alexandra Road\nDublin 1', 'Blackout drapes on all walls.')
  const clonmore = venue('Clonmore House', 'Clonmore\nCo. Wicklow', 'Marquee on the lawn; the venue supplies a generator.')

  // Jobs and their phases.
  const job = (name: string, clientId: string, venueId: string, status: CommandInput<'project.create'>['status'], notes = '') =>
    add('project.create', { id: newId(), name, clientId, venueId, status, notes }).id
  const phase = (projectId: string, name: string, from: number, to: number, notes = '') =>
    add('phase.add', { id: newId(), projectId, name, start: day(from), end: day(to), venueId: null, notes })

  const harbour = job('Harbour Lights Festival', shannonside, riverside.id, 'confirmed', 'Two stages; the main stage is ours.')
  const harbourIn = phase(harbour, 'Load in', 3, 4, '07:00 Crew call at the north gate\n08:00 Rigging\n13:00 Lunch\n18:00 Stage handed over')
  const harbourShow = phase(harbour, 'Show', 5, 6, '11:00 Crew chief on site\n12:00 Crew call\n14:00 Line check\n17:30 Doors\n18:00 First act\n22:45 Headliner\n23:00 Curfew')
  const harbourOut = phase(harbour, 'Load out', 7, 7, '09:00 Crew call\n09:30 De-rig\n14:00 Trucks leave')
  const summit = job('Brightwater Tech Summit', brightwater, northbank.id, 'confirmed')
  phase(summit, 'Build', 5, 5)
  const summitShow = phase(summit, 'Conference', 6, 7, '08:00 Crew call\n08:45 Doors\n09:00 Keynote\n17:30 Close')
  const arts = job('Corrib Arts Week', corrib, granary.id, 'quoted', 'Waiting on their funding.')
  phase(arts, 'Load in', 12, 12)
  phase(arts, 'Show', 13, 15)
  const launch = job('Liffey Brands Launch', liffey, pier3.id, 'confirmed')
  const launchShow = phase(launch, 'Show', 13, 14)
  const wedding = job('Clonmore Wedding', kilbeg, clonmore.id, 'enquiry', 'Speeches and a band in the marquee.')
  phase(wedding, 'Show', 20, 21)
  const showcase = job('Winter Showcase', shannonside, riverside.id, 'confirmed')
  phase(showcase, 'Show', 30, 30)
  add('project.update', { id: showcase, status: 'cancelled' })
  const gala = job('Autumn Gala', brightwater, northbank.id, 'confirmed')
  phase(gala, 'Show', -10, -9)

  // Crew: staff, freelancers, and some days off.
  const person = (name: string, kind: 'staff' | 'freelancer', skills: string[], euroADay: number | null) =>
    add('person.upsert', {
      id: newId(),
      name,
      kind,
      email: `${name.split(' ')[0]!.toLowerCase().normalize('NFD').replace(/[^a-z]/g, '')}@example.com`,
      phone: phone(),
      skills,
      dayRateCents: euroADay === null ? null : euroADay * 100,
      notes: '',
    }).id
  const aoife = person('Aoife Brennan', 'staff', ['Crew chief', 'Audio'], null)
  const cian = person('Cian Murphy', 'staff', ['Warehouse', 'Driver'], null)
  const orla = person('Orla Hayes', 'staff', ['Lighting'], null)
  const dara = person('Dara Quinn', 'freelancer', ['Sound No.1', 'Audio'], 320)
  const eimear = person('Eimear Nolan', 'freelancer', ['Monitors', 'Audio'], 300)
  const fionn = person('Fionn Gallagher', 'freelancer', ['LX op', 'Lighting'], 280)
  const grainne = person('Gráinne Power', 'freelancer', ['Video', 'Camera'], 300)
  const padraig = person('Pádraig Kenny', 'freelancer', ['Rigger'], 290)
  const roisin = person('Róisín Farrell', 'freelancer', ['Rigger'], 290)
  const tadhg = person('Tadhg Brady', 'freelancer', ['Stagehand', 'Driver'], 200)
  const laoise = person('Laoise Keane', 'freelancer', ['Stagehand'], 200)
  add('unavailability.add', { id: newId(), personId: laoise, start: day(12), end: day(16), note: 'Holidays' })

  // Crew asked for from the jobs, and what each person said.
  const venues = new Map([riverside, northbank, granary, pier3, clonmore].map((v) => [v.id, venueLabel(v)]))
  const call = (p: CommandInput<'phase.add'>, project: string, venueId: string, role: string, needed: number, euroADay: number | null, callTime = '08:00') =>
    add('call.create', {
      id: newId(),
      projectId: p.projectId,
      phaseId: p.id,
      project,
      phase: p.name,
      venue: venues.get(venueId)!,
      role,
      start: p.start,
      end: p.end,
      callTime,
      needed,
      dayRateCents: euroADay === null ? null : euroADay * 100,
      details: 'Food on site. Blacks, please.',
      replyBy: null,
    }).id
  const offer = (callId: string, personId: string, override = false) => add('offer.send', { id: newId(), callId, personId, override }).id
  const booked = (callId: string, personId: string) => {
    const id = offer(callId, personId)
    add('offer.respond', { id, answer: 'accept', days: null, note: '' })
    add('offer.confirm', { id })
  }
  const riggers = call(harbourIn, 'Harbour Lights Festival', riverside.id, 'Rigger', 2, 290, '07:00')
  booked(riggers, padraig)
  offer(riggers, roisin)
  const hands = call(harbourIn, 'Harbour Lights Festival', riverside.id, 'Stagehand', 2, 200, '07:00')
  booked(hands, tadhg)
  add('offer.respond', { id: offer(hands, laoise), answer: 'decline', note: 'At a wedding that weekend.' })
  booked(call(harbourShow, 'Harbour Lights Festival', riverside.id, 'Sound No.1', 1, 320, '12:00'), dara)
  booked(call(harbourShow, 'Harbour Lights Festival', riverside.id, 'Monitors', 1, 300, '12:00'), eimear)
  const lx = call(harbourShow, 'Harbour Lights Festival', riverside.id, 'LX op', 1, 280, '12:00')
  add('offer.respond', { id: offer(lx, fionn), answer: 'counter', counterRateCents: 32000, days: null, note: 'Two long days; can you do 320?' })
  booked(call(harbourOut, 'Harbour Lights Festival', riverside.id, 'Stagehand', 2, 200, '09:00'), tadhg)
  booked(call(summitShow, 'Brightwater Tech Summit', northbank.id, 'Video', 1, 300), grainne)
  // Dara is booked at Harbour Lights then: offered anyway, so the planner shows it as a check.
  offer(call(summitShow, 'Brightwater Tech Summit', northbank.id, 'Sound No.1', 1, 320), dara, true)
  booked(call(launchShow, 'Liffey Brands Launch', pier3.id, 'LX op', 1, 280, '10:00'), orla)
  // Who crew ring on the day, on the call sheets; Aoife is booked as crew chief for the show, so hers has everyone's number.
  booked(call(harbourShow, 'Harbour Lights Festival', riverside.id, 'Crew chief', 1, null, '11:00'), aoife)
  for (const p of [harbourIn, harbourShow, harbourOut]) add('phase.update', { id: p.id, contactId: aoife })
  add('phase.update', { id: summitShow.id, contactId: cian })
  add('phase.update', { id: launchShow.id, contactId: orla })

  // The warehouse: places, products, counts and labelled items.
  const place = (name: string) => add('place.upsert', { id: newId(), name, notes: '' }).id
  const bayA1 = place('Bay A1')
  const bayA2 = place('Bay A2')
  const bayB1 = place('Bay B1')
  place('Van 1')
  const model = (name: string, department: CommandInput<'model.create'>['department'], category: string, tracking: 'serialised' | 'bulk', euro: number, isCase = false) =>
    add('model.create', { id: newId(), name, department, category, tracking, isCase, valueCents: euro * 100, notes: '' }).id
  const y10p = model('d&b Y10P', 'audio', 'Speakers', 'serialised', 3500)
  const d20 = model('d&b D20', 'audio', 'Amplifiers', 'serialised', 9000)
  const rack = model('Amp rack', 'audio', 'Racks', 'serialised', 600, true)
  const sm58 = model('Shure SM58', 'audio', 'Microphones', 'bulk', 110)
  const xlr = model('XLR 10 m', 'audio', 'Cables', 'bulk', 25)
  const spiider = model('Robe Spiider', 'lighting', 'Moving heads', 'serialised', 6500)
  const powercon = model('Powercon 5 m', 'power', 'Cables', 'bulk', 20)
  const deck = model('Stage deck 2 × 1 m', 'staging', 'Decks', 'bulk', 400)
  const led = model('ROE BP2 LED panel', 'video', 'LED', 'bulk', 900)
  const count = (modelId: string, placeId: string, qty: number) => add('stock.set', { modelId, placeId, caseId: null, qty })
  const item = (modelId: string, where: { placeId: string | null; caseId: string | null }, fromCount = false) =>
    add('asset.add', { id: newId(), modelId, number: null, serial: '', ...where, notes: '', fromCount }).id
  // 16 speakers counted, 12 of them labelled so far.
  count(y10p, bayA1, 16)
  const speakers = Array.from({ length: 12 }, () => item(y10p, { placeId: bayA1, caseId: null }, true))
  for (let r = 0; r < 2; r++) {
    const inRack = item(rack, { placeId: bayA2, caseId: null })
    for (let i = 0; i < 2; i++) item(d20, { placeId: null, caseId: inRack })
  }
  // 16 moving heads, half labelled.
  count(spiider, bayB1, 16)
  for (let i = 0; i < 8; i++) item(spiider, { placeId: bayB1, caseId: null }, true)
  count(sm58, bayA2, 24)
  count(xlr, bayA2, 80)
  count(powercon, bayB1, 40)
  count(deck, bayB1, 30)
  add('labels.reserve', { id: newId(), count: 20, name: 'Made-up roll', notes: 'For trying out printing and putting labels on.' })

  // Kit on the jobs.
  const kit = (projectId: string, modelId: string, qty: number, subhire?: { qty: number; supplier: string }) =>
    add('kit.add', { id: newId(), projectId, phaseId: null, modelId, qty, subhireQty: subhire?.qty ?? 0, supplier: subhire?.supplier ?? '', notes: '' })
  kit(harbour, y10p, 12)
  kit(harbour, d20, 4)
  kit(harbour, rack, 2)
  kit(harbour, sm58, 16)
  kit(harbour, spiider, 8)
  kit(harbour, xlr, 60)
  kit(harbour, powercon, 20)
  // With Harbour Lights on the same days: 4 short.
  kit(summit, y10p, 8)
  kit(summit, sm58, 8)
  kit(summit, led, 24, { qty: 24, supplier: 'Lumen Video Hire' })
  kit(arts, spiider, 16)
  kit(arts, deck, 20)
  kit(launch, spiider, 12)
  kit(wedding, sm58, 4)
  kit(wedding, xlr, 10)
  kit(gala, y10p, 8)

  // The gala's speakers went out and came back, all but two.
  const scan = (direction: 'out' | 'in', assetId: string, on: number, time: string) =>
    add('move.record', { id: newId(), projectId: gala, direction, assetId, modelId: y10p, qty: 1, at: `${day(on)}T${time}:00.000Z` })
  for (const s of speakers.slice(0, 8)) scan('out', s, -11, '09:00')
  for (const s of speakers.slice(0, 6)) scan('in', s, -8, '11:00')
  add('fault.report', {
    id: newId(),
    kind: 'damaged',
    assetId: speakers[0]!,
    modelId: y10p,
    qty: 1,
    projectId: gala,
    usable: true,
    note: 'Rattles at high level. Fine for speech meanwhile.',
    at: `${day(-8)}T11:05:00.000Z`,
  })
  return out
}
