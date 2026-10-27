import {
  CERTIFICATE_KINDS,
  CERTIFICATE_LABELS,
  certificateState,
  companyLine,
  daysLabel,
  eachDay,
  euro,
  levelLine,
  LEVELS,
  newId,
  type PersonView,
  type View,
} from '@sh/shared'
import { CERTIFICATE_SOON_DAYS, certificateName, daysBetween, dayLabel, whatsappNumber } from '@sh/shared'
import { holdsARole, ROLE_LABELS, ROLE_LINES, ROLES, roleOfPerson, type Role } from '@sh/shared'
import { useId, useState } from 'react'
import { Confirm, Refusal, useAct } from '../act.tsx'
import { Empty } from '../Empty.tsx'
import { Fold, ShowAll } from '../Fold.tsx'
import { Heading, Icon } from '../Icon.tsx'
import { Page } from '../jobs/common.tsx'
import { TabPanel, Tabs, useTab } from '../Tabs.tsx'
import { Avatar, photoOf } from '../Picture.tsx'
import { Pending, StatusPill } from '../StatusPill.tsx'
import { useAccess } from '../role.ts'
import { client } from '../sync.ts'
import { CREW, PEOPLE } from '../Up.tsx'
import { useToday } from '../view.ts'
import { CombineWith, useSamePeople } from './Combine.tsx'
import { STATUS } from './Calls.tsx'
import { linkFor } from './Messages.tsx'
import { PersonForm } from './People.tsx'
import { Documents } from './Documents.tsx'
import { useFeedAddress } from './feed.ts'
import { OwnCalendarCard } from './OwnCalendar.tsx'
import { PersonPhoto } from './PersonPhoto.tsx'

/**
 * One person on a page of their own (#crew/person/<id>): who they are and
 * how to reach them, what they're booked on, offered and off for, what
 * they hold, what they've worked, and their private link. The People list
 * on Crew is one line each and opens this; before, all of it opened in
 * place inside the list. Their picture (ADR 0038) is beside their name.
 */

/** Where a person's page is. */
export const personHref = (id: string) => `#crew/person/${encodeURIComponent(id)}`

/** "Fri 3 Oct 2027": a certificate's expiry wants its year. */
const dateLabel = (d: string) => `${dayLabel(d)} ${d.slice(0, 4)}`

/** A person's page in parts (ADR 0082), one at a time under their name. */
export type PersonPart = 'coming' | 'details' | 'documents' | 'worked' | 'link'
const PERSON_PARTS: readonly PersonPart[] = ['coming', 'details', 'documents', 'worked', 'link']
const PERSON_LABELS: Record<PersonPart, string> = { coming: 'Coming up', details: 'Details', documents: 'Documents', worked: 'Worked', link: 'Their link' }

export function PersonScreen({
  view,
  id,
  part: asked,
  onArchived,
}: {
  view: View
  id: string
  part?: string
  onArchived: (p: { id: string; name: string }) => void
}) {
  const person = view.crew.people.find((p) => p.id === id)
  const up = { steps: [CREW, PEOPLE], here: person?.name }
  const parts = PERSON_PARTS.filter((p) => p !== 'link' || (person && !person.archived))
  const [part, pick] = useTab({ parts, asked, remember: 'sh.personPart', address: (p) => `${personHref(id)}/${p}` })
  if (!person)
    return (
      <Page view={view} title="Crew" className="crew person-page" up={up}>
        <section className="card">
          <p className="empty">This person isn't on this device. They may still be on their way: check again once it says “Up to date”.</p>
        </section>
      </Page>
    )
  return (
    <Page
      view={view}
      title="Crew"
      className="crew person-page"
      up={up}
      picture={<Avatar name={person.name} src={photoOf(person)} size="large" />}
      heading={person.name}
      badge={<Pending pending={person.pending} />}
      sub={<WhoLine person={person} />}
    >
      <Reach person={person} />
      <Warnings person={person} view={view} />
      <Tabs label={`About ${person.name}`} id="person" parts={parts} labels={PERSON_LABELS} current={part} counts={{ worked: person.worked.length || undefined }} onPick={pick} />
      <TabPanel id="person" current={part}>
        {part === 'coming' && (
          <>
            <ComingUp person={person} view={view} onArchived={onArchived} />
            <OwnCalendarCard person={person} view={view} />
          </>
        )}
        {part === 'details' && <Who person={person} view={view} />}
        {part === 'documents' && (
          <section className="card" aria-label="Certificates and documents">
            <Heading icon="certificate">Certificates and documents</Heading>
            <CertificateLines person={person} />
            <Documents person={person} />
          </section>
        )}
        {part === 'worked' && <Worked person={person} />}
        {part === 'link' && <TheirLink person={person} />}
      </TabPanel>
    </Page>
  )
}

