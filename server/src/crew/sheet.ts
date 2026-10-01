import { callSheet, HOLDING, type CallSheet, type SheetKitLine, type SheetPerson } from '@sh/shared'
import type { Queryable } from '../db.ts'
import { getClient, getPhase, getProject, getVenue } from '../projects/store.ts'
import { CSS } from './page.ts'
import { getCall, getPerson, offersForCall, openCallsFor } from './store.ts'

/**
 * A call sheet on a person's private link, /f/<token>/sheet/<call> (ADR
 * 0021): for a call they've accepted or are booked on, and only while it's
 * going ahead. The contact on the day sees the crew's numbers and the kit;
 * everyone else sees who's on by name and role, and the contact's number.
 */
export async function sheetFor(q: Queryable, personId: string, callId: string): Promise<CallSheet | undefined> {
  const call = await getCall(q, callId)
  if (!call || call.status !== 'open') return undefined
  const offers = await offersForCall(q, call.id)
  if (!offers.some((o) => o.personId === personId && HOLDING.includes(o.status))) return undefined

  const project = call.projectId ? await getProject(q, call.projectId) : undefined
  const phase = call.phaseId ? await getPhase(q, call.phaseId) : undefined
  const client = project?.clientId ? await getClient(q, project.clientId) : undefined
  const venueId = phase?.venueId ?? project?.venueId ?? null
  const venue = venueId ? await getVenue(q, venueId) : undefined

  // The whole phase's crew; a call not for one phase is a sheet of its own.
  const calls = phase ? await openCallsFor(q, { phaseId: phase.id }) : [call]
  const offersOf = new Map([[call.id, offers]])
  for (const c of calls) if (!offersOf.has(c.id)) offersOf.set(c.id, await offersForCall(q, c.id))
  const ids = new Set([...offersOf.values()].flat().map((o) => o.personId))
  if (phase?.contactId) ids.add(phase.contactId)
  const people = new Map<string, SheetPerson>()
  for (const id of ids) {
    const p = await getPerson(q, id)
    if (p) people.set(id, { id, name: p.name, phone: p.phone })
  }
  const contact = (phase?.contactId && people.get(phase.contactId)) || null
  const reader = contact?.id === personId ? 'contact' : 'crew'

  return callSheet(
    {
      job: project ? { name: project.name, notes: project.notes } : { name: call.project, notes: '' },
      client: client ? { name: client.name, contacts: client.contacts } : null,
      phase: phase ? { name: phase.name, start: phase.start, end: phase.end, notes: phase.notes } : null,
      venue: venue ?? (call.venue ? { name: call.venue, address: '', notes: '' } : null),
      contact,
      calls: calls.map((c) => ({ ...c, offers: offersOf.get(c.id) ?? [] })),
      people,
      kit: reader === 'contact' && project ? await kitFor(q, project.id, phase?.id ?? null) : [],
      readerId: personId,
    },
    reader
  )
}

/** The phase's kit and the whole job's, as a crew chief loads the van. */
async function kitFor(q: Queryable, projectId: string, phaseId: string | null): Promise<SheetKitLine[]> {
  const { rows } = await q.query<{ name: string; department: SheetKitLine['department']; qty: number; subhire_qty: number; supplier: string }>(
    `SELECT m.name, m.department, k.qty, k.subhire_qty, k.supplier
       FROM kit_lines k JOIN models m ON m.id = k.model_id
      WHERE k.project_id = $1 AND (k.phase_id IS NULL OR k.phase_id = $2)`,
    [projectId, phaseId]
  )
  return rows.map((r) => ({ name: r.name, department: r.department, qty: r.qty, subhireQty: r.subhire_qty, supplier: r.supplier }))
}

const h = (s: unknown) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)
const lines = (s: string) => h(s).replace(/\n/g, '<br>')
const tel = (phone: string) => `<a href="tel:${h(phone.replace(/[^\d+]/g, ''))}">${h(phone)}</a>`

