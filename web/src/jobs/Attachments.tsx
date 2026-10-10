import {
  ATTACHMENT_KIND_LABELS,
  ATTACHMENT_KINDS_OF,
  ATTACHMENT_TITLES,
  attachmentDetails,
  attachmentTitleInSentence,
  documentFileName,
  FILE_HEAD_BYTES,
  FILE_TOO_BIG,
  fileLabel,
  FILES_WAIT_LINK,
  fileTypeOf,
  linkHost,
  MAX_FILE_BYTES,
  newId,
  spanLabel,
  STOPPED,
  type AttachmentDetails,
  type AttachmentKind,
  type AttachmentOwner,
  type AttachmentView,
  type JobView,
} from '@sh/shared'
import { useRef, useState, type FormEvent } from 'react'
import { Confirm, Refusal, useAct } from '../act.tsx'
import { ACCEPT, refusal, useDocumentStorage } from '../crew/Documents.tsx'
import { Empty } from '../Empty.tsx'
import { Fold } from '../Fold.tsx'
import { Pending } from '../StatusPill.tsx'
import { client } from '../sync.ts'
import { useToday, useView } from '../view.ts'
import { JobStatusPill } from './common.tsx'

/**
 * What a venue's page and a client's page share (ADR 0032): the documents
 * kept on it, each a file, a link to where it's shared, or both, and the
 * jobs there or for them. The details and links work with no signal; a
 * file goes to the server and comes back from it, as a person's documents
 * do (ADR 0029).
 */

const base = import.meta.env.VITE_API_BASE ?? ''

/** What the documents are kept on: a venue or a client, by id and name. */
export interface Owner {
  owner: AttachmentOwner
  id: string
  name: string
}

/** What the empty list suggests, for each. */
const NONE_YET: Record<AttachmentOwner, string> = {
  venue: "None yet: the venue's tech spec, floor plan, power and rigging details, or a link to where they share them.",
  client: 'None yet: their contract, purchase orders, a brief or brand guidelines, or a link to where they share them.',
}

/**
 * A file put on a document, with its details, as the request's whole body.
 * Checked here first by the server's own rules, so a refusal is said in
 * place with nothing sent.
 */