/** Under their name: staff or freelancer, department and level, and the name they go by. */
function WhoLine({ person }: { person: PersonView }) {
  const kind = person.kind === 'staff' ? (person.role ? ROLE_LABELS[person.role] : 'Staff') : 'Freelancer'
  return (
    <>
      <p>{[kind, person.department, levelLine(person.level)].filter(Boolean).join(' · ')}</p>
      {person.knownAs && <p>Goes by {person.knownAs}</p>}
    </>
  )
}

/** Ringing, messaging or emailing them, under their name whichever part is open. */
function Reach({ person }: { person: PersonView }) {
  const phone = person.phone?.trim()
  const email = person.email?.trim()
  if (!phone && !email) return null
  return (
        <div className="actions reach">
          {phone && (
            <a className="button" href={`tel:${phone.replace(/[^\d+]/g, '')}`}>
              <Icon name="phone" />
              Call {phone}
            </a>
          )}
          {phone && (
            <a className="button" href={`https://wa.me/${whatsappNumber(phone)}`} target="_blank" rel="noreferrer">
              <Icon name="message" />
              WhatsApp
            </a>
          )}
          {email && (
            <a className="button" href={`mailto:${email}`}>
              <Icon name="mail" />
              Email
            </a>
          )}
        </div>
  )
}

/** What the office must see whichever part is open (ADR 0082): archived, or brought in twice (ADR 0055). */
function Warnings({ person, view }: { person: PersonView; view: View }) {
  const access = useAccess()
  const twice = useSamePeople(view)
    .find((g) => g.people.some((p) => p.id === person.id))
    ?.people.filter((p) => p.id !== person.id)
  return (
    <>
      {person.archived && (
        <p className="warn-line">Archived: kept for the record, and offered no work. Bring them back from the Archived list on Crew.</p>
      )}
      {access.can('crew') && !person.archived && twice && twice.length > 0 && (
        <p className="warn-line">
          {twice.map((p) => p.name).join(', ')} {twice.length === 1 ? 'looks' : 'look'} like the same person, brought in twice. Combine them under
          Details.
        </p>
      )}
    </>
  )
}

