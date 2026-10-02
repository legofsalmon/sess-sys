import { useState } from 'react'
import { markSignedOut } from './auth.ts'
import { size } from './format.ts'
import { client } from './sync.ts'

/**
 * "Download everything" (ADR 0006): every table as a spreadsheet and as
 * JSON, and the history, in one file, so the company's data is never locked
 * in. Each download goes in the history: the app records it as it asks for
 * the file, so the file's address alone never writes one.
 */

const base = import.meta.env.VITE_API_BASE ?? ''

export function ExportCard() {
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<{ ok: boolean; text: string } | undefined>()

  const download = async () => {
    setBusy(true)
    setNote(undefined)
    try {
      // The device code goes in the history beside the download, before the file comes: a download nobody saw arrive still counts.
      const record = await fetch(`${base}/api/export/record?client=${encodeURIComponent(client.clientId)}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ format: 'zip' }),
        signal: AbortSignal.timeout(30_000),
      })
      if (record.status === 401) return markSignedOut()
      if (!record.ok) return setNote({ ok: false, text: `That didn't work: the server answered ${record.status}. Try again in a minute.` })
      const res = await fetch(`${base}/api/export.zip`, { cache: 'no-store', signal: AbortSignal.timeout(120_000) })
      if (res.status === 401) return markSignedOut()
      if (!res.ok) return setNote({ ok: false, text: `That didn't work: the server answered ${res.status}. Try again in a minute.` })
      const file = await res.blob()
      const name = /filename="([^"]+)"/.exec(res.headers.get('content-disposition') ?? '')?.[1] ?? 'session-hire.zip'
      const url = URL.createObjectURL(file)
      const link = Object.assign(document.createElement('a'), { href: url, download: name })
      document.body.append(link)
      link.click()
      link.remove()
      setTimeout(() => URL.revokeObjectURL(url), 60_000)
      setNote({ ok: true, text: `Downloaded ${name} (${size(file.size)}).` })
    } catch {
      setNote({ ok: false, text: "Couldn't reach the server. Try again when you have signal." })
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="card">
      <h2>Your data</h2>
      <p>
        Everything in the app in one file: a spreadsheet for each kind of record, all of it as JSON for moving to another system, and the
        history in words. Easiest on a laptop.
      </p>
      <button type="button" onClick={download} disabled={busy}>
        {busy ? 'Getting everything…' : 'Download everything'}
      </button>
      {note && (
        <p className={note.ok ? 'hint' : 'alert'} role={note.ok ? 'status' : 'alert'}>
          {note.text}
        </p>
      )}
      <p className="hint">It holds everyone's details, so keep it somewhere safe. Each download shows in the history.</p>
    </section>
  )
}
