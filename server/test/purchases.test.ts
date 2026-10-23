import { broughtInId, type NoticesPage, type PurchaseRequest, type PurchaseVote } from '@sh/shared'
import { describe, expect, it } from 'vitest'
import { IPHONE, server, staff, WINDOWS } from './people.ts'

/**
 * The purchase list (ADR 0077): anyone signed in asks for kit and votes for
 * what they'd find most useful; whoever asked changes their own, the office
 * and heads say where each one is at, and a list brought in twice adds
 * nothing the second time. Nothing is sent outside the app.
 */

const PERSON = { phone: null, skills: [], dayRateCents: null, notes: '' }

async function office() {
  const { app, db } = await server()
  const colly = await staff(app, db, 'Colly Hewson', WINDOWS, 'office-c0ffee')
  const aoife = await staff(app, db, 'Aoife Byrne', IPHONE, 'phone-a1b2c3')
  await colly.send('person.upsert', { id: 'colly', name: 'Colly Hewson', kind: 'staff', email: 'colly@sessionhire.com', ...PERSON })
  await colly.send('person.upsert', { id: 'aoife', name: 'Aoife Byrne', kind: 'staff', email: 'aoife@sessionhire.com', ...PERSON })
  await colly.send('person.upsert', { id: 'dara', name: 'Dara Kelly', kind: 'freelancer', email: null, knownAs: 'Smokey', ...PERSON })
  return { app, db, colly, aoife }
}

/** Every record of a kind the server has sent, as a device would hold it once caught up. */
async function all<T>(app: Awaited<ReturnType<typeof server>>['app'], cookies: Record<string, string>, entity: string): Promise<Map<string, T>> {
  const res = await app.inject({ url: '/api/sync/pull?after=0', cookies })
  const out = new Map<string, T>()
  for (const c of res.json().changes as { entity: string; id: string; op: string; data: T }[]) {
    if (c.entity !== entity) continue
    if (c.op === 'delete') out.delete(c.id)
    else out.set(c.id, c.data)
  }
  return out
}

