import { addDays, irishToday, type CrewCall, type CrewListPreview, type MutationResult, type Offer, type Person } from '@sh/shared'
import { describe, expect, it } from 'vitest'
import { IPHONE, server, staff } from './people.ts'

/**
 * The certificates a call needs (ADR 0028), on the server: an offer to
 * someone whose needed certificate has run out, or runs out before the
 * job ends, or who has none, is refused by name whatever "Send anyway"
 * says; not known is allowed; a call that comes to need one keeps whoever
 * is booked; the history says what a call needs; and the crew list's new
 * columns come in.
 */

const said = (r: MutationResult) => (r.status === 'rejected' ? r.reason.message : 'applied')

/** Colly signed in, a rigging call needing working at height and IPAF from next week, and three riggers. */
async function rigging() {
  const { app, db } = await server()
  const colly = await staff(app, db, 'Colly Hewson', IPHONE, 'phone-c0ffee')
  const today = irishToday()
  const [start, end] = [addDays(today, 7), addDays(today, 9)]
  const held = (expires: string | null, note = '') => ({ held: true, expires, note })
  const rigger = (id: string, name: string, certificates: Person['certificates']) =>
    colly.send('person.upsert', { id, name, kind: 'freelancer', email: null, phone: '+353871234567', skills: ['Rigger'], dayRateCents: 29000, notes: '', certificates })
  expect(await rigger('padraig', 'Pádraig Kenny', { 'working-at-height': held(null), ipaf: held(addDays(today, 200), '3a, 3b') })).toMatchObject({ status: 'applied' })
  expect(await rigger('sean', 'Seán Ó Briain', { 'working-at-height': held(null), ipaf: held(addDays(today, 8)) })).toMatchObject({ status: 'applied' })
  expect(await rigger('roisin', 'Róisín Farrell', { 'working-at-height': held(null), ipaf: held(addDays(today, -1)) })).toMatchObject({ status: 'applied' })
  expect(await rigger('niall', 'Niall Kerr', {})).toMatchObject({ status: 'applied' })
  expect(
    await colly.send('call.create', {
      id: 'riggers',
      project: 'Harbour Lights Festival',
      phase: 'Load in',
      venue: 'Riverside Park',
      role: 'Rigger',
      start,
      end,
      callTime: '07:00',
      needed: 3,
      dayRateCents: 29000,
      details: '',
      replyBy: null,
      // Ticked in any order, and twice: kept once each, in the list's order.
      needsCertificates: ['ipaf', 'working-at-height', 'ipaf'],
    })
  ).toMatchObject({ status: 'applied' })
  return { app, db, colly, today, start, end }
}

describe('an offer for a call that needs certificates', () => {
  it('is refused by name for one run out, or running out before the job ends, override or not', async () => {
    // Proves: the server refuses in the brief's words, naming the person, the certificate and the day, and "Send anyway" doesn't pass it.
    const { colly, today } = await rigging()
    const day = (n: number) => {
      const d = addDays(today, n)
      const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
      return `${Number(d.slice(8))} ${months[Number(d.slice(5, 7)) - 1]}${d.slice(0, 4) === today.slice(0, 4) ? '' : ` ${d.slice(0, 4)}`}`
    }
    expect(said(await colly.send('offer.send', { id: 'o-sean', callId: 'riggers', personId: 'sean', override: true }))).toBe(
      `Seán Ó Briain's IPAF runs out on ${day(8)}, before the job ends. Update their card if that's changed.`
    )
    expect(said(await colly.send('offer.send', { id: 'o-roisin', callId: 'riggers', personId: 'roisin', override: false }))).toBe(
      `Róisín Farrell's IPAF ran out on ${day(-1)}. Update their card if that's changed.`
    )
    // Pádraig holds both to the last day.
    expect(said(await colly.send('offer.send', { id: 'o-padraig', callId: 'riggers', personId: 'padraig', override: false }))).toBe('applied')
    const call = await colly.record<CrewCall>('crewCall', 'riggers')
    expect(call.needsCertificates).toEqual(['working-at-height', 'ipaf'])
  })

  it('goes to someone whose certificates are not known, the warning being for the office to see', async () => {
    // Proves: not known is allowed: Niall's card says nothing about either, and the offer goes.
    const { colly } = await rigging()
    expect(said(await colly.send('offer.send', { id: 'o-niall', callId: 'riggers', personId: 'niall', override: false }))).toBe('applied')
    expect(await colly.record<Offer>('offer', 'o-niall')).toMatchObject({ status: 'offered', personId: 'niall' })
  })

  it('goes once the card is put right, and a call that comes to need one keeps whoever is booked', async () => {
    // Proves: the fix is the person's card; and adding a needed certificate after a booking undoes nothing, the history saying what changed.
    const { colly, today } = await rigging()
    expect(
      await colly.send('person.upsert', {
        id: 'roisin',
        name: 'Róisín Farrell',
        kind: 'freelancer',
        email: null,
        phone: '+353871234567',
        skills: ['Rigger'],
        dayRateCents: 29000,
        notes: '',
        certificates: { 'working-at-height': { held: true, expires: null, note: '' }, ipaf: { held: true, expires: addDays(today, 365), note: '3b' } },
      })
    ).toMatchObject({ status: 'applied' })
    expect(said(await colly.send('offer.send', { id: 'o-roisin', callId: 'riggers', personId: 'roisin', override: false }))).toBe('applied')
    expect(await colly.send('offer.respond', { id: 'o-roisin', answer: 'accept', days: null, note: '' })).toMatchObject({ status: 'applied' })
    expect(await colly.send('offer.confirm', { id: 'o-roisin' })).toMatchObject({ status: 'applied' })

    // The site asks for a Safe Pass too, which Róisín's card says nothing about: she stays booked.
    expect(await colly.send('call.update', { id: 'riggers', needsCertificates: ['working-at-height', 'ipaf', 'safe-pass'] })).toMatchObject({ status: 'applied' })
    expect(await colly.record<Offer>('offer', 'o-roisin')).toMatchObject({ status: 'confirmed' })
    expect(await colly.send('call.update', { id: 'riggers', needsCertificates: [] })).toMatchObject({ status: 'applied' })

    const words = (await colly.history()).entries.map((e) => e.what)
    expect(words).toContain('Changed the call for Rigger on Harbour Lights Festival: certificates needed to Safe Pass, working at height and IPAF')
    expect(words).toContain('Changed the call for Rigger on Harbour Lights Festival: no certificates needed')
    expect(words.find((w) => w.startsWith('Asked for 3 × Rigger'))).toMatch(/, needing working at height and IPAF$/)
  })
})

