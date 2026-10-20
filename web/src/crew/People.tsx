import {
  APPLICANT_LEVEL,
  CERTIFICATE_KINDS,
  CERTIFICATE_LABELS,
  CREW_DEPARTMENTS,
  DEFAULT_LEVEL,
  euro,
  euroText,
  levelLabel,
  levelLine,
  LEVELS,
  newId,
  parseEuro,
  tidyDepartment,
  type CertificateKind,
  type Certificates,
  type CommandInput,
  type CrewView,
  type PersonView,
  type View,
  namedFromAddress,
  emailInUseRefusal,
  emailTakenBy,
  holdsARole,
  ROLE_LABELS,
  sameEmail,
  whoSignsInRefusal,
} from '@sh/shared'
import { useId, useState, type FormEvent } from 'react'
import { Refusal, useAct } from '../act.tsx'
import { Pending } from '../StatusPill.tsx'
import { useAccess, useSeesRates } from '../role.ts'
import { client } from '../sync.ts'
import { useToday, useView } from '../view.ts'
import { personHref } from './PersonScreen.tsx'
import { useSamePeople } from './Combine.tsx'
import { Avatar } from '../Picture.tsx'

/**
 * Crew › People's parts: finding someone, their line in the list, and the
 * form for adding or changing a person. The screen that lists them is
 * CrewScreen.tsx.
 */

/** A department as compared: free text, so "audio" and "Audio" are one. */
export const dept = (p: Pick<PersonView, 'department'>) => (p.department ?? '').toLowerCase()

/** Lower case with the fadas off, so "padraig" finds Pádraig and "sean" finds Seán: names are often typed without them. */
const plain = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()

/** The words typed into a search for someone. */
export const wordsOf = (typed: string) => plain(typed).split(/\s+/).filter(Boolean)

/**
 * Whether every word typed is in someone's name, the name they go by, their
 * department or a skill (audit finding 16): the picker's search and the
 * people list's find people the same way.
 */
export function found(p: PersonView, words: readonly string[]): boolean {
  const text = plain([p.name, p.knownAs, p.department, ...p.skills].filter(Boolean).join(' '))
  return words.every((w) => text.includes(w))
}

/**
 * One person in the People list: their name and a line of who they are
 * and what's ahead, opening their page (#crew/person/<id>), where
 * everything else about them is.
 */
export function PersonRow({ person, crew }: { person: PersonView; crew: CrewView }) {
  const today = useToday()
  const held = crew.calls.flatMap((c) =>
    c.status === 'open' && c.end >= today ? c.offers.filter((o) => o.personId === person.id && (o.status === 'accepted' || o.status === 'confirmed')) : []
  )
  // Booked means confirmed; someone who has said yes is still to confirm.
  const confirmed = held.filter((o) => o.status === 'confirmed').length
  const toConfirm = held.length - confirmed
  const off = crew.unavailability.some((u) => u.personId === person.id && u.end >= today)
  return (
    <div className="row person">
      <a className="who pictured" href={personHref(person.id)}>
        <Avatar name={person.name} />
        <span>
          <b>{person.name}</b>
          <small>
            {[
              // A role set says more than "Staff"; none set is staff crew, which is what "Staff" says (ADR 0034).
              person.kind === 'staff' ? (person.role ? ROLE_LABELS[person.role] : 'Staff') : null,
              person.department,
              levelLine(person.level),
              person.kind === 'staff' && person.approvesLeave ? 'approves time off' : null,
              person.skills.join(', '),
              // A rate this device isn't sent (ADR 0046) isn't said in the list; their page says it's hidden.
              person.dayRateCents !== null && !person.rateHidden ? `${euro(person.dayRateCents)}/day` : null,
            ]
              .filter(Boolean)
              .join(' · ')}
            {confirmed > 0 && ` · ${confirmed} booking${confirmed === 1 ? '' : 's'}`}
            {toConfirm > 0 && ` · ${toConfirm} to confirm`}
            {off && ' · has days off'}
          </small>
        </span>
      </a>
      <Pending pending={person.pending} />
    </div>
  )
}

/** Adding someone; `onAdded` hears who once the device has them, so the list can keep them in view. */
export function NewPerson({ onAdded }: { onAdded: (p: { id: string; name: string }) => void }) {
  return (
    <PersonForm
      submitLabel="Add person"
      onSubmit={async (fields) => {
        const id = newId()
        await client.mutate('person.upsert', { id, ...fields })
        onAdded({ id, name: fields.name })
      }}
    />
  )
}

type PersonFields = Omit<CommandInput<'person.upsert'>, 'id'>

/**
 * A person's details: the Add form, and the same form again to correct
 * them (audit finding 7). A refused change says why under the fields and
 * keeps what was typed.
 */
/** A certificate as the form holds it: yes, no or not known, an expiry day or none, and a note, such as an IPAF card's categories (ADR 0028). */
type CertField = { held: '' | 'yes' | 'no'; expires: string; note: string }

type CertFields = Record<CertificateKind, CertField>

