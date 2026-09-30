import type { View } from '@sh/shared'
import { useState } from 'react'
import { useFeedAddress, webcal } from './crew/feed.ts'

/**
 * Staff who also work jobs get their own bookings in their own calendar
 * (ADR 0012): the read-only feed of the person in Crew with the same email
 * address as the account they are signed in with.
 */
export function FeedCard({ view, email }: { view: View; email: string }) {
  const me = view.crew.people.find((p) => p.email?.trim().toLowerCase() === email.trim().toLowerCase())
  const address = useFeedAddress(me?.linkToken)
  const [copied, setCopied] = useState('')
  if (!me || !address) return null

  return (
    <section className="card feed" aria-labelledby="feed-title">
      <h2 id="feed-title">Your bookings in your own calendar</h2>
      <p>
        Every job you're booked on, in Google, Apple or Outlook Calendar, kept up to date. It only shows your bookings, so it's fine in a calendar you share.
      </p>
      <input readOnly value={address} aria-label="Calendar address" onFocus={(e) => e.target.select()} />
      <div className="actions">
        <a className="button" href={webcal(address)}>
          Subscribe
        </a>
        <button type="button" onClick={() => void navigator.clipboard?.writeText(address).then(() => setCopied(address))}>
          {copied === address ? 'Copied' : 'Copy address'}
        </button>
      </div>
      <p className="hint">
        Subscribe works on an iPhone, a Mac and in Outlook. For Google Calendar, copy the address and add it on a computer, under Other calendars, From URL. If
        our Google Calendar invites already reach you, you don't need it as well.
      </p>
    </section>
  )
}
