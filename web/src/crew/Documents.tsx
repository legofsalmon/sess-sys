import {
  CERTIFICATE_SOON_DAYS,
  certificateFollows,
  certificateOf,
  dayLabel,
  daysBetween,
  DOCUMENT_KIND_LABELS,
  DOCUMENT_KINDS,
  DOCUMENT_TITLES,
  documentDetails,
  documentFileName,
  FILE_HEAD_BYTES,
  FILE_TOO_BIG,
  FILE_TYPES,
  fileLabel,
  FILES_WAIT,
  fileTypeOf,
  MAX_FILE_BYTES,
  newId,
  titleInSentence,
  type DocumentDetails,
  type DocumentKind,
  type DocumentStorage,
  type DocumentView,
  type PersonView,
} from '@sh/shared'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Confirm, Refusal, useAct } from '../act.tsx'
import { markSignedOut } from '../auth.ts'
import { Fold } from '../Fold.tsx'
import { ask } from '../server.ts'
import { Pending } from '../StatusPill.tsx'
import { client } from '../sync.ts'
import { useToday, useView } from '../view.ts'

/**
 * A person's documents on the Crew tab (ADR 0029): on their card, each
 * with when it runs out, its file to open, Change and Remove, and the form
 * to add one; and in "Answers to check", one sent from their link for the
 * office to check. The device holds the details; a file goes to the server
 * and comes back from it, so it needs signal.
 */

const base = import.meta.env.VITE_API_BASE ?? ''

/** What the file field takes: the types by name too, for phones that pick by them. */
const ACCEPT = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/heic', ...Object.values(FILE_TYPES).map((t) => `.${t.ext}`), '.jpeg'].join(',')

/** "Fri 23 Oct 2026": a document's day wants its year. */
const dateLabel = (d: string) => `${dayLabel(d)} ${d.slice(0, 4)}`

/** Whether the server can keep files, asked once while the app is open; unknown with no signal. */
let known: DocumentStorage | undefined
let asking: Promise<DocumentStorage | undefined> | undefined
export function useDocumentStorage(): DocumentStorage | undefined {
  const [storage, setStorage] = useState(known)
  useEffect(() => {
    if (known) return
    asking ??= ask<DocumentStorage>('/api/documents/storage')
      .then((s) => (known = s))
      .catch(() => undefined)
      .finally(() => (asking = undefined))
    let live = true
    void asking.then((s) => live && setStorage(s))
    return () => {
      live = false
    }
  }, [])
  return storage
}

/** A failed answer from the server, in its words, or in general ones. */
async function refusal(res: Response): Promise<Error> {
  if (res.status === 401) {
    markSignedOut()
    return new Error('Signed out.')
  }
  if (res.status === 413) return new Error(FILE_TOO_BIG)
  const { error } = (await res.json().catch(() => ({}))) as { error?: string }
  return new Error(error ?? `The server answered ${res.status}. Try again in a minute.`)
}

/**
 * A file put on a document, with its details, as the request's whole body.
 * Checked here first by the same rules as the server's, its size and its
 * first bytes, so a refusal is said in place with nothing sent.
 */
async function sendFile(details: DocumentDetails, file: File) {
  if (file.size > MAX_FILE_BYTES) throw new Error(FILE_TOO_BIG)
  const found = fileTypeOf(new Uint8Array(await file.slice(0, FILE_HEAD_BYTES).arrayBuffer()))
  if ('refused' in found) throw new Error(found.refused)
  const q = new URLSearchParams({ client: client.clientId, personId: details.personId, kind: details.kind, title: details.title, expires: details.expires ?? '' })
  let res: Response
  try {
    res = await fetch(`${base}/api/documents/${encodeURIComponent(details.id)}/file?${q}`, {
      method: 'POST',
      headers: { 'content-type': 'application/octet-stream' },
      body: file,
      signal: AbortSignal.timeout(120_000),
    })
  } catch {
    // Said as what's kept and what to do, not as a fault (rule 8): the form keeps everything, file and all.
    throw new Error('Not sent: a file needs signal. What you filled in is kept here, so send it again when you have signal.')
  }
  if (!res.ok) throw await refusal(res)
}

