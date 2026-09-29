import { createHash, randomBytes } from 'node:crypto'
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

/** Where to land after signing in: one of the app's own areas, or a record in one (#jobs/<id>), never another site. */
const landing = (next: unknown) => (typeof next === 'string' && /^#[a-z]{1,20}(\/[a-z0-9]{1,64})?$/.test(next) ? next : '')

/**
 * Staff sign-in. When it is on, every /api route needs a signed-in person
 * unless the route is marked public (health, the sign-in steps, /api/me).
 * The app shell, its files and freelancers' private links (/f/...) are not
 * API routes, so they load for anyone: the shell holds no data, and a link's
 * secret is its own credential.
 */
export function registerAuth(app: FastifyInstance, db: Db, auth: AuthConfig | undefined) {
  app.decorateRequest('user', null)

  async function signedIn(req: FastifyRequest, reply: FastifyReply): Promise<StaffUser | null> {
    const token = readCookie(req, SESSION_COOKIE)
    const found = token ? await sessionUser(db, token) : undefined
    if (!found) return null
    if (found.renewed) setCookie(req, reply, SESSION_COOKIE, token!, { maxAge: SESSION_DAYS * 86_400 })
    return found.user
  }

  app.addHook('onRequest', async (req, reply) => {
    if (!auth || !req.routeOptions.url?.startsWith('/api/') || req.routeOptions.config.public) return
    req.user = await signedIn(req, reply)
    if (!req.user) return reply.code(401).send({ error: 'Sign in first.' })
  })

  app.get('/api/me', { config: { public: true } }, async (req, reply): Promise<MeResponse | void> => {
    reply.header('cache-control', 'no-store')
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

  app.post('/api/auth/signout', { config: { public: true } }, async (req, reply) => {
    const token = readCookie(req, SESSION_COOKIE)
    if (token) await endSession(db, token)
    clearCookie(req, reply, SESSION_COOKIE)
    return { ok: true }
  })
}
