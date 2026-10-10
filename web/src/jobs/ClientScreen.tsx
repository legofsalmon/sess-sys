import { type ClientView, type Contact, type View } from '@sh/shared'
import { useState, type FormEvent } from 'react'
import { Refusal, useAct } from '../act.tsx'
import { Pending } from '../StatusPill.tsx'
import { client } from '../sync.ts'
import { Attachments, JobsCard } from './Attachments.tsx'
import { Page } from './common.tsx'

/**
 * One client on a page of its own (ADR 0032, #clients/<id>): who to talk
 * to there, the notes, the documents kept for them (their contract,
 * purchase orders, a brief…), and their jobs.
 */

export function ClientScreen({ view, id }: { view: View; id: string }) {
  const found = view.jobs.clients.find((c) => c.id === id)
  const back = (
    <a className="back" href="#jobs">
      ‹ All jobs
    </a>
  )
  if (!found)
    return (
      <Page view={view} title="Client" className="crew jobs" back={back}>
        <section className="card">
          <p className="empty">This client isn't on this device. It may still be on its way: check again once it says “Up to date”.</p>
        </section>
      </Page>
    )
  return (
    <Page view={view} title="Client" className="crew jobs" back={back}>
      <ClientSummary c={found} />
      <Attachments owner={{ owner: 'client', id: found.id, name: found.name }} />
      <JobsCard jobs={view.jobs.jobs.filter((j) => j.clientId === found.id)} title="Their jobs" />
    </Page>
  )
}

function ClientSummary({ c }: { c: ClientView }) {
  const [editing, setEditing] = useState(false)
  return (
    <section className="card">
      <header className="title">
        <h1>{c.name}</h1>
        <Pending pending={c.pending} />
      </header>
      <dl className="facts">
        {c.contacts.length === 0 && (
          <div>
            <dt>Contacts</dt>
            <dd>None yet</dd>
          </div>
        )}
        {c.contacts.map((x, i) => (
          <div key={i}>
            <dt>{x.role || 'Contact'}</dt>
            <dd>
              {x.name}
              {/* Each on a line of its own, so a number never breaks across two on a phone. */}
              {x.phone && (
                <>
                  <br />
                  <a href={`tel:${x.phone.replace(/[^+\d]/g, '')}`}>{x.phone}</a>
                </>
              )}
              {x.email && (
                <>
                  <br />
                  <a href={`mailto:${x.email}`}>{x.email}</a>
                </>
              )}
            </dd>
          </div>
        ))}
      </dl>
      {c.notes && <p className="notes">{c.notes}</p>}
      {editing ? (
        <EditClient c={c} onDone={() => setEditing(false)} />
      ) : (
        <button type="button" onClick={() => setEditing(true)}>
          Change details
        </button>
      )}
    </section>
  )
}

const blankContact = (): Contact => ({ name: '', role: '', email: null, phone: null })

function EditClient({ c, onDone }: { c: ClientView; onDone: () => void }) {
  const [f, setF] = useState({ name: c.name, notes: c.notes, contacts: c.contacts })
  const { run, error } = useAct()
  const setContact = (i: number, changes: Partial<Contact>) => setF({ ...f, contacts: f.contacts.map((x, j) => (j === i ? { ...x, ...changes } : x)) })
  const save = (e: FormEvent) => {
    e.preventDefault()
    if (!f.name.trim()) return
    const contacts = f.contacts
      .filter((x) => x.name.trim())
      .map((x) => ({ name: x.name.trim(), role: x.role.trim(), email: x.email?.trim() || null, phone: x.phone?.trim() || null }))
    void run(() => client.mutate('client.upsert', { id: c.id, name: f.name.trim(), contacts, notes: f.notes.trim() })).then((ok) => ok && onDone())
  }
  return (
    <form className="grid-form" onSubmit={save} aria-label={`Change ${c.name}`}>
      <label className="wide">
        Name <input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required />
      </label>
      {f.contacts.map((x, i) => (
        <fieldset className="wide contact" key={i}>
          <legend>Contact {i + 1}</legend>
          {/* Each field's name is over it, not only inside it, so it stays once something is typed (audit finding 22). */}
          <label>
            Name <input value={x.name} onChange={(e) => setContact(i, { name: e.target.value })} />
          </label>
          <label>
            Role <input value={x.role} onChange={(e) => setContact(i, { role: e.target.value })} placeholder="e.g. Producer" />
          </label>
          <label>
            Mobile <input type="tel" value={x.phone ?? ''} onChange={(e) => setContact(i, { phone: e.target.value })} />
          </label>
          <label>
            Email <input type="email" value={x.email ?? ''} onChange={(e) => setContact(i, { email: e.target.value })} />
          </label>
        </fieldset>
      ))}
      <button type="button" className="wide" onClick={() => setF({ ...f, contacts: [...f.contacts, blankContact()] })}>
        Add a contact
      </button>
      <label className="wide">
        Notes <textarea rows={2} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} />
      </label>
      <Refusal error={error} className="wide" />
      <button type="submit" className="primary">
        Save client
      </button>
      <button type="button" onClick={onDone}>
        Cancel
      </button>
    </form>
  )
}