/** A document's file, from the server, saved as a download named for whose and what it is. */
async function openFile(doc: DocumentView) {
  if (!doc.file) return
  let res: Response
  try {
    res = await fetch(`${base}/api/documents/${encodeURIComponent(doc.id)}/file`, { cache: 'no-store', signal: AbortSignal.timeout(60_000) })
  } catch {
    throw new Error("Couldn't reach the server. A file opens with signal: try again when you have it.")
  }
  if (!res.ok) throw await refusal(res)
  const url = URL.createObjectURL(await res.blob())
  const a = document.createElement('a')
  a.href = url
  a.download = documentFileName(doc.person?.name ?? '', doc.title, doc.file.type)
  document.body.append(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
}

/** "Runs out Fri 23 Oct 2026", "Ran out …", or "No expiry", in the tone the certificates use. */
function runsOutLine(runsOut: string | null, today: string): { text: string; tone: '' | 'warn' | 'bad' } {
  if (!runsOut) return { text: 'No expiry', tone: '' }
  if (runsOut < today) return { text: `Ran out ${dateLabel(runsOut)}`, tone: 'bad' }
  return { text: `Runs out ${dateLabel(runsOut)}`, tone: daysBetween(today, runsOut) <= CERTIFICATE_SOON_DAYS ? 'warn' : '' }
}

/** Their documents, on the person's card. */
export function Documents({ person }: { person: PersonView }) {
  const view = useView()
  const storage = useDocumentStorage()
  const docs = view.documents.of(person.id)
  const [changing, setChanging] = useState<string | undefined>()
  return (
    <div className="documents" role="group" aria-label={`Documents: ${person.name}`}>
      <p className="muted">
        <b>Documents</b>
      </p>
      {docs.length === 0 && <p className="hint">None yet: their insurance, and a photo of each certificate's card.</p>}
      {docs.map((d) =>
        changing === d.id ? (
          <DocumentForm key={d.id} person={person} doc={d} onDone={() => setChanging(undefined)} />
        ) : (
          <DocumentLine key={d.id} doc={d} onChange={() => setChanging(d.id)} />
        )
      )}
      {storage && !storage.files && <p className="hint">{FILES_WAIT}</p>}
      {!person.archived && (
        <Fold label="Add document">
          <DocumentForm person={person} />
        </Fold>
      )}
    </div>
  )
}

/** One document: what it is, when it runs out, its file, and Open, Change and Remove. */
function DocumentLine({ doc, onChange }: { doc: DocumentView; onChange: () => void }) {
  const today = useToday()
  const { run, error } = useAct()
  const [removing, setRemoving] = useState(false)
  const when = runsOutLine(doc.runsOut, today)
  const name = doc.person?.name ?? 'Someone'
  return (
    <div className="row doc">
      <div>
        <b>{doc.title}</b>
        <p>
          <span className={when.tone}>{when.text}</span>
          {' · '}
          {doc.file ? fileLabel(doc.file) : 'no file yet'}
          {!doc.checkedAt && ' · sent from their link, waiting for you to check'}
        </p>
      </div>
      <Pending pending={doc.pending} />
      <div className="actions">
        {doc.file && (
          <button type="button" onClick={() => void run(() => openFile(doc))} aria-label={`Open ${name}'s ${titleInSentence(doc.title)}`}>
            Open
          </button>
        )}
        {doc.checkedAt && (
          <button type="button" className="link" onClick={onChange} aria-label={`Change ${name}'s ${titleInSentence(doc.title)}`}>
            Change
          </button>
        )}
        {!removing && (
          <button type="button" className="link" onClick={() => setRemoving(true)} aria-label={`Remove ${name}'s ${titleInSentence(doc.title)}`}>
            Remove
          </button>
        )}
      </div>
      {removing && (
        <Confirm
          question={`Remove ${name}'s ${titleInSentence(doc.title)}?${doc.file ? ' Its file is deleted too.' : ''}`}
          yes="Remove it"
          onYes={() => {
            setRemoving(false)
            void run(() => client.mutate('document.remove', { id: doc.id }))
          }}
          onNo={() => setRemoving(false)}
        />
      )}
      <Refusal error={error} />
    </div>
  )
}

/**
 * Adding a document, or changing one: what it is, its title, when it runs
 * out, and a file. With no file it goes through the outbox like any change;
 * with one it goes straight to the server. A certificate's card starts at
 * the certificate's own day and says what saving it does to it.
 */
function DocumentForm({ person, doc, onDone }: { person: PersonView; doc?: DocumentView; onDone?: () => void }) {
  const storage = useDocumentStorage()
  const certDay = (kind: DocumentKind) => {
    const cert = certificateOf(kind)
    return cert ? (person.certificates[cert]?.expires ?? '') : ''
  }
  const blank = { kind: 'insurance' as DocumentKind, title: DOCUMENT_TITLES.insurance, expires: '' }
  const [f, setF] = useState(doc ? { kind: doc.kind, title: doc.title, expires: doc.runsOut ?? '' } : blank)
  const [file, setFile] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const [added, setAdded] = useState('')
  const picker = useRef<HTMLInputElement>(null)
  const { run, error, refuse } = useAct()
  // A new kind brings its own title, unless one has been typed, and a certificate's card its certificate's day.
  const setKind = (kind: DocumentKind) =>
    setF((was) => ({
      kind,
      title: !was.title.trim() || was.title === DOCUMENT_TITLES[was.kind] ? DOCUMENT_TITLES[kind] : was.title,
      expires: certificateOf(kind) ? certDay(kind) : certificateOf(was.kind) ? '' : was.expires,
    }))
  const cert = certificateOf(f.kind)
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    const parsed = documentDetails.safeParse({ id: doc?.id ?? newId(), personId: person.id, kind: f.kind, title: f.title.trim(), expires: f.expires || null })
    if (!parsed.success) return refuse(parsed.error.issues[0]?.message ?? 'Check the details and try again.')
    setBusy(true)
    const taken = await run(() => (file ? sendFile(parsed.data, file) : client.mutate('document.save', parsed.data)))
    setBusy(false)
    if (!taken) return
    if (doc) return onDone?.()
    setAdded(parsed.data.title)
    setF(blank)
    setFile(null)
    if (picker.current) picker.current.value = ''
  }
  return (
    <form className="grid-form doc-form" onSubmit={submit} aria-label={doc ? `Change ${doc.title}` : `Add a document for ${person.name}`}>
      <label>
        What is it
        <select value={f.kind} onChange={(e) => setKind(e.target.value as DocumentKind)}>
          {DOCUMENT_KINDS.map((k) => (
            <option key={k} value={k}>
              {DOCUMENT_KIND_LABELS[k]}
            </option>
          ))}
        </select>
      </label>
      <label>
        Runs out <input type="date" value={f.expires} onChange={(e) => setF({ ...f, expires: e.target.value })} />
      </label>
      <label className="wide">
        Title <input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="e.g. Public liability insurance" maxLength={100} />
      </label>
      {cert && <p className="hint wide">Saving it {certificateFollows(person, cert, f.expires || null)}: the certificate on their card holds the date.</p>}
      {storage?.files !== false && (
        <label className="wide">
          {doc?.file ? 'A new file, to replace the one it has' : 'The file'}
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
      {/* Read out as it changes, as it's there from the form's opening. */}
      <div aria-live="polite" className="wide">
        {added && <p className="added">Added {added}.</p>}
      </div>
    </form>
  )
}

/**
 * One sent from their link, in "Answers to check": what it is and when it
 * runs out, Open, the day to correct, Checked, and Not right. For a
 * certificate's card it says what checking it does to the certificate.
 */
export function DocumentToCheck({ doc }: { doc: DocumentView }) {
  const { run, error } = useAct()
  const [expires, setExpires] = useState(doc.expires ?? '')
  const [wrong, setWrong] = useState(false)
  const cert = certificateOf(doc.kind)
  const name = doc.person?.name ?? 'Someone'
  const what = titleInSentence(doc.title)
  return (
    <div className="row doc-check">
      <div>
        <b>{name}</b> sent {doc.renews ? 'a renewed' : 'a new'} {what}
        <p>
          {[doc.expires ? `Runs out ${dateLabel(doc.expires)}, they say` : 'No expiry given', doc.file && fileLabel(doc.file)].filter(Boolean).join(' · ')}
          {cert && doc.person && (
            <>
              <br />
              Checking it {certificateFollows(doc.person, cert, expires || null)}.
            </>
          )}
        </p>
      </div>
      <div className="actions">
        {doc.file && (
          <button type="button" onClick={() => void run(() => openFile(doc))} aria-label={`Open the ${what} ${name} sent`}>
            Open
          </button>
        )}
        <label className="field">
          Runs out <input type="date" value={expires} onChange={(e) => setExpires(e.target.value)} aria-label={`Runs out: the ${what} ${name} sent`} />
        </label>
        <button type="button" className="primary" onClick={() => void run(() => client.mutate('document.check', { id: doc.id, expires: expires || null }))} aria-label={`Checked: the ${what} ${name} sent`}>
          Checked
        </button>
        {!wrong && (
          <button type="button" onClick={() => setWrong(true)} aria-label={`Not right: the ${what} ${name} sent`}>
            Not right
          </button>
        )}
      </div>
      {wrong && (
        <Confirm
          question={`Remove the ${what} ${name} sent? Its file is deleted, and they aren't told: ask them for the right one yourself.`}
          yes="Remove it"
          onYes={() => {
            setWrong(false)
            void run(() => client.mutate('document.remove', { id: doc.id }))
          }}
          onNo={() => setWrong(false)}
        />
      )}
      <Refusal error={error} />
    </div>
  )
}