const blankCerts = (): CertFields => Object.fromEntries(CERTIFICATE_KINDS.map((kind) => [kind, { held: '', expires: '', note: '' }])) as CertFields

function certFieldsOf(c: Certificates): CertFields {
  const out = blankCerts()
  for (const kind of CERTIFICATE_KINDS) {
    const x = c[kind]
    if (x) out[kind] = { held: x.held === null ? '' : x.held ? 'yes' : 'no', expires: x.expires ?? '', note: x.note }
  }
  return out
}

/** Every kind goes back, one not known as not known: the server keeps a newer kind that's left out, for a version of the app that doesn't know it (ADR 0028). */
function certificatesOf(fields: CertFields): Certificates {
  const out: Certificates = {}
  for (const kind of CERTIFICATE_KINDS) {
    const f = fields[kind]
    out[kind] = { held: f.held === '' ? null : f.held === 'yes', expires: f.expires || null, note: f.note.trim() }
  }
  return out
}

export function PersonForm({ initial, submitLabel, onSubmit, onDone }: { initial?: PersonView; submitLabel: string; onSubmit: (fields: PersonFields) => Promise<unknown>; onDone?: () => void }) {
  const access = useAccess()
  // Who approves time off is a permission, so it's a director's to give once roles are on (ADR 0034); the form keeps it as it was.
  const mayApprove = access.can('company')
  // The email and type of someone who holds a role are how they sign in as it, so only the office and directors change them (audit finding 12).
  const whoFixed = initial && initial.role && holdsARole(initial) && !access.can('settings') ? initial.role : null
  const people = useView().crew.people
  // A rate this device isn't sent (ADR 0046) isn't in the form, and the server keeps the one it has.
  const seesRates = useSeesRates() && !initial?.rateHidden
  const blank = {
    name: '',
    phone: '',
    email: '',
    skills: '',
    rate: '',
    kind: 'freelancer' as 'freelancer' | 'staff',
    notes: '',
    approvesLeave: false,
    department: '',
    knownAs: '',
    level: String(DEFAULT_LEVEL),
    certs: blankCerts(),
    companyName: '',
    vatNumber: '',
    croNumber: '',
  }
  const from = (p: PersonView) => ({
    name: p.name,
    phone: p.phone ?? '',
    email: p.email ?? '',
    skills: p.skills.join(', '),
    rate: p.dayRateCents === null ? '' : euroText(p.dayRateCents),
    kind: p.kind,
    notes: p.notes,
    approvesLeave: p.approvesLeave,
    department: p.department ?? '',
    knownAs: p.knownAs ?? '',
    level: String(p.level),
    certs: certFieldsOf(p.certificates),
    companyName: p.company?.name ?? '',
    vatNumber: p.company?.vatNumber ?? '',
    croNumber: p.company?.croNumber ?? '',
  })
  const [f, setF] = useState(initial ? from(initial) : blank)
  // The profile (ADR 0025) folds away on a phone, open when any of it is set; once open or shut by hand it stays so.
  const [moreOpen] = useState(() => !!initial && (!!initial.department || !!initial.knownAs || initial.level !== DEFAULT_LEVEL || !!initial.company || Object.values(initial.certificates).some((c) => c && (c.held !== null || !!c.expires || !!c.note))))
  const listId = useId()
  const { run, error, refuse } = useAct()
  const set = (k: Exclude<keyof typeof blank, 'approvesLeave' | 'certs'>) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value })
  // Only freelancers trade through a company (ADR 0025); one a member of staff already has (from the crew list, say)
  // stays in view so it can be seen and cleared, never dropped without a word.
  const showCompany = f.kind === 'freelancer' || !!initial?.company
  const setCert = (kind: CertificateKind, field: Partial<CertField>) => setF({ ...f, certs: { ...f.certs, [kind]: { ...f.certs[kind], ...field } } })
  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (!f.name.trim()) return
    const rate = parseEuro(f.rate)
    if (rate.reason !== undefined) return refuse(rate.reason)
    const company = f.companyName.trim() || f.vatNumber.trim() || f.croNumber.trim()
    const email = f.email.trim() || null
    // Each email is one person's, as the server checks it (audit finding 12).
    const other = sameEmail(email, initial?.email) ? undefined : emailTakenBy(people, initial?.id ?? '', email)
    if (other) return refuse(emailInUseRefusal(other.name))
    void run(() =>
      onSubmit({
        name: f.name.trim(),
        kind: f.kind,
        phone: f.phone.trim() || null,
        email,
        skills: f.skills.split(',').map((s) => s.trim()).filter(Boolean),
        ...(seesRates ? { dayRateCents: rate.cents } : {}),
        notes: f.notes.trim(),
        // Only staff approve time off (ADR 0024).
        approvesLeave: f.kind === 'staff' && f.approvesLeave,
        department: tidyDepartment(f.department),
        knownAs: f.knownAs.trim() || null,
        level: Number(f.level),
        certificates: certificatesOf(f.certs),
        company: showCompany && company ? { name: f.companyName.trim(), vatNumber: f.vatNumber.trim() || null, croNumber: f.croNumber.trim() || null } : null,
      })
    ).then((taken) => {
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
        Email <input type="email" value={f.email} onChange={set('email')} readOnly={!!whoFixed} />
      </label>
      <label>
        Skills <input value={f.skills} onChange={set('skills')} placeholder="audio, rigger" />
      </label>
      {seesRates && (
        <label>
          Usual day rate € <input inputMode="decimal" value={f.rate} onChange={set('rate')} />
        </label>
      )}
      <label>
        Type
        <select value={f.kind} onChange={set('kind')} disabled={!!whoFixed}>
          <option value="freelancer">Freelancer</option>
          <option value="staff">Staff</option>
        </select>
      </label>
      {whoFixed && <p className="hint wide">{whoSignsInRefusal(initial!.name, whoFixed)}</p>}
      {f.kind === 'staff' && mayApprove && (
        <label className="wide tick">
          <input type="checkbox" checked={f.approvesLeave} onChange={(e) => setF({ ...f, approvesLeave: e.target.checked })} />
          <span>
            Can approve time off
            <small>Decides other staff's leave and days in lieu, and sets allowances, on the Leave screen.</small>
          </span>
        </label>
      )}
      <label className="wide">
        Notes <textarea rows={2} value={f.notes} onChange={set('notes')} placeholder="Notes for the office" />
      </label>
      <p className="hint wide">They can read these in their own data download.</p>
      <details className="wide more" open={moreOpen}>
        <summary>More: department, level, certificates{showCompany ? ', company' : ''}</summary>
        <div className="more-grid">
          <label>
            Department <input list={listId} value={f.department} onChange={set('department')} placeholder="Audio, LX…" maxLength={60} />
            <datalist id={listId}>
              {CREW_DEPARTMENTS.map((d) => (
                <option key={d} value={d} />
              ))}
            </datalist>
          </label>
          <label>
            Known as <input value={f.knownAs} onChange={set('knownAs')} placeholder="The name they go by" maxLength={100} />
          </label>
          <label className="wide">
            Level
            <select value={f.level} onChange={set('level')}>
              {LEVELS.map((n) => (
                <option key={n} value={n}>
                  {levelLabel(n)}
                </option>
              ))}
            </select>
            <small>{Number(f.level) === APPLICANT_LEVEL ? 'An applicant, not vetted yet: out of the Offer to… picker unless asked for.' : 'Higher is more preferred. 1 is known.'}</small>
          </label>
          {CERTIFICATE_KINDS.map((kind) => (
            <div className="cert wide" key={kind}>
              <label>
                {CERTIFICATE_LABELS[kind]}
                <select value={f.certs[kind].held} onChange={(e) => setCert(kind, { held: e.target.value as CertField['held'] })}>
                  <option value="">Unknown</option>
                  <option value="yes">Yes</option>
                  <option value="no">No</option>
                </select>
              </label>
              <label>
                Expires <input type="date" value={f.certs[kind].expires} onChange={(e) => setCert(kind, { expires: e.target.value })} aria-label={`${CERTIFICATE_LABELS[kind]} expires`} />
              </label>
              {/* Only for one held, or one with a note already: a phone's form stays short. */}
              {(f.certs[kind].held === 'yes' || !!f.certs[kind].note) && (
                <label className="cert-note">
                  Note
                  <input
                    value={f.certs[kind].note}
                    onChange={(e) => setCert(kind, { note: e.target.value })}
                    placeholder={kind === 'ipaf' ? 'Categories, e.g. 3a, 3b' : ''}
                    maxLength={200}
                    aria-label={`${CERTIFICATE_LABELS[kind]} note`}
                  />
                </label>
              )}
            </div>
          ))}
          {showCompany && (
            <>
              <label className="wide">
                Company <input value={f.companyName} onChange={set('companyName')} placeholder="If they trade through a company" maxLength={200} />
              </label>
              <label>
                VAT number <input value={f.vatNumber} onChange={set('vatNumber')} maxLength={40} />
              </label>
              <label>
                CRO number <input value={f.croNumber} onChange={set('croNumber')} maxLength={40} />
              </label>
            </>
          )}
        </div>
      </details>
      <Refusal error={error} className="wide" />
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

/** A quiet line while anyone brought in from the calendars is still named from their address (audit of 16 October, finding 7). */
export function NamedFromAddress({ view }: { view: View }) {
  const mayCrew = useAccess().can('crew')
  const n = view.crew.people.filter(namedFromAddress).length
  // And anyone who looks brought in twice, under two addresses (ADR 0055).
  const twice = useSamePeople(view).length
  if (!mayCrew || (n === 0 && twice === 0)) return null
  const said = [
    twice > 0 && `${twice === 1 ? '1 person looks' : `${twice.toLocaleString('en-IE')} people look`} brought in twice`,
    n > 0 && `${n === 1 ? '1 person is' : `${n.toLocaleString('en-IE')} people are`} still named from their email address`,
  ].filter(Boolean)
  return (
    <p className="hint">
      {said.join(', and ')}. <a href="#jobs/tidy">{twice > 0 ? 'Tidy them up' : 'Give them their names'}</a>
    </p>
  )
}
