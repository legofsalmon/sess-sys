import { waitLabel, type HistoryEntry } from '@sh/shared'
import { strToU8, zipSync } from 'fflate'
import type { Db } from './db.ts'
import { readAllHistory } from './history.ts'
import { MODULES } from './modules.ts'
import { columnsOf, forEachRow, ident, tablesInOrder, useCanonicalOutput } from './tables.ts'

/**
 * Everything the company has in the app, in one file it can open without the
 * app (ADR 0006): every table as a spreadsheet and as JSON, and the history
 * in words, with a README saying what is what. Every table is included
 * without anyone listing it, so a new module's tables are in the export from
 * their first day.
 */

/**
 * Left out on purpose: sign-in sessions, which are secrets, and the server's
 * own bookkeeping (schema versions, which copy of the data this is).
 */
const NOT_EXPORTED = new Set(['sessions', 'server_meta', ...MODULES.map((m) => m.versionTable)])

/**
 * The secret in each freelancer's private link, wherever it turns up: in
 * their row, and in every copy of their record in the change feed, including
 * links since replaced. Whoever held the file could otherwise act as them.
 * Likewise the app's key to the connected Google calendar (ADR 0008), even
 * though it is stored locked; devices never see it, so the feed has no copies.
 */
const SECRET_COLUMNS: Record<string, string[]> = { people: ['link_token'], calendar_link: ['refresh_token'] }
const SECRET_FIELDS: Record<string, string[]> = { person: ['linkToken'] }

type Row = Record<string, unknown>

export interface Table {
  name: string
  columns: { name: string; type: string }[]
  rows: Row[]
}

export interface Everything {
  exportedAt: Date
  tables: Table[]
  /** Oldest first. */
  history: HistoryEntry[]
}

/** Read every table, and the history, all at one moment. */
export async function readEverything(db: Db, now = new Date()): Promise<Everything> {
  return db.transaction(async (tx) => {
    // One consistent moment across every table, and nothing written.
    await tx.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY')
    await useCanonicalOutput(tx)
    const tables: Table[] = []
    for (const name of await tablesInOrder(tx)) {
      if (NOT_EXPORTED.has(name)) continue
      const secret = new Set(SECRET_COLUMNS[name] ?? [])
      const columns = (await columnsOf(tx, name)).filter((c) => !secret.has(c.name))
      const rows: Row[] = []
      await forEachRow(tx, name, (json) => {
        const row = JSON.parse(json) as Row
        for (const c of secret) delete row[c]
        if (name === 'changes') withoutSecretFields(row)
        rows.push(row)
      })
      tables.push({ name, columns, rows })
    }
    return { exportedAt: now, tables, history: await readAllHistory(tx) }
  })
}

function withoutSecretFields(change: Row) {
  const fields = SECRET_FIELDS[String(change.entity)]
  const data = change.data
  if (!fields || !data || typeof data !== 'object') return
  for (const f of fields) delete (data as Row)[f]
}

/** How many rows a download would hold right now, counted without reading them: for the history's record of a download. */
export async function exportRowCount(db: Db): Promise<number> {
  const tables = (await tablesInOrder(db)).filter((t) => !NOT_EXPORTED.has(t))
  if (tables.length === 0) return 0
  const { rows } = await db.query<{ n: string | number }>(`SELECT ${tables.map((t) => `(SELECT count(*) FROM ${ident(t)})`).join(' + ')} AS n`)
  return Number(rows[0]?.n ?? 0)
}

/** For scripts: every table exactly, by name. The same as `everything.json` in the file. */
export function everythingJson(e: Everything) {
  return { exportedAt: e.exportedAt.toISOString(), ...Object.fromEntries(e.tables.map((t) => [t.name, t.rows])) }
}

/** The one file: README, the history, a spreadsheet per table, and all of it as JSON. */
export function everythingZip(e: Everything, by?: { name: string; email: string }): Uint8Array {
  const files: Record<string, Uint8Array> = {
    'README.txt': strToU8(readme(e, by)),
    'history.csv': strToU8(historyCsv(e.history)),
  }
  for (const t of byName(e.tables)) files[`tables/${t.name}.csv`] = strToU8(tableCsv(t))
  files['everything.json'] = strToU8(JSON.stringify(everythingJson(e), null, 1))
  return zipSync(files, { level: 6, mtime: e.exportedAt })
}

