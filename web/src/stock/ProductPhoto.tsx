import { mayChangeProductPhoto, PHOTOS_WAIT, PRODUCT_PHOTO_SIDE, type ModelView } from '@sh/shared'
import { useRef, useState } from 'react'
import { Confirm, Refusal, useAct } from '../act.tsx'
import { refusal, useDocumentStorage } from '../crew/Documents.tsx'
import { Icon } from '../Icon.tsx'
import { shrinkPhoto } from '../photo-file.ts'
import { productPhotoOf } from '../Picture.tsx'
import { useAccess } from '../role.ts'
import { client } from '../sync.ts'
import { useLate } from '../useLate.ts'

/**
 * A product's photo on its page (ADR 0082): shown at its own shape, and put
 * up, changed or taken down by whoever changes stock. It's made small here
 * before it's sent, keeping its shape, as the best photo for a rack is
 * often of its wide front panel. It shows in the stock lists and on the
 * product's panel in a rack, flat and in 3D. It goes straight to the
 * server, so it needs signal, as a person's photo does.
 */

const base = import.meta.env.VITE_API_BASE ?? ''

async function call(id: string, init: RequestInit) {
  let res: Response
  try {
    res = await fetch(`${base}/api/models/${encodeURIComponent(id)}/photo?${new URLSearchParams({ client: client.clientId })}`, { ...init, signal: AbortSignal.timeout(120_000) })
  } catch {
    throw new Error('Not changed: a photo needs signal. Try again when you have it.')
  }
  if (!res.ok) throw await refusal(res)
}

export function ProductPhoto({ m }: { m: ModelView }) {
  const access = useAccess()
  const storage = useDocumentStorage()
  const picker = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const late = useLate(busy)
  const [removing, setRemoving] = useState(false)
  const { run, error } = useAct()
  const src = productPhotoOf(m)
  const may = mayChangeProductPhoto(access.role) && !(storage && !storage.files)

  const send = async (file: File | undefined) => {
    if (picker.current) picker.current.value = ''
    if (!file) return
    setBusy(true)
    await run(async () => call(m.id, { method: 'POST', headers: { 'content-type': 'application/octet-stream' }, body: await shrinkPhoto(file, { side: PRODUCT_PHOTO_SIDE, square: false }) }))
    setBusy(false)
  }
  if (!src && !may) return storage && !storage.files && access.can('settings') ? <p className="hint">{PHOTOS_WAIT}</p> : null

  return (
    <div className="product-photo">
      {src && <img src={src} alt={`${m.name}, as it looks`} loading="lazy" />}
      {may &&
        (removing ? (
          <Confirm
            question={`Take the photo of ${m.name} off? It's deleted, and its icon comes back.`}
            yes="Take it off"
            onYes={() => {
              setRemoving(false)
              void run(() => call(m.id, { method: 'DELETE' }))
            }}
            onNo={() => setRemoving(false)}
          />
        ) : (
          <div className="actions">
            {/* The button is the file field's label, so it opens the phone's camera or photos as any file field does. */}
            <label className="button" aria-busy={busy}>
              <Icon name="camera" />
              {late ? 'Sending…' : src ? 'Change photo' : 'Add a photo'}
              <input ref={picker} type="file" accept="image/*" className="sr-only" disabled={busy} onChange={(e) => void send(e.target.files?.[0])} />
            </label>
            {src && (
              <button type="button" onClick={() => setRemoving(true)} disabled={busy}>
                Remove photo
              </button>
            )}
          </div>
        ))}
      {!src && may && <p className="hint">{m.rackMount ? 'A photo of its front panel, square on, shows on it in the rack designer.' : 'A photo of it, so crew know it when they see it.'}</p>}
      <Refusal error={error} />
    </div>
  )
}
