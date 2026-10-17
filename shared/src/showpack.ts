import { callSheet, type SheetInput } from './callsheet.ts'
import { eachDay } from './crew.ts'
import { qrCode } from './labels.ts'
import { officeContact, type OfficeDetails } from './office.ts'
import { csvText } from './quotes.ts'
import { color as dsColor } from './ds/tokens.js'
import { DEPARTMENTS, type Department } from './stock.ts'

/**
 * The Crewbox show pack (ADR 0045): the files a crew chief loads on the
 * on-site box, made on the device from what it holds, for one phase of a
 * job or the whole job. It's step 1 of docs/research/crewbox-handoff.md:
 * files only, nothing sent anywhere, nothing needed from Crewbox but the
 * running-order import. The layout of every file is written down in
 * docs/crewbox-show-pack.md, so the Crewbox side can be built to it, and
 * `manifest.json` says which version of it a pack is.
 *
 * Who is on it and whose numbers follow the call sheet's rules (ADR 0021):
 * the pack is the crew chief's, so it's the contact on the day's sheet
 * (everyone who has said yes, with their numbers, and the kit) for someone
 * who can change crew and their bookings; for anyone else it's what the
 * rest of the crew see (those confirmed, by name and role, and only the
 * contact's number). Never a rate, a price or a client's contact.
 */

export const SHOW_PACK_FORMAT = 'session-hire/show-pack'
/** Goes up when a file's columns or meaning change, so Crewbox can tell what it got. */
export const SHOW_PACK_VERSION = 1

/** One act on Crewbox's timetable: its `Act {id, name, stage, date, start, end, changeover}`, with the phase it came from. */
export interface RunningOrderAct {
  id: string
  name: string
  stage: string
  date: string
  start: string
  end: string
  /** Minutes; empty when not said. */
  changeover: string
  phaseId: string
}

const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']
const time = (h: string, m: string) => (Number(h) < 24 && Number(m) < 60 ? `${h.padStart(2, '0')}:${m}` : null)

/**
 * The running order in a phase's notes, where it's written a line at a
 * time as "18:00 First act" or "18:00–19:00 Support": each such line is an
 * act, in the order written. A line that's only a day ("Sunday", "Sun 4
 * Oct", "Day 2" or "2026-10-04") puts the lines after it on that day of
 * the phase; until one does, they're on its first. Notes with no day line
 * on a phase of several days are read as the call sheet reads them, the
 * same order each day, so the acts are repeated on every day of the
 * phase. An act's id is the phase's and its place in the list. A line
 * "Stage: Main" or
 * "Main stage:" names the stage for the lines after it. An end time is
 * only what's written: none is made up from the next act. Anything else
 * is left out of the timetable and kept, as typed, in running-order.txt.
 */
export function runningOrder(notes: string, days: readonly string[], phaseId: string): { acts: RunningOrderAct[]; unread: number } {
  const acts: RunningOrderAct[] = []
  let unread = 0
  let date = days[0] ?? ''
  let stage = ''
  let dayLines = 0
  for (const raw of notes.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line) continue
    const t = /^(\d{1,2})[:.](\d{2})(?:\s*(?:-|–|—|to)\s*(\d{1,2})[:.](\d{2}))?\s*[-–—:·,]?\s+(.+)$/i.exec(line)
    const start = t && time(t[1]!, t[2]!)
    if (t && start) {
      const end = t[3] ? time(t[3], t[4]!) : ''
      acts.push({ id: `${phaseId}-${acts.length + 1}`, name: t[5]!.trim(), stage, date, start, end: end ?? '', changeover: '', phaseId })
      continue
    }
    const s = /^stage\s*[:-]\s*(.+)$/i.exec(line) ?? /^(.{1,40}\bstage):$/i.exec(line)
    if (s) {
      stage = s[1]!.trim()
      continue
    }
    const day = dayOfLine(line, days, date)
    if (day) {
      date = day
      dayLines++
      continue
    }
    unread++
  }
  if (dayLines || days.length < 2) return { acts, unread }
  const each = days.flatMap((d) => acts.map((a) => ({ ...a, date: d })))
  return { acts: each.map((a, i) => ({ ...a, id: `${phaseId}-${i + 1}` })), unread }
}

