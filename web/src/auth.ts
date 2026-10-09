import type { MeResponse, StaffUser } from '@sh/shared'
import { useEffect, useState } from 'react'

/**
 * Who is using this device, as far as it knows. The app never waits on
 * this to show the device's own data: with no signal it carries on with the
 * last answer the server gave. It only swaps to the sign-in page when the
 * server itself says this device isn't signed in.
 */
export type Auth =
  | { status: 'unknown' }
  /** The server hasn't got sign-in switched on, or (passcode) is a demo copy locked with a shared passcode. */
  | { status: 'open'; passcode?: true }
  | { status: 'signed-in'; user: StaffUser }
  | { status: 'signed-out'; passcode?: true }

const KEY = 'sh.auth'
const base = import.meta.env.VITE_API_BASE ?? ''
const listeners = new Set<(auth: Auth) => void>()
let current = load()

function load(): Auth {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Auth | null
    if (saved?.status === 'open' || saved?.status === 'signed-in' || saved?.status === 'signed-out') return saved
  } catch {
    // Nothing saved, or storage is blocked: find out from the server.
  }
  return { status: 'unknown' }
}

function set(next: Auth) {
  current = next
  try {
    localStorage.setItem(KEY, JSON.stringify(next))
  } catch {
    // Private browsing can refuse storage; the app still works this session.
  }
  for (const fn of listeners) fn(next)
}

export function useAuth(): Auth {
  const [auth, setAuth] = useState(current)
  useEffect(() => {
    listeners.add(setAuth)
    setAuth(current)
    return () => void listeners.delete(setAuth)
  }, [])
  return auth
}

/** Ask the server who this device is signed in as. With no signal, keep what we knew. */
export async function checkAuth() {
  try {
    const res = await fetch(`${base}/api/me`, { cache: 'no-store', signal: AbortSignal.timeout(8_000) })
    if (res.status === 401) {
      const body = (await res.json().catch(() => ({}))) as { auth?: string }
      return set(body.auth === 'passcode' ? { status: 'signed-out', passcode: true } : { status: 'signed-out' })
    }
    if (!res.ok) return
    const me = (await res.json()) as MeResponse
    set(me.auth === 'off' ? { status: 'open' } : me.auth === 'passcode' ? { status: 'open', passcode: true } : { status: 'signed-in', user: me.user })
  } catch {
    // No signal or server down: carry on as before.
  }
}

/** The server turned a sync away because this device isn't signed in (any more). */
export function markSignedOut() {
  if (current.status === 'signed-out') return
  set(current.status === 'open' && current.passcode ? { status: 'signed-out', passcode: true } : { status: 'signed-out' })
  // A demo copy's passcode may have changed; the server says which way in it wants.
  void checkAuth()
}

/** A demo copy's shared passcode. Needs signal. Says what went wrong, or nothing when it worked. */
export async function enterPasscode(passcode: string): Promise<string | undefined> {
  try {
    const res = await fetch(`${base}/api/auth/passcode`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ passcode }),
      signal: AbortSignal.timeout(8_000),
    })
    if (res.status === 403) return "That passcode isn't right."
    if (!res.ok) return `The server answered ${res.status}. Please try again.`
  } catch {
    return "Couldn't reach the server. Check the signal and try again."
  }
  await checkAuth()
  return undefined
}

export const signInUrl = (area: string) => `${base}/api/auth/google/start?next=${encodeURIComponent(area)}`

/** Needs signal: the server has to forget the session. */
export async function signOut() {
  const res = await fetch(`${base}/api/auth/signout`, { method: 'POST', signal: AbortSignal.timeout(8_000) })
  if (!res.ok) throw new Error(`Server answered ${res.status}`)
  set({ status: 'signed-out' })
}

/**
 * Why the last sign-in didn't work, if it didn't. The server says so in the
 * address it sends the browser back to; it is read once and tidied away.
 */
export const signInProblem = (() => {
  const params = new URLSearchParams(location.search)
  const problem = params.get('signin')
  if (!problem) return undefined
  params.delete('signin')
  const query = params.toString()
  history.replaceState(null, '', `${location.pathname}${query ? `?${query}` : ''}${location.hash}`)
  return problem === 'denied' || problem === 'cancelled' ? problem : 'failed'
})()

void checkAuth()
addEventListener('online', () => void checkAuth())