describe("a person's certificates", () => {
  it('are laid over what is held kind by kind, so an edit from an older version of the app keeps the new kinds', async () => {
    // Proves: a device that only knows first aid, manual handling and driving licence sends those three, and Pádraig's IPAF and working at height stay; a kind sent as not known clears it.
    const { colly } = await rigging()
    const edit = (certificates: Person['certificates']) =>
      colly.send('person.upsert', { id: 'padraig', name: 'Pádraig Kenny', kind: 'freelancer', email: null, phone: '+353871234568', skills: ['Rigger'], dayRateCents: 29000, notes: '', certificates })
    expect(await edit({ 'first-aid': { held: true, expires: null, note: '' }, 'manual-handling': { held: null, expires: null, note: '' } })).toMatchObject({ status: 'applied' })
    const after = await colly.record<Person>('person', 'padraig')
    expect(after.phone).toBe('+353871234568')
    expect(after.certificates).toMatchObject({ 'first-aid': { held: true }, 'working-at-height': { held: true }, ipaf: { held: true, note: '3a, 3b' } })
    expect(await edit({ ipaf: { held: null, expires: null, note: '' } })).toMatchObject({ status: 'applied' })
    expect((await colly.record<Person>('person', 'padraig')).certificates.ipaf).toEqual({ held: null, expires: null, note: '' })
  })

  it('can still be cleared from an older version of the app, which leaves out a kind it clears', async () => {
    // Proves: that form sent only the kinds that said something, so first aid left out is cleared, as it always was, while IPAF, which it can't know, is kept.
    const { colly } = await rigging()
    const edit = (certificates: Person['certificates']) =>
      colly.send('person.upsert', { id: 'padraig', name: 'Pádraig Kenny', kind: 'freelancer', email: null, phone: '+353871234567', skills: ['Rigger'], dayRateCents: 29000, notes: '', certificates })
    expect(await edit({ 'first-aid': { held: true, expires: null, note: '' } })).toMatchObject({ status: 'applied' })
    expect(Object.keys((await colly.record<Person>('person', 'padraig')).certificates).sort()).toEqual(['first-aid', 'ipaf', 'working-at-height'])
    expect(await edit({})).toMatchObject({ status: 'applied' })
    expect((await colly.record<Person>('person', 'padraig')).certificates).toEqual({
      'working-at-height': { held: true, expires: null, note: '' },
      ipaf: expect.objectContaining({ held: true, note: '3a, 3b' }),
    })
  })
})

describe('bringing in the crew list', () => {
  it('reads the Safe Pass, working at height and IPAF columns, and brings them in', async () => {
    // Proves: the preview reads the new columns by their aliases, and bringing in writes them to the person, a blank saying nothing.
    const { app, db, colly } = await rigging()
    const text = ['First Name,Last Name,Email,Phone,Safepass,WAH,PAL card', 'Ciara,Byrne,ciara@example.com,,Yes,No,', 'Tom,Walsh,tom@example.com,,,Yes,Yes'].join('\r\n')
    const res = await app.inject({ method: 'POST', url: '/api/people/import/preview', cookies: colly.cookies, payload: { text } })
    expect(res.statusCode).toBe(200)
    const preview = res.json() as CrewListPreview
    expect(preview.rows.map((r) => r.certificates)).toEqual([
      { 'safe-pass': { held: true, expires: null, note: '' }, 'working-at-height': { held: false, expires: null, note: '' } },
      { 'working-at-height': { held: true, expires: null, note: '' }, ipaf: { held: true, expires: null, note: '' } },
    ])
    const brought = await app.inject({ method: 'POST', url: '/api/people/import', cookies: colly.cookies, payload: { rows: preview.rows.map((r) => ({ ...r, skip: false })) } })
    expect(brought.statusCode).toBe(200)
    const { rows } = await db.query<{ name: string; certificates: Person['certificates'] }>(`SELECT name, certificates FROM people WHERE name IN ('Ciara Byrne', 'Tom Walsh') ORDER BY name`)
    expect(rows.map((r) => [r.name, Object.keys(r.certificates).sort()])).toEqual([
      ['Ciara Byrne', ['safe-pass', 'working-at-height']],
      ['Tom Walsh', ['ipaf', 'working-at-height']],
    ])
  })
})
