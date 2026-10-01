import { officeLine, type OfficeView } from '@sh/shared'
import { useState, type FormEvent } from 'react'
import { client, syncSoon } from './sync.ts'

/**
 * The office's own details (audit finding 10): shown on every freelancer
 * page as a way back to the office, so someone booked can ring or email
 * without the app. Saved like any other change, so it works with no signal
 * and syncs later.
 */
export function OfficeCard({ office }: { office: OfficeView }) {
  const { details } = office
  // Starts again from what's saved whenever that changes, such as when another device's change syncs.
  return <Form key={`${details?.name ?? ''}|${details?.phone ?? ''}|${details?.email ?? ''}`} office={office} />
}

function Form({ office }: { office: OfficeView }) {
  const { details, pending } = office
  const [f, setF] = useState({ name: details?.name ?? 'Session Hire office', phone: details?.phone ?? '', email: details?.email ?? '' })
  const [problem, setProblem] = useState('')
  const shown = officeLine(details)
  const save = (e: FormEvent) => {
    e.preventDefault()
    setProblem('')
    client.mutate('office.update', { name: f.name.trim(), phone: f.phone.trim() || null, email: f.email.trim() || null }).then(syncSoon, (err: Error) => setProblem(err.message))
  }
  return (
    <section className="card office" aria-labelledby="office-title">
      <h2 id="office-title">Office details</h2>
      <p>
        At the top of every freelancer's page, so someone booked can ring or email the office.{' '}
        {shown ? (
          <>
            Now: <b>{shown}</b>.
          </>
        ) : (
          'Nothing is shown until a phone or an email is saved here.'
        )}
      </p>
      <form className="office-form" onSubmit={save}>
        <label className="wide">
          Name <input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} maxLength={200} placeholder="Session Hire office" />
        </label>
        <label>
          Phone <input type="tel" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} placeholder="01 234 5678" />
        </label>
        <label>
          Email <input type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} placeholder="office@…" />
        </label>
        <div className="actions wide">
          <button type="submit" className="primary">
            Save
          </button>
          {pending && <span className="pill pending">Waiting to sync</span>}
        </div>
      </form>
      {problem && (
        <p className="alert" role="alert">
          {problem}
        </p>
      )}
    </section>
  )
}
