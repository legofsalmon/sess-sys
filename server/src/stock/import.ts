import {
  columnLetter,
  commandSchemas,
  newId,
  previewStockList,
  readStockFile,
  STOCK_FIELDS,
  stockRows,
  unreadColumns,
  type CommandInput,
  type CommandName,
  type KnownStock,
  type PlannedItem,
  type PlannedWhere,
  type StockPlan,
  type StockField,
  type StockListOptions,
  type StockListReading,
  type StockListResult,
  type StockRef,
} from '@sh/shared'
import type { FastifyInstance, FastifyRequest } from 'fastify'
import { z } from 'zod'
import { applyMutationIn } from '../commands.ts'
import { recordAction, type Who } from '../data/fresh.ts'
import type { Db, Queryable } from '../db.ts'
import { describeDevice } from '../devices.ts'
import { IMPORT_STOCK_ACTION } from '../history.ts'
import { everyAsset } from './store.ts'

/**
 * Bringing in the stock list (ADR 0026): the office's spreadsheet read
 * against everything in the catalogue for a preview, then brought in as the
 * office fixed it. Every row goes in as the commands a device would send,
 * each checked by its own schema and applied by its own handler, so sync,
 * the history and the export follow with no special case.
 */

const field = z.enum(STOCK_FIELDS)
const options = z.object({ make: z.boolean(), defaultPlace: z.string().max(200) })
const previewBody = z.object({
  text: z.string().max(5_000_000, 'The file is too big: up to 5 MB.'),
  /** Which field each column is, as the office said; the headers' own reading when left out. */
  columns: z.array(field.nullable()).max(1000).optional(),
  options: options.optional(),
})
/** A row as the office sends it back. Loose on purpose: the shared reading and each command's own schema do the checking, and name the row. */
const choice = z.object({
  row: z.number().int().min(1).max(10_000_000),
  cells: z.record(z.string(), z.string().max(5000)),
  skip: z.boolean(),
  /** What the preview said it does, so a row that would now do something else is refused rather than applied unseen. */
  does: z.array(z.string().max(2000)).max(200),
})
const importBody = z.object({
  rows: z.array(choice).max(20_000),
  options,
  /** An earlier call of this import put something in, so the history's line for it is due when it ends. */
  going: z.boolean().optional(),
})
/** A list near the most the preview takes, sent back with every cell and what each row does, is bigger than the server's usual limit. */
const BODY_LIMIT = 24 * 1024 * 1024

const NO_OPTIONS: StockListOptions = { make: false, defaultPlace: '' }

/** Everything in the catalogue, retired items and products added by mistake too, as the rows are matched against it. */
async function knownStock(q: Queryable): Promise<KnownStock> {
  const { rows: models } = await q.query<{
    id: string
    name: string
    tracking: 'serialised' | 'bulk'
    is_case: boolean
    value_cents: number | null
    pat_months: number | null
    notes: string
    mistake: boolean
  }>('SELECT id, name, tracking, is_case, value_cents, pat_months, notes, mistake FROM models ORDER BY id')
  const { rows: places } = await q.query<{ id: string; name: string }>('SELECT id, name FROM places ORDER BY id')
  const { rows: counts } = await q.query<{ model_id: string; place_id: string | null; case_id: string | null; qty: number }>(
    'SELECT model_id, place_id, case_id, qty FROM stock ORDER BY id'
  )
  return {
    products: models.map((m) => ({
      id: m.id,
      name: m.name,
      tracking: m.tracking,
      isCase: m.is_case,
      valueCents: m.value_cents,
      patMonths: m.pat_months,
      notes: m.notes,
      mistake: m.mistake,
    })),
    items: (await everyAsset(q)).map((a) => ({
      id: a.id,
      modelId: a.modelId,
      number: a.number,
      formerNumbers: a.formerNumbers,
      oldNumber: a.oldNumber,
      serial: a.serial,
      placeId: a.placeId,
      caseId: a.caseId,
      status: a.status,
      retiredReason: a.retiredReason,
      patDue: a.patDue,
      notes: a.notes,
    })),
    places,
    counts: counts.map((c) => ({ modelId: c.model_id, placeId: c.place_id, caseId: c.case_id, qty: c.qty })),
  }
}

/** The cells the office sent, for the fields the app reads. */
const cellsOf = (cells: Record<string, string>) =>
  Object.fromEntries(Object.entries(cells).filter(([k]) => (STOCK_FIELDS as readonly string[]).includes(k))) as Partial<Record<StockField, string>>

/** One row the server couldn't take, so none of that call's changes go in. */
class BadRow extends Error {}