/** The phase's day a short line names, if it's only a day: an ISO date, "Day 2", or a weekday (the next one on or after `from`). */
function dayOfLine(line: string, days: readonly string[], from: string): string | undefined {
  const l = line.replace(/[:.]$/, '').trim().toLowerCase()
  if (l.length > 30) return undefined
  if (/^\d{4}-\d{2}-\d{2}$/.test(l)) return days.includes(l) ? l : undefined
  const n = /^day\s+(\d{1,2})$/.exec(l)
  if (n) return days[Number(n[1]) - 1]
  const word = /^([a-z]+)\b[\s\d\w]*$/.exec(l)?.[1]
  if (!word || word.length < 3) return undefined
  const wd = WEEKDAYS.findIndex((w) => w.startsWith(word) && (word.length === 3 || word === w))
  if (wd < 0) return undefined
  const on = (d: string) => new Date(`${d}T12:00:00Z`).getUTCDay() === wd
  return days.find((d) => d >= from && on(d)) ?? days.find(on)
}

/** A product on the pack's kit list: no value, price or rate, only what it is and which of Session Hire's numbers are out with the job. */
export interface PackKitRow {
  department: Department
  category: string
  product: string
  /** How many the job's lines want, subhired ones too. */
  qty: number
  subhireQty: number
  supplier: string
  /** Numbered items scanned out with the job now, by Session Hire number. */
  numbers: readonly string[]
  /** Counted (not numbered) kit scanned out with the job now. */
  countedOut: number
}

/** A person as the pack names them: never their rate, email or link. */
export interface PackPerson {
  name: string
  /** What they go by: their "known as", or their first name. */
  knownAs: string
  /** Their department, as typed on their profile (ADR 0025). */
  department: string | null
}

export interface ShowPackPhase {
  /** Null for the job's crew across its phases. */
  id: string | null
  name: string
  start: string
  end: string
  /** The call sheet's input for it (web/src/jobs/SheetScreen.tsx's `sheetInput`), its kit and lateness aside. */
  sheet: SheetInput
}

export interface ShowPackInput {
  job: { id: string; name: string; client: string | null }
  /** One phase, or every phase of the job and its crew across them. */
  scope: 'phase' | 'job'
  phases: readonly ShowPackPhase[]
  people: ReadonlyMap<string, PackPerson>
  kit: readonly PackKitRow[]
  office: OfficeDetails | null
  /** Whether crew's numbers go in: only for someone who can change crew and their bookings. */
  phones: boolean
  /** When it was made, as an ISO time, and by which version of the app. */
  made: string
  appVersion: string
  /** The box, when the crew chief knows it: its address on the site's Wi-Fi and the event PIN, for the join QR. Kept in the pack only. */
  box?: { address: string; pin: string } | null
}

