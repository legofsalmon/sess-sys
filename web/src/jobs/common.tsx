import { newId, STATUS_LABELS, type ClientView, type ProjectStatus, type VenueView, type View } from '@sh/shared'
import { useEffect, useState } from 'react'
import { useNotDone } from '../problems.tsx'
import { client } from '../sync.ts'

/** What the Jobs screens share, and Stock and Crew too: the device's view, the header, and picking or adding a client or venue by name. */

export const today = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Dublin' })

export function useView(): View {
  const [view, setView] = useState(() => client.view())
  useEffect(() => client.subscribe(setView), [])
  return view
}

export function useHash(): string {
  const [hash, setHash] = useState(location.hash)
  useEffect(() => {
    const on = () => setHash(location.hash)
    addEventListener('hashchange', on)
    return () => removeEventListener('hashchange', on)
  }, [])
  return hash
}

/**
 * The top bar: the screen's name, what's waiting to sync, and what wasn't
 * done (audit finding 11), which counts every area's refusals and opens
 * the one list of them under the bar. The list is inside the header, so
 * the two stick to the top as one block and the list never covers the bar.
 */
export function Top({ view, title = 'Jobs' }: { view: View; title?: string }) {
  const waiting = view.pendingCount
  const notDone = useNotDone(view)
  return (
    <>
      <header className="top">
        <div className="brand">
          <span className="mark">SH</span>
          <span>
            <b>Session Hire</b>
            <small>
              {title}
              <MadeUp view={view} />
            </small>
          </span>
        </div>
        <div className="state">
          {notDone.count}
          <span className={`conn ${view.connection === 'offline' ? 'offline' : waiting ? 'syncing' : 'online'}`} role="status">
            {view.connection === 'offline' ? `No signal${waiting ? ` · ${waiting} waiting` : ''}` : waiting ? `${waiting} waiting` : 'Up to date'}
          </span>
        </div>
        {notDone.list}
      </header>
    </>
  )
}

/** Beside each screen's name while the app holds made-up data (ADR 0019), so nobody mistakes it for real work. */
export function MadeUp({ view }: { view: Pick<View, 'madeUp'> }) {
  return view.madeUp ? <span className="made-up"> · made-up data</span> : null
}

export const STATUS_TONE: Record<ProjectStatus, string> = {
  enquiry: 'pending',
  quoted: 'pending',
  confirmed: 'confirmed',
  cancelled: 'cancelled',
  lost: 'cancelled',
}

export function StatusPill({ status, pending }: { status: ProjectStatus; pending: boolean }) {
  return <span className={`pill ${pending ? 'pending' : STATUS_TONE[status]}`}>{pending ? 'Waiting to sync' : STATUS_LABELS[status]}</span>
}

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase()

/** The client with this name, added if there isn't one yet; null for no name. */
export async function clientNamed(name: string, clients: readonly ClientView[]): Promise<string | null> {
  if (!name.trim()) return null
  const found = clients.find((c) => same(c.name, name))
  if (found) return found.id
  const id = newId()
  await client.mutate('client.upsert', { id, name: name.trim(), contacts: [], notes: '' })
  return id
}

/** The venue with this name, added if there isn't one yet; null for no name. */
export async function venueNamed(name: string, venues: readonly VenueView[]): Promise<string | null> {
  if (!name.trim()) return null
  const found = venues.find((v) => same(v.name, name))
  if (found) return found.id
  const id = newId()
  await client.mutate('venue.upsert', { id, name: name.trim(), address: '', notes: '' })
  return id
}

/** The names to pick from as you type. */
export function Choices({ id, names }: { id: string; names: readonly { id: string; name: string }[] }) {
  return (
    <datalist id={id}>
      {names.map((n) => (
        <option key={n.id} value={n.name} />
      ))}
    </datalist>
  )
}
