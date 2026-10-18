import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { refusalFor, roleCan, ROLES, type Ability, type MeResponse, type ReaderOf, type Role, type StaffUser } from '@sh/shared'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import type { Db } from '../db.ts'
import { clearCookie, publicOrigin, readCookie, setCookie } from '../http.ts'
import { isStaff, type AuthConfig } from './config.ts'
import { roleOfAccount } from './roles.ts'
import { createSession, endSession, SESSION_DAYS, sessionUser, upsertUser } from './sessions.ts'

declare module 'fastify' {
  interface FastifyContextConfig {
    /** Reachable without signing in, even when sign-in is on. */
    public?: boolean
    /** What a role has to be able to do to use it, once roles are on (ADR 0034). */
    needs?: Ability
  }
  interface FastifyRequest {
    /** The signed-in member of staff; null when sign-in is off or on a public route. */
    user: StaffUser | null
    /**
     * What this request may change (ADR 0034): the signed-in person's role
     * once roles are on, or a demo's chosen persona. Null when nothing is
     * checked: roles off, sign-in off, or a public route.
     */
    role: Role | null
    /**
     * Who is asking on the Crew tab, and their department, which with the
     * role decide what they read of crew rates and links (ADR 0046). On a
     * demo, the persona's stand-in. Empty when nobody is matched.
     */
    reader: ReaderOf
  }
}

const SESSION_COOKIE = 'sh_session'
/** Holds the sign-in attempt (state, PKCE verifier, where to land) between leaving for Google and coming back. */
const ATTEMPT_COOKIE = 'sh_signin'
const ATTEMPT_PATH = '/api/auth'
/** Holds proof that this browser was given the demo passcode (never the passcode itself). */
const PASSCODE_COOKIE = 'sh_passcode'
/** On a demo copy, the persona chosen on "See it as…", as the role the server holds it to (ADR 0034). */
const PREVIEW_COOKIE = 'sh_preview'
const asRole = (v: unknown): Role | undefined => (ROLES as readonly unknown[]).includes(v) ? (v as Role) : undefined

/**
 * What the preview cookie holds: the role alone, as it always has, or with
 * who the persona stands in for, so the demo reads as that person would
 * (ADR 0046): their own rate and link, a head's department's links.
 */
interface Preview {
  role: Role
  personId?: string
  department?: string
}
function readPreview(value: string | undefined): Preview | undefined {
  const role = asRole(value)
  if (role) return { role }
  try {
    const p = JSON.parse(Buffer.from(value ?? '', 'base64url').toString('utf8')) as Record<string, unknown>
    const known = asRole(p.role)
    if (!known) return undefined
    const text = (v: unknown, max: number) => (typeof v === 'string' && v.trim() && v.length <= max ? v.trim() : undefined)
    const personId = text(p.personId, 64)
    const department = text(p.department, 60)
    return { role: known, ...(personId ? { personId } : {}), ...(department ? { department } : {}) }
  } catch {
    return undefined
  }
}
/** The made-up freelancer whose page has the most on it: offers and bookings coming up. */
async function busiestLink(db: Db): Promise<string | null> {
  const { rows } = await db.query<{ link_token: string }>(
    `SELECT p.link_token FROM people p
      WHERE p.kind = 'freelancer' AND NOT p.archived AND p.link_token <> ''
      ORDER BY (SELECT count(*) FROM offers o WHERE o.person_id = p.id AND o.status IN ('offered', 'accepted', 'confirmed')) DESC, p.name, p.id
      LIMIT 1`
  )
  return rows[0] ? `/f/${rows[0].link_token}` : null
}
const writePreview = (p: Preview) => (p.personId || p.department ? Buffer.from(JSON.stringify(p)).toString('base64url') : p.role)

/** What the passcode cookie holds: changes whenever the passcode does, so changing it locks every device out. */
const passcodeProof = (passcode: string) => createHmac('sha256', passcode).update('session-hire demo').digest('base64url')
const same = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b))

/**
 * Where to land after signing in: one of the app's own areas, or a place in
 * one (#jobs/<id>, #stock/item/<id>, #jobs/plan/week/<day>/people), never another site.
 */
