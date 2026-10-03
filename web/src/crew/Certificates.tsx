import {
  blocks,
  CERTIFICATE_KINDS,
  CERTIFICATE_LABELS,
  CERTIFICATE_SOON_DAYS,
  certificateGaps,
  certificateName,
  documentRenewalMessage,
  gapSentence,
  needsOf,
  renewalMessage,
  runningOut,
  runningOutLine,
  tidyNeeds,
  titleInSentence,
  type CallView,
  type CertificateKind,
  type PersonView,
  type RunningOut,
  type View,
} from '@sh/shared'
import { useState } from 'react'
import { ShowAll } from '../Fold.tsx'
import { useToday } from '../view.ts'
import { linkFor, SendButtons } from './CrewScreen.tsx'
import { useDocumentStorage } from './Documents.tsx'

/**
 * Certificates on the Crew tab (ADR 0028): the ticks for what a call
 * needs, the warnings on a call's line for anyone on it short of one, and
 * the list of what's running out, documents' expiries among them (ADR
 * 0029), each with a message asking for the new one.
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
 * Certificates and documents run out, or running out in the next 30 days,
 * soonest first (ADR 0028, ADR 0029): a certificate's card adds no line of
 * its own, as its certificate has one. Nothing while there are none. Not on
 * the Crew badge: they're known weeks ahead, and a badge always lit stops
 * being read.
 */
export function CertificateReminders({ view }: { view: View }) {
  const today = useToday()
  const reminders = runningOut(view.crew.people, view.documents.all, today)
  const [asking, setAsking] = useState<RunningOut<PersonView> | undefined>()
  if (!reminders.length) return null
  const key = (r: RunningOut<PersonView>) => (r.what === 'certificate' ? `${r.person.id} ${r.kind}` : `document ${r.document.id}`)
  return (
    <section className="card reminders" aria-label="Certificates and documents running out">
      <h2>Running out ({reminders.length})</h2>
      <ShowAll items={reminders} limit={3} what="certificates and documents" keep={(r) => !!asking && key(r) === key(asking)}>
        {(rows) =>
          rows.map((r) => (
            <div className={`row reminder ${r.ranOut ? 'ran-out' : 'soon'}`} key={key(r)}>
              <div>
                <b>{r.person.name}</b>
                <p>{runningOutLine(r, today)}</p>
              </div>
              <div className="actions">
                {/* The name starts with what the button says, so it can be asked for by voice. */}
                {r.what === 'certificate' ? (
                  <button type="button" onClick={() => setAsking(r)} aria-label={`Ask for the new card: ${r.person.name}'s ${certificateName(r.kind)}`}>
                    Ask for the new card
                  </button>
                ) : (
                  <button type="button" onClick={() => setAsking(r)} aria-label={`Ask for the new one: ${r.person.name}'s ${titleInSentence(r.document.title)}`}>
                    Ask for the new one
                  </button>
                )}
              </div>
            </div>
          ))
        }
      </ShowAll>
      <p className="hint">
        Held certificates, and documents such as insurance, past their expiry or running out in the next {CERTIFICATE_SOON_DAYS} days. One leaves the list once their card
        or the document says the new expiry, or No for a certificate they're not renewing.
      </p>
      {asking && <AskPanel key={key(asking)} reminder={asking} today={today} onClose={() => setAsking(undefined)} />}
    </section>
  )
}

/** The message asking for the new one, to send as the other prompted messages are; with their page, once files can be sent from it. The app sends nothing itself. */
function AskPanel({ reminder, today, onClose }: { reminder: RunningOut<PersonView>; today: string; onClose: () => void }) {
  const { person } = reminder
  const storage = useDocumentStorage()
  const link = storage?.files ? linkFor(person) || undefined : undefined
  const { text, subject, what } = reminder.what === 'certificate' ? renewalMessage(person, reminder, today, link) : documentRenewalMessage(person, reminder, today, link)
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
