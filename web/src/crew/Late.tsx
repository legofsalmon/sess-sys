import { firstName, lateDayWord, lateLine, telHref, type CallView, type LateNote, type LateView } from '@sh/shared'

/**
 * Running late (ADR 0028) on the Crew tab: the row in "Answers to check"
 * until the office notes it, and the lines on a call until the day is
 * over. Said by the person on their private link.
 */

/** "Gráinne Power is running late": what they said, the job and the day, a way to ring them, and Noted. */
export function LateRow({ note, today, onNoted }: { note: LateNote; today: string; onNoted: () => void }) {
  const name = note.person?.name ?? 'Someone'
  const c = note.call
  return (
    <div className="row late-row">
      <div>
        <b>{name}</b> is running late
        <p>
          {lateLine(note)}
          <br />
          {[c?.project, c?.role, `${lateDayWord(note.day, today)}${c?.callTime ? `, call ${c.callTime}` : ''}`].filter(Boolean).join(' · ')}
        </p>
      </div>
      <div className="actions">
        {note.person?.phone && (
          <a className="button" href={telHref(note.person.phone)}>
            Ring
          </a>
        )}
        <button type="button" onClick={onNoted} aria-label={`Noted: ${name} is running late`}>
          Noted
        </button>
      </div>
    </div>
  )
}

/** On a call's line, at rest: "Gráinne: about 30 minutes late, “Traffic on the M50”", or "Gráinne: there now". */
export function LateLines({ call, late, today }: { call: CallView; late: LateView | undefined; today: string }) {
  const notes = call.offers.flatMap((o) => (o.status === 'accepted' || o.status === 'confirmed' ? (late?.forOffer(o.id) ?? []) : []))
  if (!notes.length) return null
  return (
    <>
      {notes.map((l) => (
        <p key={l.id} className={`late-line${l.arrivedAt ? ' there' : ''}`}>
          {l.person ? firstName(l.person) : 'Someone'}: {lateLine(l)}
          {l.day !== today && ` (${lateDayWord(l.day, today)})`}
        </p>
      ))}
    </>
  )
}