export function renderSheet(s: CallSheet, base: string): string {
  const mine = s.calls.filter((c) => c.crew.some((p) => p.me))
  return `<!doctype html>
<html lang="en-IE">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="noindex, nofollow">
<meta name="referrer" content="no-referrer">
<meta name="theme-color" content="#ee3744">
<title>Call sheet: ${h(s.job)}${s.phase ? `, ${h(s.phase)}` : ''}</title>
<style>${CSS}${SHEET_CSS}</style>
</head>
<body>
<main class="sheet">
  <header class="top"><span class="mark">SH</span><div><b>Session Hire</b><small>Call sheet</small></div></header>
  <a class="back" href="${h(base)}">‹ Your work</a>
  <section class="head">
    <h1>${h(s.job)}${s.phase ? ` <span>${h(s.phase)}</span>` : ''}</h1>
    <p class="when">${h(s.when)}</p>
    ${s.client ? `<p class="small">For ${h(s.client.name)}</p>` : ''}
  </section>

  ${mine
    .map((c) => {
      const me = c.crew.find((p) => p.me)!
      return `<section class="you"><h2>You</h2><p><b>${h(c.role)}</b>${c.callTime ? `, call <b>${h(c.callTime)}</b>` : ''}${me.days || c.days ? `, ${h(me.days ?? c.days)}` : ''}${me.status === 'to confirm' ? ' <small>(the office will confirm)</small>' : ''}</p>${c.details ? `<p class="details">${lines(c.details)}</p>` : ''}</section>`
    })
    .join('')}

  ${
    s.contact
      ? `<section class="contact"><h2>On the day</h2>${
          s.contact.me
            ? '<p>You\'re the contact on the day: crew will ring you. Their numbers are below.</p>'
            : `<p>Ring <b>${h(s.contact.name)}</b>${s.contact.phone ? ` on ${tel(s.contact.phone)}` : ''}.</p>`
        }</section>`
      : ''
  }

  ${
    s.venue
      ? `<section><h2>Where</h2><p><b>${h(s.venue.name)}</b>${s.venue.address ? `<br>${lines(s.venue.address)}` : ''}</p>
    <p><a href="${h(s.venue.map)}">Open the map</a></p>${s.venue.notes ? `<p class="details">${lines(s.venue.notes)}</p>` : ''}</section>`
      : ''
  }

  ${s.notes.phase ? `<section><h2>${h(s.phase || 'Running order')}</h2><p class="details">${lines(s.notes.phase)}</p></section>` : ''}
  ${s.notes.job ? `<section><h2>About the job</h2><p class="details">${lines(s.notes.job)}</p></section>` : ''}

  <section><h2>Crew</h2>
    ${s.calls
      .map(
        (c) => `<article class="call"><p><b>${c.callTime ? `${h(c.callTime)} · ` : ''}${h(c.role)}</b>${c.days ? ` <small>${h(c.days)}</small>` : ''}</p>
      ${
        c.crew.length
          ? `<ul>${c.crew
              .map(
                (p) =>
                  `<li${p.me ? ' class="me"' : ''}>${h(p.name)}${p.me ? ' (you)' : ''}${p.days ? ` <small>${h(p.days)}</small>` : ''}${p.status === 'to confirm' && !p.me ? ' <small>to confirm</small>' : ''}${p.phone ? ` · ${tel(p.phone)}` : ''}</li>`
              )
              .join('')}</ul>`
          : '<p class="small">To be confirmed.</p>'
      }</article>`
      )
      .join('')}
  </section>

  ${
    s.kit?.length
      ? `<section><h2>Kit</h2>${s.kit
          .map(
            (d) =>
              `<article class="call"><p><b>${h(d.department)}</b></p><ul>${d.lines.map((l) => `<li>${l.qty} × ${h(l.name)}${l.note ? ` <small>${h(l.note)}</small>` : ''}</li>`).join('')}</ul></article>`
          )
          .join('')}</section>`
      : ''
  }

  <footer>
    <span>This sheet shows what the office has as you open it: open it again on the day for any changes.</span>
    <span>Keep this link to yourself: anyone with it can answer for you.</span>
  </footer>
</main>
</body>
</html>`
}

/** Not this person's, or the job's changed since the link was sent. */
export function renderNoSheet(base: string, what: 'call sheet' | 'timesheet' = 'call sheet'): string {
  return `<!doctype html><html lang="en-IE"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex"><title>Session Hire</title><style>${CSS}${SHEET_CSS}</style></head>
<body><main><header class="top"><span class="mark">SH</span><div><b>Session Hire</b></div></header>
<p class="flash warn">There's no ${what} here for you: you may not be booked on it any more, or the job has changed.</p>
<a class="back" href="${h(base)}">‹ Your work</a></main></body></html>`
}

export const SHEET_CSS = `
.back{font-weight:600;text-decoration:none}
.sheet h1{margin:0;font-size:1.4rem;line-height:1.2}.sheet h1 span{font-weight:500;color:var(--muted)}
.head{gap:4px}.when{margin:0;font-weight:600}
.sheet section{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:14px;gap:8px}
.sheet section.head{background:none;border:0;padding:0}
.sheet section p{margin:0}.sheet h2{margin:0}
.you{border-left:4px solid var(--good)!important}.contact{border-left:4px solid var(--accent)!important}
.call{display:grid;gap:4px;padding-top:8px;border-top:1px solid var(--line)}.call:first-of-type{border-top:0;padding-top:0}
.call ul{margin:0;padding-left:1.1em;display:grid;gap:2px}.call small,.head small{color:var(--muted)}
.call li.me{font-weight:600}
a[href^="tel:"]{white-space:nowrap}
@media print{
  :root{--bg:#fff;--panel:#fff;color-scheme:light}
  .back,footer span:last-child{display:none}
  main{max-width:none;padding:0}
  .sheet section{break-inside:avoid}
}
`
