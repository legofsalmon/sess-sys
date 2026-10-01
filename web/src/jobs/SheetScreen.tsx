import {
  callSheet,
  callSheetText,
  HOLDING,
  sheetMessage,
  type CallSheet,
  type CallView,
  type JobView,
  type PersonView,
  type PhaseView,
  type SheetInput,
  type SheetPerson,
  type View,
} from '@sh/shared'
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { Refusal, useAct } from '../act.tsx'
import { linkFor, SharePanel } from '../crew/CrewScreen.tsx'
import { client } from '../sync.ts'
import { Top } from './common.tsx'

/**
 * A phase's call sheet (ADR 0021), #jobs/<job>/sheet/<phase>, as the office
 * sees it: who's on and their numbers, who's still to answer, the contact
 * on the day, where, the running order, the kit and the client's contacts.
 * Everyone who has said yes gets their own on their private link, sent from
 * here. It's worked out from what's on this device, so it works with no
 * signal, and printing it prints only the sheet.
 */

export function sheetInput(view: View, job: JobView, phase: PhaseView): SheetInput {
  const people = new Map<string, SheetPerson>(view.crew.people.map((p) => [p.id, { id: p.id, name: p.name, phone: p.phone }]))
  return {
    job: { name: job.name, notes: job.notes },
    client: job.client ? { name: job.client.name, contacts: job.client.contacts } : null,
    phase: { name: phase.name, start: phase.start, end: phase.end, notes: phase.notes },
    venue: phase.venue ?? null,
    contact: (phase.contactId && people.get(phase.contactId)) || null,
    calls: phase.calls,
    people,
    kit: (view.kit.byJob.get(job.id) ?? [])
      .filter((l) => l.phaseId === null || l.phaseId === phase.id)
      .map((l) => ({ department: l.model?.department ?? 'other', name: l.model?.name ?? 'A product', qty: l.qty, subhireQty: l.subhireQty, supplier: l.supplier })),
  }
}

export function SheetScreen({ view, jobId, phaseId }: { view: View; jobId: string; phaseId: string }) {
  const job = view.jobs.jobs.find((j) => j.id === jobId)
  const phase = job?.phases.find((p) => p.id === phaseId)
  const [share, setShare] = useState<{ person: PersonView; call: CallView } | undefined>()
  const [copied, setCopied] = useState(false)
  const [printing, setPrinting] = useState(false)
  useEffect(() => {
    if (!printing) return
    const done = () => setPrinting(false)
    addEventListener('afterprint', done)
    // Once the sheet is on the page.
    const frame = requestAnimationFrame(() => print())
    return () => {
      cancelAnimationFrame(frame)
      removeEventListener('afterprint', done)
    }
  }, [printing])

  if (!job || !phase)
    return (
      <div className="app crew jobs">
        <Top view={view} />
        <a className="back" href={job ? `#jobs/${job.id}` : '#jobs'}>
          ‹ {job?.name ?? 'All jobs'}
        </a>
        <section className="card">
          <p className="empty">This phase isn't on this device. It may have been removed, or still be on its way: check again once it says “Up to date”.</p>
        </section>
      </div>
    )

  const sheet = callSheet(sheetInput(view, job, phase), 'office')
  const copy = () => void navigator.clipboard?.writeText(callSheetText(sheet)).then(() => setCopied(true))
  const send = (call: CallView, personId: string) => {
    const person = view.crew.people.find((p) => p.id === personId)
    if (person) setShare({ person, call })
  }

  return (
    <div className="app crew jobs sheet-screen">
      <Top view={view} />
      <a className="back" href={`#jobs/${job.id}`}>
        ‹ {job.name}
      </a>
      <section className="card">
        <p className="kicker">Call sheet</p>
        <h1>
          {job.name} <span className="muted">{phase.name}</span>
        </h1>
        <p>
          {sheet.when}
          {sheet.client && ` · for ${sheet.client.name}`}
        </p>
        <div className="actions">
          <button type="button" className="primary" onClick={() => setPrinting(true)} disabled={printing}>
            Print
          </button>
          <button type="button" onClick={copy}>
            {copied ? 'Copied' : 'Copy for a WhatsApp group'}
          </button>
        </div>
        <p className="hint">
          Everyone who has said yes has their own on their private link: send it from Crew below. Theirs shows who else is on by name, and only the
          contact's number.
        </p>
      </section>

      <Contact view={view} phase={phase} sheet={sheet} />
      <Sheet sheet={sheet} calls={phase.calls} onSend={send} />
      {share && (
        <SharePanel
          {...share}
          onClose={() => setShare(undefined)}
          message={(link) => ({ ...sheetMessage(share.person, sheet, `${link}/sheet/${share.call.id}`), what: 'call sheet' })}
        />
      )}

      {printing &&
        createPortal(
          <div className="print-sheet call-sheet">
            <style>{'@page { size: A4; margin: 14mm; }'}</style>
            <header>
              <p className="kicker">Session Hire · call sheet</p>
              <h1>
                {job.name}
                {sheet.phase && `: ${sheet.phase}`}
              </h1>
              <p>
                {sheet.when}
                {sheet.client && ` · for ${sheet.client.name}`}
              </p>
            </header>
            {sheet.contact && (
              <section>
                <h2>On the day</h2>
                <p>
                  Ring <b>{sheet.contact.name}</b>
                  {sheet.contact.phone && ` on ${sheet.contact.phone}`}
                </p>
              </section>
            )}
            <Sheet sheet={sheet} calls={phase.calls} print />
            <footer>The office's copy, with everyone's numbers: crew have their own on their private link.</footer>
          </div>,
          document.body
        )}
    </div>
  )
}

