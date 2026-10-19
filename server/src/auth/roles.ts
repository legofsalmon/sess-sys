import { roleForEmail, type Role, type RolePerson } from '@sh/shared'
import { HAS_EMAIL } from '../crew/store.ts'
import type { Queryable } from '../db.ts'

/**
 * The role a signed-in account acts with (ADR 0034), read fresh on every
 * request so a change a director makes counts at once: the people who
 * could decide it (the directors, and whoever has the account's email)
 * are read, and the shared rule decides, as a device does with its copy.
 * With it, who they are on the Crew tab and their department, which decide
 * what they read of rates and links (ADR 0046).
 */
export async function roleOfAccount(q: Queryable, email: string): Promise<{ role: Role; on: boolean; personId?: string; department?: string | null }> {
  const { rows } = await q.query<RolePerson & { department: string | null }>(
    `SELECT id, kind, email, other_emails AS "otherEmails", archived, role, department FROM people
     WHERE (role = 'director' AND kind = 'staff' AND NOT archived) OR ${HAS_EMAIL('$1')}`,
    [email.trim().toLowerCase()]
  )
  const { role, on, personId } = roleForEmail(rows, email)
  const me = personId ? rows.find((r) => r.id === personId) : undefined
  return { role, on, ...(personId ? { personId, department: me?.department ?? null } : {}) }
}
