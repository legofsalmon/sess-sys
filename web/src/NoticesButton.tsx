import type { View } from '@sh/shared'
import { useEffect } from 'react'
import { useAuth } from './auth.ts'
import { Icon } from './Icon.tsx'
import { loadNotices, unreadCount, useNotices } from './notices.ts'

/** Top right, before dark and light: the count is of things waiting for you, so it's the accent, and said in words to a screen reader. */
export function NoticesButton({ view }: { view: View }) {
  const auth = useAuth()
  const notices = useNotices()
  // Signed in after the app opened, or back from the sign-in page: look now rather than at the next change.
  useEffect(() => void loadNotices(), [auth.status])
  if (auth.status !== 'signed-in' && auth.status !== 'open') return null
  // Lines, not changes (audit, 20 October 2026, finding 68): a bulk change, or a day's changes to one job, count once.
  const n = unreadCount(notices, view)
  const words = n === 0 ? 'Notifications' : `Notifications, ${n} new`
  return (
    <a
      className="notices-button"
      href="#notifications"
      aria-label={words}
      title={words}
      aria-current={location.hash === '#notifications' ? 'page' : undefined}
    >
      <Icon name="notifications" />
      {n > 0 && (
        <span className="badge" aria-hidden="true">
          {n > 99 ? '99+' : n}
        </span>
      )}
    </a>
  )
}
