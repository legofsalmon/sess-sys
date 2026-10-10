import {
  dayLabel,
  firstName,
  HOLDING,
  LATE_BY,
  LATE_BY_LABELS,
  LATE_NOTE_LENGTH,
  lateDays,
  lateDayWord,
  lateGoneReason,
  lateLine,
  newId,
  noLateReason,
  telHref,
  type CallView,
  type LateBy,
  type LateNote,
  type LateView,
  type OfferView,
} from '@sh/shared'
import { useState, type FormEvent } from 'react'
import { Refusal, useAct } from '../act.tsx'
import { Fold } from '../Fold.tsx'
import { client } from '../sync.ts'
import { useToday } from '../view.ts'

/**
 * Running late (ADR 0028) on the Crew tab: the row in "Answers to check"
 * until the office notes it, and the lines on a call until the day is
 * over. Said by the person on their private link, or noted by the office
 * on the call's line when they ring instead.
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

/**
 * Someone booked rang to say they're running late (ADR 0028, amended): the
 * office notes it under the call's line, with the same choices as their
 * link, in the same record, so it reaches the queue, the badge, the
 * planner and the contact's call sheet as theirs would. Only for the days
 * it can be said for now, as on the link: today, and tomorrow from 6pm.
 */
export function NoteLate({ call, late }: { call: CallView; late: LateView | undefined }) {
  const booked = call.status === 'open' ? call.offers.filter((o) => o.person && HOLDING.includes(o.status) && lateDays(o.days).length > 0) : []
  if (!booked.length) return null
  return (
    <Fold label="Running late…" className="link late-open">
      <LateForm call={call} booked={booked} late={late} />
    </Fold>
  )
}

/** Who rang and for which day, when there's a choice, over the form for that person and day. */
function LateForm({ call, booked, late }: { call: CallView; booked: OfferView[]; late: LateView | undefined }) {
  const today = useToday()
  const [offerId, setOfferId] = useState(booked[0]!.id)
  const offer = booked.find((o) => o.id === offerId) ?? booked[0]!
  const days = lateDays(offer.days)
  const [picked, setPicked] = useState(days[0] ?? today)
  const day = days.includes(picked) ? picked : (days[0] ?? today)
  return (
    <>
      {(booked.length > 1 || days.length > 1) && (
        <div className="grid-form">
          {booked.length > 1 && (
            <label className="wide">
              Who rang
              <select value={offer.id} onChange={(e) => setOfferId(e.target.value)}>
                {booked.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.person!.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          {days.length > 1 && (
            <fieldset className="chips wide">
              <legend>Which day</legend>
              <div>
                {days.map((d) => (
                  <label key={d}>
                    <input type="radio" name={`late-day-${call.id}`} checked={d === day} onChange={() => setPicked(d)} />
                    {d === today ? 'Today' : 'Tomorrow'}, {dayLabel(d)}
                  </label>
                ))}
              </div>
            </fieldset>
          )}
        </div>
      )}
      {/* A fresh form for each person and day, filled in with what's on record, to change it. */}
      <LateFields key={`${offer.id} ${day}`} call={call} offer={offer} day={day} said={late?.forOffer(offer.id).find((l) => l.day === day)} />
    </>
  )
}

function LateFields({ call, offer, day, said }: { call: CallView; offer: OfferView; day: string; said: LateNote | undefined }) {
  const name = offer.person!.name
  const first = firstName(offer.person!)
  const [by, setBy] = useState<LateBy | ''>(said?.by ?? '')
  const [at, setAt] = useState(said?.arriveAt ?? '')
  const [note, setNote] = useState(said?.note ?? '')
  const [done, setDone] = useState('')
  const { run, error, refuse } = useAct()

  const save = (e: FormEvent) => {
    e.preventDefault()
    setDone('')
    // The server's rules, checked here first, so a refusal is said in place with no round trip.
    const gone = call.status !== 'open' || !HOLDING.includes(offer.status) ? lateGoneReason(name) : noLateReason(offer.days, day, new Date(), name)
    const no = gone ?? (!by && !at ? "Say roughly how late they'll be, or the time they'll be there." : null)
    if (no) return refuse(no)
    const args = { id: said?.id ?? newId(), offerId: offer.id, day, by: by || null, arriveAt: at || null, note: note.trim() }
    void run(() => client.mutate('late.say', args)).then((ok) => ok && setDone(`Noted: ${first}, ${lateLine({ ...args, arrivedAt: null })}.`))
  }
  // With the booking and the day, so a record this device noted under its own id before it heard theirs is still found.
  const there = (l: LateNote) => {
    setDone('')
    void run(() => client.mutate('late.arrived', { id: l.id, offerId: l.offerId, day: l.day })).then((ok) => ok && setDone(`Noted: ${first} is there now.`))
  }

  return (
    <form className="grid-form" onSubmit={save} aria-label={`${name} running late`}>
      <fieldset className="chips wide">
        <legend>Roughly how late {first} will be</legend>
        <div>
          {LATE_BY.map((b) => (
            <label key={b}>
              <input type="radio" name={`late-by-${offer.id}`} checked={by === b} onChange={() => setBy(b)} />
              {LATE_BY_LABELS[b]}
            </label>
          ))}
        </div>
      </fieldset>
      <label>
        Or the time they'll be there <input type="time" value={at} onChange={(e) => setAt(e.target.value)} />
      </label>
      <label>
        Note, if you like <input value={note} maxLength={LATE_NOTE_LENGTH} onChange={(e) => setNote(e.target.value)} placeholder="e.g. traffic on the M50" />
      </label>
      <Refusal error={error} className="wide" />
      {/* Read out as it changes, as it's there from the form's opening. */}
      <div className="wide" aria-live="polite">
        {done && <p className="added">{done}</p>}
      </div>
      <div className="actions wide">
        <button type="submit" className="primary">
          {said ? 'Change how late' : `Note ${first} as late`}
        </button>
        {said && !said.arrivedAt && (
          <button type="button" onClick={() => there(said)} aria-label={`Mark as there: ${name}`}>
            Mark as there
          </button>
        )}
      </div>
    </form>
  )
}
