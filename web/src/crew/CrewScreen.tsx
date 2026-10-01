import {
  daysLabel,
  eachDay,
  euro,
  newId,
  offerMessage,
  offerOnCalendar,
  personConflicts,
  whatsappNumber,
  type CallView,
  type CommandInput,
  type CrewView,
  type OfferView,
  type PersonView,
  type View,
} from '@sh/shared'
import { useEffect, useState, type FormEvent } from 'react'
import { Top, useHash } from '../jobs/common.tsx'
import { client, syncSoon } from '../sync.ts'
import { useFeedAddress } from './feed.ts'
import { TimesheetScreen, TimesheetsCard } from './Timesheets.tsx'

/**
 * Ops' crew screen: jobs that need people, the offers out for them, and
 * the people who can be offered work. Answers arrive from freelancers'
 * private links, and from Google Calendar when crew invites are on (ADR
 * 0009), and show up here live; everything also works with no signal and
 * syncs later, like the rest of the app. Timesheets for bookings that
 * have happened are checked and approved here too (ADR 0022).
 */

const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Dublin' })

const STATUS: Record<OfferView['status'], [string, string]> = {
  offered: ['Offered', 'pending'],
  countered: ['Asked for more', 'pending'],
  accepted: ['Accepted', 'accepted'],
  confirmed: ['Confirmed', 'confirmed'],
  declined: ['Declined', 'cancelled'],
  filled: ['Filled', 'cancelled'],
  cancelled: ['Withdrawn', 'cancelled'],
}

export const act = async (fn: () => Promise<unknown>) => {
  await fn()
  syncSoon()
}

export const linkFor = (p: PersonView) => (p.linkToken ? `${location.origin}/f/${p.linkToken}` : '')

function useView(): View {
  const [view, setView] = useState(() => client.view())
  useEffect(() => client.subscribe(setView), [])
  return view
}

