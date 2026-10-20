import { createHash } from 'node:crypto'
import { redact } from '@sh/shared'
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

/**
 * How a request is written in the server's log, which Railway keeps: the
 * method and the path. The code in a private link or feed address is
 * masked, anything else that looks like a secret or an email address is
 * taken out, and the query string is left off, as it can hold a Google
 * sign-in code (ADR 0012).
 */
export function requestForLog(req: { method?: string; url?: string }) {
  return { method: req.method, url: pathForLog(req.url ?? '') }
}

export function pathForLog(url: string): string {
  const path = url.split(/[?#]/)[0]!
  return redact(path.replace(/(^|\/)(f|cal)\/[^/]+/g, '$1$2/:token'))
}

/** A script's hash as a content security policy names it. */
export const scriptHash = (script: string) => `'sha256-${createHash('sha256').update(script, 'utf8').digest('base64')}'`

/**
 * The content security policy of the server's own pages (audit finding 24): freelancers' pages, call sheets,
 * timesheets, documents and staff's sign-in. A second line behind the escaping, which already holds: nothing loads but
 * the page itself, its own style and the scripts named here by hash, and a form posts only back to this server.
 */
export function pagePolicy(scripts: readonly string[]): string {
  return [
    "default-src 'none'",
    "style-src 'unsafe-inline'",
    `script-src ${scripts.map(scriptHash).join(' ') || "'none'"}`,
    "img-src 'self' data:",
    "form-action 'self'",
    "base-uri 'none'",
    "frame-ancestors 'none'",
  ].join('; ')
}

/**
 * Sentry's own ingest addresses, where the app on each device reports to (ADR 0005), whichever region the project is
 * in. Fixed rather than read from SENTRY_DSN, so a device told of a new project before the server's policy is can still
 * report; a DSN at any other address is added to them.
 */
const SENTRY_INGEST = ['https://*.ingest.sentry.io', 'https://*.ingest.de.sentry.io', 'https://*.ingest.us.sentry.io']

/**
 * The app shell's content security policy (audit finding 24). What the app loads: its own files, the inline theme
 * script by hash, OpenStreetMap's tiles on the venue map (ADR 0057), images from data: and blob: addresses (labels'
 * codes, photos being added), its own service worker, and its error reports going to Sentry. Inline style attributes are
 * allowed, as React and Leaflet set them; nothing else inline. Google sign-in is a link to this server, which sends the
 * browser on, so it needs nothing here.
 */
export function appShellPolicy(scripts: readonly string[], dsn?: string): string {
  let reports = SENTRY_INGEST
  if (dsn) {
    try {
      const at = new URL(dsn)
      if (!/\.ingest\.(?:(?:de|us)\.)?sentry\.io$/.test(at.hostname)) reports = [...reports, at.origin]
    } catch {
      // A DSN that isn't an address is refused at start-up (monitoring.ts).
    }
  }
  return [
    "default-src 'self'",
    `script-src 'self' ${scripts.map(scriptHash).join(' ')}`.trim(),
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https://tile.openstreetmap.org",
    "media-src 'self' blob:",
    `connect-src 'self' ${reports.join(' ')}`,
    "worker-src 'self'",
    "manifest-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; ')
}

/** The scripts written inline in a page, such as the app shell's theme script, exactly as a hash of each must match. */
export function inlineScripts(html: string): string[] {
  return [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]!)
}