const landing = (next: unknown) => (typeof next === 'string' && /^#[a-z]{1,20}(\/[a-z0-9-]{1,64}){0,4}$/.test(next) ? next : '')

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
  app.decorateRequest('role', null)
  app.decorateRequest('reader', null as unknown as ReaderOf)
  // Google sign-in wins: a passcode is only for a demo copy before it is set up.
  const proof = !auth && passcode ? passcodeProof(passcode) : undefined
  const hasPasscode = (req: FastifyRequest) => !!proof && same(readCookie(req, PASSCODE_COOKIE) ?? '', proof)

  async function signedIn(req: FastifyRequest, reply: FastifyReply): Promise<StaffUser | null> {
    const token = readCookie(req, SESSION_COOKIE)
    // Asked on every request, so on the reads' own connections: never queued behind writes waiting for the write lock.
    const found = token ? await sessionUser(db.reads, token) : undefined
    if (!found) return null
    if (found.renewed) setCookie(req, reply, SESSION_COOKIE, token!, { maxAge: SESSION_DAYS * 86_400 })
    return found.user
  }

  app.addHook('onRequest', async (req, reply) => {
    req.reader = {}
    if (!req.routeOptions.url?.startsWith('/api/') || req.routeOptions.config.public) return
    if (proof) {
      if (!hasPasscode(req)) return reply.code(401).send({ error: 'Enter the passcode first.' })
      const preview = readPreview(readCookie(req, PREVIEW_COOKIE))
      req.role = preview?.role ?? null
      if (preview) req.reader = { ...(preview.personId ? { personId: preview.personId } : {}), ...(preview.department ? { department: preview.department } : {}) }
    } else if (auth) {
      req.user = await signedIn(req, reply)
      if (!req.user) return reply.code(401).send({ error: 'Sign in first.' })
      const { role, on, personId, department } = await roleOfAccount(db.reads, req.user.email)
      req.role = on ? role : null
      if (on && personId) req.reader = { personId, department: department ?? null }
    }
    const needs = req.routeOptions.config.needs
    if (needs && req.role && !roleCan(req.role, needs)) return reply.code(403).send({ error: refusalFor(req.role, needs) })
  })

  app.get('/api/me', { config: { public: true } }, async (req, reply): Promise<MeResponse | void> => {
    reply.header('cache-control', 'no-store')
    if (proof) {
      if (!hasPasscode(req)) return reply.code(401).send({ auth: 'passcode', error: 'Enter the passcode first.' })
      const role = readPreview(readCookie(req, PREVIEW_COOKIE))?.role
      return { auth: 'passcode', ...(role ? { role } : {}) }
    }
    if (!auth) return { auth: 'off' }
    const user = await signedIn(req, reply)
    if (!user) return reply.code(401).send({ auth: 'google', error: 'Sign in first.' })
    const { role, on } = await roleOfAccount(db, user.email)
    return { auth: 'google', user, role, rolesOn: on }
  })

  // A demo copy's "See it as…" (ADR 0033): the persona chosen is the role the server holds this browser to, so
  // the demo turns down what that person couldn't do, as the live app will. None goes back to everything.
  // With it, who the persona stands in for (a member of staff, a head's department), so the demo reads as they would (ADR 0046).
  app.post<{ Body: { role?: unknown; personId?: unknown; department?: unknown } }>('/api/auth/preview', async (req, reply) => {
    reply.header('cache-control', 'no-store')
    if (!proof) return reply.code(404).send({ error: 'Only a demo copy can be seen as someone else.' })
    const role = asRole(req.body?.role)
    const preview = role && readPreview(writePreview({ role, personId: req.body?.personId as string, department: req.body?.department as string }))
    if (preview) setCookie(req, reply, PREVIEW_COOKIE, writePreview(preview), { maxAge: SESSION_DAYS * 86_400 })
    else clearCookie(req, reply, PREVIEW_COOKIE)
    // The freelancer is their page, not a role: the one with the most on it, found here, as a persona seen before may
    // have left this browser's copy without anyone's link (ADR 0046).
    if (req.body?.role === 'freelancer') return { role: null, link: await busiestLink(db) }
    return { role: role ?? null }
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
    if (proof) clearCookie(req, reply, PREVIEW_COOKIE)
    return { ok: true }
  })
}
