import type { Queryable } from '../db.ts'
import { googleProvider, type Identity, type IdentityProvider } from './google.ts'

/**
 * Who may sign in. Staff are the Google Workspace accounts of the listed
 * domains (sessionhire.com unless told otherwise), plus any single accounts
 * listed by email, such as a tester outside the company.
 */
export interface AuthConfig {
  provider: IdentityProvider
  domains: string[]
  emails: string[]
}

const list = (s: string | undefined) =>
  (s ?? '')
    .split(',')
    .map((x) => x.trim().toLowerCase())
    .filter(Boolean)

/**
 * Sign-in is on when the Google client id and secret are set (Railway
 * variables GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET), and off otherwise.
 * STAFF_DOMAINS and STAFF_EMAILS, comma-separated, say who counts as staff.
 */
export function authFromEnv(env: NodeJS.ProcessEnv = process.env): AuthConfig | undefined {
  const clientId = env.GOOGLE_CLIENT_ID?.trim()
  const clientSecret = env.GOOGLE_CLIENT_SECRET?.trim()
  if (!clientId && !clientSecret) return undefined
  if (!clientId || !clientSecret) throw new Error('Set both GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET, or neither.')
  const domains = list(env.STAFF_DOMAINS ?? 'sessionhire.com')
  const emails = list(env.STAFF_EMAILS)
  if (domains.length === 0 && emails.length === 0) throw new Error('STAFF_DOMAINS and STAFF_EMAILS are both empty, so nobody could sign in.')
  // Google's account picker can be narrowed to one company's accounts, but
  // only when nobody from outside it is allowed in.
  const hostedDomain = domains.length === 1 && emails.length === 0 ? domains[0] : undefined
  return { provider: googleProvider({ clientId, clientSecret, hostedDomain }), domains, emails }
}

/**
 * The Google client for the calendar sync (ADR 0008): the same one as
 * sign-in, so the calendar is available exactly when sign-in is on.
 */
export function googleClientFromEnv(env: NodeJS.ProcessEnv = process.env): { clientId: string; clientSecret: string } | undefined {
  const clientId = env.GOOGLE_CLIENT_ID?.trim()
  const clientSecret = env.GOOGLE_CLIENT_SECRET?.trim()
  return clientId && clientSecret ? { clientId, clientSecret } : undefined
}

/**
 * A shared passcode in front of the app (DEMO_PASSCODE), for a demo copy
 * with made-up data before Google sign-in is set up. Only used when Google
 * sign-in is off: once the Google keys are in, they decide who gets in.
 */
export function passcodeFromEnv(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const passcode = env.DEMO_PASSCODE?.trim()
  if (!passcode) return undefined
  if (passcode.length < 8) throw new Error('DEMO_PASSCODE is too short: use at least 8 characters.')
  return passcode
}

/**
 * Staff means a verified address that is either listed by itself or on a
 * Workspace account of a listed domain. The domain comes from Google's `hd`
 * claim, not the email's ending: a personal Google account can be made
 * with any address, but only the company's Workspace can issue its `hd`.
 */
export function isStaff(auth: AuthConfig, id: Identity): boolean {
  if (!id.emailVerified) return false
  if (auth.emails.includes(id.email)) return true
  return id.hostedDomain !== undefined && auth.domains.includes(id.hostedDomain)
}

/**
 * Once anyone has signed in, running without sign-in is a mistake (a lost
 * variable, or a copy of the service without its secrets) rather than a
 * choice, so the server refuses to start. AUTH_MODE=open is the way to
 * switch sign-in off on purpose.
 */
export async function assertSignInKept(db: Queryable, auth: AuthConfig | undefined, env: NodeJS.ProcessEnv = process.env) {
  if (auth || env.AUTH_MODE === 'open') return
  const { rows } = await db.query<{ n: string }>('SELECT count(*) AS n FROM users')
  const n = Number(rows[0]?.n ?? 0)
  if (n > 0) {
    throw new Error(
      `Sign-in has been used on this database (${n} staff account${n === 1 ? '' : 's'}), but GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET are not set. ` +
        'Refusing to start without sign-in. Set them again, or set AUTH_MODE=open to run without sign-in on purpose.'
    )
  }
}
