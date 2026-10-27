import { newId, STATUS_LABELS, type ClientView, type ProjectStatus, type VenueView, type View } from '@sh/shared'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useSeenAs } from '../home/Preview.tsx'
import { useNotDone } from '../problems.tsx'
import { NoticesButton } from '../NoticesButton.tsx'
import { OnThisScreen } from '../OnThisScreen.tsx'
import { StatusPill, type PillTone } from '../StatusPill.tsx'
import { client } from '../sync.ts'
import { ThemeButton } from '../ThemeButton.tsx'
import { Up, type Trail } from '../Up.tsx'

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
/**
 * The bar at the top of every screen: the company's mark and name, the
 * sync state and dark or light (ADR 0036); after it, the parts of the
 * screen (ADR 0033), which put themselves on the parts. Under the name, the area; on the demo copy, whose
 * eyes it's seen through instead, the name taking you back to choose
 * again. On an area's own screen (`root`) the area's name follows as the
 * screen's title, so Jobs, Stock and Crew read as different places; a
 * record's page has its own title instead. `aside` goes top right, before
 * the sync state: Home's date. Every page under an area's own screen has
 * `up`, the way back up to it (Up.tsx), in the bar so it stays in view.
 */
export function Top({ view, title = 'Jobs', root = false, aside, up }: { view: View; title?: string; root?: boolean; aside?: ReactNode; up?: Trail }) {
  const waiting = view.pendingCount
  const notDone = useNotDone(view)
  const seenAs = useSeenAs()
  return (
    <>
      <header className="top">
        <div className="brand">
          <span className="mark">SH</span>
          <span>
            <b>Session Hire</b>
            {seenAs ? (
              <small className="seen-as">
                Seeing it as{' '}
                <a href="#preview" aria-label={`${seenAs.name}: choose someone else`}>
                  {seenAs.name}
                </a>
                <MadeUp view={view} />
              </small>
            ) : (
              <small className="where">
                {title}
                <MadeUp view={view} />
              </small>
            )}
          </span>
        </div>
        <div className="state">
          {aside}
          {notDone.count}
          <span className={`conn ${view.connection === 'offline' ? 'offline' : waiting || view.copying ? 'syncing' : 'online'}`} role="status">
            {connWords(view)}
          </span>
          <NoticesButton />
          <ThemeButton />
        </div>
        {up && <Up {...up} />}
        {notDone.list}
      </header>
      {root && <h1 className="area-title">{title}</h1>}
      <OnThisScreen />
    </>
  )
}

/**
 * The top bar's word for the connection. "Up to date" only once the copy has
 * arrived in full: before that, "Catching up" with how far it has got, so a
 * new phone's counts aren't vouched for while they're still climbing (audit,
 * 20 October 2026, finding 1).
 */
export function connWords(view: Pick<View, 'connection' | 'pendingCount' | 'copying'>): string {
  const waiting = view.pendingCount
  const share = view.copying && view.copying.share !== undefined ? ` · ${Math.floor(view.copying.share * 100)}%` : ''
  if (view.connection === 'offline') return `No signal${view.copying ? ' · not caught up' : ''}${waiting ? ` · ${waiting} waiting` : ''}`
  if (view.copying) return `Catching up${share}`
  return waiting ? `${waiting} waiting` : 'Up to date'
}

/** Beside each screen's name while the app holds made-up data (ADR 0019), so nobody mistakes it for real work. */
export function MadeUp({ view }: { view: Pick<View, 'madeUp'> }) {
  return view.madeUp ? <span className="made-up"> · made-up data</span> : null
}

/**
 * A record's page (a job, a product, an item, a place): on its own with the
 * top bar and the way up, or beside its list on a laptop (audit finding
 * 25), where the list's screen draws the bar, so just its cards.
 */
export function Page({ view, title, className, up, bare, children }: { view: View; title?: string; className: string; up: Trail; bare?: boolean; children: ReactNode }) {
  if (bare) return <>{children}</>
  return (
    <div className={`app ${className}`}>
      <Top view={view} title={title} up={up} />
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
  up,
  children,
}: {
  view: View
  title?: string
  className: string
  head?: ReactNode
  list: ReactNode
  /** Which record is open, if any: another picked from the list starts at its top. */
  open?: string
  /** The open record's breadcrumbs: the list beside it is its way back, so on a desk they only say where it is. */
  up?: Trail
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
      <Top view={view} title={title} root={!open} up={open ? up : undefined} />
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
