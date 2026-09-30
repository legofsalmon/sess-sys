import { newId, type CommandInput, type CommandName, type HistoryPage, type Mutation, type MutationResult } from '@sh/shared'
import type { FastifyInstance } from 'fastify'
import { afterEach, describe, expect, it } from 'vitest'
import { buildApp } from '../src/app.ts'
import { pgliteDb, type Db } from '../src/db.ts'

/**
 * Call sheets on a person's private link (ADR 0021): only for a call
 * they've accepted or are booked on, with what their part lets them see.
 */

let cleanup: (() => Promise<void>)[] = []
afterEach(async () => {
  for (const fn of cleanup.reverse()) await fn()
  cleanup = []
})

async function server() {
  const db = await pgliteDb()
  const app = await buildApp({ db })
  cleanup.push(async () => {
    await app.close()
    await db.close()
  })
  return { app, db }
}

function m<N extends CommandName>(name: N, args: CommandInput<N>): Mutation {
  return { id: newId(), name, args, createdAt: new Date().toISOString() } as Mutation
}

async function send(app: FastifyInstance, ...mutations: Mutation[]): Promise<MutationResult[]> {
  const res = await app.inject({ method: 'POST', url: '/api/sync/push', payload: { clientId: 'office', mutations } })
  const results: MutationResult[] = res.json().results
  return results
}

async function ok(app: FastifyInstance, ...mutations: Mutation[]) {
  for (const r of await send(app, ...mutations)) expect(r).toMatchObject({ status: 'applied' })
}

const person = (id: string, name: string, phone: string | null, kind: 'staff' | 'freelancer' = 'freelancer') =>
  m('person.upsert', { id, name, kind, email: `${id}@example.com`, phone, skills: [], dayRateCents: 30000, notes: '' })

const call = (id: string, role: string, needed: number, callTime: string, details = '') =>
  m('call.create', {
    id,
    projectId: 'harbour',
    phaseId: 'show',
    project: 'Harbour Lights Festival',
    phase: 'Show',
    venue: 'Riverside Park, Limerick',
    role,
    start: '2031-06-06',
    end: '2031-06-07',
    callTime,
    needed,
    dayRateCents: 32000,
    details,
    replyBy: null,
  })

const booked = (offerId: string, callId: string, personId: string) => [
  m('offer.send', { id: offerId, callId, personId, override: false }),
  m('offer.respond', { id: offerId, answer: 'accept', days: null, note: '' }),
  m('offer.confirm', { id: offerId }),
]

/** A festival's show days: a contact on the day, two booked, one accepted, one only offered, and some kit. */
async function festival() {
  const { app, db } = await server()
  await ok(
    app,
    m('client.upsert', { id: 'shannon', name: 'Shannonside Festivals', contacts: [{ name: 'Niamh Walsh', role: 'Producer', email: null, phone: '+44 7700 900200' }], notes: '' }),
    m('venue.upsert', { id: 'riverside', name: 'Riverside Park', address: 'Riverside Park\nLimerick', notes: 'Load in from the north gate. Park in the crew car park.' }),
    m('project.create', { id: 'harbour', name: 'Harbour Lights Festival', clientId: 'shannon', venueId: 'riverside', status: 'confirmed', notes: 'Two stages; the main stage is ours.' }),
    m('phase.add', { id: 'show', projectId: 'harbour', name: 'Show', start: '2031-06-06', end: '2031-06-07', venueId: null, notes: '12:00 Crew call\n17:30 Doors\n23:00 Curfew' }),
    person('aoife', 'Aoife Brennan', '+44 7700 900101', 'staff'),
    person('dara', 'Dara Quinn', '+44 7700 900102'),
    person('eimear', 'Eimear Nolan', '+44 7700 900103'),
    person('fionn', 'Fionn Gallagher', '+44 7700 900104'),
    person('tadhg', 'Tadhg Brady', '+44 7700 900105'),
    call('sound', 'Sound No.1', 1, '10:00', 'Food on site. Blacks, please.'),
    call('hands', 'Stagehand', 2, '12:00'),
    call('lx', 'LX op', 1, '12:00'),
    ...booked('o1', 'sound', 'dara'),
    ...booked('o2', 'hands', 'tadhg'),
    m('offer.send', { id: 'o3', callId: 'hands', personId: 'eimear', override: false }),
    m('offer.respond', { id: 'o3', answer: 'accept', days: null, note: '' }),
    m('offer.send', { id: 'o4', callId: 'lx', personId: 'fionn', override: false }),
    m('model.create', { id: 'y10p', name: 'd&b Y10P', department: 'audio', category: 'Speakers', tracking: 'bulk', isCase: false, valueCents: 0, notes: '' }),
    m('kit.add', { id: 'k1', projectId: 'harbour', phaseId: null, modelId: 'y10p', qty: 12, subhireQty: 4, supplier: 'Lumen Hire', notes: '' }),
    m('phase.update', { id: 'show', contactId: 'aoife' })
  )
  const token = async (id: string) => (await db.query<{ t: string }>('SELECT link_token AS t FROM people WHERE id = $1', [id])).rows[0]!.t
  return { app, db, token }
}

