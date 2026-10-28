import {
  documentFileName,
  FILE_HEAD_BYTES,
  FILE_TOO_BIG,
  fileLabel,
  FILES_WAIT_LINK,
  fileTypeOf,
  ITEM_CERTIFICATE_KINDS,
  ITEM_CERTIFICATE_LABELS,
  ITEM_CERTIFICATE_TITLES,
  itemCertificateDetails,
  linkHost,
  MAX_FILE_BYTES,
  newId,
  type AssetView,
  type ItemCertificateDetails,
  type ItemCertificateKind,
  type ItemCertificateView,
  type View,
} from '@sh/shared'
import { useRef, useState, type FormEvent } from 'react'
import { Confirm, Refusal, useAct } from '../act.tsx'
import { ACCEPT, refusal, useDocumentStorage } from '../crew/Documents.tsx'
import { Empty } from '../Empty.tsx'
import { Fold } from '../Fold.tsx'
import { Heading } from '../Icon.tsx'
import { useAccess } from '../role.ts'
import { Pending } from '../StatusPill.tsx'
import { client } from '../sync.ts'
import { useLate } from '../useLate.ts'
import { useToday } from '../view.ts'
import { dateLabel, numberLabel } from './common.tsx'

/**
 * Certificates on items (ADR 0094): a PAT certificate, a report of a
 * thorough examination, or another, such as a declaration of conformity,
 * each a file, a link to where it's shared, or both, on the items it
 * covers. A test's certificate shows beside the test on the item's page;
 * every one an item has is listed on its Certificates card. The details
 * and links work with no signal; a file goes to the server and comes back
 * from it, as a venue's documents do (ADR 0032).
 */

const base = import.meta.env.VITE_API_BASE ?? ''

/** As many items as go in the address with a file; the rest follow with the details. */
const IN_ADDRESS = 100

/**
 * A file put on a certificate, with its details, as the request's whole
 * body. Checked here first by the server's own rules, so a refusal is
 * said in place with nothing sent. A round longer than the address holds
 * sends the rest of its items with the details straight after.
 */
async function sendFile(details: ItemCertificateDetails, file: File) {
  if (file.size > MAX_FILE_BYTES) throw new Error(FILE_TOO_BIG)
  const found = fileTypeOf(new Uint8Array(await file.slice(0, FILE_HEAD_BYTES).arrayBuffer()))
  if ('refused' in found) throw new Error(found.refused)
  const q = new URLSearchParams({
    client: client.clientId,
    kind: details.kind,
    title: details.title,
    day: details.day,
    expires: details.expires ?? '',
    link: details.link ?? '',
    assets: details.assetIds.slice(0, IN_ADDRESS).join(','),
  })
  let res: Response
  try {
    res = await fetch(`${base}/api/item-certificates/${encodeURIComponent(details.id)}/file?${q}`, {
      method: 'POST',
      headers: { 'content-type': 'application/octet-stream' },
      body: file,
      signal: AbortSignal.timeout(120_000),
    })
  } catch {
    throw new Error("Couldn't reach the server. A file needs signal to send: try again when you have it, or keep a link to it meanwhile.")
  }
  if (!res.ok) throw await refusal(res)
  if (details.assetIds.length > IN_ADDRESS) await client.mutate('itemCertificate.save', details)
}