/** One change the import makes, from one row, and what it adds to what the office is told was done. */
interface Step {
  name: CommandName
  args: object
  row: number
  tally?: 'places' | 'products' | 'items' | 'counted' | 'changed'
}

/**
 * The plan as the commands a device would send, in order: places, products
 * and what changes on products already here; items keeping their own
 * numbers, so the next free numbers come after them; cases, each after the
 * case it goes in, so what goes in them has somewhere to go; the rest of the
 * items; moves and changes to items already here; then counts. An item
 * keeping its number whose case isn't made yet goes in unplaced and is
 * moved once it is, and a call that ends between the two finds it again by
 * its number.
 */
function stepsOf(plan: StockPlan): Step[] {
  const steps: Step[] = []
  // Each new record's id, by the key the plan gave it.
  const ids = new Map<string, string>()
  for (const x of [...plan.places, ...plan.products, ...plan.items]) ids.set(x.key, newId())
  const idOf = (ref: StockRef) => ref.id ?? ids.get(ref.key)!
  const placed = (w: PlannedWhere) => ({ placeId: w.place ? idOf(w.place) : null, caseId: w.case ? idOf(w.case) : null })

  for (const p of plan.places) steps.push({ name: 'place.upsert', args: { id: idOf(p), name: p.name, notes: '' }, row: p.row, tally: 'places' })
  for (const { key, row, ...p } of plan.products) steps.push({ name: 'model.create', args: { ...p, id: idOf({ key }), liftingMonths: null }, row, tally: 'products' })
  for (const { id, name: _name, row, ...changes } of plan.productChanges) steps.push({ name: 'model.update', args: { id, ...changes }, row })

  const added = new Set<string>()
  const later: PlannedItem[] = []
  const add = (i: PlannedItem) => {
    const ready = !i.where.case || i.where.case.id !== undefined || added.has(i.where.case.key)
    const where = ready ? placed(i.where) : { placeId: null, caseId: null }
    const args = { id: idOf(i), modelId: idOf(i.model), number: i.number, serial: i.serial, ...where, notes: i.notes, fromCount: i.fromCount && ready, oldNumber: i.oldNumber, patDue: i.patDue }
    steps.push({ name: 'asset.add', args, row: i.row, tally: 'items' })
    added.add(i.key)
    if (!ready) later.push(i)
  }
  for (const i of plan.items) if (i.number !== null) add(i)
  const cases = plan.items.filter((i) => i.isCase && !added.has(i.key))
  while (cases.length) {
    // One whose case is made already, or isn't one of these; any, should they go in each other, for the handler to refuse.
    const free = cases.findIndex((c) => !c.where.case?.key || added.has(c.where.case.key) || !cases.some((o) => o.key === c.where.case!.key))
    add(cases.splice(Math.max(free, 0), 1)[0]!)
  }
  for (const i of later) steps.push({ name: 'asset.move', args: { id: idOf(i), ...placed(i.where) }, row: i.row })
  for (const i of plan.items) if (!added.has(i.key)) add(i)

  for (const { row, id, where, ...fields } of plan.changes) {
    if (where) steps.push({ name: 'asset.move', args: { id, ...placed(where) }, row, tally: 'changed' })
    if (Object.keys(fields).length) steps.push({ name: 'asset.update', args: { id, ...fields }, row, tally: 'changed' })
  }
  for (const c of plan.counts) steps.push({ name: 'stock.set', args: { modelId: idOf(c.model), ...placed(c.where), qty: c.qty }, row: c.row, tally: 'counted' })
  return steps
}

/** How much one call brings in: changes for this long, then it answers, well inside the minute the app waits; at most this many, for tests. */
export interface StockImportRound {
  ms: number
  commands: number
}
const ROUND: StockImportRound = { ms: 20_000, commands: Number.POSITIVE_INFINITY }

