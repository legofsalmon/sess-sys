import { roleForEmail, type Role, type RolePerson } from '@sh/shared'
import type { Queryable } from '../db.ts'

/**
 * The role a signed-in account acts with (ADR 0034), read fresh on every
 * request so a change a director makes counts at once: the people who
 * could decide it (the directors, and whoever has the account's email)
 * are read, and the shared rule decides, as a device does with its copy.
 */
export async function roleOfAccount(q: Queryable, email: string): Promise<{ role: Role; on: boolean }> {
  const { rows } = await q.query<RolePerson>(
    `SELECT id, kind, email, archived, role FROM people
     WHERE (role = 'director' AND kind = 'staff' AND NOT archived) OR lower(trim(email)) = $1`,
    [email.trim().toLowerCase()]
  )
  const { role, on } = roleForEmail(rows, email)
  return { role, on }
}