const page = async (app: FastifyInstance, url: string) => {
  const res = await app.inject({ url })
  return { status: res.statusCode, html: res.body }
}

describe('a call sheet on a private link', () => {
  it('shows a booked freelancer the job, where, who to ring and who else is on, and nobody else\'s number', async () => {
    const { app, token } = await festival()
    const dara = await token('dara')
    // Linked from the booking on their page.
    expect((await page(app, `/f/${dara}`)).html).toContain(`/f/${dara}/sheet/sound`)

    const { status, html } = await page(app, `/f/${dara}/sheet/sound`)
    expect(status).toBe(200)
    for (const text of [
      'Harbour Lights Festival',
      'Sat 7 Jun',
      'For Shannonside Festivals',
      '<b>Riverside Park</b><br>Limerick',
      'Load in from the north gate. Park in the crew car park.',
      '12:00 Crew call<br>17:30 Doors<br>23:00 Curfew',
      'Two stages; the main stage is ours.',
      'Ring <b>Aoife Brennan</b> on <a href="tel:+447700900101">+44 7700 900101</a>',
      '<b>Sound No.1</b>, call <b>10:00</b>',
      'Food on site. Blacks, please.',
      'Dara Quinn (you)',
      'Tadhg Brady',
    ])
      expect(html).toContain(text)
    // Not who's only offered or yet to be confirmed, nor anyone's number but the contact's, nor rates or kit.
    for (const text of ['Fionn', 'Eimear', '900102', '900104', '900105', '900200', 'Niamh', '€', '320', 'Y10P'])
      expect(html).not.toContain(text)
  })

  it('shows the contact on the day everyone booked with their numbers, and the kit', async () => {
    const { app, token } = await festival()
    // Aoife isn't on a call, so she's booked on one to have the sheet on her link.
    await ok(app, call('chief', 'Crew chief', 1, '09:00'), ...booked('o5', 'chief', 'aoife'))
    const { status, html } = await page(app, `/f/${await token('aoife')}/sheet/chief`)
    expect(status).toBe(200)
    expect(html).toContain("You're the contact on the day")
    expect(html).toContain('Tadhg Brady · <a href="tel:+447700900105">+44 7700 900105</a>')
    expect(html).toContain('Eimear Nolan <small>to confirm</small> · <a href="tel:+447700900103">')
    expect(html).toContain('12 × d&amp;b Y10P <small>8 ours, 4 from Lumen Hire</small>')
    // Still not who's only been offered, or the client's own contacts.
    expect(html).not.toContain('Fionn')
    expect(html).not.toContain('Niamh')
  })

  it('is only for the person\'s own calls they\'ve said yes to, while they go ahead', async () => {
    const { app, token } = await festival()
    const [eimear, fionn, dara] = [await token('eimear'), await token('fionn'), await token('dara')]
    // Accepted, not yet confirmed: theirs to see, marked as such.
    const accepted = await page(app, `/f/${eimear}/sheet/hands`)
    expect(accepted.status).toBe(200)
    expect(accepted.html).toContain('(the office will confirm)')
    // Only offered, or someone else's call.
    expect((await page(app, `/f/${fionn}/sheet/lx`)).status).toBe(404)
    expect((await page(app, `/f/${dara}/sheet/hands`)).status).toBe(404)
    expect((await page(app, `/f/${dara}/sheet/nothing`)).html).toContain("There's no call sheet here for you")
    // A cancelled call, and a link that no longer works.
    await ok(app, m('call.cancel', { id: 'sound' }))
    expect((await page(app, `/f/${dara}/sheet/sound`)).status).toBe(404)
    expect((await page(app, `/f/not-a-real-token-at-all/sheet/sound`)).status).toBe(404)
  })

  it('has a contact on the day only from the people in the app, and says so in the history', async () => {
    const { app } = await festival()
    const [refused] = await send(app, m('phase.update', { id: 'show', contactId: 'nobody' }))
    expect(refused).toMatchObject({ status: 'rejected', reason: { message: "That person isn't in the app any more." } })
    await ok(app, m('phase.update', { id: 'show', contactId: null }))
    const history: HistoryPage = (await app.inject({ url: '/api/history' })).json()
    expect(history.entries.slice(0, 3).map((e) => [e.what, e.outcome])).toEqual([
      ['Changed Show on Harbour Lights Festival: no contact on the day', 'done'],
      ['Changed Show on Harbour Lights Festival: the contact on the day to someone', 'turned-down'],
      ['Changed Show on Harbour Lights Festival: the contact on the day to Aoife Brennan', 'done'],
    ])
  })
})
