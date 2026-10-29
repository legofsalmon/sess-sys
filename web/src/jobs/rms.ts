import type { RmsClientStats, RmsLastCharged, RmsOpportunity } from '@sh/shared'
import { useEffect, useState } from 'react'
import { markSignedOut } from '../auth.ts'

/**
 * Asking the server about Current RMS (ADR 0078, 0092). Its copy stays on
 * the server, too big and too private for every phone, so all of this needs
 * signal; with none it says so, or for a hint says nothing.
 */

const base = import.meta.env.VITE_API_BASE ?? ''

export type Loaded<T> = { state: 'loading' } | { state: 'offline' } | { state: 'gone'; error: string } | { state: 'ready'; data: T }

async function ask<T>(url: string, init?: RequestInit, ms = 15_000): Promise<Loaded<T>> {
  try {
    const res = await fetch(`${base}${url}`, { cache: 'no-store', signal: AbortSignal.timeout(ms), ...init })
    if (res.status === 401) {
      markSignedOut()
      return { state: 'offline' }
    }
    if (!res.ok) return { state: 'gone', error: ((await res.json().catch(() => ({}))) as { error?: string }).error ?? `The server answered ${res.status}.` }
    return { state: 'ready', data: (await res.json()) as T }
  } catch {
    return { state: 'offline' }
  }
}

export const getJson = <T>(url: string) => ask<T>(url)
/** A post; one asking Claude (ADR 0096) waits up to `ms` for its answer, longer than the 15 seconds anything else waits. */
export const postJson = <T>(url: string, body: unknown, ms?: number) => ask<T>(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }, ms)

/** Asked once each time the key changes, and again when `again` moves. */
export function useAsked<T>(on: boolean, key: string, asking: () => Promise<Loaded<T>>, again = 0): Loaded<T> {
  const [loaded, setLoaded] = useState<Loaded<T>>({ state: 'loading' })
  useEffect(() => {
    if (!on) return
    let live = true
    void asking().then((l) => live && setLoaded(l))
    return () => {
      live = false
    }
  }, [on, key, again])
  return loaded
}

export interface RmsJob {
  opportunities: Pick<RmsOpportunity, 'id' | 'number' | 'subject' | 'client' | 'state' | 'status' | 'startsAt' | 'endsAt' | 'netCents'>[]
  client: RmsClientStats | null
}

/** What a quote's lines were last charged, asked a moment after the names stop changing; empty without signal. */
export function useLastCharged(on: boolean, projectId: string, names: readonly string[]): RmsLastCharged {
  const key = [...new Set(names.map((n) => n.trim().toLowerCase()).filter(Boolean))].sort().join('\n')
  const [found, setFound] = useState<RmsLastCharged>({})
  useEffect(() => {
    if (!on || !key) return
    let live = true
    const t = setTimeout(() => {
      void postJson<RmsLastCharged>('/api/rms/last-charged', { projectId, names: key.split('\n') }).then((l) => live && l.state === 'ready' && setFound(l.data))
    }, 600)
    return () => {
      live = false
      clearTimeout(t)
    }
  }, [on, projectId, key])
  return found
}

/** "Won 7 of 10 · usually 5% off · last 3 Mar 2026": how a client's quotes went, in a line. */
export function clientWords(c: RmsClientStats): string {
  return [
    c.winPct === null ? `${c.quotes} quote${c.quotes === 1 ? '' : 's'}, none decided yet` : `Went ahead with ${c.ahead} of ${c.decided} (${c.winPct}%)`,
    c.discountPct ? `usually ${c.discountPct.toLocaleString('en-IE')}% off` : c.ahead ? 'usually no discount' : '',
    c.lastOn ? `last ${new Date(`${c.lastOn}T12:00:00Z`).toLocaleDateString('en-IE', { day: 'numeric', month: 'short', year: 'numeric' })}` : '',
  ]
    .filter(Boolean)
    .join(' · ')
}
