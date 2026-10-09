import { createHash, randomBytes } from 'node:crypto'
import { newId } from '@sh/shared'
import type { FastifyInstance, LightMyRequestResponse } from 'fastify'
import { afterEach, describe, expect, it } from 'vitest'
import { buildApp } from '../src/app.ts'
import { assertSignInKept, authFromEnv, passcodeFromEnv, type AuthConfig } from '../src/auth/config.ts'
import { googleProvider, identityFromIdToken, type Identity, type IdentityProvider } from '../src/auth/google.ts'
import { pgliteDb } from '../src/db.ts'

/**
 * Staff sign-in, as the people involved see it: nothing but the sign-in
 * page for someone who isn't signed in, Google's account picker, and back
 * into the app. Google itself is played by a stand-in that checks what the
 * real one checks (the one-time code, and the PKCE verifier matching the
 * challenge the browser left with).
 */

function fakeGoogle() {
  const codes = new Map<string, { identity: Identity; challenge: string; redirectUri: string }>()
  let lastVisit: { state: string; codeChallenge: string; redirectUri: string } | undefined
  const provider: IdentityProvider = {
    authorizeUrl(p) {
      lastVisit = p
      return `https://accounts.example/pick?state=${p.state}`
    },
    async exchange({ code, codeVerifier, redirectUri }) {
      const c = codes.get(code)
      codes.delete(code)
      if (!c) throw new Error('Unknown or used code')
      if (createHash('sha256').update(codeVerifier).digest('base64url') !== c.challenge) throw new Error('Verifier does not match')
      if (redirectUri !== c.redirectUri) throw new Error('Redirect does not match')
      return c.identity
    },
  }
  return {
    provider,
    /** The person picks this account; Google sends the browser back with these. */
    pick(identity: Identity) {
      const code = randomBytes(8).toString('hex')
      codes.set(code, { identity, challenge: lastVisit!.codeChallenge, redirectUri: lastVisit!.redirectUri })
      return { code, state: lastVisit!.state }
    },
  }
}

const aoife: Identity = { subject: '1001', email: 'aoife@sessionhire.com', emailVerified: true, name: 'Aoife Byrne', hostedDomain: 'sessionhire.com' }

let cleanup: (() => Promise<void>)[] = []
afterEach(async () => {
  for (const fn of cleanup.reverse()) await fn()
  cleanup = []
})

async function server(opts: { signIn?: boolean; emails?: string[] } = {}) {
  const db = await pgliteDb()
  const google = fakeGoogle()
  const auth: AuthConfig | undefined = opts.signIn === false ? undefined : { provider: google.provider, domains: ['sessionhire.com'], emails: opts.emails ?? [] }
  const app = await buildApp({ db, auth })
  cleanup.push(async () => {
    await app.close()
    await db.close()
  })
  return { app, db, google }
}

const cookie = (res: LightMyRequestResponse, name: string) => res.cookies.find((c) => c.name === name)

/** Tap "Sign in with Google", pick an account, and come back. */
async function signIn(app: FastifyInstance, google: ReturnType<typeof fakeGoogle>, identity: Identity, next = '#crew') {
  const start = await app.inject(`/api/auth/google/start?next=${encodeURIComponent(next)}`)
  expect(start.statusCode).toBe(302)
  expect(start.headers.location).toMatch(/^https:\/\/accounts\.example\/pick/)
  const attempt = cookie(start, 'sh_signin')!
  const { code, state } = google.pick(identity)
  const back = await app.inject({ url: `/api/auth/google/callback?code=${code}&state=${state}`, cookies: { sh_signin: attempt.value } })
  return { back, session: cookie(back, 'sh_session')?.value }
}

const pull = (app: FastifyInstance, session?: string) =>
  app.inject({ url: '/api/sync/pull?after=0', ...(session ? { cookies: { sh_session: session } } : {}) })

function push(app: FastifyInstance, session: string | undefined, name: string, args: unknown) {
  return app.inject({
    method: 'POST',
    url: '/api/sync/push',
    ...(session ? { cookies: { sh_session: session } } : {}),
    payload: { clientId: 'office-laptop', mutations: [{ id: newId(), name, args, createdAt: new Date().toISOString() }] },
  })
}

