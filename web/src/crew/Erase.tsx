import { dayLabel, ERASED_NAME, eraseRefusal, irishToday, nameKeptUntil, PAID_WORK_YEARS, type PersonView } from '@sh/shared'
import { useState } from 'react'
import { Confirm, Refusal, useAct } from '../act.tsx'
import { Pending } from '../StatusPill.tsx'
import { client } from '../sync.ts'
import { useToday, useView } from '../view.ts'

/**
 * Someone archived, on the Crew tab, and erasing their details when they
 * ask (ADR 0027). Archive first, then erase: two deliberate steps. What
 * has to be settled first is said here before anything is sent, in the
 * server's words; the question in place says what goes, what stays and
 * why, that copies stay in the backups for a while, and that it can't be
 * undone. Once erased, the card says when, and why a name is still there.
 */

const dateLabel = (d: string) => `${dayLabel(d)} ${d.slice(0, 4)}`
/** In words, as a person would say it: "six years". */
const years = `${['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'][PAID_WORK_YEARS] ?? PAID_WORK_YEARS} years`

export function ArchivedPerson({ person, onBringBack }: { person: PersonView; onBringBack: () => void }) {
  const view = useView()
  const today = useToday()
  const [asking, setAsking] = useState(false)
  const { run, error, refuse } = useAct()
  const erased = view.erasures[person.id]
  // As the server will decide it, from their approved timesheets (ADR 0027).
  const keptUntil = erased
    ? erased.nameKeptUntil
    : nameKeptUntil(
        view.timesheets.approved.filter((r) => r.offer.personId === person.id).map((r) => r.timesheet?.approvedAt),
        today
      )
  const erase = () => {
    const why = eraseRefusal(person, view, today)
    if (why) return refuse(why)
    refuse('')
    setAsking(true)
  }

  if (erased) {
    return (
      <div className="row person erased">
        <span className="who">
          <b>{person.name}</b>
          <small>Details erased on request, {dateLabel(irishToday(new Date(erased.erasedAt)))}</small>
        </span>
        <Pending pending={erased.pending || person.pending} />
        {keptUntil && (
          <div className="detail">
            <p className="hint">
              Their name is kept with their timesheets: Revenue needs the business's records of what it paid, and to whom, for {years}. It can be erased from{' '}
              {dateLabel(keptUntil)}.
            </p>
            {keptUntil <= today &&
              !erased.pending &&
              // Asked first, as for the rest of their details: it can't be undone either.
              (asking ? (
                <Confirm
                  question={`Erase ${person.name}'s name now? This can't be undone.`}
                  yes="Erase the name"
                  no="Keep it"
                  onYes={() => {
                    setAsking(false)
                    void run(() => client.mutate('person.erase', { id: person.id }))
                  }}
                  onNo={() => setAsking(false)}
                />
              ) : (
                <div className="actions">
                  <button type="button" onClick={() => setAsking(true)}>
                    Erase the name now
                  </button>
                </div>
              ))}
            <Refusal error={error} />
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="row person">
      <span className="who">
        <b>{person.name}</b>
        <small>{[person.kind === 'staff' ? 'Staff' : null, person.skills.join(', ')].filter(Boolean).join(' · ')}</small>
      </span>
      {person.pending ? (
        <Pending pending />
      ) : (
        !asking && (
          <div className="actions">
            <button type="button" onClick={onBringBack}>
              Bring back
            </button>
            <button type="button" className="link" onClick={erase}>
              Erase details…
            </button>
          </div>
        )
      )}
      {(asking || error) && (
        <div className="detail">
          {asking && (
            <Confirm
              className="erase"
              question={`Erase ${person.name}'s details? This can't be undone.`}
              yes="Erase their details"
              no="Keep them"
              onYes={() => {
                setAsking(false)
                void run(() => client.mutate('person.erase', { id: person.id }))
              }}
              onNo={() => setAsking(false)}
            >
              <p>
                <b>Goes:</b> their phone, email, notes, skills, department, level, the name they go by, certificates, company with its VAT and CRO numbers, day rate,
                days off, staff leave and what they said about running late. Their private link stops working and their calendar feed stops.{' '}
                {person.kind === 'staff' && 'If they sign in to the app, they are signed out and their account is switched off. '}
                {keptUntil ? 'Everything but their name goes.' : `Their name becomes “${ERASED_NAME}”.`}
              </p>
              <p>
                <b>Kept:</b>{' '}
                {keptUntil
                  ? `their name and their timesheets with the amounts, until ${dateLabel(keptUntil)}: Revenue needs the business's records of what it paid, and to whom, for ${years}. Their bookings and offers stay too, as records of work.`
                  : `their bookings, offers and timesheets, as records of work, under “${ERASED_NAME}”.`}
              </p>
              <p>
                <b>Backups:</b> they can't be edited, so any made before now keep copies of their details until they age out: the nightly ones after 35 days, the monthly
                ones after a year. The list of who was erased is kept with the app's data, and beside the backups when they're on, so putting a backup back never brings
                them back.
              </p>
            </Confirm>
          )}
          <Refusal error={error} />
        </div>
      )}
    </div>
  )
}