export function CrewScreen() {
  const view = useView()
  const hash = useHash()
  const crew = view.crew
  const [share, setShare] = useState<{ person: PersonView; call: CallView } | undefined>()
  const people = new Map(crew.people.map((p) => [p.id, p]))
  // Archived people (leavers) are kept for the record but out of the way.
  const active = crew.people.filter((p) => !p.archived)
  const archived = crew.people.filter((p) => p.archived)
  const upcoming = crew.calls.filter((c) => c.end >= today && c.status === 'open')
  const onCalendar = (o: OfferView) => offerOnCalendar(o, view.calendar.days, today)
  const toCheck = upcoming.flatMap((c) =>
    c.offers.filter((o) => o.status === 'accepted' || o.status === 'countered').map((o) => ({ c, o, warning: onCalendar(o)?.warning }))
  )
  // Answers in Google the app couldn't act on, such as a No to a booked day: for the office to sort out.
  const toSortOut = upcoming.flatMap((c) =>
    c.offers
      .filter((o) => o.status === 'offered' || o.status === 'confirmed')
      .flatMap((o) => {
        const cal = onCalendar(o)
        return cal?.warning ? [{ c, o, text: o.status === 'confirmed' ? cal.warning : `${cal.line} ${cal.warning}` }] : []
      })
  )
  const problems = view.problems.filter((p) => /^(person|call|offer|unavailability|timesheet)\./.test(p.mutation.name))
  const [, timesheet] = /^#crew\/timesheet\/(.+)$/.exec(hash) ?? []
  if (timesheet) return <TimesheetScreen view={view} offerId={decodeURIComponent(timesheet)} />

  return (
    <div className="app crew">
      <Top view={view} title="Crew" />

      {problems.length > 0 && (
        <section className="card attention">
          <h2>Not done</h2>
          {problems.map((p) => (
            <div className="row" key={p.mutation.id}>
              <p>{p.reason.message}</p>
              <button type="button" onClick={() => client.dismissProblem(p.mutation.id)}>
                Dismiss
              </button>
            </div>
          ))}
        </section>
      )}

      {(toCheck.length > 0 || toSortOut.length > 0) && (
        <section className="card">
          <h2>Answers to check</h2>
          {toSortOut.map(({ c, o, text }) => (
            <div className="row" key={o.id}>
              <div>
                <b>{o.person?.name ?? 'Someone'}</b> answered on Google Calendar
                <p>
                  {c.project} · {c.role} · {o.status === 'confirmed' ? 'booked' : 'offered'} {daysLabel(o.days)}
                  <br />
                  {text}
                </p>
              </div>
              {c.projectId && (
                <div className="actions">
                  <a className="link" href={`#jobs/${c.projectId}`}>
                    Open job
                  </a>
                </div>
              )}
            </div>
          ))}
          {toCheck.map(({ c, o, warning }) => (
            <div className="row" key={o.id}>
              <div>
                <b>{o.person?.name ?? 'Someone'}</b>{' '}
                {o.status === 'accepted'
                  ? `accepted${o.respondedVia === 'calendar' ? ' on Google Calendar' : ''}`
                  : `asks ${euro(o.counterRateCents)} a day (offered ${euro(c.dayRateCents)})`}
                <p>
                  {c.project} · {c.role} · {daysLabel(o.days)}
                  {o.note && <><br />“{o.note}”</>}
                  {warning && <><br />{warning}</>}
                </p>
              </div>
              <div className="actions">
                <button type="button" className="primary" onClick={() => act(() => client.mutate('offer.confirm', { id: o.id }))}>
                  {o.status === 'countered' ? `Agree ${euro(o.counterRateCents)}` : 'Confirm'}
                </button>
                <button type="button" onClick={() => act(() => client.mutate('offer.cancel', { id: o.id }))}>
                  {o.status === 'countered' ? 'Say no' : 'Release'}
                </button>
              </div>
            </div>
          ))}
        </section>
      )}

      <TimesheetsCard view={view} />

      <section className="card">
        <h2>Crew needed</h2>
        {upcoming.length === 0 && <p className="empty">No crew needed yet. Ask for crew from a job in Jobs, or below.</p>}
        {upcoming.map((c) => (
          <CallCard key={c.id} call={c} crew={crew} calendar={view.calendar} onShare={(person) => setShare({ person, call: c })} />
        ))}
      </section>

      {share && <SharePanel {...share} onClose={() => setShare(undefined)} />}

      <section className="card">
        <h2>Crew for something not in Jobs</h2>
        <p className="hint">For a job in Jobs, ask for crew from the job, so the crew get its phases, venue and any changes.</p>
        <NewCall />
      </section>

      <section className="card">
        <h2>People</h2>
        {active.length === 0 && archived.length === 0 && <p className="empty">Nobody yet. Add your crew below.</p>}
        {active.map((p) => (
          <PersonRow key={p.id} person={p} crew={crew} />
        ))}
        {archived.length > 0 && (
          <details className="archived">
            <summary>Archived ({archived.length})</summary>
            {archived.map((p) => (
              <div className="row person" key={p.id}>
                <span className="who">
                  <b>{p.name}</b>
                  <small>{[p.kind === 'staff' ? 'Staff' : null, p.skills.join(', ')].filter(Boolean).join(' · ')}</small>
                </span>
                {p.pending ? (
                  <span className="pill pending">Waiting to sync</span>
                ) : (
                  <button type="button" onClick={() => act(() => client.mutate('person.archive', { id: p.id, archived: false }))}>
                    Bring back
                  </button>
                )}
              </div>
            ))}
          </details>
        )}
        <NewPerson />
      </section>

      <p className="hint">
        Freelancers answer from their own private link: no app or login. Send it with an offer by WhatsApp, text or email.
        {people.size > 0 && ' Their bookings also appear in their own calendar if they subscribe from that page.'}
      </p>
    </div>
  )
}