describe('the purchase list', () => {
  it('takes a request from anyone, tidied, with who asked from their sign-in and the day it was asked', async () => {
    const { aoife } = await office()
    expect(
      await aoife.send('purchase.ask', { id: 'nl4t', title: '  NL4T connectors ', details: '20\u0000', link: 'thomann.de/ie/nl4t.htm', department: 'audio', by: 'colly' })
    ).toMatchObject({ status: 'applied' })
    const r = await aoife.record<PurchaseRequest>('purchaseRequest', 'nl4t')
    expect(r).toEqual({
      id: 'nl4t',
      title: 'NL4T connectors',
      details: '20',
      link: 'https://thomann.de/ie/nl4t.htm',
      department: 'Audio',
      // The server knows who asked from her sign-in, whatever the device says.
      askedBy: 'aoife',
      askedByName: '',
      askedOn: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      status: 'asked',
      notes: '',
    })
    expect(await aoife.send('purchase.ask', { id: 'bad', title: 'Mics', details: '', link: 'not a link', department: null })).toMatchObject({
      status: 'rejected',
      reason: { message: "The link isn't a web address. Copy it from the shop's page." },
    })
    expect(await aoife.send('purchase.ask', { id: 'none', title: '   ', details: '', link: '', department: null })).toMatchObject({
      status: 'rejected',
      reason: { message: 'What to buy is needed.' },
    })
  })

  it('counts one vote a person, which can be taken back', async () => {
    const { app, colly, aoife } = await office()
    await aoife.send('purchase.ask', { id: 'ups', title: 'UPS for FOH', details: '4', link: '', department: 'Audio' })
    await aoife.send('purchase.vote', { requestId: 'ups', vote: true })
    // Voting twice is the same vote.
    await aoife.send('purchase.vote', { requestId: 'ups', vote: true })
    await colly.send('purchase.vote', { requestId: 'ups', vote: true })
    expect([...(await all<PurchaseVote>(app, colly.cookies, 'purchaseVote')).values()]).toEqual([
      { id: 'ups.aoife', requestId: 'ups', personId: 'aoife' },
      { id: 'ups.colly', requestId: 'ups', personId: 'colly' },
    ])
    await colly.send('purchase.vote', { requestId: 'ups', vote: false })
    expect([...(await all<PurchaseVote>(app, colly.cookies, 'purchaseVote')).keys()]).toEqual(['ups.aoife'])

    const said = (await colly.history()).entries.filter((e) => e.command.startsWith('purchase.') && e.outcome === 'done').map((e) => e.what)
    expect(said).toEqual([
      'Took back a vote for UPS for FOH on the purchase list',
      'Voted for UPS for FOH on the purchase list',
      'Voted for UPS for FOH on the purchase list',
      'Voted for UPS for FOH on the purchase list',
      'Asked for UPS for FOH to be bought',
    ])
  })

  it("lets whoever asked change or take back their own, and staff crew no one else's, once roles are on", async () => {
    const { app, colly, aoife } = await office()
    await colly.send('person.role', { id: 'colly', role: 'director' })
    await aoife.send('purchase.ask', { id: 'mine', title: 'Gaffer tape', details: '', link: '', department: null })
    await colly.send('purchase.ask', { id: 'his', title: 'Opticon DUO', details: '6', link: '', department: 'Video' })
    expect(await aoife.send('purchase.update', { id: 'mine', details: '24 rolls, black' })).toMatchObject({ status: 'applied' })
    expect(await aoife.send('purchase.update', { id: 'his', details: '60' })).toMatchObject({
      status: 'rejected',
      reason: { code: 'forbidden', message: 'You can change only a request you made. Ask the office or a head of department to change this one.' },
    })
    // Saying where it's at is for those who change stock.
    expect(await aoife.send('purchase.status', { id: 'mine', status: 'ordered', notes: '' })).toMatchObject({ status: 'rejected', reason: { code: 'forbidden' } })
    // She can still vote for his.
    expect(await aoife.send('purchase.vote', { requestId: 'his', vote: true })).toMatchObject({ status: 'applied' })
    expect(await colly.send('purchase.status', { id: 'mine', status: 'ordered', notes: 'From Thomann, due Friday' })).toMatchObject({ status: 'applied' })
    expect(await aoife.record<PurchaseRequest>('purchaseRequest', 'mine')).toMatchObject({ details: '24 rolls, black', status: 'ordered', notes: 'From Thomann, due Friday' })

    // She hears in the app that hers was ordered; not of his.
    const hers: NoticesPage = (await app.inject({ url: '/api/notices', cookies: aoife.cookies })).json()
    expect(hers.notices.filter((n) => n.about.entity === 'purchaseRequest').map((n) => [n.who.name, n.what, n.why])).toEqual([
      ['Colly Hewson', 'Marked Gaffer tape on the purchase list ordered, with a note', 'you'],
    ])

    // Taking his back takes its votes with it; hers she takes back herself.
    expect(await aoife.send('purchase.remove', { id: 'his' })).toMatchObject({ status: 'rejected', reason: { code: 'forbidden' } })
    expect(await colly.send('purchase.remove', { id: 'his' })).toMatchObject({ status: 'applied' })
    expect(await aoife.send('purchase.remove', { id: 'mine' })).toMatchObject({ status: 'applied' })
    expect((await all(app, colly.cookies, 'purchaseRequest')).size).toBe(0)
    expect((await all(app, colly.cookies, 'purchaseVote')).size).toBe(0)
  })

  it('brings a list in once: the same list again adds nothing, and leaves what changed since', async () => {
    const { app, colly } = await office()
    const id = broughtInId('2026-04-22', 'Smokey', 'Mic cable')
    const list = {
      requests: [
        { id, title: 'Mic cable', details: '60 × 10 m', link: '', department: 'Audio', askedBy: 'dara', askedByName: 'Smokey', askedOn: '2026-04-22', status: 'ordered' as const, notes: 'On the April order' },
        { id: 'buy-2', title: 'Fluorescent tape', details: '', link: '', department: null, askedBy: null, askedByName: 'Fergal', askedOn: '2026-07-20', status: 'asked' as const, notes: '' },
      ],
    }
    expect(await colly.send('purchase.bringIn', list)).toMatchObject({ status: 'applied' })
    const got = await all<PurchaseRequest>(app, colly.cookies, 'purchaseRequest')
    // Matched to Dara, the name isn't kept as well: it's read from the Crew tab, so it follows her name there.
    expect(got.get(id)).toMatchObject({ askedBy: 'dara', askedByName: '', askedOn: '2026-04-22', status: 'ordered', notes: 'On the April order' })
    expect(got.get('buy-2')).toMatchObject({ askedBy: null, askedByName: 'Fergal' })

    await colly.send('purchase.status', { id, status: 'arrived', notes: '' })
    expect(await colly.send('purchase.bringIn', list)).toMatchObject({ status: 'applied' })
    expect((await all<PurchaseRequest>(app, colly.cookies, 'purchaseRequest')).get(id)).toMatchObject({ status: 'arrived' })
    expect((await colly.history()).entries[0]!.what).toBe('Brought in a purchase list of 2 requests')
  })

  it('carries votes and requests over when two people are made one', async () => {
    const { app, db, colly, aoife } = await office()
    await colly.send('person.upsert', { id: 'aoife2', name: 'Aoife Byrne', kind: 'staff', email: 'aoife.b@example.com', ...PERSON })
    await colly.send('purchase.ask', { id: 'a', title: 'Haze fluid', details: '', link: '', department: 'SFX' })
    await colly.send('purchase.ask', { id: 'b', title: 'Truss stackers', details: '', link: '', department: 'Rigger' })
    await aoife.send('purchase.vote', { requestId: 'a', vote: true })
    await colly.send('purchase.vote', { requestId: 'a', vote: true, by: 'aoife2' })
    await colly.send('purchase.bringIn', {
      requests: [{ id: 'c', title: 'Labels', details: '', link: '', department: null, askedBy: 'aoife2', askedByName: '', askedOn: '2026-05-08', status: 'asked', notes: '' }],
    })
    // With sign-in on the server takes the vote as Colly's, whatever the device said.
    expect([...(await all<PurchaseVote>(app, colly.cookies, 'purchaseVote')).keys()].sort()).toEqual(['a.aoife', 'a.colly'])
    await colly.send('purchase.vote', { requestId: 'b', vote: true })
    await colly.send('person.upsert', { id: 'colly2', name: 'Colly Hewson', kind: 'staff', email: 'c.hewson@example.com', ...PERSON })
    // Colly brought in twice voted for the same request twice over: one vote stays.
    await db.query(`INSERT INTO purchase_votes (id, request_id, person_id) VALUES ('a.colly2', 'a', 'colly2')`)
    expect(await colly.send('person.merge', { id: 'aoife', from: ['aoife2'] })).toMatchObject({ status: 'applied' })
    expect((await all<PurchaseRequest>(app, colly.cookies, 'purchaseRequest')).get('c')).toMatchObject({ askedBy: 'aoife' })
    expect(await colly.send('person.merge', { id: 'colly2', from: ['colly'] })).toMatchObject({ status: 'applied' })
    expect((await db.query('SELECT id, request_id AS "requestId", person_id AS "personId" FROM purchase_votes ORDER BY id')).rows).toEqual([
      { id: 'a.aoife', requestId: 'a', personId: 'aoife' },
      { id: 'a.colly2', requestId: 'a', personId: 'colly2' },
      { id: 'b.colly2', requestId: 'b', personId: 'colly2' },
    ])
  })
})
