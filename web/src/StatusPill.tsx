import type { ReactNode } from 'react'

/**
 * The one status pill (audit finding 24): amber when someone has to act,
 * green when it's settled, grey when it's off, and the bad tone for a
 * clash, as the design system has them. Anything this device has changed
 * but the server hasn't yet taken says so, whatever its status, in a quiet
 * dashed grey: nobody has to act on it, so it isn't amber.
 */

export const WAITING_TO_SYNC = 'Waiting to sync'

export type PillTone = 'pending' | 'confirmed' | 'cancelled' | 'bad'

export function StatusPill({ tone, pending = false, children }: { tone: PillTone; pending?: boolean; children?: ReactNode }) {
  return <span className={`pill ${pending ? 'waiting' : tone}`}>{pending ? WAITING_TO_SYNC : children}</span>
}

/** The pill only while a change is still on its way; nothing otherwise. */
export function Pending({ pending }: { pending: boolean }) {
  return pending ? <StatusPill tone="pending" pending /> : null
}