describe('staff sign-in', () => {
  it('is off until Google is set up, and says so', async () => {
    const { app } = await server({ signIn: false })
    expect((await app.inject('/api/me')).json()).toEqual({ auth: 'off' })
    expect((await app.inject('/api/health')).json()).toMatchObject({ ok: true, auth: 'off' })
    expect((await pull(app)).statusCode).toBe(200)
  })

  it('keeps every API behind sign-in once it is on, but not health or freelancer links', async () => {
    const { app, google } = await server()
    expect((await pull(app)).statusCode).toBe(401)
    expect((await push(app, undefined, 'place.upsert', { id: 'a3', name: 'Bay A3', notes: '' })).statusCode).toBe(401)
    expect((await app.inject('/api/export')).statusCode).toBe(401)
    expect((await app.inject('/api/me')).statusCode).toBe(401)
    expect((await app.inject('/api/health')).json()).toMatchObject({ ok: true, auth: 'google' })

    // Ops add a freelancer; the freelancer's link works with no sign-in.
    const { session } = await signIn(app, google, aoife)
    const res = await push(app, session, 'person.upsert', { id: 'p1', name: 'Dara Kelly', kind: 'freelancer', email: null, phone: null, skills: [], dayRateCents: null, notes: '' })
    expect(res.json().results[0].status).toBe('applied')
    const people = (await pull(app, session)).json().changes.filter((c: { entity: string }) => c.entity === 'person')
    const link = people[people.length - 1].data.linkToken
    expect((await app.inject(`/f/${link}`)).statusCode).toBe(200)
  })

  it('signs a member of staff in with Google and lands them where they were', async () => {
    const { app, google } = await server()
    const { back, session } = await signIn(app, google, aoife, '#crew')
    expect(back.statusCode).toBe(303)
    expect(back.headers.location).toBe('/#crew')
    const set = cookie(back, 'sh_session')!
    expect(set).toMatchObject({ httpOnly: true, sameSite: 'Lax', path: '/' })
    expect(set.maxAge).toBe(60 * 86_400)

    const me = await app.inject({ url: '/api/me', cookies: { sh_session: session! } })
    expect(me.json()).toEqual({ auth: 'google', user: { id: expect.any(String), email: 'aoife@sessionhire.com', name: 'Aoife Byrne' } })
    expect((await pull(app, session)).statusCode).toBe(200)
  })

  it('marks its cookies Secure when the app is on https', async () => {
    const { app } = await server()
    const start = await app.inject({ url: '/api/auth/google/start', headers: { 'x-forwarded-proto': 'https' } })
    expect(cookie(start, 'sh_signin')).toMatchObject({ secure: true, httpOnly: true, sameSite: 'Lax', path: '/api/auth', maxAge: 600 })
  })

  it('records who made each change', async () => {
    const { app, google } = await server()
    const { session } = await signIn(app, google, aoife)
    const me = (await app.inject({ url: '/api/me', cookies: { sh_session: session! } })).json()
    await push(app, session, 'place.upsert', { id: 'a3', name: 'Bay A3', notes: '' })
    const exported = (await app.inject({ url: '/api/export', cookies: { sh_session: session! } })).json()
    expect(exported.mutations).toEqual([expect.objectContaining({ name: 'place.upsert', user_id: me.user.id })])
    expect(exported.users).toEqual([expect.objectContaining({ email: 'aoife@sessionhire.com' })])
    expect(exported).not.toHaveProperty('sessions')
  })

  it.each([
    ['a personal Google account', { ...aoife, subject: '2', email: 'aoife.byrne@gmail.com', hostedDomain: undefined }],
    ['a personal account made with a company address', { ...aoife, subject: '3', hostedDomain: undefined }],
    ["another company's Workspace", { ...aoife, subject: '4', email: 'sam@rentalco.ie', hostedDomain: 'rentalco.ie' }],
    ['an address Google has not verified', { ...aoife, subject: '5', emailVerified: false }],
  ])('turns away %s', async (_label, identity) => {
    const { app, google } = await server()
    const { back, session } = await signIn(app, google, identity)
    expect(back.headers.location).toBe('/?signin=denied#crew')
    expect(session).toBeUndefined()
  })

  it('lets in single accounts listed by email, such as a tester', async () => {
    const { app, google } = await server({ emails: ['colly.tester@gmail.com'] })
    const { back, session } = await signIn(app, google, { ...aoife, subject: '6', email: 'colly.tester@gmail.com', hostedDomain: undefined })
    expect(back.headers.location).toBe('/#crew')
    expect((await pull(app, session)).statusCode).toBe(200)
  })

  it('refuses a return from Google that did not start in this browser', async () => {
    const { app, google } = await server()
    const start = await app.inject('/api/auth/google/start')
    const { code, state } = google.pick(aoife)

    // No record of setting out: someone else's link to our callback.
    const forged = await app.inject(`/api/auth/google/callback?code=${code}&state=${state}`)
    expect(forged.headers.location).toBe('/?signin=failed')
    expect(cookie(forged, 'sh_session')).toBeUndefined()

    // The right browser, but the state has been tampered with.
    const attempt = cookie(start, 'sh_signin')!.value
    const tampered = await app.inject({ url: `/api/auth/google/callback?code=${code}&state=nope`, cookies: { sh_signin: attempt } })
    expect(tampered.headers.location).toBe('/?signin=failed')

    // The person pressed Cancel on Google's page.
    const cancelled = await app.inject({ url: '/api/auth/google/callback?error=access_denied', cookies: { sh_signin: attempt } })
    expect(cancelled.headers.location).toBe('/?signin=cancelled')
  })

  it('only lands on one of the app’s own areas, or a record in one', async () => {
    const { app, google } = await server()
    const { back } = await signIn(app, google, aoife, 'https://evil.example/')
    expect(back.headers.location).toBe('/')
    const job = await signIn(app, google, aoife, '#jobs/mg4x2k1q0abcdefghij12')
    expect(job.back.headers.location).toBe('/#jobs/mg4x2k1q0abcdefghij12')
    const item = await signIn(app, google, aoife, '#stock/item/mg4x2k1q0abcdefghij12')
    expect(item.back.headers.location).toBe('/#stock/item/mg4x2k1q0abcdefghij12')
    const odd = await signIn(app, google, aoife, '#jobs/../evil.example')
    expect(odd.back.headers.location).toBe('/')
  })

  it('signs out, and a session ends when it expires or the account is switched off', async () => {
    const { app, db, google } = await server()
    let { session } = await signIn(app, google, aoife)
    const out = await app.inject({ method: 'POST', url: '/api/auth/signout', cookies: { sh_session: session! } })
    expect(cookie(out, 'sh_session')).toMatchObject({ value: '', maxAge: 0 })
    expect((await pull(app, session)).statusCode).toBe(401)

    ;({ session } = await signIn(app, google, aoife))
    await db.query("UPDATE sessions SET expires_at = now() - interval '1 minute'")
    expect((await pull(app, session)).statusCode).toBe(401)

    ;({ session } = await signIn(app, google, aoife))
    await db.query('UPDATE users SET disabled = true')
    expect((await pull(app, session)).statusCode).toBe(401)
    const again = await signIn(app, google, aoife)
    expect(again.back.headers.location).toBe('/?signin=denied#crew')
  })

  it('keeps a session going while it is used, a day at a time', async () => {
    const { app, db, google } = await server()
    const { session } = await signIn(app, google, aoife)
    const quiet = await pull(app, session)
    expect(cookie(quiet, 'sh_session')).toBeUndefined()

    await db.query("UPDATE sessions SET last_seen_at = now() - interval '2 days', expires_at = now() + interval '58 days'")
    const renewed = await pull(app, session)
    expect(cookie(renewed, 'sh_session')).toMatchObject({ value: session, maxAge: 60 * 86_400 })
    const { rows } = await db.query<{ days: number }>("SELECT round(extract(epoch FROM expires_at - now()) / 86400)::int AS days FROM sessions")
    expect(rows[0]!.days).toBe(60)
  })

  it('keeps only a hash of the session secret', async () => {
    const { app, db, google } = await server()
    const { session } = await signIn(app, google, aoife)
    const { rows } = await db.query<{ id: string }>('SELECT id FROM sessions')
    expect(rows).toHaveLength(1)
    expect(rows[0]!.id).not.toContain(session!)
    expect(rows[0]!.id).toBe(createHash('sha256').update(session!).digest('hex'))
  })

  it('only lets signed-in devices listen for changes', async () => {
    const { app, google } = await server()
    await app.ready()
    await expect(app.injectWS('/api/sync/live')).rejects.toThrow('401')
    const { session } = await signIn(app, google, aoife)
    const ws = await app.injectWS('/api/sync/live', { headers: { cookie: `sh_session=${session}` } })
    ws.terminate()
  })
})

