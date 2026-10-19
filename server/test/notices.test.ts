import type { NoticesPage, Person } from '@sh/shared'
import { describe, expect, it } from 'vitest'
import { IPHONE, onLink, server, staff, WINDOWS } from './people.ts'

/**
 * Notifications (ADR 0058): what others changed, lately, on what's someone's
 * own, in the history's words, with why it's theirs; never their own changes.
 */

const call = {
  id: 'c1',
  projectId: 'j1',
  phaseId: 'build',
  project: 'Electric Picnic',
  phase: 'Build',
  venue: 'Stradbally Hall',
  role: 'Audio tech',
  start: '2026-10-02',
  end: '2026-10-04',
  callTime: '08:00',
  needed: 2,
  dayRateCents: 25000,
  details: '',
  replyBy: null,
}

async function setUp() {
  const { app, db } = await server()
  const colly = await staff(app, db, 'Colly Hewson', WINDOWS, 'office-c0ffee')
  const aoife = await staff(app, db, 'Aoife Byrne', IPHONE, 'phone-a1b2c3')
  const notices = async (who: { cookies: Record<string, string> }, client = ''): Promise<NoticesPage> => {
    const res = await app.inject({ url: `/api/notices${client ? `?client=${client}` : ''}`, cookies: who.cookies })
    expect(res.statusCode).toBe(200)
    return res.json()
  }
  const person = { phone: null, skills: [], dayRateCents: 25000, notes: '' }
  await colly.send('person.upsert', { id: 'aoife', name: 'Aoife Byrne', kind: 'staff', email: 'Aoife@sessionhire.com', ...person })
  await colly.send('person.upsert', { id: 'dara', name: 'Dara Kelly', kind: 'freelancer', email: null, ...person, phone: '+353871234567' })
  await colly.send('project.create', { id: 'j1', name: 'Electric Picnic', clientId: null, venueId: null, status: 'confirmed', notes: '' })
  await colly.send('phase.add', { id: 'build', projectId: 'j1', name: 'Build', start: '2026-10-02', end: '2026-10-04', venueId: null, notes: '' })
  await colly.send('call.create', call)
  return { app, db, colly, aoife, notices }
}

describe('notifications', () => {
  it("tells someone what others changed on what's theirs, and why it's theirs, never their own changes", async () => {
    const { app, colly, aoife, notices } = await setUp()
    // A job Aoife has nothing to do with.
    await colly.send('project.create', { id: 'j2', name: 'Harbour Lights', clientId: null, venueId: null, status: 'enquiry', notes: '' })
    await colly.send('offer.send', { id: 'o1', callId: 'c1', personId: 'aoife', override: false })
    await colly.send('offer.send', { id: 'o2', callId: 'c1', personId: 'dara', override: false })
    const dara = await colly.record<Person>('person', 'dara')
    await onLink(app, `/f/${dara.linkToken}/offers/o2`, { answer: 'accept' })
    await colly.send('project.update', { id: 'j1', name: 'Electric Picnic 2026' })

    const hers = await notices(aoife)
    expect(hers.found).toBe(true)
    expect(hers.readUpTo).toBeNull()
    expect(hers.notices.map((n) => [n.who.name, n.what, n.why, n.about])).toEqual([
      ['Colly Hewson', 'Changed the job Electric Picnic 2026: name to Electric Picnic 2026', 'on', { entity: 'project', id: 'j1' }],
      ['Colly Hewson', 'Offered Audio tech on Electric Picnic 2026 to Aoife Byrne', 'you', { entity: 'offer', id: 'o1' }],
      ['Colly Hewson', expect.stringContaining('Audio tech'), 'on', { entity: 'crewCall', id: 'c1' }],
      ['Colly Hewson', expect.stringContaining('Build'), 'on', { entity: 'phase', id: 'build' }],
      ['Colly Hewson', expect.stringContaining('Electric Picnic'), 'on', { entity: 'project', id: 'j1' }],
      ['Colly Hewson', "Saved Aoife Byrne's details", 'you', { entity: 'person', id: 'aoife' }],
    ])
    // Someone else's offer on her job, and a job she isn't on, aren't hers.
    expect(hers.notices.some((n) => n.what.includes('Dara') || n.what.includes('Harbour'))).toBe(false)

    // Colly made the job and sent the offers: Dara's answer, on her link, comes back to Colly, and none of Colly's own changes do.
    const his = await notices(colly)
    expect(his.found).toBe(false)
    expect(his.notices.map((n) => [n.who.name, n.what, n.why])).toEqual([
      ['Dara Kelly', 'Dara Kelly accepted Audio tech on Electric Picnic 2026', 'sent'],
    ])

    // Her answer, in the app, goes to Colly and not back to her.
    await aoife.send('offer.respond', { id: 'o1', answer: 'accept', days: null, note: '' } as never)
    expect((await notices(colly)).notices[0]).toMatchObject({ who: { name: 'Aoife Byrne' }, why: 'sent' })
    expect((await notices(aoife)).notices.some((n) => n.who.name === 'Aoife Byrne')).toBe(false)
  })

  it('keeps how far each person has read, on every device, and never goes back', async () => {
    const { app, colly, aoife, notices } = await setUp()
    await colly.send('offer.send', { id: 'o1', callId: 'c1', personId: 'aoife', override: false })
    const newest = (await notices(aoife)).notices[0]!.arrivedAt
    const read = (upTo: string) => app.inject({ method: 'POST', url: '/api/notices/read', cookies: aoife.cookies, payload: { upTo } })
    expect((await read(newest)).statusCode).toBe(200)
    expect((await notices(aoife)).readUpTo).toBe(newest)
    // A slower device saying it read less leaves it where it was.
    await read('2020-01-01T00:00:00.000Z')
    expect((await notices(aoife)).readUpTo).toBe(newest)
    // Colly's is Colly's own.
    expect((await notices(colly)).readUpTo).toBeNull()
    expect((await read('not a time')).statusCode).toBe(400)
  })

  it("leaves out noting an answer, which is the office's housekeeping", async () => {
    const { colly, aoife, notices } = await setUp()
    await colly.send('offer.send', { id: 'o1', callId: 'c1', personId: 'aoife', override: false })
    await aoife.send('offer.respond', { id: 'o1', answer: 'decline', note: '' } as never)
    await colly.send('offer.seen', { id: 'o1' })
    expect((await notices(aoife)).notices.map((n) => n.command)).not.toContain('offer.seen')
  })
})
