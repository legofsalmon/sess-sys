import { createHash, randomBytes } from 'node:crypto'
import { newId } from '@sh/shared'
import type { FastifyInstance, LightMyRequestResponse } from 'fastify'
import { afterEach, describe, expect, it } from 'vitest'
import { buildApp } from '../src/app.ts'
import type { AuthConfig } from '../src/auth/config.ts'
import type { Identity, IdentityProvider } from '../src/auth/google.ts'
import { CREW, migrateCrew } from '../src/crew/schema.ts'
import { pgliteDb } from '../src/db.ts'
import { migrateAll } from '../src/modules.ts'

/**
 * Roles (ADR 0034), as the people involved meet them: off until someone is
 * made a director, then each member of staff changes only what their role
 * covers, on the server whatever the device sends, and a demo copy holds a
 * browser to the persona it chose.
 */

function fakeGoogle() {
  const codes = new Map<string, { identity: Identity; challenge: string }>()
  let last: { state: string; codeChallenge: string } | undefined
  const provider: IdentityProvider = {
    authorizeUrl(p) {
      last = p
      return `https://accounts.example/pick?state=${p.state}`
    },
    async exchange({ code, codeVerifier }) {
      const c = codes.get(code)
      codes.delete(code)
      if (!c || createHash('sha256').update(codeVerifier).digest('base64url') !== c.challenge) throw new Error('Bad code')
      return c.identity
    },
  }
  return {
    provider,
    pick(identity: Identity) {
      const code = randomBytes(8).toString('hex')
      codes.set(code, { identity, challenge: last!.codeChallenge })
      return { code, state: last!.state }
    },
  }
}

const account = (name: string, email: string): Identity => ({ subject: email, email, emailVerified: true, name, hostedDomain: 'sessionhire.com' })
const colly = account('Colly', 'colly@sessionhire.com')
const sean = account('Seán Ó Briain', 'sean@sessionhire.com')
const nobody = account('Temp Account', 'temp@sessionhire.com')

let cleanup: (() => Promise<void>)[] = []
afterEach(async () => {
  for (const fn of cleanup.reverse()) await fn()
  cleanup = []
})

const cookie = (res: LightMyRequestResponse, name: string) => res.cookies.find((c) => c.name === name)

async function server(admins: string[] = []) {
  const db = await pgliteDb()
  const google = fakeGoogle()
  const auth: AuthConfig = { provider: google.provider, domains: ['sessionhire.com'], emails: [], admins }
  const app = await buildApp({ db, auth })
  cleanup.push(async () => {
    await app.close()
    await db.close()
  })
  async function signIn(identity: Identity) {
    const start = await app.inject('/api/auth/google/start?next=%23home')
    const { code, state } = google.pick(identity)
    const back = await app.inject({ url: `/api/auth/google/callback?code=${code}&state=${state}`, cookies: { sh_signin: cookie(start, 'sh_signin')!.value } })
    return cookie(back, 'sh_session')!.value
  }
  return { app, signIn }
}

async function send(app: FastifyInstance, cookies: Record<string, string>, name: string, args: unknown) {
  const res = await app.inject({
    method: 'POST',
    url: '/api/sync/push',
    cookies,
    payload: { clientId: 'phone', mutations: [{ id: newId(), name, args, createdAt: new Date().toISOString() }] },
  })
  return res.json().results[0] as { status: string; reason?: { code: string; message: string } }
}

const staff = (id: string, name: string, email: string | null, extra: object = {}) => ({
  id,
  name,
  kind: 'staff',
  email,
  phone: null,
  skills: [],
  dayRateCents: null,
  notes: '',
  ...extra,
})
const bay = (id: string) => ({ id, name: `Bay ${id}`, notes: '' })

/** Colly signs in, puts herself and Seán on the Crew tab, and makes herself the director: roles are on. */
async function company(admins: string[] = []) {
  const s = await server(admins)
  const c = { sh_session: await s.signIn(colly) }
  expect((await send(s.app, c, 'person.upsert', staff('colly', 'Colly', 'colly@sessionhire.com'))).status).toBe('applied')
  expect((await send(s.app, c, 'person.upsert', staff('sean', 'Seán Ó Briain', 'Sean@SessionHire.com'))).status).toBe('applied')
  expect((await send(s.app, c, 'person.role', { id: 'colly', role: 'director' })).status).toBe('applied')
  return { ...s, c }
}

