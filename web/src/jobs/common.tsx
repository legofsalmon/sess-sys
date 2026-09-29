import { newId, STATUS_LABELS, type ClientView, type ProjectStatus, type VenueView, type View } from '@sh/shared'
import { useEffect, useState } from 'react'
import { client } from '../sync.ts'

/** What the Jobs screens share: the device's view, the header, and picking or adding a client or venue by name. */

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

export function Top({ view }: { view: View }) {
  const waiting = view.pendingCount
  return (
    <header className="top">
      <div className="brand">
        <span className="mark">SH</span>
        <span>
          <b>Session Hire</b>
          <small>Jobs</small>
        </span>
      </div>
      <span className={`conn ${view.connection === 'offline' ? 'offline' : waiting ? 'syncing' : 'online'}`} role="status">
        {view.connection === 'offline' ? `No signal${waiting ? ` · ${waiting} waiting` : ''}` : waiting ? `${waiting} waiting` : 'Up to date'}
      </span>
    </header>
  )
}

/** Changes to jobs the server turned down, with its reason, until dismissed. */
export function NotDone({ view }: { view: View }) {
  const problems = view.problems.filter((p) => /^(client|venue|project|phase|call)\./.test(p.mutation.name))
  if (problems.length === 0) return null
  return (
    <section className="card attention">
      <h2>Not done</h2>
      {problems.map((p) => (
        <div className="row" key={p.mutation.id}>
          <p>{p.reason.message}</p>
          <button type="button" onClick={() => client.dismissProblem(p.mutation.id)}>
            Dismiss
          </button>
        </div>
      ))}
    </section>
  )
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