/** One crew call: who's been offered it and how they answered, on their link or on Google Calendar, and offering it to someone else. */
export function CallCard({
  call,
  crew,
  calendar,
  onShare,
  inJob = false,
}: {
  call: CallView
  crew: CrewView
  calendar: View['calendar']
  onShare: (p: PersonView) => void
  inJob?: boolean
}) {
  const [personId, setPersonId] = useState('')
  const [override, setOverride] = useState(false)
  const offered = new Set(call.offers.filter((o) => !['declined', 'filled', 'cancelled'].includes(o.status)).map((o) => o.personId))
  const candidates = crew.people.filter((p) => !offered.has(p.id) && !p.archived)
  const chosen = candidates.find((p) => p.id === personId)
  const conflicts = chosen ? personConflicts(crew, chosen.id, call.days, call.id) : []
  const filled = call.openDays.length === 0
  const invites = calendar.link?.state === 'on' && calendar.link.invites === true

  const send = (e: FormEvent) => {
    e.preventDefault()
    if (!chosen) return
    const p = chosen
    void act(() => client.mutate('offer.send', { id: newId(), callId: call.id, personId: p.id, override: conflicts.length > 0 && override }))
    setPersonId('')
    setOverride(false)
    onShare(p)
  }

  return (
    <article className={`job ${call.pending ? 'is-pending' : ''}`}>
      <header>
        <div>
          {inJob ? (
            // On the job's own page the job needs no saying, and the phase shows only for a call across phases.
            <b>
              {call.needed} × {call.role}
              {!call.phaseId && call.phase && <span className="muted"> · {call.phase}</span>}
            </b>
          ) : (
            <b>
              {call.project}
              {call.phase && <span className="muted"> · {call.phase}</span>}
            </b>
          )}
          <p>
            {!inJob && `${call.needed} × ${call.role} · `}
            {daysLabel(call.days)}
            {call.callTime && ` · call ${call.callTime}`} · {euro(call.dayRateCents)}
            {call.venue && !inJob && <><br />{call.venue}</>}
          </p>
        </div>
        <span className={`pill ${filled ? 'confirmed' : 'pending'}`}>
          {filled ? 'Filled' : call.days.length > 1 ? `${call.days.filter((d) => call.heldByDay[d]! >= call.needed).length}/${call.days.length} days filled` : `${call.heldByDay[call.days[0]!]}/${call.needed}`}
        </span>
      </header>

      {call.offers.length > 0 && (
        <ul className="offers">
          {call.offers.map((o) => {
            const [label, tone] = STATUS[o.status]
            const partial = o.days.length < call.days.length && (o.status === 'accepted' || o.status === 'confirmed' || o.status === 'countered')
            const cal = offerOnCalendar(o, calendar.days, today)
            const live = o.status === 'offered' || o.status === 'countered' || o.status === 'accepted' || o.status === 'confirmed'
            return (
              <li key={o.id}>
                <span>
                  {o.person?.name ?? 'Unknown'}
                  {partial && <small> {daysLabel(o.days)}</small>}
                  {o.override && <small> (override)</small>}
                </span>
                <span className="actions">
                  <span className={`pill ${o.pending ? 'pending' : tone}`}>{o.pending ? 'Waiting to sync' : label}</span>
                  {o.status === 'offered' && o.person && (
                    <button type="button" className="link" onClick={() => onShare(o.person as PersonView)}>
                      Send
                    </button>
                  )}
                  {(o.status === 'offered' || o.status === 'confirmed') && (
                    <button type="button" className="link" onClick={() => act(() => client.mutate('offer.cancel', { id: o.id }))}>
                      Withdraw
                    </button>
                  )}
                </span>
                {cal && <small className="on-cal">{cal.line}</small>}
                {cal?.warning && <small className="warn-line">{cal.warning}</small>}
                {!cal && invites && live && o.person && !o.person.email?.trim() && <small className="on-cal">No email address, so no calendar invite.</small>}
              </li>
            )
          })}
        </ul>
      )}

      {!filled && (
        <form className="offer-form" onSubmit={send}>
          <select value={personId} onChange={(e) => setPersonId(e.target.value)} aria-label="Offer to">
            <option value="">Offer to…</option>
            {candidates.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
                {p.skills.length ? ` (${p.skills.join(', ')})` : ''}
                {personConflicts(crew, p.id, call.days, call.id).length ? ' ⚠' : ''}
              </option>
            ))}
          </select>
          <button type="submit" disabled={!chosen || (conflicts.length > 0 && !override)}>
            Offer
          </button>
          {conflicts.length > 0 && (
            <label className="warn">
              <input type="checkbox" checked={override} onChange={(e) => setOverride(e.target.checked)} />
              <span>
                {conflicts.join('. ')}. <b>Offer anyway</b>
              </span>
            </label>
          )}
        </form>
      )}
      <div className="actions end">
        {call.projectId && !inJob && (
          <a className="link" href={`#jobs/${call.projectId}`}>
            Open job
          </a>
        )}
        <button
          type="button"
          className="link"
          onClick={() =>
            confirm(`Cancel the call for ${call.needed} × ${call.role} on ${call.project}? Everyone offered is told it's withdrawn.`) &&
            act(() => client.mutate('call.cancel', { id: call.id }))
          }
        >
          Cancel crew call
        </button>
      </div>
    </article>
  )
}

