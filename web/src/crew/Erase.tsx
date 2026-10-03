import { dayLabel, ERASED_NAME, eraseRefusal, irishToday, LEAVE_RECORD_YEARS, PAID_WORK_YEARS, type NameKept, type PersonView } from '@sh/shared'
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
 * undone. Once erased, the card says when, why a name is still there, and
 * the day the app erases it.
 */

const dateLabel = (d: string) => `${dayLabel(d)} ${d.slice(0, 4)}`
/** In words, as a person would say it: "six years". */
const years = (n: number) => `${['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'][n] ?? n} years`

/** Why each kind of record outlives the rest of their details. */
const PAY_WHY = `Revenue needs the business's records of what it paid, and to whom, for ${years(PAID_WORK_YEARS)}`
const LEAVE_WHY = `the Working Time Act asks for records of leave to be kept for ${years(LEAVE_RECORD_YEARS)}`

/** Why the erased card still shows a name: whichever records keep it. */
function keptWith(k: Pick<NameKept, 'pay' | 'leave'>): string {
  const what = [k.pay && 'their timesheets', k.leave && 'their staff leave records'].filter(Boolean).join(' and ')
  const why = [k.pay && PAY_WHY, k.leave && LEAVE_WHY].filter(Boolean).join(', and ')
  return what ? `Their name is kept with ${what}: ${why}.` : 'Their name is kept while the law asks for their records to be kept.'
}

/** What the question says is kept, when something keeps the name: each kind of record, until when, and why. */
function keptList(k: NameKept & { until: string }): string {
  const leave = 'their staff leave records, without notes or reasons,'
  if (k.pay && k.leave)
    return `their timesheets with the amounts until ${dateLabel(k.pay)}, ${leave} until ${dateLabel(k.leave)}, and their name until ${dateLabel(k.until)}: ${PAY_WHY}, and ${LEAVE_WHY}. Their bookings and offers stay too, as records of work.`
  if (k.leave) return `their name and ${leave} until ${dateLabel(k.until)}: ${LEAVE_WHY}. Their bookings, offers and timesheets stay too, as records of work.`
  return `their name and their timesheets with the amounts, until ${dateLabel(k.until)}: ${PAY_WHY}. Their bookings and offers stay too, as records of work.`
}

export function ArchivedPerson({ person, onBringBack }: { person: PersonView; onBringBack: () => void }) {
  const view = useView()
  const today = useToday()
  const [asking, setAsking] = useState(false)
  const { run, error, refuse } = useAct()
  const erased = view.erasures[person.id]
  // As the server will decide it, from their pay and leave records (ADR 0027); once erased, as it was decided that day.
  const kept = view.keptFor(person.id, erased ? irishToday(new Date(erased.erasedAt)) : today)
  const keptUntil = erased ? erased.nameKeptUntil : kept.until
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
            {/* Nobody has to remember: the server erases it that day, with any leave records left (ADR 0027). */}
            <p className="hint">
              {keptWith(kept)} The app erases it on {dateLabel(keptUntil)}.
            </p>
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
                <b>Goes:</b> their phone, email, notes, skills, department, level, the name they go by, certificates, documents and their files, company with its VAT and CRO numbers, day rate,
                days off{kept.leave ? '' : ', staff leave'} and what they said about running late. Their private link stops working and their calendar feed stops.{' '}
                {person.kind === 'staff' && 'If they sign in to the app, they are signed out and their account is switched off. '}
                {keptUntil ? 'Everything but their name goes.' : `Their name becomes “${ERASED_NAME}”.`}
              </p>
              <p>
                <b>Kept:</b> {kept.until ? keptList({ ...kept, until: kept.until }) : `their bookings, offers and timesheets, as records of work, under “${ERASED_NAME}”.`}
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