describe('Google', () => {
  const token = (claims: Record<string, unknown>) =>
    ['{"alg":"RS256"}', JSON.stringify(claims)].map((p) => Buffer.from(p).toString('base64url')).join('.') + '.signature'
  const good = {
    iss: 'https://accounts.google.com',
    aud: 'client-1',
    sub: '1001',
    email: 'Aoife@SessionHire.com',
    email_verified: true,
    name: 'Aoife Byrne',
    hd: 'sessionhire.com',
    exp: Math.floor(Date.now() / 1000) + 3600,
  }

  it('reads who the person is from the ID token', () => {
    expect(identityFromIdToken(token(good), 'client-1')).toEqual({
      subject: '1001',
      email: 'aoife@sessionhire.com',
      emailVerified: true,
      name: 'Aoife Byrne',
      hostedDomain: 'sessionhire.com',
    })
  })

  it.each([
    ['from someone other than Google', { iss: 'https://evil.example' }, 'not from Google'],
    ['meant for another app', { aud: 'client-2' }, 'another app'],
    ['expired', { exp: Math.floor(Date.now() / 1000) - 60 }, 'expired'],
    ['without an email', { email: undefined }, 'no account or email'],
  ])('refuses an ID token %s', (_label, change, message) => {
    expect(() => identityFromIdToken(token({ ...good, ...change }), 'client-1')).toThrow(message)
  })

  it('sends the person to Google with PKCE, and swaps the code using the secret', async () => {
    let sent: URLSearchParams | undefined
    const fakeFetch = (async (_url: string, init: RequestInit) => {
      sent = init.body as URLSearchParams
      return new Response(JSON.stringify({ id_token: token(good) }), { status: 200 })
    }) as typeof fetch
    const google = googleProvider({ clientId: 'client-1', clientSecret: 'secret-1', hostedDomain: 'sessionhire.com', fetch: fakeFetch })

    const url = new URL(google.authorizeUrl({ state: 's1', codeChallenge: 'c1', redirectUri: 'https://app.example/api/auth/google/callback' }))
    expect(url.origin + url.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth')
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      client_id: 'client-1',
      response_type: 'code',
      scope: 'openid email profile',
      state: 's1',
      code_challenge: 'c1',
      code_challenge_method: 'S256',
      hd: 'sessionhire.com',
    })

    const identity = await google.exchange({ code: 'code-1', codeVerifier: 'v1', redirectUri: 'https://app.example/api/auth/google/callback' })
    expect(identity.email).toBe('aoife@sessionhire.com')
    expect(Object.fromEntries(sent!)).toEqual({
      code: 'code-1',
      code_verifier: 'v1',
      client_id: 'client-1',
      client_secret: 'secret-1',
      redirect_uri: 'https://app.example/api/auth/google/callback',
      grant_type: 'authorization_code',
    })
  })
})

