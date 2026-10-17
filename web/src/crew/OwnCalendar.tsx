import { dayLabel, firstName, tidyCalendarAddress, type OwnCalendar, type PersonView, type View } from '@sh/shared'
import { useState, type FormEvent } from 'react'
import { Confirm, Refusal, useAct } from '../act.tsx'
import { Empty } from '../Empty.tsx'
import { Fold, ShowAll } from '../Fold.tsx'
import { Heading } from '../Icon.tsx'
import { useAccess } from '../role.ts'
import { post } from '../server.ts'
import { Pending } from '../StatusPill.tsx'
import { client } from '../sync.ts'
import { useToday } from '../view.ts'

/**
 * A person's own calendar on their page (ADR 0044), read only: whether
 * they share when they're busy, when it was last read, the busy days
 * coming up, and for the office, adding the address they sent, reading it
 * again now and stopping. The address itself never comes back to a
 * device; only the server holds it.
 */

/** Read today, or the day it last was, in Ireland. */
function readLine(cal: OwnCalendar, today: string): string {
  if (!cal.readAt) return 'not read yet'
  const day = new Date(cal.readAt).toLocaleDateString('sv-SE', { timeZone: 'Europe/Dublin' })
  return day === today ? 'last read today' : `last read ${dayLabel(day)}`
}

export function OwnCalendarCard({ person, view }: { person: PersonView; view: View }) {
  const cal = view.ownCalendars.of(person.id)
  const mayEdit = useAccess().can('crew') && !person.archived
  const today = useToday()
  const { run, error, refuse } = useAct()
  const [address, setAddress] = useState('')
  const [reading, setReading] = useState(false)
  const [stopping, setStopping] = useState(false)
  const first = firstName(person)
  if (!cal && person.archived) return null

  const share = (e: FormEvent) => {
    e.preventDefault()
    // Said here, in the server's words, before anything is sent.
    const tidy = tidyCalendarAddress(address)
    if ('reason' in tidy) return refuse(tidy.reason)
    setReading(true)
    void run(() => post(`/api/own-calendars/${encodeURIComponent(person.id)}`, { address: tidy.address })).then((ok) => {
      setReading(false)
      // The address isn't kept on this device once it's with the server.
      if (ok) setAddress('')
    })
  }
  const readNow = () => {
    setReading(true)
    void run(() => post(`/api/own-calendars/${encodeURIComponent(person.id)}/read`)).then(() => setReading(false))
  }

  const promise = "Only when they're busy is kept: never what, where or who with, and nothing is written to their calendar."
  const busy = cal ? [...view.ownCalendars.busyOn(person.id)].filter(([day]) => day >= today) : []
  return (
    <section className="card own-calendar" aria-label="Their own calendar">
      <Heading icon="calendar">Their own calendar</Heading>
      {!cal && (
        <>
          <p className="hint">
            {first} hasn't shared when they're busy. They can from their link, by pasting their calendar's private address, or send it to you to add here. {promise}
          </p>
          {mayEdit && (
            <Fold label="Add the address they sent">
              <form className="share-calendar" onSubmit={share}>
                <label className="field wide">
                  Their calendar's private address
                  <input
                    value={address}
                    onChange={(e) => setAddress(e.target.value)}
                    inputMode="url"
                    autoComplete="off"
                    autoCapitalize="off"
                    spellCheck={false}
                    placeholder="e.g. webcal://… or https://….ics"
                  />
                </label>
                <p className="hint wide">It's read now, so a wrong address is said here. Then every few hours, on its own.</p>
                <button type="submit" className="primary" aria-busy={reading || undefined} disabled={reading}>
                  {reading ? 'Reading their calendar…' : 'Read their calendar'}
                </button>
              </form>
            </Fold>
          )}
        </>
      )}
      {cal && (
        <>
          <p className="hint">
            {cal.addedBy === 'self' ? 'Shared by them, from their link' : 'Added by the office, with the address they sent'}, {readLine(cal, today)}. Busy days show in the planner and when
            offering them work, as a warning: they may still say yes. {promise}
          </p>
          <Pending pending={cal.stopping} />
          {cal.problem && !cal.stopping && (
            <p className="warn-line">
              It couldn't be read last time, so these are from the read before. Their link tells them: “{cal.problem}”
            </p>
          )}
          {!cal.stopping &&
            (busy.length === 0 ? (
              <Empty>Nothing busy in the next four months.</Empty>
            ) : (
              <ShowAll items={busy} limit={10} what="busy days">
                {(rows) => (
                  <ul className="busy-days">
                    {rows.map(([day, words]) => (
                      <li key={day}>
                        <b>{dayLabel(day)}</b> <span className="muted">busy {words}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </ShowAll>
            ))}
          {mayEdit && !cal.stopping && !stopping && (
            <div className="actions">
              <button type="button" onClick={readNow} aria-busy={reading || undefined} disabled={reading}>
                {reading ? 'Reading it…' : 'Read it now'}
              </button>
              <button type="button" className="link" onClick={() => setStopping(true)}>
                Stop reading it
              </button>
            </div>
          )}
          {stopping && (
            <Confirm
              question={`Stop reading ${person.name}'s calendar? Its address and busy times are deleted here. To read it again, they share it again or send you the address.`}
              yes="Stop reading it"
              no="Keep reading it"
              onYes={() => {
                setStopping(false)
                void run(() => client.mutate('ownCalendar.stop', { personId: person.id }))
              }}
              onNo={() => setStopping(false)}
            />
          )}
        </>
      )}
      <Refusal error={error} />
    </section>
  )
}
