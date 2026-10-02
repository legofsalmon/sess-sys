import {
  blocks,
  CERTIFICATE_KINDS,
  CERTIFICATE_LABELS,
  CERTIFICATE_SOON_DAYS,
  certificateGaps,
  certificateName,
  certificateReminders,
  gapSentence,
  needsOf,
  reminderLine,
  renewalMessage,
  tidyNeeds,
  type CallView,
  type CertificateKind,
  type CertificateReminder,
  type PersonView,
  type View,
} from '@sh/shared'
import { useState } from 'react'
import { ShowAll } from '../Fold.tsx'
import { useToday } from '../view.ts'
import { SendButtons } from './CrewScreen.tsx'

/**
 * Certificates on the Crew tab (ADR 0028): the ticks for what a call
 * needs, the warnings on a call's line for anyone on it short of one, and
 * the list of certificates running out, each with a message asking for the
 * renewed card.
 */

/** What a call needs: a tick for each kind, in a row that wraps. */
export function NeedsField({ value, onChange }: { value: readonly CertificateKind[]; onChange: (needs: CertificateKind[]) => void }) {
  return (
    <fieldset className="needs wide">
      <legend>Certificates needed</legend>
      <div>
        {CERTIFICATE_KINDS.map((kind) => (
          <label key={kind}>
            <input type="checkbox" checked={value.includes(kind)} onChange={(e) => onChange(tidyNeeds(e.target.checked ? [...value, kind] : value.filter((k) => k !== kind)))} />
            {CERTIFICATE_LABELS[kind]}
          </label>
        ))}
      </div>
    </fieldset>
  )
}

/**
 * Anyone on a call short of a certificate it needs, at rest on the call's
 * line: offered, asking a rate, accepted or booked. Nobody is taken off;
 * the office sorts it out with the person.
 */
export function certificateWarnings(call: CallView, today: string): string[] {
  const needs = needsOf(call)
  if (!needs.length || call.status !== 'open') return []
  return call.offers.flatMap((o) =>
    o.person && ['offered', 'countered', 'accepted', 'confirmed'].includes(o.status)
      ? certificateGaps(o.person, needs, o.days, today)
          .filter(blocks)
          .map((g) => gapSentence(o.person!.name, g, o.days, today))
      : []
  )
}

/**
 * Certificates run out, or running out in the next 30 days, soonest first
 * (ADR 0028). Nothing while there are none. Not on the Crew badge: they're
 * known weeks ahead, and a badge always lit stops being read.
 */
export function CertificateReminders({ view }: { view: View }) {
  const today = useToday()
  const reminders = certificateReminders(view.crew.people, today)
  const [asking, setAsking] = useState<CertificateReminder<PersonView> | undefined>()
  if (!reminders.length) return null
  const key = (r: CertificateReminder<PersonView>) => `${r.person.id} ${r.kind}`
  return (
    <section className="card reminders" aria-label="Certificates running out">
      <h2>Certificates running out ({reminders.length})</h2>
      <ShowAll items={reminders} limit={3} what="certificates" keep={(r) => !!asking && key(r) === key(asking)}>
        {(rows) =>
          rows.map((r) => (
            <div className={`row reminder ${r.ranOut ? 'ran-out' : 'soon'}`} key={key(r)}>
              <div>
                <b>{r.person.name}</b>
                <p>{reminderLine(r, today)}</p>
              </div>
              <div className="actions">
                {/* The name starts with what the button says, so it can be asked for by voice. */}
                <button type="button" onClick={() => setAsking(r)} aria-label={`Ask for the new card: ${r.person.name}'s ${certificateName(r.kind)}`}>
                  Ask for the new card
                </button>
              </div>
            </div>
          ))
        }
      </ShowAll>
      <p className="hint">Held certificates past their expiry or running out in the next {CERTIFICATE_SOON_DAYS} days. One leaves the list once their card says the new expiry, or No if they're not renewing.</p>
      {asking && <AskPanel key={key(asking)} reminder={asking} today={today} onClose={() => setAsking(undefined)} />}
    </section>
  )
}

/** The message asking for the renewed card, to send as the other prompted messages are. The app sends nothing itself. */
function AskPanel({ reminder, today, onClose }: { reminder: CertificateReminder<PersonView>; today: string; onClose: () => void }) {
  const { person } = reminder
  const { text, subject, what } = renewalMessage(person, reminder, today)
  return (
    <section className="card share" aria-label={`Send ${what} to ${person.name}`}>
      <h2>Ask {person.name}</h2>
      <textarea readOnly value={text} rows={5} />
      {!person.phone && !person.email && <p className="hint">There's no number or email for {person.name}: copy it, or add one on their card.</p>}
      <div className="actions">
        <SendButtons person={person} text={text} subject={subject} />
        <button type="button" className="link" onClick={onClose}>
          Done
        </button>
      </div>
    </section>
  )
}