/** Its file, from the server, saved as a download named for the item and what it is. */
async function openFile(a: AssetView, c: ItemCertificateView) {
  if (!c.file) return
  let res: Response
  try {
    res = await fetch(`${base}/api/item-certificates/${encodeURIComponent(c.id)}/file`, { cache: 'no-store', signal: AbortSignal.timeout(60_000) })
  } catch {
    throw new Error("Couldn't reach the server. A file opens with signal: try again when you have it.")
  }
  if (!res.ok) throw await refusal(res)
  const url = URL.createObjectURL(await res.blob())
  const link = document.createElement('a')
  link.href = url
  link.download = documentFileName([numberLabel(a), a.model?.name].filter(Boolean).join(' '), c.title, c.file.type)
  document.body.append(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
}

/** "Covers this and 11 more", for one that covers a round. */
const covers = (c: ItemCertificateView) => (c.assetIds.length > 1 ? `covers this and ${c.assetIds.length - 1} more` : '')

/** Open, and Link beside it when it has both: what a test's line and a certificate's line share. */
export function OpenCertificate({ a, c, what }: { a: AssetView; c: ItemCertificateView; what: string }) {
  const { run, error } = useAct()
  return (
    <>
      {c.file && (
        <button type="button" onClick={() => void run(() => openFile(a, c))} aria-label={`Open ${what}`}>
          Open
        </button>
      )}
      {c.link && (
        <a className="button" href={c.link} target="_blank" rel="noreferrer noopener" aria-label={`Open the link to ${what}`}>
          {c.file ? 'Link' : 'Open'}
        </a>
      )}
      <Refusal error={error} />
    </>
  )
}

/** An item's certificates: every one that covers it, and adding one. */
export function CertificatesCard({ view, a }: { view: View; a: AssetView }) {
  const certs = view.inspections.certificatesOf(a.id)
  const storage = useDocumentStorage()
  const [changing, setChanging] = useState<string | undefined>()
  // Certificates are stock's, as the tests are (ADR 0094); anyone can open one.
  const mayChange = useAccess().can('stock')
  const needs = [a.model?.patMonths && 'pat', a.model?.liftingMonths && 'lifting'].filter(Boolean) as ItemCertificateKind[]
  if (certs.length === 0 && !mayChange) return null
  return (
    <section className="card documents certificates" aria-label="Certificates">
      <Heading icon="document">Certificates</Heading>
      {certs.length === 0 && (
        <Empty>
          None yet: {needs.includes('lifting') ? 'the report of its thorough examination, ' : ''}
          {needs.includes('pat') ? 'its PAT certificate, ' : ''}a declaration of conformity, or a link to where they're kept.
        </Empty>
      )}
      {certs.map((c) =>
        changing === c.id && mayChange ? (
          <CertificateForm key={c.id} a={a} cert={c} onDone={() => setChanging(undefined)} />
        ) : (
          <CertificateLine key={c.id} view={view} a={a} c={c} onChange={mayChange ? () => setChanging(c.id) : undefined} />
        )
      )}
      {storage && !storage.files && <p className="hint">{FILES_WAIT_LINK}</p>}
      {mayChange && a.status === 'active' && (
        <Fold label="Add certificate">
          <CertificateForm a={a} kind={needs[0] ?? 'other'} />
        </Fold>
      )}
    </section>
  )
}

/** One certificate: what it is, its day, when another runs out, its file or link, and Open, Change and Remove; without `onChange`, Open alone. */
function CertificateLine({ view, a, c, onChange }: { view: View; a: AssetView; c: ItemCertificateView; onChange?: () => void }) {
  const { run, error } = useAct()
  const [removing, setRemoving] = useState(false)
  const state = view.inspections.certificateState(c)
  const what = `${numberLabel(a)}'s ${c.title}`
  return (
    <div className="row doc">
      <div>
        <b>{c.title}</b>
        <p>
          {[c.kind === 'other' ? undefined : ITEM_CERTIFICATE_LABELS[c.kind] === c.title ? undefined : ITEM_CERTIFICATE_LABELS[c.kind], dateLabel(c.day), covers(c), c.file && fileLabel(c.file), c.link && `link to ${linkHost(c.link)}`]
            .filter(Boolean)
            .join(' · ')}
        </p>
        {c.expires && (
          <p className={state === 'expired' ? 'bad' : state === 'soon' ? 'warn' : undefined}>
            {state === 'expired' ? `Ran out on ${dateLabel(c.expires)}` : `Runs out ${dateLabel(c.expires)}`}
          </p>
        )}
      </div>
      <Pending pending={c.pending} />
      <div className="actions">
        <OpenCertificate a={a} c={c} what={what} />
        {onChange && (
          <button type="button" className="link" onClick={onChange} aria-label={`Change ${what}`}>
            Change
          </button>
        )}
        {!removing && onChange && (
          <button type="button" className="link" onClick={() => setRemoving(true)} aria-label={`Remove ${what}`}>
            Remove
          </button>
        )}
      </div>
      {removing && (
        <Confirm
          question={`Remove ${what}?${c.assetIds.length > 1 ? ` It comes off all ${c.assetIds.length} items it covers.` : ''}${c.file ? ' Its file is deleted too.' : ''} The tests stay recorded.`}
          yes="Remove it"
          onYes={() => {
            setRemoving(false)
            void run(() => client.mutate('itemCertificate.remove', { id: c.id }))
          }}
          onNo={() => setRemoving(false)}
        />
      )}
      <Refusal error={error} />
    </div>
  )
}

/**
 * Adding a certificate, or changing one: what it is, its title, the day on
 * it, the day another runs out, a link, and a file. A test's certificate
 * starts as the kind and day of the test it's for; one for a round covers
 * every item in `assetIds`. A link alone goes through the outbox like any
 * change, so it works with no signal; a file goes straight to the server.
 */
export function CertificateForm({
  a,
  cert,
  kind: startKind = 'other',
  day: startDay,
  assetIds,
  label,
  onDone,
}: {
  /** The item it's added from; a round's form has none. */
  a?: AssetView
  cert?: ItemCertificateView
  kind?: ItemCertificateKind
  day?: string
  /** The items it covers, when not just `a`. */
  assetIds?: readonly string[]
  /** What the form is called, for a screen reader. */
  label?: string
  onDone?: () => void
}) {
  const storage = useDocumentStorage()
  const today = useToday()
  const blank = { kind: startKind, title: ITEM_CERTIFICATE_TITLES[startKind], day: startDay ?? today, expires: '', link: '' }
  const [f, setF] = useState(cert ? { kind: cert.kind, title: cert.title, day: cert.day, expires: cert.expires ?? '', link: cert.link ?? '' } : blank)
  const [file, setFile] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const late = useLate(busy)
  const [added, setAdded] = useState('')
  const picker = useRef<HTMLInputElement>(null)
  const { run, error, refuse } = useAct()
  // A new kind brings its own title, unless one has been typed; only another runs out on a day.
  const setKind = (kind: ItemCertificateKind) =>
    setF((was) => ({
      ...was,
      kind,
      title: !was.title.trim() || was.title === ITEM_CERTIFICATE_TITLES[was.kind] ? ITEM_CERTIFICATE_TITLES[kind] : was.title,
      expires: kind === 'other' ? was.expires : '',
    }))
  // Fixed to the test it's for: its kind and day are the test's, so they're not offered.
  const forTest = !cert && !!startDay && startKind !== 'other'
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    const parsed = itemCertificateDetails.safeParse({
      id: cert?.id ?? newId(),
      kind: f.kind,
      title: f.title.trim(),
      day: f.day,
      expires: f.kind === 'other' && f.expires ? f.expires : null,
      assetIds: cert?.assetIds ?? assetIds ?? (a ? [a.id] : []),
      link: f.link.trim() || null,
    })
    if (!parsed.success) return refuse(parsed.error.issues[0]?.message ?? 'Check the details and try again.')
    if (!file && !parsed.data.link && !cert?.file) return refuse(storage?.files === false ? 'Add the link to it: files wait on the storage being set up.' : 'Add the link to it, or choose its file.')
    setBusy(true)
    const taken = await run(() => (file ? sendFile(parsed.data, file) : client.mutate('itemCertificate.save', parsed.data)))
    setBusy(false)
    if (!taken) return
    if (cert) return onDone?.()
    setAdded(parsed.data.title)
    setF(blank)
    setFile(null)
    if (picker.current) picker.current.value = ''
    onDone?.()
  }
  const count = cert?.assetIds.length ?? assetIds?.length ?? 1
  return (
    <form className="grid-form doc-form" onSubmit={submit} aria-label={label ?? (cert ? `Change ${cert.title}` : `Add a certificate${a ? ` for ${numberLabel(a)}` : ''}`)}>
      {!forTest && (
        <label>
          What is it
          <select value={f.kind} onChange={(e) => setKind(e.target.value as ItemCertificateKind)}>
            {ITEM_CERTIFICATE_KINDS.map((k) => (
              <option key={k} value={k}>
                {ITEM_CERTIFICATE_LABELS[k]}
              </option>
            ))}
          </select>
        </label>
      )}
      <label>
        Title{' '}
        <input
          value={f.title}
          onChange={(e) => setF({ ...f, title: e.target.value })}
          maxLength={100}
          placeholder={f.kind === 'other' ? 'e.g. Declaration of conformity' : undefined}
        />
      </label>
      {!forTest && (
        <label>
          {f.kind === 'other' ? 'Issued' : 'Test done on'} <input type="date" value={f.day} onChange={(e) => setF({ ...f, day: e.target.value })} />
          {f.kind !== 'other' && <small>The day of the test it's for, which says which test it goes with.</small>}
        </label>
      )}
      {f.kind === 'other' && (
        <label>
          Runs out <input type="date" value={f.expires} min={f.day} onChange={(e) => setF({ ...f, expires: e.target.value })} />
          <small>Leave it blank if it doesn't.</small>
        </label>
      )}
      <label className="wide">
        Link <input type="url" inputMode="url" value={f.link} onChange={(e) => setF({ ...f, link: e.target.value })} placeholder="https://… where it's kept" />
        <small>A Dropbox, Google Drive or tester's website address. Works with no signal.</small>
      </label>
      {storage?.files !== false && (
        <label className="wide">
          {cert?.file ? 'A new file, to replace the one it has' : 'Or the file'}
          <input ref={picker} type="file" accept={ACCEPT} onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          <small>A PDF, or a photo of it (JPEG, PNG, WebP or HEIC), up to 10 MB. Sending a file needs signal.</small>
        </label>
      )}
      {count > 1 && <p className="hint wide">It goes on all {count} items it covers.</p>}
      <Refusal error={error} className="wide" />
      <button type="submit" className={cert || onDone ? 'primary' : 'wide'} disabled={busy} aria-busy={busy}>
        {late && file ? 'Sending…' : cert ? 'Save certificate' : 'Add certificate'}
      </button>
      {onDone && (
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
