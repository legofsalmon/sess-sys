import { hasEmail } from '@sh/shared'
import type { FastifyInstance } from 'fastify'
import type { Db } from '../db.ts'
import { renderStaffSignIn, type StaffSignIn } from '../crew/page.ts'
import { personByToken } from '../crew/store.ts'
import { officeFor } from '../office/store.ts'
import { roleOfAccount } from './roles.ts'
import { signedInStaff } from './routes.ts'

/** Calendar apps fetch it on their own and can't sign in, so it stays the read-only feed it always was (ADR 0012). */
const FEED = '/f/:token/calendar.ics'
const SAID = ['cancelled', 'failed', 'denied'] as const

/**
 * Google is the only way in for staff (ADR 0052). A freelancer's link is
 * still their whole credential (ADR 0002), but a member of staff's link
 * (/f/<token>, and everything under it but the calendar feed) opens only
 * for a Google sign-in: their own, matched by email as roles are, or the
 * office's, a director's or a system admin's (ADR 0059) once roles are
 * on, or anyone's while they are off, as the app itself is then open to
 * every member of staff. Only when Google sign-in is on: a demo copy and a local server keep links as
 * they were.
 */
export function guardStaffPages(app: FastifyInstance, db: Db, admins?: readonly string[]) {
  app.addHook('onRequest', async (req, reply) => {
    const url = req.routeOptions.url
    if (!url?.startsWith('/f/:token') || url === FEED) return
    const token = (req.params as { token?: string }).token ?? ''
    const person = await personByToken(db.reads, token)
    if (!person || person.kind !== 'staff') return
    const user = await signedInStaff(db, req, reply)
    if (user) {
      const email = user.email.trim().toLowerCase()
      if (hasEmail(person, email)) return
      const { role, on } = await roleOfAccount(db.reads, email, admins)
      if (!on || role === 'director' || role === 'office') return
    }
    const asked = (req.query as { signin?: string } | undefined)?.signin
    const said: StaffSignIn = user ? { why: 'not-theirs', as: user.email } : { why: SAID.find((s) => s === asked) ?? 'sign-in' }
    const start = `/api/auth/google/start?${new URLSearchParams({ next: `/f/${person.linkToken}` })}`
    return reply
      .code(user ? 403 : 401)
      .header('cache-control', 'no-store')
      .type('text/html')
      .send(renderStaffSignIn(person.name, start, said, await officeFor(db.reads)))
  })
}