/** The box's join page, from the address typed: "crewbox.local" or "10.0.0.2:8080" becomes http://…/connect. Undefined when it can't be one. */
export function boxConnectUrl(address: string): string | undefined {
  let a = address.trim()
  if (!a) return undefined
  if (!/^https?:\/\//i.test(a)) a = `http://${a}`
  try {
    const u = new URL(a)
    if (!u.hostname || /\s/.test(address.trim())) return undefined
    const path = u.pathname.replace(/\/+$/, '')
    u.pathname = path.endsWith('/connect') ? path : `${path}/connect`
    u.search = ''
    u.hash = ''
    return u.toString()
  } catch {
    return undefined
  }
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** A file name from a job and phase: "show-pack-harbour-lights-festival-show.zip". */
export function showPackFileName(job: string, phase?: string): string {
  const slug = (s: string) =>
    s
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
  return `show-pack-${[slug(job), phase ? slug(phase) : ''].filter(Boolean).join('-') || 'job'}.zip`
}

/** The patch sheet's columns, for Crewbox's patch import (fuzzy headers): one row per input. */
export const PATCH_COLUMNS = ['Channel', 'Source', 'Mic/DI', 'Stand', '48V', 'Stage box', 'Notes'] as const
/** The lighting rig's columns, Lightwright's names, which Crewbox's lighting import reads: one row per fixture. */
export const LIGHTING_COLUMNS = ['Channel', 'Dimmer', 'Universe', 'Address', 'Position', 'Unit#', 'Instrument Type', 'Mode', 'Purpose', 'Color', 'Gobo', 'Notes'] as const

export interface ShowPackFile {
  path: string
  /** What it is, for the manifest. */
  kind: 'manifest' | 'readme' | 'event' | 'crew' | 'crew-list' | 'contacts' | 'running-order' | 'running-order-notes' | 'kit' | 'patch' | 'lighting'
  text: string
  /** Data rows, for a CSV. */
  rows?: number
  /** An empty template: the app holds no data for it. */
  template?: true
}

/** The pack's files, manifest first, ready to zip. */
export function showPack(input: ShowPackInput): ShowPackFile[] {
  const reader = input.phones ? 'contact' : 'crew'
  const sheets = input.phases.map((p) => ({ phase: p, sheet: callSheet({ ...p.sheet, kit: [], late: [] }, reader) }))
  const files: ShowPackFile[] = []
  const csv = (path: string, kind: ShowPackFile['kind'], header: readonly string[], rows: readonly (readonly string[])[], template?: true) =>
    files.push({ path, kind, text: csvText(header, rows), rows: rows.length, ...(template ? { template } : {}) })

  // Who's on: one row per person per call, as the sheet for this reader lists them.
  const crewRows: string[][] = []
  for (const { phase, sheet } of sheets) {
    for (const c of sheet.calls) {
      const call = phase.sheet.calls.find((x) => x.id === c.id)!
      const callDays = eachDay(call.start, call.end)
      for (const p of c.crew) {
        const who = input.people.get(p.personId)
        const offer = call.offers.find((o) => o.personId === p.personId)
        const days = (offer?.days ?? []).filter((d) => callDays.includes(d)).sort()
        crewRows.push([
          phase.id ?? '',
          phase.id ? phase.name : 'Across phases',
          p.name,
          who?.knownAs ?? p.name,
          c.role,
          // The call's own department (ADR 0046); a call with none yet goes by the person's profile, as before.
          c.department ?? who?.department ?? '',
          c.callTime ?? '',
          (days.length ? days : callDays).join(' '),
          p.status === 'booked' ? 'booked' : 'to confirm',
          p.phone ?? '',
        ])
      }
    }
  }
  csv('crew.csv', 'crew', ['phase_id', 'phase', 'name', 'known_as', 'role', 'department', 'call_time', 'days', 'status', 'phone'], crewRows)

  // Who to ring: the contact on the day for each phase, then the office.
  const contacts: string[][] = []
  for (const { phase, sheet } of sheets)
    if (sheet.contact && phase.id) contacts.push([phase.id, phase.name, 'Contact on the day', sheet.contact.name, sheet.contact.phone ?? '', ''])
  const office = officeContact(input.office)
  if (office) contacts.push(['', '', 'Office', office.name, office.phone ?? '', office.email ?? ''])
  csv('contacts.csv', 'contacts', ['phase_id', 'phase', 'what', 'name', 'phone', 'email'], contacts)

  // The running order, as Crewbox's timetable has it, from each phase's notes.
  const acts: RunningOrderAct[] = []
  let unread = 0
  for (const { phase, sheet } of sheets) {
    if (!phase.id) continue
    const r = runningOrder(sheet.notes.phase, sheet.days, phase.id)
    acts.push(...r.acts)
    unread += r.unread
  }
  csv(
    'running-order.csv',
    'running-order',
    ['id', 'name', 'stage', 'date', 'start', 'end', 'changeover', 'phase_id'],
    acts.map((a) => [a.id, a.name, a.stage, a.date, a.start, a.end, a.changeover, a.phaseId])
  )
  files.push({ path: 'running-order.txt', kind: 'running-order-notes', text: runOfShowText(input, sheets) })

  // The kit, by department, with the numbers out with the job.
  const kit = [...input.kit].sort(
    (a, b) => DEPARTMENTS.indexOf(a.department) - DEPARTMENTS.indexOf(b.department) || a.product.localeCompare(b.product, 'en-IE')
  )
  csv(
    'kit.csv',
    'kit',
    ['department', 'category', 'product', 'quantity', 'subhired', 'supplier', 'scanned_out', 'numbers'],
    kit.map((k) => [
      k.department,
      k.category,
      k.product,
      String(k.qty),
      String(k.subhireQty),
      k.subhireQty ? k.supplier : '',
      String(k.numbers.length + k.countedOut),
      [...k.numbers].sort().join(' '),
    ])
  )

  // The app holds no patch or rig yet, so these are the headers to fill in.
  csv('patch.csv', 'patch', PATCH_COLUMNS, [], true)
  csv('lighting.csv', 'lighting', LIGHTING_COLUMNS, [], true)

  const connect = input.box ? boxConnectUrl(input.box.address) : undefined
  const pin = input.box?.pin.trim() ?? ''
  const first = sheets.find((s) => s.phase.id)?.sheet
  const allDays = [...new Set(sheets.flatMap((s) => s.sheet.days))].sort()
  const event = {
    name: input.scope === 'phase' && first ? `${input.job.name}: ${first.phase}` : input.job.name,
    job: { id: input.job.id, name: input.job.name, client: input.job.client },
    start: allDays[0] ?? null,
    end: allDays.at(-1) ?? null,
    phases: sheets
      .filter((s) => s.phase.id)
      .map(({ phase, sheet }) => ({
        id: phase.id,
        name: phase.name,
        start: phase.start,
        end: phase.end,
        venue: sheet.venue,
        contactOnTheDay: sheet.contact ? { name: sheet.contact.name, phone: sheet.contact.phone } : null,
      })),
    // One channel per department with crew on, as step 2 would seed them.
    departments: [...new Set(crewRows.map((r) => r[5]!).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'en-IE')),
    box: connect ? { connect } : null,
  }
  files.push({ path: 'event.json', kind: 'event', text: `${JSON.stringify(event, null, 2)}\n` })
  files.push({ path: 'crew-list.html', kind: 'crew-list', text: crewListHtml(input, sheets, connect, pin) })
  files.push({ path: 'README.txt', kind: 'readme', text: readme(input, { acts: acts.length, unread, connect: !!connect }) })

  const manifest = {
    format: SHOW_PACK_FORMAT,
    formatVersion: SHOW_PACK_VERSION,
    made: input.made,
    madeBy: { app: 'Session Hire', version: input.appVersion },
    scope: input.scope,
    job: event.job,
    phases: input.phases.filter((p) => p.id).map((p) => ({ id: p.id, name: p.name, start: p.start, end: p.end })),
    phones: input.phones ? 'crew who have said yes' : "the contact on the day's only",
    joinQr: !!connect,
    files: files.map((f) => ({ path: f.path, kind: f.kind, ...(f.rows !== undefined ? { rows: f.rows } : {}), ...(f.template ? { template: true } : {}) })),
  }
  return [{ path: 'manifest.json', kind: 'manifest', text: `${JSON.stringify(manifest, null, 2)}\n` }, ...files]
}

type Sheets = { phase: ShowPackPhase; sheet: ReturnType<typeof callSheet> }[]

/** The run of show as a person reads it: each phase's crew calls by time, then its notes as typed, then the job's. */
function runOfShowText(input: ShowPackInput, sheets: Sheets): string {
  const out: string[] = [input.job.name, '']
  for (const { phase, sheet } of sheets) {
    if (!phase.id && !sheet.calls.length) continue
    out.push(phase.id ? `${phase.name}, ${sheet.when}` : 'Crew across phases', '')
    if (sheet.venue) out.push(`At ${sheet.venue.name}${sheet.venue.address ? `, ${sheet.venue.address.replace(/\s*\n\s*/g, ', ')}` : ''}`)
    if (sheet.contact) out.push(`On the day, ring ${sheet.contact.name}${sheet.contact.phone ? ` on ${sheet.contact.phone}` : ''}`)
    if (sheet.calls.length) {
      out.push('', 'Crew calls')
      for (const c of sheet.calls) out.push(`${c.callTime ? `${c.callTime} ` : ''}${c.role}${c.days ? ` (${c.days})` : ''}: ${c.crew.map((p) => p.name).join(', ') || 'to be confirmed'}`)
    }
    if (sheet.notes.phase) out.push('', 'Running order', sheet.notes.phase)
    out.push('')
  }
  const jobNotes = sheets[0]?.sheet.notes.job
  if (jobNotes) out.push('About the job', jobNotes, '')
  return `${out.join('\n').replace(/\n{3,}/g, '\n\n').trim()}\n`
}

/**
 * The crew list to print and pin up, with the box's join QR and PIN when the
 * crew chief gave them. It's paper, so the light theme's roles on white; the
 * QR code is black on white, as a reader wants, being content, not chrome.
 */
function crewListHtml(input: ShowPackInput, sheets: Sheets, connect: string | undefined, pin: string): string {
  const t = dsColor.light
  const title = input.scope === 'phase' && sheets[0]?.phase.id ? `${input.job.name}: ${sheets[0].phase.name}` : input.job.name
  const parts: string[] = []
  if (connect) {
    const qr = qrCode(connect)
    parts.push(
      `<section class="join"><svg viewBox="-2 -2 ${qr.size + 4} ${qr.size + 4}" width="160" height="160" role="img" aria-label="QR code for ${esc(connect)}"><rect x="-2" y="-2" width="${qr.size + 4}" height="${qr.size + 4}" fill="#fff"/><path d="${qr.path}" fill="#000"/></svg>`,
      `<div><h2>Join the box</h2><p>On the site's Wi-Fi, scan this or open <b>${esc(connect)}</b>, then type your name${pin ? ` and the event PIN, <b class="pin">${esc(pin)}</b>` : ' and the event PIN'}.</p></div></section>`
    )
  }
  for (const { phase, sheet } of sheets) {
    if (!phase.id && !sheet.calls.length) continue
    parts.push(`<section><h2>${esc(phase.id ? `${phase.name} · ${sheet.when}` : 'Crew across phases')}</h2>`)
    if (sheet.venue) parts.push(`<p><b>${esc(sheet.venue.name)}</b>${sheet.venue.address ? `<br>${esc(sheet.venue.address).replace(/\n/g, '<br>')}` : ''}</p>${sheet.venue.notes ? `<p class="notes">${esc(sheet.venue.notes)}</p>` : ''}`)
    if (sheet.contact) parts.push(`<p>On the day, ring <b>${esc(sheet.contact.name)}</b>${sheet.contact.phone ? ` on ${esc(sheet.contact.phone)}` : ''}</p>`)
    const rows = sheet.calls.flatMap((c) =>
      c.crew.map((p) => `<tr><td>${esc(p.name)}</td><td>${esc(c.role)}${c.days ? ` <span class="muted">${esc(c.days)}</span>` : ''}</td><td>${esc(c.callTime ?? '')}</td>${input.phones ? `<td>${esc(p.phone ?? '')}</td>` : ''}<td>${p.status === 'booked' ? '' : 'to confirm'}</td></tr>`)
    )
    parts.push(
      rows.length
        ? `<table><thead><tr><th>Name</th><th>Role</th><th>Call</th>${input.phones ? '<th>Phone</th>' : ''}<th></th></tr></thead><tbody>${rows.join('')}</tbody></table>`
        : '<p class="muted">Nobody has said yes yet.</p>'
    )
    parts.push('</section>')
  }
  const css = [
    '@page{size:A4;margin:14mm}',
    `body{margin:0 auto;max-width:180mm;padding:16px;font:14px/1.45 system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;background:#fff;color:${t.ink.primary}}`,
    `h1{font-size:1.4rem;margin:0}h2{font-size:1rem;margin:0 0 6px}.muted,.kicker{color:${t.ink.tertiary}}.kicker{text-transform:uppercase;letter-spacing:.06em;font-size:.75rem;margin:0}`,
    `section{margin-top:18px;break-inside:avoid}table{width:100%;border-collapse:collapse}th,td{text-align:left;padding:4px 6px;border-bottom:1px solid ${t.line.subtle}}th{font-size:.8rem;color:${t.ink.secondary}}`,
    `.join{display:flex;gap:16px;align-items:center;padding:12px;border:1px solid ${t.line.strong};border-radius:6px}.pin{font-family:'IBM Plex Mono',ui-monospace,monospace;font-size:1.2rem}.notes{white-space:pre-line}`,
  ].join('')
  const footer = input.phones ? "With the crew's numbers: keep it with the crew chief." : "Only the contact on the day's number is on it."
  return `<!doctype html>
<html lang="en-IE"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Crew list · ${esc(title)}</title><style>${css}</style></head>
<body><header><p class="kicker">Session Hire · crew list</p><h1>${esc(title)}</h1>${input.job.client ? `<p class="muted">For ${esc(input.job.client)}</p>` : ''}</header>
${parts.join('\n')}
<footer><p class="muted">${esc(footer)}</p></footer></body></html>
`
}

function readme(input: ShowPackInput, n: { acts: number; unread: number; connect: boolean }): string {
  const lines = [
    `Show pack for ${input.job.name}, made by Session Hire on ${input.made.slice(0, 10)}.`,
    'Load it on the Crewbox at the warehouse or on site. Nothing in it was sent anywhere.',
    '',
    'manifest.json        what is in the pack, and which version of the layout it is',
    'event.json           the event, its days, venue, access notes and contact on the day',
    "crew.csv             who's on: name, what they go by, role, department, call time, days" + (input.phones ? ', phone' : ''),
    'crew-list.html       the crew list to print' + (n.connect ? ', with the join QR' : ''),
    'contacts.csv         who to ring on the day, and the office',
    `running-order.csv    the running order for Crewbox's timetable: ${n.acts} ${n.acts === 1 ? 'act' : 'acts'} from the phase notes`,
    'running-order.txt    the run of show as typed: crew calls by time, and the notes',
    "kit.csv              the kit, with Session Hire's numbers of what's scanned out",
    'patch.csv            empty: Session Hire has no patch yet, so these are the columns to fill in',
    'lighting.csv         empty: Session Hire has no lighting rig yet, so these are the columns to fill in',
  ]
  if (n.unread) lines.push('', `${n.unread} ${n.unread === 1 ? 'line' : 'lines'} of the notes had no time at the start, so ${n.unread === 1 ? "it isn't" : "they aren't"} in running-order.csv; running-order.txt has ${n.unread === 1 ? 'it' : 'them'}.`)
  if (!n.connect) lines.push('', "No join QR: type the box's address when making the pack to have one on the crew list.")
  lines.push('', input.phones ? "It has the numbers of crew who have said yes: keep it with the crew chief." : "It has no crew numbers but the contact on the day's.", 'No rates or prices are in it.')
  return `${lines.join('\n')}\n`
}

/**
 * The pack's kit from a job's kit lines and its pick list (ADR 0014, 0017):
 * for a phase, its own lines and the whole job's; for the job, all of them,
 * and anything scanned out with it that isn't on the kit. Items go out
 * with a job, not a phase, so a phase's numbers are the job's for that
 * product.
 */
export function showPackKit(
  lines: readonly {
    modelId: string
    phaseId: string | null
    qty: number
    subhireQty: number
    supplier: string
    model?: { name: string; department: Department; category: string } | undefined
  }[],
  pick: { rows: readonly { modelId: string; model?: { name: string; department: Department; category: string } | undefined; items: readonly { number: string }[]; counted: number }[] } | undefined,
  phaseId: string | null
): PackKitRow[] {
  const mine = lines.filter((l) => phaseId === null || l.phaseId === null || l.phaseId === phaseId)
  const rows = new Map<string, PackKitRow>()
  for (const l of mine) {
    const r = rows.get(l.modelId)
    if (r) {
      r.qty += l.qty
      r.subhireQty += l.subhireQty
      if (l.subhireQty && l.supplier && !r.supplier.includes(l.supplier)) r.supplier = r.supplier ? `${r.supplier}, ${l.supplier}` : l.supplier
      continue
    }
    rows.set(l.modelId, {
      department: l.model?.department ?? 'other',
      category: l.model?.category ?? '',
      product: l.model?.name ?? 'A product',
      qty: l.qty,
      subhireQty: l.subhireQty,
      supplier: l.subhireQty ? l.supplier : '',
      numbers: [],
      countedOut: 0,
    })
  }
  for (const p of pick?.rows ?? []) {
    let r = rows.get(p.modelId)
    if (!r) {
      if (phaseId !== null || (!p.items.length && !p.counted)) continue
      r = { department: p.model?.department ?? 'other', category: p.model?.category ?? '', product: p.model?.name ?? 'A product', qty: 0, subhireQty: 0, supplier: '', numbers: [], countedOut: 0 }
      rows.set(p.modelId, r)
    }
    r.numbers = p.items.map((i) => i.number).filter(Boolean)
    r.countedOut = p.counted
  }
  return [...rows.values()]
}
