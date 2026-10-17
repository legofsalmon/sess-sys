import { createHash, randomBytes } from 'node:crypto'
import { newId } from '@sh/shared'
import type { FastifyInstance, LightMyRequestResponse } from 'fastify'
import { afterEach, describe, expect, it } from 'vitest'
import { buildApp } from '../src/app.ts'
import type { AuthConfig } from '../src/auth/config.ts'
import type { Identity, IdentityProvider } from '../src/auth/google.ts'
import { pgliteDb } from '../src/db.ts'

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

async function server() {
  const db = await pgliteDb()
  const google = fakeGoogle()
  const auth: AuthConfig = { provider: google.provider, domains: ['sessionhire.com'], emails: [] }
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
async function company() {
  const s = await server()
  const c = { sh_session: await s.signIn(colly) }
  expect((await send(s.app, c, 'person.upsert', staff('colly', 'Colly', 'colly@sessionhire.com'))).status).toBe('applied')
  expect((await send(s.app, c, 'person.upsert', staff('sean', 'Seán Ó Briain', 'Sean@SessionHire.com'))).status).toBe('applied')
  expect((await send(s.app, c, 'person.role', { id: 'colly', role: 'director' })).status).toBe('applied')
  return { ...s, c }
}

describe('roles', () => {
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
      'Only the office, heads of department, the warehouse and directors can change stock and the warehouse. Your role is Staff crew; a director can change it on your person on the Crew tab.'
    )

    // Made warehouse, he can, at once; jobs, crew and settings stay out of reach.
    expect((await send(app, c, 'person.role', { id: 'sean', role: 'warehouse' })).status).toBe('applied')
    expect((await send(app, s, 'place.upsert', bay('a2'))).status).toBe('applied')
    expect((await send(app, s, 'project.create', { id: 'j1' })).reason?.code).toBe('forbidden')
    expect((await send(app, s, 'person.upsert', staff('p2', 'Dara', null))).reason?.code).toBe('forbidden')
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

    const chose = await see(app, cookies, 'warehouse')
    expect(chose.statusCode).toBe(200)
    const as = { ...cookies, sh_preview: cookie(chose, 'sh_preview')!.value }
    expect((await app.inject({ url: '/api/me', cookies: as })).json()).toEqual({ auth: 'passcode', role: 'warehouse' })
    expect((await send(app, as, 'place.upsert', bay('a2'))).status).toBe('applied')
    expect((await send(app, as, 'project.create', { id: 'j1' })).reason?.code).toBe('forbidden')

    // Choosing someone else, or nobody, lets go.
    const none = await see(app, as, null)
    expect(cookie(none, 'sh_preview')!.maxAge).toBe(0)
    expect((await see(app, cookies, 'janitor')).json()).toEqual({ role: null })
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
