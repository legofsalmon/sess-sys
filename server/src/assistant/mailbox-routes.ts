import { createHash, randomBytes } from 'node:crypto'
import type { MailboxStatus, MailThread } from '@sh/shared'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { faultForLog } from '../db.ts'
import { clearCookie, publicOrigin, readCookie, setCookie } from '../http.ts'
import { seal } from '../calendar/crypto.ts'
import type { Google } from '../calendar/google.ts'
import { GMAIL_SCOPES } from './gmail.ts'
import type { Mailbox } from './mailbox.ts'

/**
 * Connecting the operations mailbox under Admin › Company (ADR 0098): off
 * to Google to sign in as operations@ and let the app read its mail, back
 * again, and disconnect; and what Claude read, for Quotes and each job's
 * quote. Connecting is for those who change settings; reading what Claude
 * read is money, like the rest of Claude.
 */

const ATTEMPT_COOKIE = 'sh_mailbox'
const ATTEMPT_PATH = '/api/assistant/mailbox'

type Outcome = 'connected' | 'cancelled' | 'failed' | 'missing' | 'off'

export function registerMailboxRoutes(app: FastifyInstance, { mailbox, google, secret }: { mailbox: Mailbox; google: Google | undefined; secret: string | undefined }) {
  const callbackUrl = (req: FastifyRequest) => `${publicOrigin(req)}/api/assistant/mailbox/callback`
  const back = (reply: FastifyReply, outcome: Outcome) => reply.redirect(`/?mailbox=${outcome}#admin`, 303)

  app.get('/api/assistant/mailbox', { config: { needs: 'money' } }, async (_req, reply): Promise<MailboxStatus> => {
    reply.header('cache-control', 'no-store')
    return mailbox.status()
  })

  app.get('/api/assistant/mailbox/connect', { config: { needs: 'settings' } }, async (req, reply) => {
    reply.header('cache-control', 'no-store')
    if (!google || !secret) return back(reply, 'off')
    const state = randomBytes(16).toString('base64url')
    const verifier = randomBytes(32).toString('base64url')
    setCookie(req, reply, ATTEMPT_COOKIE, [state, verifier].join('.'), { maxAge: 600, path: ATTEMPT_PATH })
    const codeChallenge = createHash('sha256').update(verifier).digest('base64url')
    return reply.redirect(google.authorizeUrl({ state, codeChallenge, redirectUri: callbackUrl(req), loginHint: 'operations@sessionhire.com', scopes: GMAIL_SCOPES }), 302)
  })

  app.get<{ Querystring: { code?: string; state?: string; error?: string } }>('/api/assistant/mailbox/callback', { config: { needs: 'settings' } }, async (req, reply) => {
    reply.header('cache-control', 'no-store')
    if (!google || !secret) return back(reply, 'off')
    const [state, verifier] = (readCookie(req, ATTEMPT_COOKIE) ?? '').split('.')
    clearCookie(req, reply, ATTEMPT_COOKIE, ATTEMPT_PATH)
    if (req.query.error) return back(reply, req.query.error === 'access_denied' ? 'cancelled' : 'failed')
    // The state must match the one this browser left with, or someone is trying to connect their own mailbox here.
    if (!state || !verifier || !req.query.code || req.query.state !== state) return back(reply, 'failed')
    let connected
    try {
      connected = await google.exchange({ code: req.query.code, codeVerifier: verifier, redirectUri: callbackUrl(req) })
    } catch (err) {
      req.log.warn({ err: faultForLog(err) }, 'Connecting the operations mailbox failed')
      return back(reply, 'failed')
    }
    if (!GMAIL_SCOPES.every((s) => connected.scopes.includes(s)) || !connected.refreshToken) {
      await google.revoke(connected.refreshToken ?? connected.accessToken)
      return back(reply, connected.refreshToken ? 'missing' : 'failed')
    }
    const { identity } = connected
    await mailbox.connected({ email: identity.email, sub: identity.subject, sealedKey: seal(secret, connected.refreshToken, identity.subject), by: req.user?.id ?? null })
    return back(reply, 'connected')
  })

  app.post('/api/assistant/mailbox/disconnect', { config: { needs: 'settings' } }, async (_req, reply): Promise<MailboxStatus> => {
    reply.header('cache-control', 'no-store')
    await mailbox.disconnect()
    return mailbox.status()
  })

  /** What Claude read: the threads with mail in the last month, or a job's. */
  app.get<{ Querystring: { projectId?: string } }>('/api/assistant/mail', { config: { needs: 'money' } }, async (req, reply): Promise<{ threads: MailThread[] }> => {
    reply.header('cache-control', 'no-store')
    const projectId = typeof req.query.projectId === 'string' && req.query.projectId ? req.query.projectId.slice(0, 64) : undefined
    return { threads: await mailbox.threads(projectId) }
  })

  /** The changes a thread's mail asks for were taken or left on the quote. */
  app.post<{ Params: { id: string } }>('/api/assistant/mail/:id/done', { config: { needs: 'money' } }, async (req, reply) => {
    if (!(await mailbox.adviceDone(req.params.id.slice(0, 200)))) return reply.code(404).send({ error: 'That thread has gone.' })
    return { ok: true }
  })
}