/** Who crew ring on the day: anyone in the app, people on the phase first. */
function Contact({ view, phase, sheet }: { view: View; phase: PhaseView; sheet: CallSheet }) {
  const on = new Set(phase.calls.flatMap((c) => (c.status === 'open' ? c.offers.filter((o) => HOLDING.includes(o.status)).map((o) => o.personId) : [])))
  const byName = (a: PersonView, b: PersonView) => a.name.localeCompare(b.name, 'en-IE')
  // Archived people aren't offered, unless they're the contact already, so the choice still shows who it is.
  const pickable = view.crew.people.filter((p) => !p.archived || p.id === phase.contactId)
  const onPhase = pickable.filter((p) => on.has(p.id)).sort(byName)
  const others = pickable.filter((p) => !on.has(p.id)).sort((a, b) => Number(b.kind === 'staff') - Number(a.kind === 'staff') || byName(a, b))
  const { run, error } = useAct()
  const choose = (id: string) => void run(() => client.mutate('phase.update', { id: phase.id, contactId: id || null }))
  return (
    <section className="card" aria-label="On the day">
      <h2>On the day</h2>
      <Refusal error={error} />
      <label className="field">
        Contact on the day
        <select value={phase.contactId ?? ''} onChange={(e) => choose(e.target.value)}>
          <option value="">Nobody yet</option>
          {onPhase.length > 0 && (
            <optgroup label={`On ${phase.name}`}>
              {onPhase.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </optgroup>
          )}
          <optgroup label={onPhase.length ? 'Everyone else' : 'Everyone'}>
            {others.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
                {p.kind === 'staff' ? ' (staff)' : ''}
              </option>
            ))}
          </optgroup>
        </select>
      </label>
      {sheet.contact && !sheet.contact.phone && (
        <p className="warn-line">There's no number for {sheet.contact.name} yet: edit them on the Crew tab to add one, or crew won't know how to reach them.</p>
      )}
      <p className="hint">
        Their name and number go on everyone's call sheet for {phase.name}. On theirs, they see the crew's numbers and the kit too.
      </p>
    </section>
  )
}

const STATUS_PILL = { booked: ['confirmed', 'Booked'], 'to confirm': ['pending', 'To confirm'], offered: ['offered', 'Offered'] } as const

