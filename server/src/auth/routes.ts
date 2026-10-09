import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import type { MeResponse, StaffUser } from '@sh/shared'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import type { Db } from '../db.ts'
import { clearCookie, publicOrigin, readCookie, setCookie } from '../http.ts'
import { isStaff, type AuthConfig } from './config.ts'
import { createSession, endSession, SESSION_DAYS, sessionUser, upsertUser } from './sessions.ts'

declare module 'fastify' {
  interface FastifyContextConfig {
    /** Reachable without signing in, even when sign-in is on. */
    public?: boolean
  }
  interface FastifyRequest {
    /** The signed-in member of staff; null when sign-in is off or on a public route. */
    user: StaffUser | null
  }
}

const SESSION_COOKIE = 'sh_session'
/** Holds the sign-in attempt (state, PKCE verifier, where to land) between leaving for Google and coming back. */
const ATTEMPT_COOKIE = 'sh_signin'
const ATTEMPT_PATH = '/api/auth'
/** Holds proof that this browser was given the demo passcode (never the passcode itself). */
const PASSCODE_COOKIE = 'sh_passcode'

/** What the passcode cookie holds: changes whenever the passcode does, so changing it locks every device out. */
const passcodeProof = (passcode: string) => createHmac('sha256', passcode).update('session-hire demo').digest('base64url')
const same = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b))

/**
 * Where to land after signing in: one of the app's own areas, or a place in
 * one (#jobs/<id>, #stock/item/<id>, #plan/week/<day>), never another site.
 */
const landing = (next: unknown) => (typeof next === 'string' && /^#[a-z]{1,20}(\/[a-z0-9-]{1,64}){0,2}$/.test(next) ? next : '')

/**
 * Staff sign-in. When it is on, every /api route needs a signed-in person
 * unless the route is marked public (health, the sign-in steps, /api/me).
 * A demo copy without Google can instead be locked with one shared
 * passcode (DEMO_PASSCODE): the same routes need it, and nobody is named.
 * The app shell, its files and freelancers' private links (/f/...) are not
 * API routes, so they load for anyone: the shell holds no data, and a link's
 * secret is its own credential.
 */
export function registerAuth(app: FastifyInstance, db: Db, auth: AuthConfig | undefined, passcode?: string) {
  app.decorateRequest('user', null)
  // Google sign-in wins: a passcode is only for a demo copy before it is set up.
  const proof = !auth && passcode ? passcodeProof(passcode) : undefined
  const hasPasscode = (req: FastifyRequest) => !!proof && same(readCookie(req, PASSCODE_COOKIE) ?? '', proof)

  async function signedIn(req: FastifyRequest, reply: FastifyReply): Promise<StaffUser | null> {
    const token = readCookie(req, SESSION_COOKIE)
    const found = token ? await sessionUser(db, token) : undefined
    if (!found) return null
    if (found.renewed) setCookie(req, reply, SESSION_COOKIE, token!, { maxAge: SESSION_DAYS * 86_400 })
    return found.user
  }

  app.addHook('onRequest', async (req, reply) => {
    if (!req.routeOptions.url?.startsWith('/api/') || req.routeOptions.config.public) return
    if (proof) {
      if (!hasPasscode(req)) return reply.code(401).send({ error: 'Enter the passcode first.' })
      return
    }
    if (!auth) return
    req.user = await signedIn(req, reply)
    if (!req.user) return reply.code(401).send({ error: 'Sign in first.' })
  })

  app.get('/api/me', { config: { public: true } }, async (req, reply): Promise<MeResponse | void> => {
    reply.header('cache-control', 'no-store')
    if (proof) return hasPasscode(req) ? { auth: 'passcode' } : reply.code(401).send({ auth: 'passcode', error: 'Enter the passcode first.' })
    if (!auth) return { auth: 'off' }
    const user = await signedIn(req, reply)
    if (!user) return reply.code(401).send({ auth: 'google', error: 'Sign in first.' })
    return { auth: 'google', user }
  })

  const callbackUrl = (req: FastifyRequest) => `${publicOrigin(req)}/api/auth/google/callback`

  app.get<{ Querystring: { next?: string } }>('/api/auth/google/start', { config: { public: true } }, async (req, reply) => {
    reply.header('cache-control', 'no-store')
    if (!auth) return reply.redirect('/', 303)
    const state = randomBytes(16).toString('base64url')
    const verifier = randomBytes(32).toString('base64url')
    setCookie(req, reply, ATTEMPT_COOKIE, [state, verifier, landing(req.query.next)].join('.'), { maxAge: 600, path: ATTEMPT_PATH })
    const codeChallenge = createHash('sha256').update(verifier).digest('base64url')
    return reply.redirect(auth.provider.authorizeUrl({ state, codeChallenge, redirectUri: callbackUrl(req) }), 302)
  })

  app.get<{ Querystring: { code?: string; state?: string; error?: string } }>(
    '/api/auth/google/callback',
    { config: { public: true } },
    async (req, reply) => {
      reply.header('cache-control', 'no-store')
      if (!auth) return reply.redirect('/', 303)
      const [state, verifier, next] = (readCookie(req, ATTEMPT_COOKIE) ?? '').split('.')
      clearCookie(req, reply, ATTEMPT_COOKIE, ATTEMPT_PATH)
      const back = landing(next)
      const fail = (why: 'cancelled' | 'failed' | 'denied') => reply.redirect(`/?signin=${why}${back}`, 303)

      if (req.query.error) return fail(req.query.error === 'access_denied' ? 'cancelled' : 'failed')
      // The state must match the one this browser left with, or someone is
      // trying to sign this browser in to their own account.
      if (!state || !verifier || !req.query.code || req.query.state !== state) return fail('failed')

      let identity
      try {
        identity = await auth.provider.exchange({ code: req.query.code, codeVerifier: verifier, redirectUri: callbackUrl(req) })
      } catch (err) {
        req.log.warn({ err }, 'Sign-in with Google failed')
        return fail('failed')
      }
      if (!isStaff(auth, identity)) {
        req.log.info({ domain: identity.hostedDomain ?? identity.email.split('@')[1] }, 'Sign-in refused: not a staff account')
        return fail('denied')
      }
      const user = await upsertUser(db, identity)
      if (user.disabled) return fail('denied')
      const token = await createSession(db, user.id, String(req.headers['user-agent'] ?? '').slice(0, 300))
      setCookie(req, reply, SESSION_COOKIE, token, { maxAge: SESSION_DAYS * 86_400 })
      return reply.redirect(`/${back}`, 303)
    }
  )

  app.post<{ Body: { passcode?: unknown } }>('/api/auth/passcode', { config: { public: true } }, async (req, reply) => {
    reply.header('cache-control', 'no-store')
    if (!proof) return reply.code(404).send({ error: 'This copy of the app has no passcode.' })
    const given = typeof req.body?.passcode === 'string' ? req.body.passcode.trim() : ''
    if (!same(passcodeProof(given), proof)) {
      // A pause on every wrong guess, so guessing takes far too long.
      await new Promise((r) => setTimeout(r, 1_000))
      return reply.code(403).send({ error: "That passcode isn't right." })
    }
    setCookie(req, reply, PASSCODE_COOKIE, proof, { maxAge: SESSION_DAYS * 86_400 })
    return { ok: true }
  })

  app.post('/api/auth/signout', { config: { public: true } }, async (req, reply) => {
    const token = readCookie(req, SESSION_COOKIE)
    if (token) await endSession(db, token)
    clearCookie(req, reply, proof ? PASSCODE_COOKIE : SESSION_COOKIE)
    return { ok: true }
  })
}