async function sendFile(details: AttachmentDetails, file: File) {
  if (file.size > MAX_FILE_BYTES) throw new Error(FILE_TOO_BIG)
  const found = fileTypeOf(new Uint8Array(await file.slice(0, FILE_HEAD_BYTES).arrayBuffer()))
  if ('refused' in found) throw new Error(found.refused)
  const q = new URLSearchParams({ client: client.clientId, owner: details.owner, ownerId: details.ownerId, kind: details.kind, title: details.title, link: details.link ?? '' })
  let res: Response
  try {
    res = await fetch(`${base}/api/attachments/${encodeURIComponent(details.id)}/file?${q}`, {
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

/** Its file, from the server, saved as a download named for the venue or client and what it is. */
async function openFile(owner: Owner, doc: AttachmentView) {
  if (!doc.file) return
  let res: Response
  try {
    res = await fetch(`${base}/api/attachments/${encodeURIComponent(doc.id)}/file`, { cache: 'no-store', signal: AbortSignal.timeout(60_000) })
  } catch {
    throw new Error("Couldn't reach the server. A file opens with signal: try again when you have it.")
  }
  if (!res.ok) throw await refusal(res)
  const url = URL.createObjectURL(await res.blob())
  const a = document.createElement('a')
  a.href = url
  a.download = documentFileName(owner.name, doc.title, doc.file.type)
  document.body.append(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
}

/** The documents card on a venue's or client's page. */
export function Attachments({ owner }: { owner: Owner }) {
  const view = useView()
  const docs = view.attachments.of(owner.owner, owner.id)
  const storage = useDocumentStorage()
  const [changing, setChanging] = useState<string | undefined>()
  return (
    <section className="card documents" aria-label="Documents">
      <h2>Documents</h2>
      {docs.length === 0 && <Empty>{NONE_YET[owner.owner]}</Empty>}
      {docs.map((d) =>
        changing === d.id ? (
          <AttachmentForm key={d.id} owner={owner} doc={d} onDone={() => setChanging(undefined)} />
        ) : (
          <AttachmentLine key={d.id} owner={owner} doc={d} onChange={() => setChanging(d.id)} />
        )
      )}
      {storage && !storage.files && <p className="hint">{FILES_WAIT_LINK}</p>}
      <Fold label="Add document">
        <AttachmentForm owner={owner} />
      </Fold>
    </section>
  )
}

/** One document: what it is, its file or where its link goes, and Open, Change and Remove. */
function AttachmentLine({ owner, doc, onChange }: { owner: Owner; doc: AttachmentView; onChange: () => void }) {
  const { run, error } = useAct()
  const [removing, setRemoving] = useState(false)
  const what = `${owner.name}'s ${attachmentTitleInSentence(doc.title)}`
  return (
    <div className="row doc">
      <div>
        <b>{doc.title}</b>
        <p>{[ATTACHMENT_KIND_LABELS[doc.kind], doc.file && fileLabel(doc.file), doc.link && `link to ${linkHost(doc.link)}`].filter(Boolean).join(' · ')}</p>
      </div>
      <Pending pending={doc.pending} />
      <div className="actions">
        {doc.file && (
          <button type="button" onClick={() => void run(() => openFile(owner, doc))} aria-label={`Open ${what}`}>
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
            void run(() => client.mutate('attachment.remove', { id: doc.id }))
          }}
          onNo={() => setRemoving(false)}
        />
      )}
      <Refusal error={error} />
    </div>
  )
}

/**
 * Adding a document, or changing one: what it is, its title, a link, and a
 * file. A link alone goes through the outbox like any change, so it works
 * with no signal; a file goes straight to the server.
 */
function AttachmentForm({ owner, doc, onDone }: { owner: Owner; doc?: AttachmentView; onDone?: () => void }) {
  const storage = useDocumentStorage()
  const kinds: readonly AttachmentKind[] = ATTACHMENT_KINDS_OF[owner.owner]
  const first = kinds[0]!
  const blank = { kind: first, title: ATTACHMENT_TITLES[first], link: '' }
  const [f, setF] = useState(doc ? { kind: doc.kind, title: doc.title, link: doc.link ?? '' } : blank)
  const [file, setFile] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const [added, setAdded] = useState('')
  const picker = useRef<HTMLInputElement>(null)
  const { run, error, refuse } = useAct()
  // A new kind brings its own title, unless one has been typed.
  const setKind = (kind: AttachmentKind) =>
    setF((was) => ({ ...was, kind, title: !was.title.trim() || was.title === ATTACHMENT_TITLES[was.kind] ? ATTACHMENT_TITLES[kind] : was.title }))
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    const parsed = attachmentDetails.safeParse({ id: doc?.id ?? newId(), owner: owner.owner, ownerId: owner.id, kind: f.kind, title: f.title.trim(), link: f.link.trim() || null })
    if (!parsed.success) return refuse(parsed.error.issues[0]?.message ?? 'Check the details and try again.')
    if (!file && !parsed.data.link && !doc?.file) return refuse(storage?.files === false ? 'Add the link to it: files wait on the storage being set up.' : 'Add the link to it, or choose its file.')
    setBusy(true)
    const taken = await run(() => (file ? sendFile(parsed.data, file) : client.mutate('attachment.save', parsed.data)))
    setBusy(false)
    if (!taken) return
    if (doc) return onDone?.()
    setAdded(parsed.data.title)
    setF(blank)
    setFile(null)
    if (picker.current) picker.current.value = ''
  }
  return (
    <form className="grid-form doc-form" onSubmit={submit} aria-label={doc ? `Change ${doc.title}` : `Add a document for ${owner.name}`}>
      <label>
        What is it
        <select value={f.kind} onChange={(e) => setKind(e.target.value as AttachmentKind)}>
          {kinds.map((k) => (
            <option key={k} value={k}>
              {ATTACHMENT_KIND_LABELS[k]}
            </option>
          ))}
        </select>
      </label>
      <label>
        Title <input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} maxLength={100} />
      </label>
      <label className="wide">
        Link <input type="url" inputMode="url" value={f.link} onChange={(e) => setF({ ...f, link: e.target.value })} placeholder="https://… where it's shared" />
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
        {busy && file ? 'Sending…' : doc ? 'Save document' : 'Add document'}
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

/** The jobs at a venue or for a client: coming up first, soonest first, then the rest, newest first, each opening the job. */
export function JobsCard({ jobs, title, client: showClient }: { jobs: readonly JobView[]; title: string; client?: boolean }) {
  const today = useToday()
  const coming = jobs.filter((j) => !STOPPED.includes(j.status) && (!j.span || j.span.end >= today))
  const rest = jobs.filter((j) => !coming.includes(j)).reverse()
  return (
    <section className="card" aria-label={title}>
      <h2>{title}</h2>
      {jobs.length === 0 && <Empty>No jobs yet.</Empty>}
      <ul className="job-list">
        {[...coming, ...rest].map((j) => (
          <li key={j.id}>
            <a className="job-row" href={`#jobs/${j.id}`}>
              <div>
                <b>{j.name}</b>
                <p>{[showClient ? j.client?.name : j.venue?.name, j.span ? spanLabel(j.span) : 'No dates yet'].filter(Boolean).join(' · ')}</p>
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