describe('demo passcode', () => {
  async function demo(opts: { signIn?: boolean } = {}) {
    const db = await pgliteDb()
    const google = fakeGoogle()
    const auth: AuthConfig | undefined = opts.signIn ? { provider: google.provider, domains: ['sessionhire.com'], emails: [] } : undefined
    const app = await buildApp({ db, auth, passcode: 'loud-speakers-42' })
    cleanup.push(async () => {
      await app.close()
      await db.close()
    })
    return { app, google }
  }
  const enter = (app: FastifyInstance, passcode: string) => app.inject({ method: 'POST', url: '/api/auth/passcode', payload: { passcode } })

  it('keeps the API behind the passcode, but not health', async () => {
    const { app } = await demo()
    expect((await pull(app)).statusCode).toBe(401)
    expect((await push(app, undefined, 'place.upsert', { id: 'a3', name: 'Bay A3', notes: '' })).statusCode).toBe(401)
    expect((await app.inject('/api/export')).statusCode).toBe(401)
    expect((await app.inject('/api/me')).json()).toEqual({ auth: 'passcode', error: 'Enter the passcode first.' })
    expect((await app.inject('/api/health')).json()).toMatchObject({ ok: true, auth: 'passcode' })
    await app.ready()
    await expect(app.injectWS('/api/sync/live')).rejects.toThrow('401')
  })

  it('lets a browser in with the right passcode, and remembers it', async () => {
    const { app } = await demo()
    const ok = await enter(app, ' loud-speakers-42 ')
    expect(ok.statusCode).toBe(200)
    const set = cookie(ok, 'sh_passcode')!
    expect(set).toMatchObject({ httpOnly: true, sameSite: 'Lax', path: '/', maxAge: 60 * 86_400 })
    expect(set.value).not.toContain('loud-speakers')
    const cookies = { sh_passcode: set.value }
    expect((await app.inject({ url: '/api/me', cookies })).json()).toEqual({ auth: 'passcode' })
    expect((await app.inject({ url: '/api/sync/pull?after=0', cookies })).statusCode).toBe(200)

    const out = await app.inject({ method: 'POST', url: '/api/auth/signout', cookies })
    expect(cookie(out, 'sh_passcode')).toMatchObject({ value: '', maxAge: 0 })
  })

  it('turns a wrong passcode away', async () => {
    const { app } = await demo()
    const wrong = await enter(app, 'quiet-speakers-42')
    expect(wrong.statusCode).toBe(403)
    expect(cookie(wrong, 'sh_passcode')).toBeUndefined()
    expect((await app.inject({ url: '/api/me', cookies: { sh_passcode: 'made-up' } })).statusCode).toBe(401)
  })

  it('steps aside once Google sign-in is on', async () => {
    const { app } = await demo({ signIn: true })
    expect((await enter(app, 'loud-speakers-42')).statusCode).toBe(404)
    expect((await app.inject('/api/health')).json()).toMatchObject({ auth: 'google' })
  })

  it('is read from DEMO_PASSCODE, and refuses a short one', () => {
    expect(passcodeFromEnv({})).toBeUndefined()
    expect(passcodeFromEnv({ DEMO_PASSCODE: ' loud-speakers-42 ' })).toBe('loud-speakers-42')
    expect(() => passcodeFromEnv({ DEMO_PASSCODE: '1234' })).toThrow('too short')
  })
})

