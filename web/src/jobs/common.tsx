import { newId, STATUS_LABELS, type ClientView, type ProjectStatus, type VenueView, type View } from '@sh/shared'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useNotDone } from '../problems.tsx'
import { StatusPill, type PillTone } from '../StatusPill.tsx'
import { client } from '../sync.ts'

/** What the Jobs screens share, and Stock and Crew too: the header, a record's page, and picking or adding a client or venue by name. */

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

/**
 * A record's page (a job, a product, an item, a place): on its own with the
 * top bar and a way back, or beside its list on a laptop (audit finding
 * 25), where the list is the way back, so just its cards.
 */
export function Page({ view, title, className, back, bare, children }: { view: View; title?: string; className: string; back: ReactNode; bare?: boolean; children: ReactNode }) {
  if (bare) return <>{children}</>
  return (
    <div className={`app ${className}`}>
      <Top view={view} title={title} />
      {back}
      {children}
    </div>
  )
}

/** On a laptop (audit finding 25): the list down the left, kept in view, with the open record beside it; `head` goes over both. */
export function Beside({
  view,
  title,
  className,
  head,
  list,
  open,
  children,
}: {
  view: View
  title?: string
  className: string
  head?: ReactNode
  list: ReactNode
  /** Which record is open, if any: another picked from the list starts at its top. */
  open?: string
  children: ReactNode
}) {
  // The window may be far down the last record, which would leave the next one's title out of sight; the list keeps its own place.
  const was = useRef(open)
  useEffect(() => {
    if (was.current === open) return
    was.current = open
    scrollTo(0, 0)
  }, [open])
  return (
    <div className={`app ${className} beside`}>
      <Top view={view} title={title} />
      {head}
      <div className="columns">
        <div className="column list">{list}</div>
        <div className="column open">{children}</div>
      </div>
    </div>
  )
}

export const STATUS_TONE: Record<ProjectStatus, PillTone> = {
  enquiry: 'pending',
  quoted: 'pending',
  confirmed: 'confirmed',
  cancelled: 'cancelled',
  lost: 'cancelled',
}

/** A job's status as a pill, "Waiting to sync" while this device's change is on its way. */
export function JobStatusPill({ status, pending }: { status: ProjectStatus; pending: boolean }) {
  return (
    <StatusPill tone={STATUS_TONE[status]} pending={pending}>
      {STATUS_LABELS[status]}
    </StatusPill>
  )
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