/** Their photo, what the office keeps about them, and changing it. */
function Who({ person, view }: { person: PersonView; view: View }) {
  const access = useAccess()
  // Someone whose role doesn't cover crew sees a person as they are, with nothing to change (ADR 0034).
  const mayEdit = access.can('crew') && !person.archived
  const role = roleOfPerson(person)
  // Their main email is how they're written to; for someone with a role, only who changes settings changes it, as with the email itself.
  const mayMakeMain = mayEdit && (!holdsARole(person) || access.can('settings'))
  const [editing, setEditing] = useState(false)
  const { run, error } = useAct()
  const phone = person.phone?.trim()
  const email = person.email?.trim()
  const kind = person.kind === 'staff' ? (person.role ? ROLE_LABELS[person.role] : 'Staff') : 'Freelancer'
  return (
    <section className="card who-card" aria-label="Details">
      <PersonPhoto person={person} />

      {/* Not sent to staff crew or freelancers (ADR 0062): said, so it isn't taken for none. */}
      {person.detailsHidden && (
        <p className="hint">
          Your role doesn't see {person.name}'s {person.phone ? 'email, notes or company' : 'phone, email, notes or company'}. The office has them.
        </p>
      )}
      {editing ? (
        <PersonForm
          initial={person}
          submitLabel="Save"
          onSubmit={(fields) => client.mutate('person.upsert', { id: person.id, ...fields })}
          onDone={() => setEditing(false)}
        />
      ) : (
        <>
          <dl className="facts">
            {email && (
              <div>
                <dt>Email</dt>
                <dd>{email}</dd>
              </div>
            )}
            {/* The addresses they had as someone combined with them (ADR 0055): a bring-in and their sign-in find them by these too.
                Any can be made the main one (ADR 0064); the one it replaces joins these, so it's undone the same way. */}
            {(person.otherEmails ?? []).length > 0 && (
              <div>
                <dt>Also found by</dt>
                <dd>
                  {mayMakeMain ? (
                    <ul className="also-emails">
                      {person.otherEmails!.map((e) => (
                        <li key={e}>
                          {e}{' '}
                          <button
                            type="button"
                            className="link"
                            aria-label={`Make ${e} ${person.name}'s main email`}
                            onClick={() => void run(() => client.mutate('person.mainEmail', { id: person.id, email: e }))}
                          >
                            Make main
                          </button>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    person.otherEmails!.join(', ')
                  )}
                </dd>
              </div>
            )}
            {(person.dayRateCents !== null || person.rateHidden) && (
              <div>
                <dt>Day rate</dt>
                {/* Not sent to a role that doesn't see crew rates (ADR 0046): said, so it isn't taken for none. */}
                <dd>{person.rateHidden ? 'Hidden for your role' : euro(person.dayRateCents)}</dd>
              </div>
            )}
            {person.skills.length > 0 && (
              <div>
                <dt>Skills</dt>
                <dd>{person.skills.join(', ')}</dd>
              </div>
            )}
            {person.company && (
              <div>
                <dt>Company</dt>
                <dd>{companyLine(person)}</dd>
              </div>
            )}
            {person.company?.vatNumber && (
              <div>
                <dt>VAT number</dt>
                <dd>{person.company.vatNumber}</dd>
              </div>
            )}
            {person.company?.croNumber && (
              <div>
                <dt>CRO number</dt>
                <dd>{person.company.croNumber}</dd>
              </div>
            )}
            {person.kind === 'staff' && person.approvesLeave && (
              <div>
                <dt>Time off</dt>
                <dd>
                  Approves time off ·{' '}
                  <a className="link" href="#crew/leave">
                    Leave
                  </a>
                </dd>
              </div>
            )}
          </dl>
          {person.notes && <p className="notes">{person.notes}</p>}
          {mayEdit && (
            <label className="level-pick">
              Level
              <select
                value={person.level}
                onChange={(e) => void run(() => client.mutate('person.level', { id: person.id, level: Number(e.target.value) }))}
                aria-label={`Level for ${person.name}`}
              >
                {LEVELS.map((n) => (
                  <option key={n} value={n}>
                    {levelLine(n)}
                  </option>
                ))}
              </select>
            </label>
          )}
          {role && (
            <RolePick
              person={person}
              role={role}
              mayChange={access.can('company')}
              onChange={(next) => void run(() => client.mutate('person.role', { id: person.id, role: next }))}
            />
          )}
          {mayEdit && (
            <button type="button" onClick={() => setEditing(true)}>
              Change details
            </button>
          )}
          {mayEdit && (
            <Fold label="Combine with…" className="combine-open">
              <CombineWith view={view} person={person} />
            </Fold>
          )}
        </>
      )}
      <Refusal error={error} />
    </section>
  )
}

/** What's ahead for them: bookings, offers still waiting on an answer, and days off, with marking more days off and archiving. */
function ComingUp({ person, view, onArchived }: { person: PersonView; view: View; onArchived: (p: { id: string; name: string }) => void }) {
  const crew = view.crew
  const today = useToday()
  const mayEdit = useAccess().can('crew') && !person.archived
  const { run, error, refuse } = useAct()
  const [away, setAway] = useState({ start: today, end: today, note: '' })
  const ahead = crew.calls.flatMap((c) =>
    c.status === 'open' && c.end >= today ? c.offers.filter((o) => o.personId === person.id).map((o) => ({ c, o })) : [],
  )
  const booked = ahead.filter(({ o }) => o.status === 'accepted' || o.status === 'confirmed')
  // Offers still waiting on them: like a booking, settled before they can be archived. The server checks the same.
  const waiting = ahead.filter(({ o }) => o.status === 'offered' || o.status === 'countered')
  const off = crew.unavailability.filter((u) => u.personId === person.id && u.end >= today)
  const lines = [...booked, ...waiting].sort((a, b) => (a.o.days[0] ?? a.c.start).localeCompare(b.o.days[0] ?? b.c.start))
  const archive = () => {
    // The same test as the server's: held days from today on, or any offer still waiting.
    const hold = booked.find(({ o }) => o.days.some((d) => d >= today)) ?? waiting[0]
    if (hold) {
      const job = hold.c.phase ? `${hold.c.project} (${hold.c.phase})` : hold.c.project
      return refuse(
        hold.o.status === 'confirmed'
          ? `${person.name} is booked on ${job}; release them first.`
          : hold.o.status === 'accepted'
            ? `${person.name} has accepted ${job}; release them first.`
            : `${person.name} has an open offer for ${job}; withdraw it first.`,
      )
    }
    void run(() => client.mutate('person.archive', { id: person.id, archived: true })).then((ok) => {
      if (!ok) return
      onArchived({ id: person.id, name: person.name })
      location.hash = '#crew/people'
    })
  }
  return (
    <section className="card" aria-label="Coming up">
      <Heading icon="calendar">Coming up</Heading>
      {lines.length === 0 && off.length === 0 && <Empty>Nothing booked or offered, and no days off.</Empty>}
      {lines.length > 0 && (
        <ul className="job-list">
          {lines.map(({ c, o }) => {
            const [label, tone] = STATUS[o.status]
            const inner = (
              <>
                <div>
                  <b>{c.project}</b>
                  <p>{[c.phase, c.role, daysLabel(o.days)].filter(Boolean).join(' · ')}</p>
                </div>
                <div className="side">
                  <StatusPill tone={tone} pending={o.pending}>
                    {label}
                  </StatusPill>
                </div>
              </>
            )
            return (
              <li key={o.id}>
                {c.projectId ? (
                  <a className="job-row" href={`#jobs/${c.projectId}/crew`}>
                    {inner}
                  </a>
                ) : (
                  <div className="job-row">{inner}</div>
                )}
              </li>
            )
          })}
        </ul>
      )}
      {off.map((u) => (
        <p key={u.id}>
          Off {daysLabel(eachDay(u.start, u.end))}
          {u.note && ` (${u.note})`}
          {u.source === 'self' && ' · said on their link'}
          {/* Approved leave is cancelled on the Leave screen, so the two never disagree (ADR 0024). */}
          {u.source === 'leave' || !mayEdit ? (
            u.source === 'leave' && (
              <>
                {' · '}
                <a className="link" href="#crew/leave">
                  approved leave
                </a>
              </>
            )
          ) : (
            <>
              {' '}
              <button type="button" className="link" onClick={() => void run(() => client.mutate('unavailability.remove', { id: u.id }))}>
                Remove
              </button>
            </>
          )}
        </p>
      ))}
      {mayEdit && (
        <Fold label="Mark days off">
          <form
            className="away-form"
            onSubmit={(e) => {
              e.preventDefault()
              void run(() =>
                client.mutate('unavailability.add', {
                  id: newId(),
                  personId: person.id,
                  start: away.start,
                  end: away.end < away.start ? away.start : away.end,
                  note: away.note,
                }),
              )
            }}
          >
            {/* Each field's name is over it, not only inside it, so it stays once something is typed (audit finding 22). */}
            <label className="field">
              Off from <input type="date" value={away.start} onChange={(e) => setAway({ ...away, start: e.target.value })} />
            </label>
            <label className="field">
              Off until <input type="date" value={away.end} min={away.start} onChange={(e) => setAway({ ...away, end: e.target.value })} />
            </label>
            <label className="field wide">
              Note <input placeholder="e.g. on tour" value={away.note} onChange={(e) => setAway({ ...away, note: e.target.value })} />
            </label>
            <button type="submit">Mark days off</button>
          </form>
        </Fold>
      )}
      <Refusal error={error} />
      {mayEdit && (
        // Reversible, so done at once: the list it goes back to says who was archived, with the way back (rule 10).
        <button type="button" className="link" onClick={archive}>
          Archive
        </button>
      )}
    </section>
  )
}

/** Their private link and calendar feed (ADR 0002, ADR 0012): open it as they see it, copy it to send, or replace it. */
function TheirLink({ person }: { person: PersonView }) {
  const mayEdit = useAccess().can('crew')
  // Which address was just copied, said on its button (rule 10).
  const [copied, setCopied] = useState<'link' | 'feed' | undefined>()
  const copy = (what: 'link' | 'feed', text: string) => void navigator.clipboard?.writeText(text).then(() => setCopied(what))
  const [relinking, setRelinking] = useState(false)
  const { run, error } = useAct()
  const link = linkFor(person)
  const feed = useFeedAddress(person.linkToken)
  if (!mayEdit) return null
  return (
    <section className="card" aria-label="Their link">
      <Heading icon="link">Their link</Heading>
      <p className="hint">
        {person.kind === 'staff'
          ? // Staff sign in with Google only (ADR 0052): their page asks for it, so the link alone opens nothing.
            'Where they answer calls, mark days off and send documents. It asks for their Google sign-in first, so it only opens for them, the office or a director.'
          : 'Where they answer offers, mark days off and send documents, with no app or login.'}{' '}
        Their bookings go to their own calendar from there too.
      </p>
      {/* Not sent to this role (ADR 0046): said plainly, so it isn't taken for a link not made yet. */}
      {person.linkHidden && <p className="hint">Your role doesn't see {person.name}'s link. The office or a director can open it or send it.</p>}
      <div className="actions">
        {link && (
          <>
            <a className="button" href={link} target="_blank" rel="noreferrer">
              Open their page
            </a>
            <button type="button" onClick={() => copy('link', link)}>
              {copied === 'link' ? 'Copied' : 'Copy link'}
            </button>
          </>
        )}
        {feed && (
          <button type="button" onClick={() => copy('feed', feed)}>
            {copied === 'feed' ? 'Copied' : 'Copy calendar address'}
          </button>
        )}
        {/* A new link for someone whose link this role isn't sent would stop theirs working with nothing to send them (ADR 0046). */}
        {!relinking && !person.linkHidden && (
          <button type="button" className="link" onClick={() => setRelinking(true)}>
            New link
          </button>
        )}
      </div>
      {relinking && (
        <Confirm
          question={`Make a new link for ${person.name}? The old one stops working, so anything sent with it no longer opens.`}
          yes="Make a new link"
          no="Keep the old one"
          onYes={() => {
            setRelinking(false)
            void run(() => client.mutate('person.newLink', { id: person.id }))
          }}
          onNo={() => setRelinking(false)}
        />
      )}
      <Refusal error={error} />
    </section>
  )
}

/**
 * A member of staff's role (ADR 0034): what they can change once signed in.
 * A director picks it here, with what the role covers said under it; anyone
 * else sees it as a line. The server keeps at least one director.
 */
function RolePick({ person, role, mayChange, onChange }: { person: PersonView; role: Role; mayChange: boolean; onChange: (role: Role) => void }) {
  const hint = useId()
  if (!mayChange) return <p className="muted">Role: {ROLE_LABELS[role]}</p>
  return (
    <div className="role-pick">
      <label className="level-pick">
        Role
        <select value={role} onChange={(e) => onChange(e.target.value as Role)} aria-label={`Role for ${person.name}`} aria-describedby={hint}>
          {ROLES.map((r) => (
            <option key={r} value={r}>
              {ROLE_LABELS[r]}
            </option>
          ))}
        </select>
      </label>
      <p className="hint" id={hint}>
        {ROLE_LINES[role]}
      </p>
    </div>
  )
}

/**
 * The certificates someone holds, with any note such as an IPAF card's
 * categories, any running out in the next 30 days in the warn tone (ADR
 * 0028), and any run out in the bad tone (ADR 0025). Nothing for ones not
 * held or not known.
 */
function CertificateLines({ person }: { person: PersonView }) {
  const today = useToday()
  const states = CERTIFICATE_KINDS.map((kind) => ({ kind, c: person.certificates[kind], state: certificateState(person.certificates[kind], today) }))
  const held = states.filter((x) => x.state === 'held')
  const expired = states.filter((x) => x.state === 'expired')
  const soon = held.filter((x) => x.c?.expires && daysBetween(today, x.c.expires) <= CERTIFICATE_SOON_DAYS)
  if (!held.length && !expired.length) return <p className="hint">No certificates held that the office knows of.</p>
  return (
    <>
      {held.length > 0 && (
        <p className="muted">
          Holds{' '}
          {held
            .map(
              (x) =>
                `${certificateName(x.kind)}${x.c?.note.trim() ? ` ${x.c.note.trim()}` : ''}${x.c?.expires ? ` (to ${dateLabel(x.c.expires)})` : ''}`,
            )
            .join(', ')}
        </p>
      )}
      {soon.map((x) => (
        <p key={x.kind} className="warn-line">
          {CERTIFICATE_LABELS[x.kind]} runs out on {dateLabel(x.c!.expires!)}.
        </p>
      ))}
      {expired.map((x) => (
        <p key={x.kind} className="alert">
          {CERTIFICATE_LABELS[x.kind]} ran out on {dateLabel(x.c!.expires!)}.
        </p>
      ))}
    </>
  )
}

/** The jobs someone was booked on, newest first (ADR 0025), each opening its job: the first ten, and the rest a tap away. */
function Worked({ person }: { person: PersonView }) {
  const { worked } = person
  return (
    <section className="card" aria-label={`Worked: ${person.name}`}>
      <Heading icon="history">Worked{worked.length > 0 && ` (${worked.length === 1 ? '1 job' : `${worked.length} jobs`})`}</Heading>
      {worked.length === 0 && <Empty>No jobs worked yet. Each booking shows here from its first day.</Empty>}
      <ShowAll items={worked} limit={10} what="jobs">
        {(rows) => (
          <ul className="job-list">
            {rows.map((w) => {
              const inner = (
                <div>
                  <b>{w.name}</b>
                  <p>{[w.phase, daysLabel(eachDay(w.start, w.end))].filter(Boolean).join(' · ')}</p>
                </div>
              )
              return (
                <li key={w.callId}>
                  {w.projectId ? (
                    <a className="job-row" href={`#jobs/${w.projectId}/crew`}>
                      {inner}
                    </a>
                  ) : (
                    <div className="job-row">{inner}</div>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </ShowAll>
    </section>
  )
}

