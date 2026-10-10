import {
  documentFileName,
  FILE_HEAD_BYTES,
  FILE_TOO_BIG,
  fileLabel,
  FILES_WAIT_VENUE,
  fileTypeOf,
  linkHost,
  mapLink,
  MAX_FILE_BYTES,
  newId,
  spanLabel,
  STOPPED,
  VENUE_DOCUMENT_KIND_LABELS,
  VENUE_DOCUMENT_KINDS,
  VENUE_DOCUMENT_TITLES,
  venueDocumentDetails,
  venueTitleInSentence,
  type JobView,
  type VenueDocumentDetails,
  type VenueDocumentKind,
  type VenueDocumentView,
  type VenueView,
  type View,
} from '@sh/shared'
import { useRef, useState, type FormEvent } from 'react'
import { Confirm, Refusal, useAct } from '../act.tsx'
import { ACCEPT, refusal, useDocumentStorage } from '../crew/Documents.tsx'
import { Empty } from '../Empty.tsx'
import { Fold } from '../Fold.tsx'
import { Pending } from '../StatusPill.tsx'
import { client } from '../sync.ts'
import { useToday } from '../view.ts'
import { JobStatusPill, Page } from './common.tsx'

/**
 * One venue on a page of its own (ADR 0032, #venues/<id>): where it is,
 * what to know getting in, the documents kept for it (its tech spec, floor
 * plan, health and safety pack…, each a file, a link to where the venue
 * shares it, or both), and the jobs there. The details and links work with
 * no signal; a file goes to the server and comes back from it, as a
 * person's documents do (ADR 0029).
 */

const base = import.meta.env.VITE_API_BASE ?? ''

/** The jobs at a venue: the job's own, or one of its phases'. */
export const jobsAt = (jobs: readonly JobView[], venueId: string) => jobs.filter((j) => j.venueId === venueId || j.phases.some((p) => p.venueId === venueId))

export function VenueScreen({ view, id }: { view: View; id: string }) {
  const venue = view.jobs.venues.find((v) => v.id === id)
  const back = (
    <a className="back" href="#jobs">
      ‹ All jobs
    </a>
  )
  if (!venue)
    return (
      <Page view={view} title="Venue" className="crew jobs" back={back}>
        <section className="card">
          <p className="empty">This venue isn't on this device. It may still be on its way: check again once it says “Up to date”.</p>
        </section>
      </Page>
    )
  return (
    <Page view={view} title="Venue" className="crew jobs" back={back}>
      <VenueSummary venue={venue} />
      <VenueDocuments venue={venue} docs={view.venueDocuments.of(venue.id)} />
      <VenueJobs jobs={jobsAt(view.jobs.jobs, venue.id)} />
    </Page>
  )
}

function VenueSummary({ venue }: { venue: VenueView }) {
  const [editing, setEditing] = useState(false)
  return (
    <section className="card">
      <header className="title">
        <h1>{venue.name}</h1>
        <Pending pending={venue.pending} />
      </header>
      <dl className="facts">
        <div>
          <dt>Address</dt>
          <dd>
            {venue.address ? <span className="lines">{venue.address}</span> : 'None yet'}{' '}
            <a href={mapLink(venue)} target="_blank" rel="noreferrer">
              Map
            </a>
          </dd>
        </div>
      </dl>
      {venue.notes && <p className="notes">{venue.notes}</p>}
      {editing ? (
        <EditVenue venue={venue} onDone={() => setEditing(false)} />
      ) : (
        <button type="button" onClick={() => setEditing(true)}>
          Change details
        </button>
      )}
    </section>
  )
}

function EditVenue({ venue, onDone }: { venue: VenueView; onDone: () => void }) {
  const [f, setF] = useState({ name: venue.name, address: venue.address, notes: venue.notes })
  const { run, error } = useAct()
  const save = (e: FormEvent) => {
    e.preventDefault()
    if (!f.name.trim()) return
    void run(() => client.mutate('venue.upsert', { id: venue.id, name: f.name.trim(), address: f.address.trim(), notes: f.notes.trim() })).then((ok) => ok && onDone())
  }
  return (
    <form className="grid-form" onSubmit={save} aria-label={`Change ${venue.name}`}>
      <label className="wide">
        Name <input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required />
      </label>
      <label className="wide">
        Address <textarea rows={2} value={f.address} onChange={(e) => setF({ ...f, address: e.target.value })} placeholder="With the Eircode, the map link goes straight there" />
      </label>
      <label className="wide">
        Notes <textarea rows={3} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} placeholder="Access, load-in, power, parking" />
      </label>
      <Refusal error={error} className="wide" />
      <button type="submit" className="primary">
        Save venue
      </button>
      <button type="button" onClick={onDone}>
        Cancel
      </button>
    </form>
  )
}