/** The offer, ready to go wherever the freelancer already looks. Nothing is sent for you. */
/** Send a person something on their private link: an offer, or with `message`, something else such as their call sheet (ADR 0021). */
export function SharePanel({
  person,
  call,
  onClose,
  message,
}: {
  person: PersonView
  call: CallView
  onClose: () => void
  message?: (link: string) => { text: string; subject: string; what: string }
}) {
  const link = linkFor(person)
  const [copied, setCopied] = useState(false)
  if (!link)
    return (
      <section className="card share">
        <h2>Send to {person.name}</h2>
        <p className="empty">Their private link is made when this device next syncs. Try again once it says “Up to date”.</p>
        <button type="button" onClick={onClose}>
          Close
        </button>
      </section>
    )
  const custom = message?.(link)
  const text = custom?.text ?? offerMessage(person, call, link)
  const subject = custom?.subject ?? `Work: ${call.project}, ${daysLabel(call.days)}`
  return (
    <section className="card share" aria-label={`Send ${custom?.what ?? 'offer'} to ${person.name}`}>
      <h2>Send to {person.name}</h2>
      <textarea readOnly value={text} rows={6} />
      <div className="actions">
        {person.phone && (
          <>
            <a className="button primary" href={`https://wa.me/${whatsappNumber(person.phone)}?text=${encodeURIComponent(text)}`} target="_blank" rel="noreferrer">
              WhatsApp
            </a>
            <a className="button" href={`sms:${person.phone}?&body=${encodeURIComponent(text)}`}>
              Text
            </a>
          </>
        )}
        {person.email && (
          <a className="button" href={`mailto:${person.email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(text)}`}>
            Email
          </a>
        )}
        <button
          type="button"
          onClick={() => {
            void navigator.clipboard?.writeText(text).then(() => setCopied(true))
          }}
        >
          {copied ? 'Copied' : 'Copy'}
        </button>
        <button type="button" className="link" onClick={onClose}>
          Done
        </button>
      </div>
    </section>
  )
}

