import { mayChangePhoto, NOT_A_PHOTO, PHOTO_SIDE, PHOTOS_WAIT, type PersonView } from '@sh/shared'
import { useRef, useState } from 'react'
import { Confirm, Refusal, useAct } from '../act.tsx'
import { Icon } from '../Icon.tsx'
import { useAccess } from '../role.ts'
import { client } from '../sync.ts'
import { useLate } from '../useLate.ts'
import { refusal, useDocumentStorage } from './Documents.tsx'

/**
 * Putting a photo on a person's page, changing it, or taking it down (ADR
 * 0065): for the person themselves and whoever can change crew. The photo
 * is made a small square JPEG here before it's sent, from the middle of
 * what was chosen: a phone's photo of several megabytes goes as a few
 * dozen kilobytes, and where it was taken (its EXIF) stays behind. It goes
 * straight to the server, so it needs signal, as a document's file does.
 */

const base = import.meta.env.VITE_API_BASE ?? ''

/** The middle square of a photo, PHOTO_SIDE across, as a JPEG; the browser turns it the right way up as it draws it. */
async function square(file: File): Promise<Blob> {
  const url = URL.createObjectURL(file)
  try {
    const img = new Image()
    img.src = url
    // An iPhone's HEIC opens in Safari; a browser that can't open it is told to send another kind.
    await img.decode().catch(() => {
      throw new Error(NOT_A_PHOTO)
    })
    const side = Math.min(img.naturalWidth, img.naturalHeight)
    if (!side) throw new Error(NOT_A_PHOTO)
    const out = Math.min(PHOTO_SIDE, side)
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = out
    const g = canvas.getContext('2d')
    if (!g) throw new Error(NOT_A_PHOTO)
    g.drawImage(img, (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, side, 0, 0, out, out)
    const blob = await new Promise<Blob | null>((done) => canvas.toBlob(done, 'image/jpeg', 0.85))
    if (!blob) throw new Error(NOT_A_PHOTO)
    return blob
  } finally {
    URL.revokeObjectURL(url)
  }
}

async function call(id: string, init: RequestInit) {
  let res: Response
  try {
    res = await fetch(`${base}/api/people/${encodeURIComponent(id)}/photo?${new URLSearchParams({ client: client.clientId })}`, { ...init, signal: AbortSignal.timeout(120_000) })
  } catch {
    throw new Error('Not changed: a photo needs signal. Try again when you have it.')
  }
  if (!res.ok) throw await refusal(res)
}

/** Under their picture on their page: Add a photo, or Change and Remove, with what was wrong said in place. */
export function PersonPhoto({ person }: { person: PersonView }) {
  const access = useAccess()
  const storage = useDocumentStorage()
  const picker = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const late = useLate(busy)
  const [removing, setRemoving] = useState(false)
  const { run, error } = useAct()
  const mine = access.personId === person.id
  if (person.archived || !mayChangePhoto(access.role, access.personId, person.id)) return null
  // Where the server has nowhere to keep it, said to the office; nothing offered that can't work.
  if (storage && !storage.files) return access.can('settings') ? <p className="hint">{PHOTOS_WAIT}</p> : null

  const send = async (file: File | undefined) => {
    if (picker.current) picker.current.value = ''
    if (!file) return
    setBusy(true)
    await run(async () => call(person.id, { method: 'POST', headers: { 'content-type': 'application/octet-stream' }, body: await square(file) }))
    setBusy(false)
  }
  const what = mine ? 'your photo' : `${person.name}'s photo`

  return (
    <div className="person-photo">
      {removing ? (
        <Confirm
          question={`Take ${what} off? It's deleted, and the initials come back.`}
          yes="Take it off"
          onYes={() => {
            setRemoving(false)
            void run(() => call(person.id, { method: 'DELETE' }))
          }}
          onNo={() => setRemoving(false)}
        />
      ) : (
        <div className="actions">
          {/* The button is the file field's label, so it opens the phone's camera or photos as any file field does. */}
          <label className="button" aria-busy={busy}>
            <Icon name="camera" />
            {late ? 'Sending…' : person.photo ? 'Change photo' : 'Add a photo'}
            <input ref={picker} type="file" accept="image/*" className="sr-only" disabled={busy} onChange={(e) => void send(e.target.files?.[0])} />
          </label>
          {person.photo && (
            <button type="button" onClick={() => setRemoving(true)} disabled={busy}>
              Remove photo
            </button>
          )}
        </div>
      )}
      {!person.photo && <p className="hint">{mine ? 'A photo of you, so crew know who to look for on site.' : 'A photo they gave you, or took with their say-so, so crew know who to look for on site.'}</p>}
      <Refusal error={error} />
    </div>
  )
}
