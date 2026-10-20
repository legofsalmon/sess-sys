import {
  boxConnectUrl,
  firstName,
  showPack,
  showPackFileName,
  showPackKit,
  type JobView,
  type PackPerson,
  type PhaseView,
  type ShowPackPhase,
  type View,
} from '@sh/shared'
import { strToU8, zipSync } from 'fflate'
import { useId, useState } from 'react'
import { Heading } from '../Icon.tsx'
import { useAccess } from '../role.ts'
import { appVersion } from '../version.ts'
import { sheetInput } from './SheetScreen.tsx'

/**
 * The Crewbox show pack (ADR 0045): one .zip of files for the on-site box,
 * for a phase from its call sheet, or for the whole job from its page. It's
 * made here from what this device holds, so it works with no signal, and
 * it's a download: nothing is sent anywhere. Crew numbers go in only for
 * someone who can change crew and their bookings; no rate or price ever
 * does. The box's address and PIN, for the join QR, go in the pack only
 * and aren't kept.
 */

export function ShowPackCard({ view, job, phase }: { view: View; job: JobView; phase?: PhaseView }) {
  const phones = useAccess().can('crew')
  const [address, setAddress] = useState('')
  const [pin, setPin] = useState('')
  const [checked, setChecked] = useState(false)
  const [done, setDone] = useState<string>()
  const id = useId()
  const badAddress = address.trim() !== '' && !boxConnectUrl(address)
  const what = phase ? phase.name : 'the whole job'

  const download = () => {
    setChecked(true)
    if (badAddress) return
    const name = showPackFileName(job.name, phase?.name)
    const files = showPack(packInput(view, job, phase, { phones, box: address.trim() ? { address, pin } : null }))
    const made = new Date()
    const zip = zipSync(Object.fromEntries(files.map((f) => [f.path, strToU8(f.text)])), { level: 6, mtime: made })
    const url = URL.createObjectURL(new Blob([zip as BlobPart], { type: 'application/zip' }))
    const a = document.createElement('a')
    a.href = url
    a.download = name
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
    setDone(name)
    setTimeout(() => setDone(undefined), 4000)
  }

  return (
    <section className="card show-pack" aria-label="Show pack">
      <Heading icon="download">Show pack</Heading>
      <p className="hint">
        The crew, running order, kit, venue and who to ring for {what}, as files to load on the Crewbox on site, in one .zip. It's made on this device from what it
        holds, so it works with no signal, and nothing is sent anywhere.
      </p>
      <details className="phase-details">
        <summary>Join QR on the crew list</summary>
        <div>
          <label className="field" htmlFor={`${id}-box`}>
            The box's address on the site's Wi-Fi
            <input
              id={`${id}-box`}
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              onBlur={() => setChecked(true)}
              placeholder="crewbox.local"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              aria-invalid={checked && badAddress}
              aria-describedby={checked && badAddress ? `${id}-bad` : undefined}
            />
          </label>
          {checked && badAddress && (
            <p className="alert" id={`${id}-bad`} role="alert">
              That isn't an address the box could have. Type it as the box's setup page shows it, such as crewbox.local or 10.0.0.2:8080.
            </p>
          )}
          <label className="field" htmlFor={`${id}-pin`}>
            Event PIN
            <input id={`${id}-pin`} value={pin} onChange={(e) => setPin(e.target.value)} inputMode="numeric" autoComplete="off" />
          </label>
          <p className="hint">Only in the pack: they aren't kept here. Without an address the crew list has no QR, and crew type the box's address.</p>
        </div>
      </details>
      <div className="actions">
        <button type="button" onClick={download}>
          Download show pack
        </button>
        {/* Said where it lands, and gone after the notice time; the region is there before it has anything to say. */}
        <span className="hint" aria-live="polite">
          {done && `Downloaded ${done}`}
        </span>
      </div>
      <p className="hint">
        {phones
          ? 'It has the numbers of crew who have said yes, as the crew chief needs.'
          : "Your role can't change crew, so it lists those confirmed, with no number but the contact on the day's."}{' '}
        No rates or prices are in it. Session Hire holds no patch or lighting rig yet, so those two files are empty, with their columns to fill in.
      </p>
    </section>
  )
}

/** The pack's input from the device's copy: one phase, or every phase and the crew across them. */
export function packInput(view: View, job: JobView, phase: PhaseView | undefined, o: { phones: boolean; box: { address: string; pin: string } | null; made?: string }) {
  const people = new Map<string, PackPerson>(view.crew.people.map((p) => [p.id, { name: p.name, knownAs: firstName(p), department: p.department }]))
  const of = (p: PhaseView): ShowPackPhase => ({ id: p.id, name: p.name, start: p.start, end: p.end, sheet: sheetInput(view, job, p) })
  const phases: ShowPackPhase[] = phase ? [of(phase)] : job.phases.map(of)
  if (!phase && job.otherCalls.length && job.span) {
    // The crew across phases, on a sheet of their own with the job's days.
    const first = job.phases[0]
    const base = first ? sheetInput(view, job, first) : undefined
    if (base)
      phases.push({ id: null, name: 'Across phases', start: job.span.start, end: job.span.end, sheet: { ...base, phase: null, venue: null, contact: null, calls: job.otherCalls } })
  }
  return {
    job: { id: job.id, name: job.name, client: job.client?.name ?? null },
    scope: phase ? ('phase' as const) : ('job' as const),
    phases,
    people,
    kit: showPackKit(view.kit.byJob.get(job.id) ?? [], view.moves.pickList(job.id), phase?.id ?? null),
    office: view.office.details ?? null,
    phones: o.phones,
    made: o.made ?? new Date().toISOString(),
    appVersion: appVersion(),
    box: o.box,
  }
}