function PersonRow({ person, crew }: { person: PersonView; crew: CrewView }) {
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState(false)
  const [cannotArchive, setCannotArchive] = useState('')
  const [away, setAway] = useState({ start: today, end: today, note: '' })
  const booked = crew.calls.flatMap((c) =>
    c.status === 'open' && c.end >= today ? c.offers.filter((o) => o.personId === person.id && (o.status === 'accepted' || o.status === 'confirmed')).map((o) => ({ c, o })) : []
  )
  // Offers still waiting on them: like a booking, settled before they can be archived. The server checks the same.
  const waiting = crew.calls.flatMap((c) =>
    c.status === 'open' && c.end >= today ? c.offers.filter((o) => o.personId === person.id && (o.status === 'offered' || o.status === 'countered')).map((o) => ({ c, o })) : []
  )
  const off = crew.unavailability.filter((u) => u.personId === person.id && u.end >= today)
  const link = linkFor(person)
  const feed = useFeedAddress(open ? person.linkToken : undefined)
  const archive = () => {
    // The same test as the server's: held days from today on, or any offer still waiting.
    const hold = booked.find(({ o }) => o.days.some((d) => d >= today)) ?? waiting[0]
    if (hold) {
      const job = hold.c.phase ? `${hold.c.project} (${hold.c.phase})` : hold.c.project
      setCannotArchive(
        hold.o.status === 'confirmed'
          ? `${person.name} is booked on ${job}; release them first.`
          : hold.o.status === 'accepted'
            ? `${person.name} has accepted ${job}; release them first.`
            : `${person.name} has an open offer for ${job}; withdraw it first.`
      )
      return
    }
    setCannotArchive('')
    void act(() => client.mutate('person.archive', { id: person.id, archived: true }))
  }
  return (
    <div className="row person">
      <button type="button" className="who" onClick={() => setOpen(!open)} aria-expanded={open}>
        <b>{person.name}</b>
        <small>
          {[person.kind === 'staff' ? 'Staff' : null, person.skills.join(', '), person.dayRateCents !== null ? `${euro(person.dayRateCents)}/day` : null]
            .filter(Boolean)
            .join(' · ')}
          {booked.length > 0 && ` · ${booked.length} booking${booked.length === 1 ? '' : 's'}`}
          {off.length > 0 && ' · has days off'}
        </small>
      </button>
      {person.pending && <span className="pill pending">Waiting to sync</span>}
      {open && editing && (
        <div className="detail">
          <PersonForm
            initial={person}
            submitLabel="Save"
            onSubmit={(fields) => act(() => client.mutate('person.upsert', { id: person.id, ...fields })).then(() => true, (err: Error) => (alert(err.message), false))}
            onDone={() => setEditing(false)}
          />
        </div>
      )}
      {open && !editing && (
        <div className="detail">
          {(person.phone || person.email) && <p className="muted">{[person.phone, person.email].filter(Boolean).join(' · ')}</p>}
          {person.notes && <p className="muted">{person.notes}</p>}
          {booked.map(({ c, o }) => (
            <p key={o.id}>
              {c.project} · {daysLabel(o.days)} · {STATUS[o.status][0]}
            </p>
          ))}
          {off.map((u) => (
            <p key={u.id}>
              Off {daysLabel(eachDay(u.start, u.end))}
              {u.note && ` (${u.note})`}
              {u.source === 'self' && ' · said on their link'}{' '}
              <button type="button" className="link" onClick={() => act(() => client.mutate('unavailability.remove', { id: u.id }))}>
                Remove
              </button>
            </p>
          ))}
          <form
            className="away-form"
            onSubmit={(e) => {
              e.preventDefault()
              void act(() => client.mutate('unavailability.add', { id: newId(), personId: person.id, start: away.start, end: away.end < away.start ? away.start : away.end, note: away.note }))
            }}
          >
            <input type="date" value={away.start} onChange={(e) => setAway({ ...away, start: e.target.value })} aria-label="Off from" />
            <input type="date" value={away.end} min={away.start} onChange={(e) => setAway({ ...away, end: e.target.value })} aria-label="Off until" />
            <input placeholder="Note" value={away.note} onChange={(e) => setAway({ ...away, note: e.target.value })} />
            <button type="submit">Mark days off</button>
          </form>
          <div className="actions">
            {link && (
              <>
                <a className="button" href={link} target="_blank" rel="noreferrer">
                  Open their page
                </a>
                <button type="button" onClick={() => navigator.clipboard?.writeText(link)}>
                  Copy link
                </button>
              </>
            )}
            {feed && (
              <button type="button" onClick={() => navigator.clipboard?.writeText(feed)}>
                Copy calendar address
              </button>
            )}
            <button
              type="button"
              className="link"
              onClick={() => confirm(`Make a new link for ${person.name}? The old one stops working.`) && act(() => client.mutate('person.newLink', { id: person.id }))}
            >
              New link
            </button>
          </div>
          <div className="actions">
            <button type="button" onClick={() => setEditing(true)}>
              Edit
            </button>
            <button type="button" className="link" onClick={archive}>
              Archive
            </button>
          </div>
          {cannotArchive && <p className="warn-line">{cannotArchive}</p>}
        </div>
      )}
    </div>
  )
}

export const euroToCents = (s: string) => (s.trim() === '' ? null : Math.round(Number(s.replace(',', '.')) * 100))

