import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto'

/**
 * The key Google gives the app for the calendar is as good as a password to
 * the connected account's calendars, so it is stored locked (ADR 0008):
 * AES-256-GCM, with a key worked out from the app's Google client secret,
 * which lives only in the server's settings. A copy of the database or a
 * backup holds only the locked form. The account's Google id is bound in,
 * so a locked key can't be moved onto another account's row.
 */

const VERSION = 'v1'

function keyFrom(secret: string): Buffer {
  return Buffer.from(hkdfSync('sha256', secret, 'session-hire', 'calendar refresh token', 32))
}

export function seal(secret: string, plain: string, boundTo: string): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', keyFrom(secret), iv)
  cipher.setAAD(Buffer.from(boundTo))
  const body = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  return [VERSION, iv.toString('base64url'), body.toString('base64url'), cipher.getAuthTag().toString('base64url')].join('.')
}

/** The key, or undefined when it can't be unlocked: the Google secret has changed, or the text was altered. */
export function open(secret: string, sealed: string, boundTo: string): string | undefined {
  const [version, iv, body, tag] = sealed.split('.')
  if (version !== VERSION || !iv || !body || !tag) return undefined
  try {
    const decipher = createDecipheriv('aes-256-gcm', keyFrom(secret), Buffer.from(iv, 'base64url'))
    decipher.setAAD(Buffer.from(boundTo))
    decipher.setAuthTag(Buffer.from(tag, 'base64url'))
    return Buffer.concat([decipher.update(Buffer.from(body, 'base64url')), decipher.final()]).toString('utf8')
  } catch {
    return undefined
  }
}