describe('sign-in settings', () => {
  it('is off without Google settings, and refuses half of them', () => {
    expect(authFromEnv({})).toBeUndefined()
    expect(() => authFromEnv({ GOOGLE_CLIENT_ID: 'id' })).toThrow('both')
    expect(() => authFromEnv({ GOOGLE_CLIENT_SECRET: 'secret' })).toThrow('both')
  })

  it('lets sessionhire.com in by default, and extra accounts by email', () => {
    expect(authFromEnv({ GOOGLE_CLIENT_ID: 'id', GOOGLE_CLIENT_SECRET: 'secret' })).toMatchObject({ domains: ['sessionhire.com'], emails: [] })
    expect(
      authFromEnv({ GOOGLE_CLIENT_ID: 'id', GOOGLE_CLIENT_SECRET: 'secret', STAFF_DOMAINS: 'sessionhire.com, Example.ie', STAFF_EMAILS: ' Colly@Gmail.com ' })
    ).toMatchObject({ domains: ['sessionhire.com', 'example.ie'], emails: ['colly@gmail.com'] })
    expect(() => authFromEnv({ GOOGLE_CLIENT_ID: 'id', GOOGLE_CLIENT_SECRET: 'secret', STAFF_DOMAINS: '' })).toThrow('nobody')
  })

  it('narrows Google’s account picker to the company only when nobody else is allowed', () => {
    const hint = (env: NodeJS.ProcessEnv) =>
      new URL(authFromEnv({ GOOGLE_CLIENT_ID: 'id', GOOGLE_CLIENT_SECRET: 'secret', ...env })!.provider.authorizeUrl({ state: 's', codeChallenge: 'c', redirectUri: 'https://x/cb' })).searchParams.get('hd')
    expect(hint({})).toBe('sessionhire.com')
    expect(hint({ STAFF_EMAILS: 'colly@gmail.com' })).toBeNull()
  })

  it('will not start without sign-in once someone has signed in, unless told to', async () => {
    const { app, db, google } = await server()
    await expect(assertSignInKept(db, undefined, {})).resolves.toBeUndefined()
    await signIn(app, google, aoife)
    await expect(assertSignInKept(db, undefined, {})).rejects.toThrow('Refusing to start without sign-in')
    await expect(assertSignInKept(db, undefined, { AUTH_MODE: 'open' })).resolves.toBeUndefined()
    await expect(assertSignInKept(db, { provider: google.provider, domains: ['sessionhire.com'], emails: [] }, {})).resolves.toBeUndefined()
  })
})
