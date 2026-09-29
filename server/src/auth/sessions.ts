import { createHash, randomBytes } from 'node:crypto'
import { newId, type StaffUser } from '@sh/shared'
import type { Queryable } from '../db.ts'
import type { Identity } from './google.ts'

/**
 * A session lasts this long after the device was last used, so a phone
 * that is picked up every week or two never has to sign in again, while
 * one left in a drawer drops out on its own.
 */
export const SESSION_DAYS = 60

const hash = (token: string) => createHash('sha256').update(token).digest('hex')

/** Add or refresh a staff account from what Google says about it. */
export async function upsertUser(db: Queryable, id: Identity): Promise<{ id: string; disabled: boolean }> {
  const { rows } = await db.query<{ id: string; disabled: boolean }>(
    `INSERT INTO users (id, google_sub, email, name, picture) VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (google_sub) DO UPDATE
       SET email = EXCLUDED.email, name = EXCLUDED.name, picture = EXCLUDED.picture, last_sign_in_at = now()
     RETURNING id, disabled`,
    [newId(), id.subject, id.email, id.name, id.picture ?? null]
  )
  return rows[0]!
}

/** Start a session; the returned secret goes in the cookie and nowhere else. */
export async function createSession(db: Queryable, userId: string, userAgent: string): Promise<string> {
  const token = randomBytes(32).toString('base64url')
  await db.query("DELETE FROM sessions WHERE expires_at < now() - interval '30 days'")
  await db.query('INSERT INTO sessions (id, user_id, expires_at, user_agent) VALUES ($1, $2, now() + make_interval(days => $3::int), $4)', [
    hash(token),
    userId,
    SESSION_DAYS,
    userAgent,
  ])
  return token
}

/**
 * Who a session cookie belongs to: nobody if it is unknown, expired, or
 * the account has been switched off. Once a day of use, the expiry moves
 * forward and `renewed` says the cookie should be sent again to match.
 */
export async function sessionUser(db: Queryable, token: string): Promise<{ user: StaffUser; renewed: boolean } | undefined> {
  const { rows } = await db.query<{ id: string; email: string; name: string; picture: string | null; stale: boolean }>(
    `SELECT u.id, u.email, u.name, u.picture, s.last_seen_at < now() - interval '1 day' AS stale
     FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.id = $1 AND s.expires_at > now() AND NOT u.disabled`,
    [hash(token)]
  )
  const r = rows[0]
  if (!r) return undefined
  if (r.stale) {
    await db.query('UPDATE sessions SET last_seen_at = now(), expires_at = now() + make_interval(days => $2::int) WHERE id = $1', [hash(token), SESSION_DAYS])
  }
  return { user: { id: r.id, email: r.email, name: r.name, ...(r.picture ? { picture: r.picture } : {}) }, renewed: r.stale }
}

export async function endSession(db: Queryable, token: string) {
  await db.query('DELETE FROM sessions WHERE id = $1', [hash(token)])
}
