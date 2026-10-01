import {
  certificates,
  checkRows,
  commandSchemas,
  company,
  domainOf,
  importCounts,
  matchRows,
  newId,
  NOTES_LENGTH,
  OFFICE_SETTING_ID,
  parseEuro,
  readCrewList,
  type Certificates,
  type CertificateKind,
  type CommandInput,
  type CrewListMatch,
  type CrewListPreview,
  type CrewListResult,
  type CrewListRow,
  type KnownPerson,
  type Person,
} from '@sh/shared'
import type { FastifyInstance, FastifyRequest } from 'fastify'
import { z } from 'zod'
import { applyMutationIn } from '../commands.ts'
import { recordAction, type Who } from '../data/fresh.ts'
import type { Db, Queryable } from '../db.ts'
import { describeDevice } from '../devices.ts'
import { IMPORT_PEOPLE_ACTION } from '../history.ts'
import { getSetting } from '../office/store.ts'
import { getPerson } from './store.ts'

/**
 * Bringing in the crew list (ADR 0025): the office's spreadsheet of staff,
 * freelancers and applicants, read as people for a preview, then brought
 * in as the office fixed it. Each row goes through person.upsert exactly
 * as a pushed command does, so sync, the history and the export follow
 * with no special case, and all of them go in one transaction or none do.
 */

const previewBody = z.object({ text: z.string().max(5_000_000, 'The file is too big: up to 5 MB.') })

/** A row as the office sends it back. Loose on purpose: person.upsert's own schema does the checking, and names the row. */
const choice = z.object({
  row: z.number().int().min(1).max(1_000_000),
  name: z.string().max(1000),
  kind: z.enum(['staff', 'freelancer']),
  email: z.string().max(1000).nullable(),
  phone: z.string().max(1000).nullable(),
  department: z.string().max(1000).nullable(),
  level: z.number().int().min(0).max(5),
  knownAs: z.string().max(1000).nullable(),
  skills: z.array(z.string().max(1000)).max(100),
  certificates,
  company: company.nullable(),
  dayRate: z.string().max(1000),
  notes: z.string().max(20_000),
  problems: z.array(z.string().max(1000)).max(20),
  /** Who the preview said the row updates, so a match that has changed since is refused rather than applied unseen. */
  matched: z.object({ id: z.string().max(100), name: z.string().max(1000), by: z.enum(['email', 'phone']) }).nullable(),
  skip: z.boolean(),
})
const importBody = z.object({ rows: z.array(choice).max(10_000) })

/** Everyone on the Crew tab, archived or not: a row for a leaver is marked, never applied. */
async function knownPeople(q: Queryable): Promise<KnownPerson[]> {
  const { rows } = await q.query<KnownPerson>('SELECT id, name, email, phone, archived FROM people ORDER BY id')
  return rows
}

/** The notes with the file's text added once, cut to fit what the notes hold, so the app's own notes are never shortened and a second import adds nothing. */
function withNotes(was: string, added: string): string {
  const kept = was.trim()
  const room = NOTES_LENGTH - kept.length - (kept ? 1 : 0)
  const text = added.trim().slice(0, Math.max(0, room))
  if (!text || kept.includes(text)) return was
  return [kept, text].filter(Boolean).join('\n')
}

/** A matched person as the file updates them: the file's values where it has them, the app's otherwise, and what the office owns kept. */
function updated(r: CrewListRow, was: Person): CommandInput<'person.upsert'> {
  const skills = [...was.skills]
  for (const s of r.skills) if (!skills.some((k) => k.toLowerCase() === s.toLowerCase())) skills.push(s)
  // The file only knows whether a certificate is held; the expiry and the note the office typed stay.
  const merged: Certificates = { ...was.certificates }
  for (const kind of Object.keys(r.certificates) as CertificateKind[]) merged[kind] = { expires: null, note: '', ...was.certificates[kind], held: r.certificates[kind]!.held }
  // Likewise each of the company's three cells: filled, it's taken; blank, the app's stays.
  const trades =
    r.company || was.company
      ? {
          name: r.company?.name || was.company?.name || '',
          vatNumber: r.company?.vatNumber ?? was.company?.vatNumber ?? null,
          croNumber: r.company?.croNumber ?? was.company?.croNumber ?? null,
        }
      : null
  return {
    id: was.id,
    name: r.name,
    // The office set the kind and the level; the file's flags don't override them.
    kind: was.kind,
    email: r.email ?? was.email,
    phone: r.phone ?? was.phone,
    skills: skills.slice(0, 30),
    dayRateCents: was.dayRateCents,
    notes: withNotes(was.notes, r.notes),
    level: was.level,
    department: r.department ?? was.department,
    knownAs: r.knownAs ?? was.knownAs,
    certificates: merged,
    company: trades,
  }
}

function added(r: CrewListRow): CommandInput<'person.upsert'> {
  return {
    id: newId(),
    name: r.name,
    kind: r.kind,
    email: r.email,
    phone: r.phone,
    skills: r.skills,
    // Already checked to read; a blank is no rate.
    dayRateCents: parseEuro(r.dayRate).cents ?? null,
    notes: r.notes,
    level: r.level,
    department: r.department,
    knownAs: r.knownAs,
    certificates: r.certificates,
    company: r.company,
  }
}