export function registerStockImportRoutes(app: FastifyInstance, { db, onChange, round = ROUND }: { db: Db; onChange: () => void; round?: StockImportRound }) {
  const who = (req: FastifyRequest<{ Querystring: { client?: string } }>): Who => ({
    userId: req.user?.id,
    name: req.user?.name,
    clientId: req.query.client,
    device: describeDevice(req.headers['user-agent']),
  })

  /** The file as the app reads it, against what's in the catalogue. Saves nothing. */
  app.post('/api/stock/import/preview', { bodyLimit: BODY_LIMIT }, async (req, reply): Promise<StockListReading | void> => {
    reply.header('cache-control', 'no-store')
    const parsed = previewBody.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? 'Choose a file first.' })
    const read = readStockFile(parsed.data.text)
    if (read.problem) return reply.code(400).send({ error: read.problem })
    const file = read.file!
    const sent = parsed.data.columns
    const columns = sent && sent.length === file.header.length ? sent : file.columns
    if (!columns.includes('product') && !columns.includes('model'))
      return reply.code(400).send({ error: 'No column is the product. Say which column is which, with one as the Product or the Model.' })
    const { plan: _plan, ...preview } = previewStockList(stockRows(file, columns), await knownStock(db), parsed.data.options ?? NO_OPTIONS)
    return { ...preview, notRead: unreadColumns(file, columns).map((i) => file.header[i] || `Column ${columnLetter(i)}`) }
  })

  /**
   * Bring the rows in as the office fixed them. A list that takes longer
   * than one call goes in a call at a time, each all or nothing, each
   * checking every row again under the lock against what the last one said
   * is left, so phones' changes go in between and a call never runs past
   * the minute the app waits for an answer. What went in stays if one call
   * fails: the same file chosen again carries on, since what's in reads as
   * already as the list says.
   */
  app.post<{ Querystring: { client?: string } }>('/api/stock/import', { bodyLimit: BODY_LIMIT }, async (req, reply): Promise<StockListResult | void> => {
    const started = Date.now()
    reply.header('cache-control', 'no-store')
    const parsed = importBody.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: "The rows couldn't be read. Choose the file again." })
    const sent = parsed.data.rows.map((r) => ({ row: r.row, cells: cellsOf(r.cells), skip: r.skip }))
    const live = parsed.data.rows.filter((r) => !r.skip)
    if (live.length === 0) return reply.code(400).send({ error: 'Every row is skipped, so there is nothing to bring in.' })
    const shown = new Map(parsed.data.rows.map((r) => [r.row, r.does]))
    const going = parsed.data.going === true
    const by = who(req)
    const clientId = by.clientId && /^[a-z0-9]{1,64}$/.test(by.clientId) ? by.clientId : 'server'
    let result: StockListResult
    try {
      result = await db.transaction(async (tx) => {
        // Read again under the lock, so what goes in is what the preview showed, with nobody else's change in between unseen.
        await tx.query('SELECT pg_advisory_xact_lock(7331)')
        const { rows, plan } = previewStockList(sent, await knownStock(tx), parsed.data.options)
        const rowSaid = (n: number) => {
          const r = rows.find((x) => x.row === n)
          return `Row ${n}${r?.product ? ` (${r.product})` : ''}`
        }
        for (const r of rows) {
          if (r.skip) continue
          if (r.problems.length) throw new BadRow(`${rowSaid(r.row)}: ${r.problems[0]!.text}`)
          if ((shown.get(r.row) ?? []).join('\n') !== r.does.join('\n'))
            throw new BadRow(`${rowSaid(r.row)} would now do something else than the preview showed: ${r.does.join('; ')}. Choose the file again to see it.`)
        }

        const now = new Date().toISOString()
        const tally = { places: 0, products: 0, items: 0, counted: 0 }
        const changed = new Set<string>()
        const steps = stepsOf(plan)
        let done = 0
        for (const { name, args, row, tally: adds } of steps) {
          if (done > 0 && (done >= round.commands || Date.now() - started >= round.ms)) break
          const ok = commandSchemas[name].safeParse(args)
          if (!ok.success) throw new BadRow(`${rowSaid(row)}: ${ok.error.issues[0]?.message ?? "Something in it can't be saved as it is."}`)
          const applied = await applyMutationIn(tx, clientId, { id: newId(), name, args: ok.data as never, createdAt: now }, { userId: by.userId, device: by.device })
          if (applied.status !== 'applied') throw new BadRow(`${rowSaid(row)}: ${applied.reason.message}`)
          done++
          if (adds === 'changed') changed.add((args as { id: string }).id)
          else if (adds) tally[adds]++
        }

        const skipped = rows.length - live.length
        const did = { rows: live.length, skipped, ...tally, changed: changed.size }
        if (done < steps.length) {
          const after = previewStockList(sent, await knownStock(tx), parsed.data.options)
          return { ...did, left: { changes: stepsOf(after.plan).length, rows: after.rows.map((r) => ({ row: r.row, does: r.does })) } }
        }
        // One line for the import, once it's all in; none for a list that found everything as it says.
        if (done > 0 || going) await recordAction(tx, by, IMPORT_STOCK_ACTION, { rows: live.length, skipped }, new Date())
        return did
      })
    } catch (err) {
      if (!(err instanceof BadRow)) throw err
      return reply.code(400).send({ error: `${err.message} ${going ? 'Nothing more was brought in.' : 'Nothing was brought in.'}` })
    }
    req.log.info({ ...result, left: result.left?.changes }, 'Stock list: brought rows in')
    if (result.products + result.items + result.counted + result.places + result.changed > 0) onChange()
    return result
  })
}