/** Alphabetical, for people; `everything.json` keeps each table after the ones it refers to, for loading elsewhere. */
const byName = (tables: Table[]) => [...tables].sort((a, b) => a.name.localeCompare(b.name))

/** "session-hire-2026-09-29.zip", by the Irish date. */
export function zipName(e: Everything) {
  return `session-hire-${irishTime(e.exportedAt).slice(0, 10)}.zip`
}

// Spreadsheets.

const IRISH = new Intl.DateTimeFormat('sv-SE', {
  timeZone: 'Europe/Dublin',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
})

/** "2026-09-29 22:40:05", Irish time, which Excel reads as a date and time. */
export function irishTime(at: Date | string): string {
  return IRISH.format(typeof at === 'string' ? new Date(at) : at)
}

function cell(value: unknown, type: string): string {
  if (value === null || value === undefined) return ''
  if (type === 'timestamp with time zone' && typeof value === 'string') return irishTime(value)
  if (typeof value === 'boolean') return value ? 'yes' : 'no'
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

/**
 * Excel runs a cell that starts with =, +, - or @ as a formula, and some text
 * here comes from freelancers' own notes, so such a cell gets a ' in front
 * and shows as the text it is. Numbers and phone numbers (digits, spaces,
 * brackets, dots, dashes and pluses only) can't do anything, and are left
 * alone.
 */
export function spreadsheetSafe(text: string): string {
  if (/^[=@\t\r]/.test(text) || (/^[+-]/.test(text) && !/^[+-][\d\s().,+-]*$/.test(text))) return `'${text}`
  return text
}

function csvLine(cells: string[]): string {
  return cells.map((c) => spreadsheetSafe(c)).map((c) => (/[",\r\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(',')
}

/** With the mark Excel needs to read UTF-8, so names like Seán come through. */
function csv(header: string[], rows: string[][]): string {
  return `﻿${[header, ...rows].map(csvLine).join('\r\n')}\r\n`
}

function tableCsv(t: Table): string {
  return csv(
    t.columns.map((c) => c.name),
    t.rows.map((r) => t.columns.map((c) => cell(r[c.name], c.type)))
  )
}

function historyCsv(history: HistoryEntry[]): string {
  return csv(
    ['When (Irish time)', 'Who', 'How', 'Device', 'What', 'Outcome', 'Why turned down', 'Made offline', 'Waited on the device', 'Arrived (Irish time)', 'Entry'],
    history.map((h) => [
      irishTime(h.madeAt),
      h.who.name,
      h.who.kind === 'link' ? 'Private link' : h.who.kind === 'calendar' ? 'Google Calendar' : h.deviceCode ? `App, device ${h.deviceCode}` : '',
      h.device ?? '',
      h.what,
      h.outcome === 'done' ? 'Done' : 'Turned down',
      h.reason ?? '',
      h.waitedSeconds === undefined ? '' : h.madeOffline ? 'yes' : 'no',
      h.waitedSeconds === undefined ? '' : waitLabel(h.waitedSeconds),
      irishTime(h.arrivedAt),
      h.id,
    ])
  )
}

// The README.

/** What each table holds, for the README. A table not described here is still exported. */
const ABOUT: Record<string, string> = {
  assets:
    'Numbered items of stock: their product, serial, where they are kept, whether they are retired (sold, scrapped, lost, stolen, or added by mistake), the old number they had before Session Hire\'s labels, and when the stock list said their next PAT is due.',
  backup_runs: 'The nightly backups: when each ran and how it went.',
  calendar_days: 'Each day of a job the app has put on Google Calendar, with the event it wrote there.',
  calendar_guests: 'Crew the app has invited to those days in Google Calendar because of their offers, with the address used and their answer.',
  calendar_imports: 'Each day of an event brought in from Google Calendar, and the job and phase it went into.',
  calendar_link: 'The Google calendar confirmed jobs are written to, the account that writes them, and who connected it.',
  changes: 'Every change to every record, in order: what phones and laptops receive.',
  clients: 'Who jobs are for, with their contacts.',
  crew_calls: 'Roles jobs need, such as 2 audio techs for Build and Show, and the certificates each needs, such as IPAF.',
  erasures: 'People whose details were erased on request: only their id, when, and the day a name kept with their pay or leave records goes. Nothing else about them.',
  faults: 'Faults and missing kit: the item, or the product and how many, damaged or missing, the job it came back from, what was wrong, the repair notes, and how it ended.',
  identifiers: 'The Session Hire numbers on items, current and replaced; a number is never used twice.',
  inspections: 'Electrical tests (PAT) and thorough examinations of numbered items: when, by whom, passed or failed, and any note. The register the law asks for.',
  kit_lines: 'Kit on jobs: how many of a product each job needs, for the whole job or one phase, and how many of those are subhired and from whom.',
  label_runs: 'Numbers set aside for printing labels, a run at a time: the first, how many, what they were for, and when one was cancelled before any of its labels went on an item. A cancelled run is off the list, but its numbers are never given out again.',
  leave_allowances: "Each staff member's annual leave for a year: the days, what was carried over, and a note; 20 days when none is set.",
  leave_requests: 'Staff requests for annual leave and days in lieu: the days asked for and counted, and whether each was approved, declined or cancelled, by whom and why.',
  lieu_entries: 'Days staff worked that earn days in lieu, and whether each was approved.',
  models: 'Products in the stock list: department, category, numbered or counted, replacement value, and whether one was added by mistake and so hidden from the list.',
  movements: 'Kit scanned or counted out to jobs and back in: the job, the item or the product and how many, and when, by the phone that scanned it.',
  mutations: 'The history as the server keeps it: every change anyone asked for, with the answer.',
  offers: 'Work offered to people, and their answers; a confirmed offer is a booking.',
  people: 'Staff and freelancers on the crew list: contact details, department, level, the name they go by, certificates, the company and VAT and CRO numbers they trade through, skills and rates, whether they have been archived, and which staff can approve time off.',
  phases: "The parts of each job, such as Build and Show, their days, and who crew ring on the day.",
  places: 'Where stock is kept: the warehouse, its bays and shelves, vans.',
  projects: 'Jobs: who for, where, whether they are going ahead, and the calendar a job was brought in from.',
  running_late: "People saying on their private link that they're running late on a day they're booked: how late or when they'll be there, their note, when they said they'd arrived, and when the office noted it. Shown only until the day is over.",
  settings: "The office's own details: the name, phone and email shown to freelancers on their pages.",
  stock: 'Counted stock: how many of a product are at a place or in a case.',
  timesheets: "Freelancers' timesheets, one for each booking: the days worked at the day rate, extras such as parking or mileage, what was sent and what the office approved.",
  unavailability: "Days people can't work.",
  users: 'Staff who have signed in with Google.',
  venues: 'Where jobs happen: addresses, and notes on access, load-in, power and parking.',
}

function readme(e: Everything, by?: { name: string; email: string }): string {
  const made = irishTime(e.exportedAt)
  const width = Math.max(...e.tables.map((t) => t.name.length), 12)
  const count = (n: number, one: string, many: string) => `${n.toLocaleString('en-IE')} ${n === 1 ? one : many}`
  const tables = byName(e.tables).map((t) => `  ${t.name.padEnd(width)}  ${count(t.rows.length, 'row', 'rows').padEnd(11)}  ${ABOUT[t.name] ?? ''}`.trimEnd())
  return `Session Hire: everything, exported
==================================

Made ${made.slice(0, 16)} Irish time${by ? `, by ${by.name} (${by.email})` : ''}.
Everything was read at that one moment, so the files agree with each other.

What is in this file
--------------------
history.csv       The history, oldest first: every change anyone made, in
                  words, with who, when, on what device, whether it was made
                  offline, and whether the server turned it down.
                  ${count(e.history.length, 'entry', 'entries')}.
tables/*.csv      A spreadsheet for each table, which opens in Excel. Times
                  are Irish time. Money is in cents: 25000 is €250.
everything.json   Every table exactly, with times in UTC to the microsecond,
                  for moving the data to another system.

The tables
----------
${tables.join('\n')}

Left out on purpose
-------------------
- The secrets in freelancers' private links, old and current, staff
  sign-in sessions, and the app's key to Google Calendar: whoever held this
  file could otherwise act as them.
- The server's own bookkeeping: schema versions, and which copy of the data
  this is.

Good to know
------------
- This file holds everyone's details. Keep it somewhere safe, and delete it
  once you're done with it. Each download is recorded in the history.
- In the spreadsheets, text starting with =, +, - or @ has a ' put in front,
  so Excel shows it as text instead of running it as a formula. Phone numbers
  and plain numbers are left as they are. everything.json has every value
  exactly.
- To put the system back as it was, use a backup, not this file.
`
}