function NewCall() {
  const blank = { project: '', phase: '', venue: '', role: '', start: today, end: today, callTime: '', needed: 1, rate: '', details: '' }
  const [f, setF] = useState(blank)
  const set = (k: keyof typeof blank) => (e: { target: { value: string } }) => setF({ ...f, [k]: k === 'needed' ? Number(e.target.value) : e.target.value })
  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (!f.project.trim() || !f.role.trim()) return
    void act(() =>
      client.mutate('call.create', {
        id: newId(),
        project: f.project.trim(),
        phase: f.phase.trim(),
        venue: f.venue.trim(),
        role: f.role.trim(),
        start: f.start,
        end: f.end < f.start ? f.start : f.end,
        callTime: f.callTime || null,
        needed: Math.max(1, f.needed),
        dayRateCents: euroToCents(f.rate),
        details: f.details.trim(),
        replyBy: null,
      })
    )
    setF({ ...blank, project: f.project, venue: f.venue, start: f.start, end: f.end })
  }
  return (
    <form className="grid-form" onSubmit={submit}>
      <label className="wide">
        Project <input value={f.project} onChange={set('project')} placeholder="e.g. Electric Picnic" required />
      </label>
      <label>
        Phase <input value={f.phase} onChange={set('phase')} placeholder="Build, Show…" />
      </label>
      <label>
        Role <input value={f.role} onChange={set('role')} placeholder="Audio tech" required />
      </label>
      <label>
        From <input type="date" value={f.start} onChange={set('start')} />
      </label>
      <label>
        To <input type="date" value={f.end} min={f.start} onChange={set('end')} />
      </label>
      <label>
        Call time <input type="time" value={f.callTime} onChange={set('callTime')} />
      </label>
      <label>
        How many <input type="number" min={1} value={f.needed} onChange={set('needed')} />
      </label>
      <label>
        Day rate € <input inputMode="decimal" value={f.rate} onChange={set('rate')} placeholder="250" />
      </label>
      <label>
        Venue <input value={f.venue} onChange={set('venue')} />
      </label>
      <label className="wide">
        Details for crew <textarea rows={2} value={f.details} onChange={set('details')} placeholder="Travel, food, parking, dress" />
      </label>
      <button type="submit" className="primary wide">
        Ask for crew
      </button>
    </form>
  )
}

function NewPerson() {
  return <PersonForm submitLabel="Add person" onSubmit={(fields) => act(() => client.mutate('person.upsert', { id: newId(), ...fields })).then(() => true, (err: Error) => (alert(err.message), false))} />
}

type PersonFields = Omit<CommandInput<'person.upsert'>, 'id'>

/**
 * A person's details: the Add form, and the same form again to correct
 * them (audit finding 7). `onSubmit` says whether the change was taken, so
 * a refused one keeps what was typed.
 */
function PersonForm({ initial, submitLabel, onSubmit, onDone }: { initial?: PersonView; submitLabel: string; onSubmit: (fields: PersonFields) => Promise<boolean>; onDone?: () => void }) {
  const blank = { name: '', phone: '', email: '', skills: '', rate: '', kind: 'freelancer' as 'freelancer' | 'staff', notes: '' }
  const from = (p: PersonView) => ({
    name: p.name,
    phone: p.phone ?? '',
    email: p.email ?? '',
    skills: p.skills.join(', '),
    rate: p.dayRateCents === null ? '' : String(p.dayRateCents / 100),
    kind: p.kind,
    notes: p.notes,
  })
  const [f, setF] = useState(initial ? from(initial) : blank)
  const set = (k: keyof typeof blank) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value })
  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (!f.name.trim()) return
    void onSubmit({
      name: f.name.trim(),
      kind: f.kind,
      phone: f.phone.trim() || null,
      email: f.email.trim() || null,
      skills: f.skills.split(',').map((s) => s.trim()).filter(Boolean),
      dayRateCents: euroToCents(f.rate),
      notes: f.notes.trim(),
    }).then((taken) => {
      if (!taken) return
      if (initial) onDone?.()
      else setF(blank)
    })
  }
  return (
    <form className="grid-form" onSubmit={submit} aria-label={initial ? `Edit ${initial.name}` : 'Add person'}>
      <label className="wide">
        Name <input value={f.name} onChange={set('name')} placeholder="Full name" required />
      </label>
      <label>
        Mobile <input type="tel" value={f.phone} onChange={set('phone')} placeholder="+353 87…" />
      </label>
      <label>
        Email <input type="email" value={f.email} onChange={set('email')} />
      </label>
      <label>
        Skills <input value={f.skills} onChange={set('skills')} placeholder="audio, rigger" />
      </label>
      <label>
        Usual day rate € <input inputMode="decimal" value={f.rate} onChange={set('rate')} />
      </label>
      <label>
        Type
        <select value={f.kind} onChange={set('kind')}>
          <option value="freelancer">Freelancer</option>
          <option value="staff">Staff</option>
        </select>
      </label>
      <label className="wide">
        Notes <textarea rows={2} value={f.notes} onChange={set('notes')} placeholder="Notes for the office" />
      </label>
      <p className="hint wide">They can read these in their own data download.</p>
      <button type="submit" className={initial ? 'primary' : 'wide'}>
        {submitLabel}
      </button>
      {initial && (
        <button type="button" onClick={onDone}>
          Cancel
        </button>
      )}
    </form>
  )
}