function Sheet({ sheet, calls, onSend, print }: { sheet: CallSheet; calls: readonly CallView[]; onSend?: (call: CallView, personId: string) => void; print?: boolean }) {
  return (
    <>
      {sheet.venue && (
        <section className={print ? '' : 'card'} aria-label="Where">
          <h2>Where</h2>
          <p>
            <b>{sheet.venue.name}</b>
            {sheet.venue.address && <span className="lines">{`\n${sheet.venue.address}`}</span>}
          </p>
          {!print && (
            <a href={sheet.venue.map} target="_blank" rel="noreferrer">
              Open the map
            </a>
          )}
          {sheet.venue.notes && <p className="lines">{sheet.venue.notes}</p>}
        </section>
      )}

      <section className={print ? '' : 'card'} aria-label="Running order">
        <h2>{sheet.phase || 'Running order'}</h2>
        {sheet.notes.phase ? <p className="lines">{sheet.notes.phase}</p> : <p className="empty">No running order yet.</p>}
        {!print && <p className="hint">From the phase's notes, which go on the calendar too. Change them with the phase on the job's page.</p>}
        {sheet.notes.job && (
          <>
            <h3>About the job</h3>
            <p className="lines">{sheet.notes.job}</p>
          </>
        )}
      </section>

      <section className={print ? '' : 'card'} aria-label="Crew">
        <h2>Crew</h2>
        {sheet.calls.length === 0 && <p className="empty">No crew asked for yet.</p>}
        {sheet.calls.map((c) => (
          <article key={c.id} className="sheet-call">
            <header>
              <b>
                {c.callTime && `${c.callTime} · `}
                {c.role}
              </b>
              {c.days && <span className="muted"> {c.days}</span>}
              {!!c.toFind && (print ? <span className="muted"> · {c.toFind} to find</span> : <span className="pill pending">{c.toFind} to find</span>)}
            </header>
            {c.details && <p className="lines muted">{c.details}</p>}
            <ul>
              {/* On paper, where there's no pill to say so, only who has said yes. */}
              {c.crew.filter((p) => !print || p.status !== 'offered').map((p) => {
                const call = calls.find((x) => x.id === c.id)
                return (
                  <li key={p.personId}>
                    <span>
                      {p.name}
                      {p.days && <span className="muted"> {p.days}</span>}
                    </span>
                    {p.phone && (print ? <span> · {p.phone}</span> : <a href={`tel:${p.phone.replace(/[^\d+]/g, '')}`}>{p.phone}</a>)}
                    {print ? p.status === 'to confirm' && <span className="muted"> · to confirm</span> : <span className={`pill ${STATUS_PILL[p.status][0]}`}>{STATUS_PILL[p.status][1]}</span>}
                    {!print && onSend && call && p.status !== 'offered' && (
                      <button type="button" className="link" onClick={() => onSend(call, p.personId)} aria-label={`Send ${p.name} their call sheet`}>
                        Send
                      </button>
                    )}
                  </li>
                )
              })}
            </ul>
          </article>
        ))}
      </section>

      {sheet.kit && sheet.kit.length > 0 && (
        <section className={print ? '' : 'card'} aria-label="Kit">
          <h2>Kit</h2>
          {sheet.kit.map((d) => (
            <div key={d.department} className="sheet-kit">
              <h3>{d.department}</h3>
              <ul>
                {d.lines.map((l) => (
                  <li key={`${l.name}${l.note}`}>
                    {l.qty} × {l.name}
                    {l.note && <span className="muted"> {l.note}</span>}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </section>
      )}

      {sheet.client?.contacts && sheet.client.contacts.length > 0 && (
        <section className={print ? '' : 'card'} aria-label="Client">
          <h2>{sheet.client.name}</h2>
          <ul className="sheet-contacts">
            {sheet.client.contacts.map((c) => (
              <li key={`${c.name}${c.role}`}>
                <b>{c.name}</b>
                {c.role && <span className="muted"> {c.role}</span>}
                {c.phone && (print ? <span> · {c.phone}</span> : <a href={`tel:${c.phone.replace(/[^\d+]/g, '')}`}> {c.phone}</a>)}
                {c.email && <span className="muted"> · {c.email}</span>}
              </li>
            ))}
          </ul>
          {!print && <p className="hint">Only on the office's sheet.</p>}
        </section>
      )}
    </>
  )
}