/** JSON with the keys in order, so two records that differ only in key order read the same. */
const canon = (v: unknown): string =>
  JSON.stringify(v, (_k, x: unknown) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => a.localeCompare(b))) : x))

/** True when the file would change nothing about them: then no command is sent, so the history and the sync feed stay quiet on a second import. */
function unchanged(args: CommandInput<'person.upsert'>, was: Person): boolean {
  const theirs = Object.fromEntries(Object.keys(args).map((k) => [k, was[k as keyof Person]]))
  return canon(args) === canon(theirs)
}

/** "Row 3 (Dara Quinn)", or "Row 3" while the row has no name. */
const rowSaid = (r: CrewListRow) => `Row ${r.row}${r.name ? ` (${r.name})` : ''}`

/** Why a row whose match isn't what the preview showed can't go in: the office hasn't seen who it would change. */
function changedMatch(r: CrewListRow, now: CrewListMatch | null, shown: CrewListMatch | null): string {
  if (now && !shown) return `${rowSaid(r)} now matches ${now.name} by ${now.by}, which the preview didn't show. Choose the file again to see it.`
  if (!now && shown) return `${rowSaid(r)} matched ${shown.name} in the preview, but doesn't now. Choose the file again to see it.`
  return `${rowSaid(r)} now matches ${now!.name} by ${now!.by}, not ${shown!.name} as the preview showed. Choose the file again to see it.`
}

/** One row the server couldn't take, so none of them go in. */
class BadRow extends Error {}

export function registerPeopleImportRoutes(app: FastifyInstance, { db, onChange }: { db: Db; onChange: () => void }) {
  const officeDomain = async () => domainOf((await getSetting(db, OFFICE_SETTING_ID))?.email)
  const who = (req: FastifyRequest<{ Querystring: { client?: string } }>): Who => ({
    userId: req.user?.id,
    name: req.user?.name,
    clientId: req.query.client,
    device: describeDevice(req.headers['user-agent']),
  })

  /** The file as the app reads it, with who each row would update. Saves nothing. */
  app.post('/api/people/import/preview', async (req, reply): Promise<CrewListPreview | void> => {
    reply.header('cache-control', 'no-store')
    const parsed = previewBody.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? 'Choose a file first.' })
    const domain = await officeDomain()
    const read = readCrewList(parsed.data.text, domain)
    if (read.problem) return reply.code(400).send({ error: read.problem })
    const rows = matchRows(read.rows, await knownPeople(db))
    return { rows, counts: importCounts(rows), officeDomain: domain }
  })

  /** Bring the rows in as the office fixed them, all in one go or not at all. */
  app.post<{ Querystring: { client?: string } }>('/api/people/import', async (req, reply): Promise<CrewListResult | void> => {
    reply.header('cache-control', 'no-store')
    const parsed = importBody.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: "The rows couldn't be read. Choose the file again." })
    // Checked again here, so a row fixed on the way is tidied the same way and a problem left in can't slip through.
    const checked = checkRows(parsed.data.rows, await officeDomain())
    const live = checked.filter((r) => !r.skip)
    if (live.length === 0) return reply.code(400).send({ error: 'Every row is skipped, so there is nothing to bring in.' })
    const shown = new Map(parsed.data.rows.map((r) => [r.row, r.matched]))
    const by = who(req)
    const clientId = by.clientId && /^[a-z0-9]{1,64}$/.test(by.clientId) ? by.clientId : 'server'
    let result: CrewListResult
    try {
      result = await db.transaction(async (tx) => {
        // Matched again under the lock, so two people bringing the list in at once can't double anyone, and a row
        // that now matches someone the preview didn't show is refused rather than applied unseen.
        await tx.query('SELECT pg_advisory_xact_lock(7331)')
        const rows = matchRows(checked, await knownPeople(tx))
        const counts: CrewListResult = { added: 0, updated: 0, unchanged: 0, skipped: checked.length - live.length }
        for (const r of rows) {
          if (r.skip) continue
          if (r.problems.length) throw new BadRow(`${rowSaid(r)}: ${r.problems[0]}`)
          const seen = shown.get(r.row) ?? null
          if ((r.matched?.id ?? null) !== (seen?.id ?? null)) throw new BadRow(changedMatch(r, r.matched, seen))
          const was = r.matched ? await getPerson(tx, r.matched.id) : undefined
          const args = was ? updated(r, was) : added(r)
          const ok = commandSchemas['person.upsert'].safeParse(args)
          if (!ok.success) throw new BadRow(`${rowSaid(r)}: ${ok.error.issues[0]?.message ?? "Something in it can't be saved as it is."}`)
          if (was && unchanged(ok.data, was)) {
            counts.unchanged++
            continue
          }
          const applied = await applyMutationIn(
            tx,
            clientId,
            { id: newId(), name: 'person.upsert', args: ok.data, createdAt: new Date().toISOString() },
            { userId: by.userId, device: by.device }
          )
          if (applied.status !== 'applied') throw new BadRow(`${rowSaid(r)}: ${applied.reason.message}`)
          if (was) counts.updated++
          else counts.added++
        }
        await recordAction(tx, by, IMPORT_PEOPLE_ACTION, { ...counts }, new Date())
        return counts
      })
    } catch (err) {
      if (!(err instanceof BadRow)) throw err
      return reply.code(400).send({ error: `${err.message} Nothing was brought in.` })
    }
    req.log.info(result, 'Crew list: brought people in')
    onChange()
    return result
  })
}