/**
 * A file put on a venue's document, with its details, as the request's
 * whole body. Checked here first by the server's own rules, so a refusal
 * is said in place with nothing sent.
 */
async function sendFile(details: VenueDocumentDetails, file: File) {
  if (file.size > MAX_FILE_BYTES) throw new Error(FILE_TOO_BIG)
  const found = fileTypeOf(new Uint8Array(await file.slice(0, FILE_HEAD_BYTES).arrayBuffer()))
  if ('refused' in found) throw new Error(found.refused)
  const q = new URLSearchParams({ client: client.clientId, venueId: details.venueId, kind: details.kind, title: details.title, link: details.link ?? '' })
  let res: Response
  try {
    res = await fetch(`${base}/api/venue-documents/${encodeURIComponent(details.id)}/file?${q}`, {
      method: 'POST',
      headers: { 'content-type': 'application/octet-stream' },
      body: file,
      signal: AbortSignal.timeout(120_000),
    })
  } catch {
    throw new Error("Couldn't reach the server. A file needs signal to send: try again when you have it, or keep a link to it meanwhile.")
  }
  if (!res.ok) throw await refusal(res)
}

/** A venue's document's file, from the server, saved as a download named for the venue and what it is. */
async function openFile(venue: VenueView, doc: VenueDocumentView) {
  if (!doc.file) return
  let res: Response
  try {
    res = await fetch(`${base}/api/venue-documents/${encodeURIComponent(doc.id)}/file`, { cache: 'no-store', signal: AbortSignal.timeout(60_000) })
  } catch {
    throw new Error("Couldn't reach the server. A file opens with signal: try again when you have it.")
  }
  if (!res.ok) throw await refusal(res)
  const url = URL.createObjectURL(await res.blob())
  const a = document.createElement('a')
  a.href = url
  a.download = documentFileName(venue.name, doc.title, doc.file.type)
  document.body.append(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
}

function VenueDocuments({ venue, docs }: { venue: VenueView; docs: VenueDocumentView[] }) {
  const storage = useDocumentStorage()
  const [changing, setChanging] = useState<string | undefined>()
  return (
    <section className="card documents" aria-label="Documents">
      <h2>Documents</h2>
      {docs.length === 0 && <Empty>None yet: the venue's tech spec, floor plan, power and rigging details, or a link to where they share them.</Empty>}
      {docs.map((d) =>
        changing === d.id ? (
          <VenueDocumentForm key={d.id} venue={venue} doc={d} onDone={() => setChanging(undefined)} />
        ) : (
          <VenueDocumentLine key={d.id} venue={venue} doc={d} onChange={() => setChanging(d.id)} />
        )
      )}
      {storage && !storage.files && <p className="hint">{FILES_WAIT_VENUE}</p>}
      <Fold label="Add document">
        <VenueDocumentForm venue={venue} />
      </Fold>
    </section>
  )
}

/** One document: what it is, its file or where its link goes, and Open, Change and Remove. */
function VenueDocumentLine({ venue, doc, onChange }: { venue: VenueView; doc: VenueDocumentView; onChange: () => void }) {
  const { run, error } = useAct()
  const [removing, setRemoving] = useState(false)
  const what = `${venue.name}'s ${venueTitleInSentence(doc.title)}`
  return (
    <div className="row doc">
      <div>
        <b>{doc.title}</b>
        <p>{[VENUE_DOCUMENT_KIND_LABELS[doc.kind], doc.file && fileLabel(doc.file), doc.link && `link to ${linkHost(doc.link)}`].filter(Boolean).join(' · ')}</p>
      </div>
      <Pending pending={doc.pending} />
      <div className="actions">
        {doc.file && (
          <button type="button" onClick={() => void run(() => openFile(venue, doc))} aria-label={`Open ${what}`}>
            Open
          </button>
        )}
        {doc.link && (
          <a className="button" href={doc.link} target="_blank" rel="noreferrer noopener" aria-label={`Open the link to ${what}`}>
            {doc.file ? 'Link' : 'Open'}
          </a>
        )}
        <button type="button" className="link" onClick={onChange} aria-label={`Change ${what}`}>
          Change
        </button>
        {!removing && (
          <button type="button" className="link" onClick={() => setRemoving(true)} aria-label={`Remove ${what}`}>
            Remove
          </button>
        )}
      </div>
      {removing && (
        <Confirm
          question={`Remove ${what}?${doc.file ? ' Its file is deleted too.' : ''}`}
          yes="Remove it"
          onYes={() => {
            setRemoving(false)
            void run(() => client.mutate('venueDocument.remove', { id: doc.id }))
          }}
          onNo={() => setRemoving(false)}
        />
      )}
      <Refusal error={error} />
    </div>
  )
}

/**
 * Adding a venue's document, or changing one: what it is, its title, a
 * link, and a file. A link alone goes through the outbox like any change,
 * so it works with no signal; a file goes straight to the server.
 */
function VenueDocumentForm({ venue, doc, onDone }: { venue: VenueView; doc?: VenueDocumentView; onDone?: () => void }) {
  const storage = useDocumentStorage()
  const blank = { kind: 'tech-spec' as VenueDocumentKind, title: VENUE_DOCUMENT_TITLES['tech-spec'], link: '' }
  const [f, setF] = useState(doc ? { kind: doc.kind, title: doc.title, link: doc.link ?? '' } : blank)
  const [file, setFile] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const [added, setAdded] = useState('')
  const picker = useRef<HTMLInputElement>(null)
  const { run, error, refuse } = useAct()
  // A new kind brings its own title, unless one has been typed.
  const setKind = (kind: VenueDocumentKind) =>
    setF((was) => ({ ...was, kind, title: !was.title.trim() || was.title === VENUE_DOCUMENT_TITLES[was.kind] ? VENUE_DOCUMENT_TITLES[kind] : was.title }))
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    const parsed = venueDocumentDetails.safeParse({ id: doc?.id ?? newId(), venueId: venue.id, kind: f.kind, title: f.title.trim(), link: f.link.trim() || null })
    if (!parsed.success) return refuse(parsed.error.issues[0]?.message ?? 'Check the details and try again.')
    if (!file && !parsed.data.link && !doc?.file) return refuse(storage?.files === false ? 'Add the link to it: files wait on the storage being set up.' : 'Add the link to it, or choose its file.')
    setBusy(true)
    const taken = await run(() => (file ? sendFile(parsed.data, file) : client.mutate('venueDocument.save', parsed.data)))
    setBusy(false)
    if (!taken) return
    if (doc) return onDone?.()
    setAdded(parsed.data.title)
    setF(blank)
    setFile(null)
    if (picker.current) picker.current.value = ''
  }
  return (
    <form className="grid-form doc-form" onSubmit={submit} aria-label={doc ? `Change ${doc.title}` : `Add a document for ${venue.name}`}>
      <label>
        What is it
        <select value={f.kind} onChange={(e) => setKind(e.target.value as VenueDocumentKind)}>
          {VENUE_DOCUMENT_KINDS.map((k) => (
            <option key={k} value={k}>
              {VENUE_DOCUMENT_KIND_LABELS[k]}
            </option>
          ))}
        </select>
      </label>
      <label>
        Title <input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="e.g. Main hall floor plan" maxLength={100} />
      </label>
      <label className="wide">
        Link <input type="url" inputMode="url" value={f.link} onChange={(e) => setF({ ...f, link: e.target.value })} placeholder="https://… where the venue shares it" />
        <small>A Dropbox, Google Drive or website address. Works with no signal.</small>
      </label>
      {storage?.files !== false && (
        <label className="wide">
          {doc?.file ? 'A new file, to replace the one it has' : 'Or the file'}
          <input ref={picker} type="file" accept={ACCEPT} onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          <small>A PDF, or a photo (JPEG, PNG, WebP or HEIC), up to 10 MB. Sending a file needs signal.</small>
        </label>
      )}
      <Refusal error={error} className="wide" />
      <button type="submit" className={doc ? 'primary' : 'wide'} disabled={busy}>
        {busy && file ? 'Sending…' : doc ? 'Save' : 'Add document'}
      </button>
      {doc && (
        <button type="button" onClick={onDone}>
          Cancel
        </button>
      )}
      <div aria-live="polite" className="wide">
        {added && <p className="added">Added {added}.</p>}
      </div>
    </form>
  )
}

/** The jobs at this venue: coming up first, soonest first, then the past ones, newest first. */
function VenueJobs({ jobs }: { jobs: JobView[] }) {
  const today = useToday()
  const coming = jobs.filter((j) => !STOPPED.includes(j.status) && (!j.span || j.span.end >= today))
  const past = jobs.filter((j) => !coming.includes(j)).reverse()
  return (
    <section className="card" aria-label="Jobs here">
      <h2>Jobs here</h2>
      {jobs.length === 0 && <Empty>No jobs here yet.</Empty>}
      <ul className="job-list">
        {[...coming, ...past].map((j) => (
          <li key={j.id}>
            <a className="job-row" href={`#jobs/${j.id}`}>
              <div>
                <b>{j.name}</b>
                <p>{[j.client?.name, j.span ? spanLabel(j.span) : 'No dates yet'].filter(Boolean).join(' · ')}</p>
              </div>
              <div className="side">
                <JobStatusPill status={j.status} pending={j.pending} />
              </div>
            </a>
          </li>
        ))}
      </ul>
    </section>
  )
}
