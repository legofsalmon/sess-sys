import type { FastifyReply, FastifyRequest } from 'fastify'

/** PUBLIC_URL when set (behind Railway's proxy), otherwise what the request came in on. */
export function publicOrigin(req: FastifyRequest): string {
  if (process.env.PUBLIC_URL) return process.env.PUBLIC_URL.replace(/\/$/, '')
  const proto = (req.headers['x-forwarded-proto'] as string | undefined)?.split(',')[0] ?? req.protocol
  return `${proto}://${req.headers['x-forwarded-host'] ?? req.headers.host}`
}

export function readCookie(req: FastifyRequest, name: string): string | undefined {
  for (const part of (req.headers.cookie ?? '').split(';')) {
    const eq = part.indexOf('=')
    if (eq > 0 && part.slice(0, eq).trim() === name) {
      try {
        return decodeURIComponent(part.slice(eq + 1).trim())
      } catch {
        return undefined
      }
    }
  }
  return undefined
}

/**
 * Cookies here are always HttpOnly (page scripts never see them) and
 * SameSite=Lax, so another site can't make a browser send them with a
 * form post or a background request. Secure whenever the app is on https.
 */
export function setCookie(req: FastifyRequest, reply: FastifyReply, name: string, value: string, { maxAge, path = '/' }: { maxAge: number; path?: string }) {
  const parts = [`${name}=${encodeURIComponent(value)}`, `Path=${path}`, `Max-Age=${maxAge}`, 'HttpOnly', 'SameSite=Lax']
  if (publicOrigin(req).startsWith('https:')) parts.push('Secure')
  reply.header('set-cookie', parts.join('; '))
}

export function clearCookie(req: FastifyRequest, reply: FastifyReply, name: string, path = '/') {
  setCookie(req, reply, name, '', { maxAge: 0, path })
}
