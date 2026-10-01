import { markSignedOut } from './auth.ts'
import { client } from './sync.ts'

/**
 * Asking the server for something outside the sync: the Google Calendar
 * connection (ADR 0008) and bringing jobs in from a calendar (ADR 0011).
 * These need signal; what goes wrong comes back in words to show.
 */

const base = import.meta.env.VITE_API_BASE ?? ''

/** The server's answer, or an error saying in words what went wrong. */
export async function ask<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response
  try {
    res = await fetch(`${base}${path}`, { cache: 'no-store', signal: AbortSignal.timeout(60_000), ...init })
  } catch {
    throw new Error("Couldn't reach the server. Try again when you have signal.")
  }
  if (res.status === 401) {
    markSignedOut()
    throw new Error('Signed out.')
  }
  if (res.status === 413) throw new Error('That is too big to send: up to 5 MB.')
  if (!res.ok) {
    const { error } = (await res.json().catch(() => ({}))) as { error?: string }
    throw new Error(error ?? `The server answered ${res.status}. Try again in a minute.`)
  }
  return (await res.json()) as T
}

/** The same, sending `body`, with this device's code for the history. */
export const post = <T,>(path: string, body?: unknown) =>
  ask<T>(`${path}?client=${encodeURIComponent(client.clientId)}`, {
    method: 'POST',
    ...(body === undefined ? {} : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
  })

/** The server's own address for a path, to send the browser to. */
export const serverUrl = (path: string) => `${base}${path}`