describe('roles', () => {
  it('make whoever was the warehouse a head of department, who keeps all the warehouse could change (ADR 0051)', async () => {
    const db = await pgliteDb()
    cleanup.push(() => db.close())
    await migrateAll(db)
    // As the database was the day before: warehouse still a role.
    await db.query('ALTER TABLE people DROP CONSTRAINT people_role_check')
    await db.query(`UPDATE crew_schema_version SET version = $1`, [CREW.migrations.findIndex((m) => m.includes("SET role = 'head' WHERE role = 'warehouse'"))])
    await db.query(`INSERT INTO people (id, name, kind, link_token, role) VALUES ('w', 'Wes', 'staff', 'tw', 'warehouse'), ('h', 'Áine', 'staff', 'th', 'head')`)
    await migrateCrew(db)
    expect((await db.query(`SELECT id, role FROM people ORDER BY id`)).rows).toEqual([{ id: 'h', role: 'head' }, { id: 'w', role: 'head' }])
    await expect(db.query(`UPDATE people SET role = 'warehouse' WHERE id = 'w'`)).rejects.toThrow()
    await db.query(`UPDATE people SET role = 'freelancer' WHERE id = 'w'`)
  })

  it('are off until someone is a director, so everyone signed in can do everything as before', async () => {
    const { app, signIn } = await server()
    const s = { sh_session: await signIn(sean) }
    expect((await app.inject({ url: '/api/me', cookies: s })).json()).toMatchObject({ role: 'director', rolesOn: false })
    expect((await send(app, s, 'place.upsert', bay('a1'))).status).toBe('applied')
    expect((await send(app, s, 'person.upsert', staff('p1', 'Dara', null))).status).toBe('applied')
    expect((await app.inject({ url: '/api/export', cookies: s })).statusCode).toBe(200)
  })

  it('hold each member of staff to what their role covers, matched by the email they sign in with', async () => {
    const { app, signIn, c } = await company()
    expect((await app.inject({ url: '/api/me', cookies: c })).json()).toMatchObject({ role: 'director', rolesOn: true })

    // Seán has no role set, so he's staff crew: he can look, but not change stock.
    const s = { sh_session: await signIn(sean) }
    expect((await app.inject({ url: '/api/me', cookies: s })).json()).toMatchObject({ role: 'crew', rolesOn: true })
    expect((await app.inject({ url: '/api/sync/pull?after=0', cookies: s })).statusCode).toBe(200)
    const refused = await send(app, s, 'place.upsert', bay('a2'))
    expect(refused).toMatchObject({ status: 'rejected', reason: { code: 'forbidden' } })
    expect(refused.reason!.message).toBe(
      'Only the office, heads of department and directors can change stock and the warehouse. Your role is Staff crew; a director can change it on your person on the Crew tab.'
    )

    // Made a freelancer, he can only report a fault: not stock, not leave (ADR 0051).
    expect((await send(app, c, 'person.role', { id: 'sean', role: 'freelancer' })).status).toBe('applied')
    expect((await app.inject({ url: '/api/me', cookies: s })).json()).toMatchObject({ role: 'freelancer', rolesOn: true })
    expect((await send(app, s, 'place.upsert', bay('a2'))).reason?.code).toBe('forbidden')
    expect((await send(app, s, 'leave.request', { id: 'l1', personId: 'sean', start: '2026-12-01', end: '2026-12-02', type: 'annual', note: '' })).reason?.code).toBe('forbidden')

    // Made a head of department, he can, at once; jobs and settings stay out of reach.
    expect((await send(app, c, 'person.role', { id: 'sean', role: 'head' })).status).toBe('applied')
    expect((await send(app, s, 'place.upsert', bay('a2'))).status).toBe('applied')
    expect((await send(app, s, 'project.create', { id: 'j1' })).reason?.code).toBe('forbidden')
    expect((await send(app, s, 'person.role', { id: 'sean', role: 'director' })).reason?.code).toBe('forbidden')
    const download = await app.inject({ url: '/api/export', cookies: s })
    expect(download.statusCode).toBe(403)
    expect(download.json().error).toMatch(/^Only the office and directors can change settings/)
    expect((await app.inject({ method: 'POST', url: '/api/data/start-fresh', cookies: s, payload: { confirm: 'x' } })).statusCode).toBe(403)

    // The office can download, but not start fresh or change roles.
    expect((await send(app, c, 'person.role', { id: 'sean', role: 'office' })).status).toBe('applied')
    expect((await app.inject({ url: '/api/export', cookies: s })).statusCode).toBe(200)
    expect((await app.inject({ method: 'POST', url: '/api/data/start-fresh', cookies: s, payload: { confirm: 'x' } })).statusCode).toBe(403)
    expect((await send(app, s, 'person.role', { id: 'sean', role: 'director' })).reason?.code).toBe('forbidden')
  })

  it("let a system admin named in the server's settings change everything, whatever their own role (ADR 0060)", async () => {
    const { app, signIn, c } = await company(['sean@sessionhire.com'])
    const s = { sh_session: await signIn(sean) }
    // Seán is staff crew on the Crew tab, but the server's settings make him a system admin.
    expect((await app.inject({ url: '/api/me', cookies: s })).json()).toMatchObject({ role: 'director', rolesOn: true, admin: true })
    expect((await app.inject({ url: '/api/me', cookies: c })).json()).not.toHaveProperty('admin')
    expect((await send(app, s, 'place.upsert', bay('a1'))).status).toBe('applied')
    expect((await send(app, s, 'project.create', { id: 'j1', name: 'Culture Night', clientId: null, venueId: null, status: 'confirmed', notes: '' })).status).toBe('applied')
    expect((await app.inject({ url: '/api/export', cookies: s })).statusCode).toBe(200)
    expect((await send(app, s, 'person.upsert', staff('adam', 'Adam', 'adam@sessionhire.com'))).status).toBe('applied')
    expect((await send(app, s, 'person.role', { id: 'adam', role: 'director' })).status).toBe('applied')
    // A director taking his role away changes nothing for him: it isn't one in the app to take.
    expect((await send(app, c, 'person.role', { id: 'sean', role: 'freelancer' })).status).toBe('applied')
    expect((await send(app, s, 'place.upsert', bay('a2'))).status).toBe('applied')
    // He isn't a director either: the last of those still can't step down.
    expect((await send(app, s, 'person.role', { id: 'colly', role: 'crew' })).status).toBe('applied')
    expect((await send(app, s, 'person.role', { id: 'adam', role: 'crew' })).reason?.message).toBe('There has to be at least one director. Make someone else a director first.')
  })

  it("don't come on because of a system admin: only a director switches them on", async () => {
    const { app, signIn } = await server(['sean@sessionhire.com'])
    const s = { sh_session: await signIn(sean) }
    expect((await app.inject({ url: '/api/me', cookies: s })).json()).toMatchObject({ role: 'director', rolesOn: false, admin: true })
  })

  it('treat an account that matches nobody on the Crew tab as staff crew', async () => {
    const { app, signIn } = await company()
    const t = { sh_session: await signIn(nobody) }
    expect((await app.inject({ url: '/api/me', cookies: t })).json()).toMatchObject({ role: 'crew', rolesOn: true })
    expect((await send(app, t, 'place.upsert', bay('a3'))).reason?.code).toBe('forbidden')
  })

  it('always keep a director, so nobody is locked out', async () => {
    const { app, c } = await company()
    const alone = await send(app, c, 'person.role', { id: 'colly', role: 'office' })
    expect(alone).toMatchObject({ status: 'rejected', reason: { code: 'conflict', message: 'There has to be at least one director. Make someone else a director first.' } })
    expect((await send(app, c, 'person.archive', { id: 'colly', archived: true })).reason?.code).toBe('conflict')
    expect((await send(app, c, 'person.upsert', staff('colly', 'Colly', 'colly@sessionhire.com', { kind: 'freelancer' }))).reason?.code).toBe('conflict')
    // With a second director, she can step down.
    expect((await send(app, c, 'person.role', { id: 'sean', role: 'director' })).status).toBe('applied')
    expect((await send(app, c, 'person.role', { id: 'colly', role: 'office' })).status).toBe('applied')
  })

  it('send prices and quotes only to the office and directors, and keep the cursor moving for everyone else', async () => {
    const { app, signIn, c } = await company()
    expect((await send(app, c, 'project.create', { id: 'gala', name: 'Autumn Gala', clientId: null, venueId: null, status: 'confirmed', notes: '' })).status).toBe('applied')
    const lines = [{ id: 'l1', kind: 'other', what: 'Delivery', ref: null, group: '', qty: 1, days: 1, unitCents: 15000, vat: '23' }]
    expect((await send(app, c, 'quote.save', { id: 'q1', projectId: 'gala', lines, discountPct: 0, notes: '' })).status).toBe('applied')
    expect((await send(app, c, 'price.role', { role: 'Rigger', dayCents: 38000 })).status).toBe('applied')
    const all = (await app.inject({ url: '/api/sync/pull?after=0', cookies: c })).json()
    expect(all.money).toBeUndefined()
    expect(all.changes.map((ch: { entity: string }) => ch.entity)).toEqual(expect.arrayContaining(['quote', 'rolePrice']))

    // Seán is staff crew: the rest of the job, and no money; his cursor still reaches the end.
    const s = { sh_session: await signIn(sean) }
    const his = (await app.inject({ url: '/api/sync/pull?after=0', cookies: s })).json()
    expect(his).toMatchObject({ money: false, cursor: all.cursor })
    expect(his.changes.map((ch: { entity: string }) => ch.entity)).toContain('project')
    expect(his.changes.some((ch: { entity: string }) => ['quote', 'rolePrice', 'productPrice', 'clientDiscount', 'costPaid'].includes(ch.entity))).toBe(false)
    const no = await send(app, s, 'price.role', { role: 'Rigger', dayCents: 1 })
    expect(no).toMatchObject({ status: 'rejected', reason: { code: 'forbidden' } })
    expect(no.reason!.message).toMatch(/^Only the office and directors can see and change prices, quotes and what is owed\./)

    // Made office, he's sent it all.
    expect((await send(app, c, 'person.role', { id: 'sean', role: 'office' })).status).toBe('applied')
    const now = (await app.inject({ url: '/api/sync/pull?after=0', cookies: s })).json()
    expect(now.money).toBeUndefined()
    expect(now.changes.some((ch: { entity: string }) => ch.entity === 'quote')).toBe(true)
  })

  it('give a role only to staff, and leave who approves time off to a director', async () => {
    const { app, signIn, c } = await company()
    await send(app, c, 'person.upsert', { ...staff('dara', 'Dara Kelly', null), kind: 'freelancer' })
    expect((await send(app, c, 'person.role', { id: 'dara', role: 'office' })).reason?.code).toBe('conflict')

    await send(app, c, 'person.role', { id: 'sean', role: 'office' })
    const s = { sh_session: await signIn(sean) }
    const tick = await send(app, s, 'person.upsert', staff('sean', 'Seán Ó Briain', 'sean@sessionhire.com', { approvesLeave: true }))
    expect(tick).toMatchObject({ status: 'rejected', reason: { code: 'forbidden' } })
    // An edit that leaves it as it was is fine.
    expect((await send(app, s, 'person.upsert', staff('sean', 'Seán Ó Briain', 'sean@sessionhire.com', { notes: 'Van keys' }))).status).toBe('applied')
    expect((await send(app, c, 'person.upsert', staff('sean', 'Seán Ó Briain', 'sean@sessionhire.com', { approvesLeave: true }))).status).toBe('applied')
  })

  it("keep the email and type of someone who holds a role to the office and directors, and each email to one person (audit finding 12)", async () => {
    const { app, signIn, c } = await company()
    await send(app, c, 'person.role', { id: 'sean', role: 'head' })
    const s = { sh_session: await signIn(sean) }
    const said = (r: { reason?: { message: string } }) => r.reason?.message

    // A head can't move the director's account, take it, or move his own.
    const moved = await send(app, s, 'person.upsert', staff('colly', 'Colly', 'sean.two@sessionhire.com'))
    expect(moved).toMatchObject({ status: 'rejected', reason: { code: 'forbidden' } })
    expect(said(moved)).toBe("Only the office and directors can change Colly's email or type: it's how they sign in as Director. Your role is Head of department.")
    expect((await send(app, s, 'person.upsert', staff('colly', 'Colly', 'colly@sessionhire.com', { kind: 'freelancer' }))).reason?.code).toBe('forbidden')
    expect((await send(app, s, 'person.contact', { id: 'colly', email: 'sean.two@sessionhire.com' })).reason?.code).toBe('forbidden')
    expect(said(await send(app, s, 'person.upsert', staff('sean', 'Seán Ó Briain', 'sean@elsewhere.ie')))).toMatch(/^Only the office and directors can change Seán Ó Briain's email or type/)
    // The same email in other letters, with anything else changed, is fine.
    expect((await send(app, s, 'person.upsert', staff('colly', 'Colly', 'Colly@SessionHire.com', { notes: 'Keys to the yard' }))).status).toBe('applied')

    // Nobody gets an email someone here already has, however it's written: from the form, or a phone change.
    const taken = await send(app, s, 'person.upsert', staff('dara', 'Dara Kelly', 'COLLY@sessionhire.com'))
    expect(taken).toMatchObject({ status: 'rejected', reason: { code: 'conflict', message: 'Colly already has that email. Each person needs their own, as it\'s how the app knows who signs in.' } })
    expect((await send(app, c, 'person.upsert', staff('dara', 'Dara Kelly', 'sean@sessionhire.com'))).reason?.code).toBe('conflict')
    // Staff crew's own, a head of department changes, as before.
    expect((await send(app, s, 'person.upsert', staff('dara', 'Dara Kelly', 'dara@sessionhire.com'))).status).toBe('applied')
    expect((await send(app, s, 'person.contact', { id: 'dara', email: 'dara.kelly@sessionhire.com' })).status).toBe('applied')
    expect((await send(app, s, 'person.contact', { id: 'dara', email: 'colly@sessionhire.com' })).reason?.code).toBe('conflict')
    // Someone who has left keeps theirs, and it can be given again.
    expect((await send(app, s, 'person.archive', { id: 'dara', archived: true })).status).toBe('applied')
    expect((await send(app, s, 'person.upsert', staff('dara2', 'Dara Kelly', 'dara.kelly@sessionhire.com'))).status).toBe('applied')
    // Bringing the old one back would give the email to two people, so it waits until one of them has another.
    const back = await send(app, s, 'person.archive', { id: 'dara', archived: false })
    expect(back).toMatchObject({ status: 'rejected', reason: { code: 'conflict' } })
    expect(said(back)).toBe("Dara Kelly now has Dara Kelly's email, so Dara Kelly can't be brought back until one of them has another. Each person needs their own, as it's how the app knows who signs in.")

    // A role kept by someone made a freelancer comes back if they're made staff again, so that's the office's too.
    expect((await send(app, c, 'person.role', { id: 'dara2', role: 'office' })).status).toBe('applied')
    expect((await send(app, c, 'person.upsert', staff('dara2', 'Dara Kelly', 'dara.kelly@sessionhire.com', { kind: 'freelancer' }))).status).toBe('applied')
    expect((await send(app, s, 'person.upsert', staff('dara2', 'Dara Kelly', 'dara.kelly@sessionhire.com'))).reason?.code).toBe('forbidden')

    // A director can, and Seán's account is then nobody's.
    expect((await send(app, c, 'person.upsert', staff('sean', 'Seán Ó Briain', 'sean@elsewhere.ie'))).status).toBe('applied')
    expect((await app.inject({ url: '/api/me', cookies: s })).json()).toMatchObject({ role: 'crew' })
  })
})

describe('the demo, seen as someone', () => {
  async function demo() {
    const db = await pgliteDb()
    const app = await buildApp({ db, passcode: 'loud-speakers-42' })
    cleanup.push(async () => {
      await app.close()
      await db.close()
    })
    const ok = await app.inject({ method: 'POST', url: '/api/auth/passcode', payload: { passcode: 'loud-speakers-42' } })
    return { app, cookies: { sh_passcode: cookie(ok, 'sh_passcode')!.value } }
  }
  const see = (app: FastifyInstance, cookies: Record<string, string>, role: string | null) =>
    app.inject({ method: 'POST', url: '/api/auth/preview', cookies, payload: { role } })

  it('holds the browser to the persona it chose, and to everything again with none', async () => {
    const { app, cookies } = await demo()
    expect((await app.inject({ url: '/api/me', cookies })).json()).toEqual({ auth: 'passcode' })
    expect((await send(app, cookies, 'place.upsert', bay('a1'))).status).toBe('applied')

    const chose = await see(app, cookies, 'head')
    expect(chose.statusCode).toBe(200)
    const as = { ...cookies, sh_preview: cookie(chose, 'sh_preview')!.value }
    expect((await app.inject({ url: '/api/me', cookies: as })).json()).toEqual({ auth: 'passcode', role: 'head' })
    expect((await send(app, as, 'place.upsert', bay('a2'))).status).toBe('applied')
    expect((await send(app, as, 'project.create', { id: 'j1' })).reason?.code).toBe('forbidden')

    // Choosing someone else, or nobody, lets go.
    const none = await see(app, as, null)
    expect(cookie(none, 'sh_preview')!.maxAge).toBe(0)
    expect((await see(app, cookies, 'janitor')).json()).toEqual({ role: null })
    // Warehouse was a role until ADR 0051: a browser still saying so is held to nothing it chose.
    expect((await see(app, cookies, 'warehouse')).json()).toEqual({ role: null })
  })

  it("isn't there on a copy without a passcode", async () => {
    const db = await pgliteDb()
    const app = await buildApp({ db })
    cleanup.push(async () => {
      await app.close()
      await db.close()
    })
    expect((await app.inject({ method: 'POST', url: '/api/auth/preview', payload: { role: 'office' } })).statusCode).toBe(404)
  })
})

/**
 * What each role reads (ADR 0046): the records everyone needs are sent to
 * everyone, with crew rates, timesheet amounts and freelancers' private
 * links left out where the role doesn't need them, and each person's own
 * always there.
 */
describe('what each role reads', () => {
  const aine = account('Áine Walsh', 'aine@sessionhire.com')
  const day = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10)
  const offerTo = (id: string, callId: string, personId: string) => [
    ['offer.send', { id, callId, personId, override: false }],
    ['offer.respond', { id, answer: 'accept', days: null, note: '' }],
    ['offer.confirm', { id }],
  ] as const
  const callFor = (id: string, role: string, extra: object = {}) => ({
    id,
    projectId: 'gala',
    phaseId: 'show',
    project: 'Autumn Gala',
    phase: 'Show',
    venue: '',
    role,
    start: day(-2),
    end: day(-1),
    callTime: null,
    needed: 2,
    dayRateCents: 32000,
    details: '',
    replyBy: null,
    ...extra,
  })

  /** Colly the director, Seán staff crew, Áine head of Audio; Dara (Audio) and Niamh (LX) freelancers booked on the gala, with a timesheet in from Dara. */
  async function crewed() {
    const s = await company()
    const { app, c } = s
    const ok = async (name: string, args: unknown) => expect(await send(app, c, name, args), name).toMatchObject({ status: 'applied' })
    await ok('person.upsert', staff('aine', 'Áine Walsh', 'aine@sessionhire.com', { department: 'Audio', dayRateCents: 21000 }))
    await ok('person.role', { id: 'aine', role: 'head' })
    await ok('person.upsert', staff('dara', 'Dara Quinn', null, { kind: 'freelancer', department: 'Audio', dayRateCents: 25000 }))
    await ok('person.upsert', staff('niamh', 'Niamh Byrne', null, { kind: 'freelancer', department: 'LX', dayRateCents: 28000 }))
    await ok('project.create', { id: 'gala', name: 'Autumn Gala', clientId: null, venueId: null, status: 'confirmed', notes: '' })
    await ok('phase.add', { id: 'show', projectId: 'gala', name: 'Show', start: day(-3), end: day(-1), venueId: null, notes: '' })
    // No department sent: the role's words say Audio. One sent stands.
    await ok('call.create', callFor('sound', 'Sound No.1'))
    await ok('call.create', callFor('lx', 'Stagehand', { department: 'LX', dayRateCents: 30000 }))
    for (const [name, args] of [...offerTo('dara-sound', 'sound', 'dara'), ...offerTo('niamh-lx', 'lx', 'niamh'), ...offerTo('aine-sound', 'sound', 'aine')]) await ok(name, args)
    await ok('timesheet.send', { id: 'dara-sound', days: [day(-2)], extras: [{ what: 'Taxi', cents: 2500 }], note: '' })
    const pull = async (cookies: Record<string, string>) => {
      const res = await app.inject({ url: '/api/sync/pull?after=0', cookies })
      expect(res.statusCode).toBe(200)
      const body = res.json() as { reading?: unknown; changes: { entity: string; id: string; op: string; data: Record<string, unknown> }[] }
      const latest = new Map<string, Record<string, unknown>>()
      for (const ch of body.changes) if (ch.op === 'put') latest.set(`${ch.entity}:${ch.id}`, ch.data)
      return { reading: body.reading, of: (entity: string, id: string) => latest.get(`${entity}:${id}`)!, all: [...latest.entries()] }
    }
    return { ...s, ok, pull }
  }

  /** Every rate, amount and link token in a feed that isn't this person's own. */
  function leaks(feed: Awaited<ReturnType<Awaited<ReturnType<typeof crewed>>['pull']>>, own?: string) {
    const rates: string[] = []
    const links: string[] = []
    for (const [key, d] of feed.all) {
      const [entity] = key.split(':')
      const mine = own && (d.id === own || d.personId === own || (entity === 'timesheet' && String(d.id).startsWith(`${own}-`)))
      if (mine) continue
      if (entity === 'person' && d.linkToken) links.push(String(d.id))
      if (['person', 'crewCall', 'offer', 'timesheet'].includes(entity!) && (d.dayRateCents != null || (d.counterRateCents ?? null) != null)) rates.push(key)
      if (entity === 'timesheet') {
        const t = d as { extras: { cents: number }[]; sent: { dayRateCents: number | null; extras: { cents: number }[] } }
        if (t.sent.dayRateCents != null || [...t.extras, ...t.sent.extras].some((e) => e.cents !== 0)) rates.push(`${key} amounts`)
      }
    }
    return { rates, links }
  }

  it('sends the director every rate and link, and the call the department its role suggests', async () => {
    const { c, pull } = await crewed()
    const feed = await pull(c)
    expect(feed.reading).toBeUndefined()
    expect(feed.of('crewCall', 'sound')).toMatchObject({ department: 'Audio', dayRateCents: 32000 })
    expect(feed.of('crewCall', 'lx')).toMatchObject({ department: 'LX' })
    expect(feed.of('person', 'niamh')).toMatchObject({ dayRateCents: 28000 })
    expect(String(feed.of('person', 'niamh').linkToken)).not.toBe('')
    expect(feed.of('timesheet', 'dara-sound')).toMatchObject({ dayRateCents: 32000, extras: [{ what: 'Taxi', cents: 2500 }] })
    expect(feed.of('timesheet', 'dara-sound').amountsHidden).toBeUndefined()
  })

  it('sends staff crew no rate, amount or link but their own', async () => {
    const { app, signIn, ok, pull } = await crewed()
    await ok('offer.send', { id: 'sean-lx', callId: 'lx', personId: 'sean', override: false })
    const s = { sh_session: await signIn(sean) }
    const feed = await pull(s)
    expect(feed.reading).toEqual({ rates: false, links: 'own', personId: 'sean', details: 'phones', documents: 'own' })
    expect(leaks(feed, 'sean')).toEqual({ rates: [], links: [] })
    // The records are all there, so the screens work, and say what's left out.
    expect(feed.of('crewCall', 'lx')).toMatchObject({ role: 'Stagehand', dayRateCents: null, rateHidden: true })
    expect(feed.of('person', 'niamh')).toMatchObject({ name: 'Niamh Byrne', dayRateCents: null, rateHidden: true, linkToken: '', linkHidden: true })
    expect(feed.of('timesheet', 'dara-sound')).toMatchObject({ days: [day(-2)], extras: [{ what: 'Taxi', cents: 0 }], amountsHidden: true })
    // His own offer is his to read, rate and all.
    expect(feed.of('offer', 'sean-lx')).toMatchObject({ dayRateCents: 30000 })
    expect(feed.of('offer', 'sean-lx').rateHidden).toBeUndefined()
    // Download everything stays the office's and directors'.
    expect((await app.inject({ url: '/api/export', cookies: s })).statusCode).toBe(403)
  })

  it('sends a freelancer no rate or link but their own', async () => {
    const { signIn, ok, pull } = await crewed()
    await ok('person.role', { id: 'sean', role: 'freelancer' })
    const feed = await pull({ sh_session: await signIn(sean) })
    expect(feed.reading).toMatchObject({ rates: false, links: 'own' })
    expect(leaks(feed, 'sean')).toEqual({ rates: [], links: [] })
  })

  it("sends a head of department their own department's links, and rates only once a director lets them", async () => {
    const { app, c, signIn, ok, pull } = await crewed()
    const h = { sh_session: await signIn(aine) }
    let feed = await pull(h)
    expect(feed.reading).toEqual({ rates: false, links: 'department', personId: 'aine', department: 'Audio' })
    // Dara is in Audio, as she is; Niamh is in LX, and Colly and Seán in none.
    expect(leaks(feed, 'aine')).toEqual({ rates: [], links: ['dara'] })
    expect(feed.of('person', 'aine')).toMatchObject({ dayRateCents: 21000 })
    expect(feed.of('offer', 'aine-sound')).toMatchObject({ dayRateCents: 32000 })

    // She can't set a rate or decide a timesheet, but can make a call without one and edit a person, whose rate is kept.
    const refusals = [
      await send(app, h, 'call.create', callFor('foh', 'FOH', { dayRateCents: 35000 })),
      await send(app, h, 'call.update', { id: 'sound', dayRateCents: 1 }),
      await send(app, h, 'timesheet.approve', { id: 'dara-sound', days: [day(-2)], dayRateCents: 32000, extras: [], officeNote: '' }),
    ]
    for (const r of refusals) expect(r).toMatchObject({ status: 'rejected', reason: { code: 'forbidden', message: expect.stringMatching(/^Only the office and directors see crew rates/) } })
    expect(await send(app, h, 'call.create', callFor('foh', 'FOH', { dayRateCents: null }))).toMatchObject({ status: 'applied' })
    expect(await send(app, h, 'person.upsert', { ...staff('dara', 'Dara Quinn', null, { kind: 'freelancer' }), dayRateCents: undefined, notes: 'Has a van' })).toMatchObject({ status: 'applied' })
    expect((await pull(c)).of('person', 'dara')).toMatchObject({ notes: 'Has a van', dayRateCents: 25000 })
    expect((await pull(c)).of('crewCall', 'foh')).toMatchObject({ department: 'Audio' })

    // Nor make a new link for someone outside her department, which would stop theirs with none to send; her department's and her own she can.
    const niamhsLink = (await pull(c)).of('person', 'niamh').linkToken
    const relink = await send(app, h, 'person.newLink', { id: 'niamh' })
    expect(relink).toMatchObject({ status: 'rejected', reason: { code: 'forbidden' } })
    expect(relink.reason!.message).toMatch(/^Only the office and directors see every freelancer's private link, and a head of department those of people in their own department/)
    expect((await pull(c)).of('person', 'niamh').linkToken).toBe(niamhsLink)
    const darasLink = (await pull(c)).of('person', 'dara').linkToken
    expect(await send(app, h, 'person.newLink', { id: 'dara' })).toMatchObject({ status: 'applied' })
    expect((await pull(h)).of('person', 'dara').linkToken).not.toBe(darasLink)
    expect(await send(app, h, 'person.newLink', { id: 'aine' })).toMatchObject({ status: 'applied' })
    // The office makes Niamh's, as ever.
    expect(await send(app, c, 'person.newLink', { id: 'niamh' })).toMatchObject({ status: 'applied' })

    // Nor agree a rate someone asked for.
    await ok('call.create', callFor('build', 'Stagehand', { start: day(-3), end: day(-3), department: 'LX' }))
    await ok('offer.send', { id: 'dara-lx', callId: 'build', personId: 'dara', override: false })
    await ok('offer.respond', { id: 'dara-lx', answer: 'counter', counterRateCents: 35000, days: null, note: '' })
    expect(await send(app, h, 'offer.confirm', { id: 'dara-lx' })).toMatchObject({ status: 'rejected', reason: { code: 'forbidden' } })
    expect((await pull(h)).of('offer', 'dara-lx')).toMatchObject({ status: 'countered', counterRateCents: null, rateHidden: true })

    // Only a director says whether heads see rates, and the office or a director whether messages to crew are prompted (ADR 0048).
    expect((await send(app, h, 'reading.heads', { rates: true })).reason?.code).toBe('forbidden')
    expect((await send(app, h, 'messages.prompt', { on: true })).reason?.code).toBe('forbidden')
    await ok('reading.heads', { rates: true })
    feed = await pull(h)
    expect(feed.reading).toMatchObject({ rates: true, ratesBy: 'department', links: 'department' })
    // Her own department's rates (ADR 0062): Dara's and the Audio call's, and not Niamh's or the LX call's.
    expect(feed.of('person', 'dara')).toMatchObject({ dayRateCents: 25000 })
    expect(feed.of('person', 'niamh')).toMatchObject({ dayRateCents: null, rateHidden: true, linkToken: '', linkHidden: true })
    expect(feed.of('crewCall', 'lx')).toMatchObject({ dayRateCents: null, rateHidden: true })
    expect(feed.of('offer', 'niamh-lx')).toMatchObject({ dayRateCents: null, rateHidden: true })
    expect(feed.of('timesheet', 'dara-sound')).toMatchObject({ extras: [{ cents: 2500 }] })
    expect(await send(app, h, 'call.update', { id: 'sound', dayRateCents: 33000 })).toMatchObject({ status: 'applied' })
    // Another department's rate is the office's, and so is one on a call she makes for it.
    for (const r of [
      await send(app, h, 'call.update', { id: 'lx', dayRateCents: 1 }),
      await send(app, h, 'call.create', callFor('rig', 'Rigger', { department: 'LX', dayRateCents: 30000 })),
    ])
      expect(r).toMatchObject({ status: 'rejected', reason: { code: 'forbidden', message: expect.stringMatching(/^You see the rates of your own department's/) } })
    expect(await send(app, h, 'call.create', callFor('mon', 'Monitors', { department: 'Audio', dayRateCents: 30000 }))).toMatchObject({ status: 'applied' })
    // An edit to Niamh keeps the rate she can't see.
    expect(await send(app, h, 'person.upsert', { ...staff('niamh', 'Niamh Byrne', null, { kind: 'freelancer', department: 'LX' }), dayRateCents: 1 })).toMatchObject({ status: 'applied' })
    expect((await pull(c)).of('person', 'niamh')).toMatchObject({ dayRateCents: 28000 })
    // The history names everyone's, so it tells her none of the figures.
    expect(JSON.stringify((await app.inject({ url: '/api/history', cookies: h })).json())).not.toMatch(/€/)
  })

  it("sends staff crew a colleague's phone but not their email, notes, documents or what they wrote about time off", async () => {
    const { app, c, signIn, ok, pull } = await crewed()
    await ok('person.upsert', staff('dara', 'Dara Quinn', 'dara@example.com', { kind: 'freelancer', department: 'Audio', dayRateCents: 25000, phone: '+353871234567', notes: 'Bad back' }))
    await ok('document.save', { id: 'd-dara', personId: 'dara', kind: 'insurance', title: 'Public liability insurance', expires: null })
    await ok('document.save', { id: 'd-sean', personId: 'sean', kind: 'insurance', title: 'Public liability insurance', expires: null })
    await ok('unavailability.add', { id: 'away', personId: 'dara', start: day(5), end: day(6), note: 'Hospital' })
    const s = { sh_session: await signIn(sean) }
    const feed = await pull(s)
    expect(feed.of('person', 'dara')).toMatchObject({ name: 'Dara Quinn', phone: '+353871234567', email: null, notes: '', detailsHidden: true })
    expect(feed.of('document', 'd-dara')).toBeUndefined()
    expect(feed.of('document', 'd-sean')).toMatchObject({ personId: 'sean' })
    expect(feed.of('unavailability', 'away')).toMatchObject({ start: day(5), note: '' })
    // Nor its file, nor the note in the history.
    const file = await app.inject({ url: '/api/documents/d-dara/file', cookies: s })
    expect(file.statusCode).toBe(403)
    expect(file.json().error).toMatch(/^Only the office, directors and heads of department/)
    expect(JSON.stringify((await app.inject({ url: '/api/history', cookies: s })).json())).not.toContain('Hospital')
    expect(JSON.stringify((await app.inject({ url: '/api/history', cookies: c })).json())).toContain('Hospital')

    // A freelancer signed in reads no one's phone either; the office reads everything.
    await ok('person.role', { id: 'sean', role: 'freelancer' })
    expect((await pull(s)).of('person', 'dara')).toMatchObject({ phone: null, email: null })
    expect((await pull(c)).of('person', 'dara')).toMatchObject({ email: 'dara@example.com', notes: 'Bad back' })
    expect((await pull(c)).of('document', 'd-dara')).toBeDefined()
  })

  it('tells the history without figures to a role without rates', async () => {
    const { app, c, signIn } = await crewed()
    const say = async (cookies: Record<string, string>) => JSON.stringify((await app.inject({ url: '/api/history', cookies })).json())
    expect(await say(c)).toMatch(/€/)
    const his = await say({ sh_session: await signIn(sean) })
    expect(his).not.toMatch(/€/)
    expect(his).toContain("Sent Dara Quinn's timesheet for Sound No.1 on Autumn Gala: 1 day, and extras")
  })

  it('gives many calls one department at once, for those who change crew', async () => {
    const { app, c, signIn, ok, pull } = await crewed()
    await ok('call.create', callFor('hands', 'Stagehand', { department: null }))
    expect((await pull(c)).of('crewCall', 'hands').department).toBeNull()
    await ok('call.department', { ids: ['hands', 'lx'], department: 'Production' })
    const feed = await pull(c)
    expect([feed.of('crewCall', 'hands').department, feed.of('crewCall', 'lx').department]).toEqual(['Production', 'Production'])
    expect((await send(app, c, 'call.department', { ids: ['nope'], department: 'LX' })).reason?.code).toBe('not-found')
    expect((await send(app, { sh_session: await signIn(sean) }, 'call.department', { ids: ['hands'], department: 'LX' })).reason?.code).toBe('forbidden')
    const page = JSON.stringify((await app.inject({ url: '/api/history', cookies: c })).json())
    expect(page).toContain('Gave 2 crew calls the department Production')
  })

  it('sends a demo persona what the person it stands in for would read', async () => {
    const db = await pgliteDb()
    const app = await buildApp({ db, passcode: 'loud-speakers-42' })
    cleanup.push(async () => {
      await app.close()
      await db.close()
    })
    const ok = await app.inject({ method: 'POST', url: '/api/auth/passcode', payload: { passcode: 'loud-speakers-42' } })
    const cookies = { sh_passcode: cookie(ok, 'sh_passcode')!.value }
    for (const [name, args] of [
      ['person.upsert', staff('dara', 'Dara Quinn', null, { kind: 'freelancer', department: 'Audio', dayRateCents: 25000 })],
      ['person.upsert', staff('niamh', 'Niamh Byrne', null, { kind: 'freelancer', department: 'LX', dayRateCents: 28000 })],
      ['person.upsert', staff('sean', 'Seán Ó Briain', null, { dayRateCents: 20000 })],
    ] as const)
      expect((await send(app, cookies, name, args)).status).toBe('applied')
    const as = async (payload: object) => {
      const chose = await app.inject({ method: 'POST', url: '/api/auth/preview', cookies, payload })
      const res = await app.inject({ url: '/api/sync/pull?after=0', cookies: { ...cookies, sh_preview: cookie(chose, 'sh_preview')!.value } })
      const people = new Map<string, Record<string, unknown>>()
      for (const ch of res.json().changes) if (ch.entity === 'person') people.set(ch.id, ch.data)
      return { reading: res.json().reading, people }
    }
    const everyone = await as({ role: 'office' })
    expect(everyone.reading).toBeUndefined()
    expect(everyone.people.get('niamh')).toMatchObject({ dayRateCents: 28000 })

    const head = await as({ role: 'head', department: 'Audio' })
    expect(head.reading).toMatchObject({ rates: false, links: 'department', department: 'Audio' })
    expect(head.people.get('dara')!.linkToken).not.toBe('')
    expect(head.people.get('niamh')).toMatchObject({ linkToken: '', dayRateCents: null })

    const staffCrew = await as({ role: 'crew', personId: 'sean' })
    expect(staffCrew.people.get('sean')).toMatchObject({ dayRateCents: 20000 })
    expect(staffCrew.people.get('dara')).toMatchObject({ linkToken: '', dayRateCents: null })

    // The freelancer persona is taken to the busiest freelancer's page by the server, as the device may hold no link.
    const free = (await app.inject({ method: 'POST', url: '/api/auth/preview', cookies, payload: { role: 'freelancer' } })).json()
    expect(free).toMatchObject({ role: null, link: expect.stringMatching(/^\/f\/[\w-]+$/) })
  })
})
