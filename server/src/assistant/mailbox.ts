import {
  adviceFor,
  CLAUDE_CLIENT,
  eachDay,
  enquiryPhases,
  enquirySuggestions,
  irishToday,
  MAIL_SCHEMA,
  mailReading,
  matcherFor,
  MAX_LINES,
  newId,
  suggestionLine,
  type AskedLine,
  type CommandArgs,
  type CommandName,
  type Department,
  type EnquiryReading,
  type MailboxStatus,
  type MailKind,
  type MailThread,
  type Pricing,
  type QuoteAdvice,
  type QuoteLine,
  type RateRule,
  roleKey,
} from '@sh/shared'
import type { FastifyBaseLogger } from 'fastify'
import { open } from '../calendar/crypto.ts'
import { GoogleError, type Google } from '../calendar/google.ts'
import { applyMutation } from '../commands.ts'
import type { Db, Queryable } from '../db.ts'
import { Gmail, type Mail } from './gmail.ts'
import { COMPANY, enquiryRules, adviceRules, NOT_INSTRUCTIONS, type Assistant } from './routes.ts'

/**
 * Claude reading the operations mailbox (ADR 0098). Every few minutes,
 * while Claude is on and the mailbox connected, the app reads the mail
 * that came to operations@ and has Claude read each thread with something
 * new in it. A new enquiry becomes a job, as an enquiry, with its quote
 * drafted from what the thread asks for; as the thread goes on, Claude
 * keeps that draft up to date until someone changes it. After that, what
 * the latest mail asks for is offered on the quote to take or leave. Mail
 * about a job already in the app is linked to it. Mail not cc'd to
 * operations@ is never seen, and the app never sends, replies to or files
 * anything there: it can only read.
 */

/** How often the mailbox is looked at. */
const LOOK_MS = 5 * 60_000
/** At most this many threads are read in one look, so a full mailbox is caught up over a few looks, not one long one. */
const MOST_THREADS = 6
/** Mail from this long before the mailbox was connected is read too, so enquiries already in hand get their quotes. */
const BACK_DAYS = 7
/** A thread is cut to its latest mails, and Claude's ask to this many characters of them. */
const MOST_MAILS = 20
const THREAD_LENGTH = 40_000
/** At most this many jobs are named to Claude, to say which one a thread is about. */
const MOST_JOBS = 150
/** Threads shown on Quotes: those with mail in this many days. */
const SHOWN_DAYS = 30
/** The company's own addresses: mail from them is the office answering, not the client. */
export const OWN_DOMAIN = 'sessionhire.com'
/** Where the history says Claude's changes came from. */
export const CLAUDE_DEVICE = 'Claude, from the operations mailbox'

const MAILBOX_ID = 'operations'
type Row = Record<string, any>

export class Mailbox {
  private timer: NodeJS.Timeout | undefined
  private looking: Promise<number> | undefined
  private access: { token: string; until: number } | undefined

  constructor(
    private readonly db: Db,
    private readonly assistant: Assistant,
    private readonly google: Google | undefined,
    private readonly secret: string | undefined,
    private readonly onChange: () => void,
    private readonly log?: FastifyBaseLogger,
    readonly gmail: Gmail = new Gmail(),
    private readonly now: () => Date = () => new Date()
  ) {}

  get available(): boolean {
    return !!this.google && !!this.secret
  }

  private async row(q: Queryable = this.db.reads): Promise<Row | undefined> {
    return (await q.query<Row>('SELECT * FROM assistant_mailbox WHERE id = $1', [MAILBOX_ID])).rows[0]
  }

  async status(): Promise<MailboxStatus> {
    const r = await this.row()
    const { rows } = await this.db.reads.query<{ n: number }>(`SELECT count(*)::int AS n FROM mail_threads WHERE kind <> 'other'`)
    return {
      available: this.available,
      state: (r?.state as MailboxStatus['state']) ?? 'off',
      account: r?.account_email ?? null,
      problem: r?.problem ?? null,
      connectedAt: r?.connected_at ? new Date(r.connected_at).toISOString() : null,
      lookedAt: r?.looked_at ? new Date(r.looked_at).toISOString() : null,
      threads: rows[0]?.n ?? 0,
    }
  }

  /** The account as connected, its key locked; reading starts a week back the first time, and carries on where it was after. */
  async connected(c: { email: string; sub: string; sealedKey: string; by: string | null }) {
    const before = await this.row()
    const from = before?.read_after && before.account_sub === c.sub ? before.read_after : new Date(this.now().getTime() - BACK_DAYS * 86_400_000)
    await this.db.query(
      `INSERT INTO assistant_mailbox (id, state, account_email, account_sub, refresh_token, problem, connected_by, connected_at, read_after)
       VALUES ($1, 'on', $2, $3, $4, NULL, $5, $6, $7)
       ON CONFLICT (id) DO UPDATE SET state = 'on', account_email = $2, account_sub = $3, refresh_token = $4, problem = NULL, connected_by = $5, connected_at = $6, read_after = $7`,
      [MAILBOX_ID, c.email, c.sub, c.sealedKey, c.by, this.now(), from]
    )
    this.access = undefined
    void this.look().catch(() => undefined)
  }

  /** Stops reading and hands the key back. What was read stays, linked to its jobs. */
  async disconnect(): Promise<void> {
    const r = await this.row()
    if (r?.refresh_token && r.account_sub && this.secret && this.google) {
      const key = open(this.secret, r.refresh_token, r.account_sub)
      if (key) await this.google.revoke(key)
    }
    await this.db.query(`UPDATE assistant_mailbox SET state = 'off', refresh_token = NULL, problem = NULL WHERE id = $1`, [MAILBOX_ID])
    this.access = undefined
  }

  private async token(r: Row): Promise<string> {
    if (this.access && this.access.until > Date.now()) return this.access.token
    const key = this.secret && r.refresh_token && r.account_sub ? open(this.secret, r.refresh_token, r.account_sub) : undefined
    if (!key || !this.google) throw new GoogleError('revoked', 0, '', 'The mailbox key can’t be unlocked')
    const t = await this.google.refresh(key)
    this.access = { token: t.accessToken, until: Date.now() + (t.expiresIn - 60) * 1000 }
    return t.accessToken
  }

  /** One look at the mailbox; asked again while one is going, it waits for that one. Says how many threads it read. */
  look(): Promise<number> {
    this.looking ??= this.lookNow().finally(() => (this.looking = undefined))
    return this.looking
  }

  private async lookNow(): Promise<number> {
    const r = await this.row()
    if (r?.state !== 'on' || !this.available || (await this.assistant.refusal())) return 0
    let read = 0
    try {
      const token = await this.token(r)
      const ids = await this.gmail.since(token, new Date(r.read_after ?? r.connected_at))
      const seen = new Set((await this.db.reads.query<{ id: string }>('SELECT id FROM mail_seen WHERE id = ANY($1)', [ids.map((m) => m.id)])).rows.map((x) => x.id))
      const fresh = ids.filter((m) => !seen.has(m.id))
      // Oldest first, so a thread's job is made before a later thread about it is read.
      const threads = [...new Set(fresh.map((m) => m.threadId).reverse())].slice(0, MOST_THREADS)
      for (const t of threads) {
        if (await this.assistant.refusal()) break
        await this.readThread(token, t)
        read++
      }
      await this.db.query('UPDATE assistant_mailbox SET looked_at = $2, problem = NULL WHERE id = $1', [MAILBOX_ID, this.now()])
    } catch (err) {
      if (err instanceof GoogleError && (err.problem === 'revoked' || err.problem === 'access')) {
        await this.db.query(`UPDATE assistant_mailbox SET state = 'reconnect', problem = $2 WHERE id = $1`, [
          MAILBOX_ID,
          err.problem === 'access' ? 'Google won’t let the app read the mailbox: check the Gmail API is on, then connect it again.' : 'Google no longer accepts the app’s key for the mailbox. Connect it again.',
        ])
        this.access = undefined
      }
      throw err
    } finally {
      if (read) this.onChange()
    }
    return read
  }

  /** Reads a whole thread with Claude and acts on it: a new job and its draft, a draft kept up to date, or changes offered. */
  async readThread(token: string, threadId: string): Promise<void> {
    const mails = (await this.gmail.thread(token, threadId)).slice(-MOST_MAILS)
    if (!mails.length) return
    const known = (await this.db.reads.query<Row>('SELECT * FROM mail_threads WHERE id = $1', [threadId])).rows[0]
    const last = mails[mails.length - 1]!
    const outside = !isOwn(last.from)
    const done = async (kind: MailKind, projectId: string | null, notes: Notes | null, drafted?: unknown) => {
      await this.db.transaction(async (tx) => {
        await tx.query(
          `INSERT INTO mail_threads (id, project_id, kind, messages, last_at, last_outside, drafted_lines, read_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
           ON CONFLICT (id) DO UPDATE SET project_id = $2, kind = $3, messages = $4, last_at = $5, last_outside = $6, drafted_lines = CASE WHEN $9 THEN $7 ELSE mail_threads.drafted_lines END, read_at = $8`,
          [threadId, projectId, kind, mails.length, last.at, outside, drafted === undefined ? null : JSON.stringify(drafted), this.now(), drafted !== undefined]
        )
        if (notes)
          await tx.query(
            `INSERT INTO mail_notes (thread_id, subject, sender, summary, questions, advice) VALUES ($1, $2, $3, $4, $5, $6)
             ON CONFLICT (thread_id) DO UPDATE SET subject = $2, sender = $3, summary = $4, questions = $5, advice = $6`,
            [threadId, notes.subject, notes.sender, notes.summary, JSON.stringify(notes.questions), notes.advice ? JSON.stringify(notes.advice) : null]
          )
        await tx.query('INSERT INTO mail_seen (id, thread_id) SELECT unnest($1::text[]), $2 ON CONFLICT DO NOTHING', [mails.map((m) => m.id), threadId])
      })
    }
    // A newsletter or a receipt is never an enquiry, and isn't worth asking about.
    if (!known && mails.every((m) => m.bulk)) return done('other', null, null)

    const job = known?.project_id ? await jobOf(this.db.reads, known.project_id) : undefined
    const quote = job ? await currentQuote(this.db.reads, job.id) : undefined
    const drafting = !!quote && quote.status === 'draft' && known?.drafted_lines != null && same(quote.lines, known.drafted_lines)
    const shown = quote && !drafting ? askedLines(quote.lines) : undefined
    const today = irishToday(this.now())
    const names = await this.assistant.names()
    const jobs = job ? [] : await openJobs(this.db.reads, today)
    const system = mailSystem(today, names, job ? { id: job.id, name: job.name } : undefined, jobs)
    const user = [`<thread>\n${threadText(mails)}\n</thread>`, shown ? `<quote>\n${JSON.stringify({ status: quote!.status, discountPct: quote!.discountPct, lines: shown })}\n</quote>` : ''].filter(Boolean).join('\n')
    const reading = await this.assistant.run('mail', { system, user, schema: MAIL_SCHEMA, maxTokens: 10_000 }, mailReading)

    const notes = (advice: QuoteAdvice | null): Notes => ({
      subject: mails[0]!.subject.slice(0, 300),
      sender: senderOf(mails.find((m) => !isOwn(m.from))?.from ?? mails[0]!.from),
      summary: reading.enquiry.summary,
      questions: reading.enquiry.questions,
      advice,
    })
    if (job) {
      if (drafting) {
        const lines = await this.linesFor(reading.enquiry, job.days)
        if (!same(lines.map(withoutId), quote!.lines.map(withoutId))) await this.claude('quote.save', { id: quote!.id, projectId: job.id, lines, discountPct: quote!.discountPct, notes: quote!.notes })
        if (!job.days) await this.addPhases(job.id, reading.enquiry)
        return done(known!.kind, job.id, notes(null), await linesOf(this.db.reads, quote!.id))
      }
      const advice = shown ? adviceFor(reading.advice, shown) : null
      const any = advice && (advice.add.length || advice.remove.length || advice.change.length || advice.discountPct != null)
      return done(known!.kind, job.id, notes(any ? advice : null))
    }
    if (reading.kind === 'job' && jobs.some((j) => j.id === reading.jobId)) return done('job', reading.jobId, notes(null))
    if (reading.kind !== 'enquiry') return done('other', null, notes(null))
    const made = await this.draft(reading.enquiry, mails)
    return done('enquiry', made.projectId, notes(null), await linesOf(this.db.reads, made.quoteId))
  }

  /** A new enquiry: its client and venue (found by name, or added), the job with its days, and its quote drafted. */
  private async draft(r: EnquiryReading, mails: Mail[]): Promise<{ projectId: string; quoteId: string }> {
    const clientId = r.client ? await this.named('clients', 'client.upsert', r.client) : null
    const venueId = r.venue ? await this.named('venues', 'venue.upsert', r.venue) : null
    const id = newId()
    const first = mails[0]!
    const notes = `Enquiry by email to operations@ from ${first.from}, ${irishToday(new Date(first.at))}: “${first.subject}”. Job and quote drafted by Claude; check both.`.slice(0, 4000)
    await this.claude('project.create', { id, name: r.name || first.subject.slice(0, 200) || 'Enquiry by email', clientId, venueId, status: 'enquiry', kind: 'gig', notes })
    const days = await this.addPhases(id, r)
    const quoteId = newId()
    const discount = clientId ? (await this.db.reads.query<{ pct: string }>('SELECT pct FROM client_discounts WHERE client_id = $1', [clientId])).rows[0]?.pct : undefined
    await this.claude('quote.save', { id: quoteId, projectId: id, lines: await this.linesFor(r, days), discountPct: discount === undefined ? 0 : Number(discount), notes: '' })
    return { projectId: id, quoteId }
  }

  private async addPhases(projectId: string, r: EnquiryReading): Promise<number> {
    const parts = enquiryPhases(r)
    for (const ph of parts) await this.claude('phase.add', { id: newId(), projectId, name: ph.name.slice(0, 100), start: ph.start, end: ph.end, venueId: null, notes: '' })
    if (!parts.length) return 0
    const start = parts[0]!.start
    return eachDay(start, parts.reduce((e, ph) => (ph.end > e ? ph.end : e), start)).length
  }

  private async named(table: 'clients' | 'venues', command: 'client.upsert' | 'venue.upsert', name: string): Promise<string> {
    const found = (await this.db.reads.query<{ id: string }>(`SELECT id FROM ${table} WHERE lower(trim(name)) = lower(trim($1)) LIMIT 1`, [name])).rows[0]
    if (found) return found.id
    const id = newId()
    if (command === 'client.upsert') await this.claude('client.upsert', { id, name, contacts: [], notes: '' })
    else await this.claude('venue.upsert', { id, name, address: '', notes: '' })
    return id
  }

  /** A change made as Claude: checked like any other, and in the history as Claude's, from the mailbox. */
  private async claude<N extends CommandName>(name: N, args: CommandArgs<N>): Promise<void> {
    const result = await applyMutation(this.db, CLAUDE_CLIENT, { id: newId(), name, args, createdAt: this.now().toISOString() }, { device: CLAUDE_DEVICE })
    if (result.status !== 'applied') throw new Error(`Claude's ${name} was turned down: ${result.reason?.message ?? 'no reason'}`)
  }

  private async linesFor(r: EnquiryReading, days: number): Promise<QuoteLine[]> {
    return enquirySuggestions(r, await pricingFrom(this.db.reads), days || 1)
      .map((s) => suggestionLine(s, newId()))
      .slice(0, MAX_LINES)
  }

  /** The threads on Quotes, or a job's. */
  async threads(projectId?: string): Promise<MailThread[]> {
    const { rows } = await this.db.reads.query<Row>(
      `SELECT t.*, n.subject, n.sender, n.summary, n.questions, n.advice,
         (SELECT q.status = 'draft' AND t.drafted_lines IS NOT NULL AND q.lines = t.drafted_lines FROM quotes q WHERE q.project_id = t.project_id ORDER BY q.version DESC LIMIT 1) AS drafting
       FROM mail_threads t LEFT JOIN mail_notes n ON n.thread_id = t.id
       WHERE t.kind <> 'other' AND ${projectId ? 't.project_id = $1' : `t.last_at >= $1::timestamptz - interval '${SHOWN_DAYS} days'`}
       ORDER BY t.last_at DESC LIMIT 100`,
      [projectId ?? this.now()]
    )
    return rows.map((r) => ({
      id: r.id,
      subject: r.subject ?? '',
      from: r.sender ?? '',
      lastAt: new Date(r.last_at).toISOString(),
      messages: r.messages,
      kind: r.kind,
      projectId: r.project_id,
      summary: r.summary ?? '',
      questions: r.questions ?? [],
      drafting: !!r.drafting,
      advice: r.advice ?? null,
    }))
  }

  /** The changes offered from a thread were taken or left: either way they go. */
  async adviceDone(threadId: string): Promise<boolean> {
    const { rows } = await this.db.query('UPDATE mail_notes SET advice = NULL WHERE thread_id = $1 RETURNING thread_id', [threadId])
    return rows.length > 0
  }

  start() {
    if (this.timer || !this.available || !this.assistant.config) return
    const look = () => void this.look().catch((err) => this.log?.warn({ err: err instanceof Error ? err.message : String(err) }, 'The operations mailbox could not be read'))
    this.timer = setInterval(look, LOOK_MS)
    this.timer.unref()
    look()
  }

  stop() {
    clearInterval(this.timer)
    this.timer = undefined
  }
}

interface Notes {
  subject: string
  sender: string
  summary: string
  questions: string[]
  advice: QuoteAdvice | null
}

const isOwn = (from: string) => new RegExp(`@${OWN_DOMAIN.replace('.', '\\.')}>?\\s*$`, 'i').test(from.trim())
/** "Aoife Byrne <aoife@liffey.ie>" as Aoife Byrne, or the address when there's no name. */
export const senderOf = (from: string) => (from.match(/^\s*"?([^"<]+?)"?\s*</)?.[1] ?? from.replace(/[<>]/g, '')).trim().slice(0, 200)
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)
const withoutId = ({ id: _, ...l }: QuoteLine) => l

function threadText(mails: Mail[]): string {
  const text = mails.map((m) => [`From: ${m.from}`, m.cc ? `Cc: ${m.cc}` : '', `Date: ${m.at}`, `Subject: ${m.subject}`, '', m.text].filter((l) => l !== '').join('\n')).join('\n\n---\n\n')
  // The latest mail matters most, so a long thread loses its start.
  return text.length > THREAD_LENGTH ? text.slice(-THREAD_LENGTH) : text
}

function askedLines(lines: readonly QuoteLine[]): AskedLine[] {
  return lines.map((l) => ({ id: l.id, kind: l.kind, what: l.what, group: l.group, qty: l.qty, days: l.out ?? l.days, per: l.per ?? 'day', unitCents: l.unitCents, discountPct: l.discountPct ?? 0 }))
}

export function mailSystem(today: string, names: { clients: string[]; venues: string[]; roles: string[] }, job: { id: string; name: string } | undefined, jobs: unknown[]): string {
  return [
    COMPANY,
    'You read a thread of email cc’d to the office’s operations mailbox, oldest first, for the app to draft a quote the office will check. Mail from @' + OWN_DOMAIN + ' is the office; the rest is clients and others.',
    job
      ? `This thread is about the job "${job.name}": kind is "job" and jobId is "${job.id}".`
      : '- kind: "enquiry" when someone asks for kit, crew or a quote for an event or hire that isn’t one of the jobs below; "job" when it’s about one of the jobs below, with its id in jobId; "other" for anything else, such as suppliers, invoices, newsletters, or the office talking among itself.',
    '- enquiry: everything the thread asks for so far, read as one enquiry by the rules below. Where a later mail changes an earlier one, the later one wins; what the office agrees with the client counts.',
    ...enquiryRules(today, names),
    '- advice: only when <quote> is given, what the mail since the quote was last changed asks to change on it, by these rules; otherwise empty lists and nulls.',
    ...adviceRules(names.roles),
    NOT_INSTRUCTIONS,
    jobs.length ? `The jobs already in the app: ${JSON.stringify(jobs)}` : '',
  ]
    .filter(Boolean)
    .join('\n')
}

async function jobOf(q: Queryable, id: string): Promise<{ id: string; name: string; days: number } | undefined> {
  const { rows } = await q.query<Row>(`SELECT p.id, p.name, (SELECT min(start_day)::text FROM phases WHERE project_id = p.id) AS a, (SELECT max(end_day)::text FROM phases WHERE project_id = p.id) AS b FROM projects p WHERE p.id = $1`, [id])
  const r = rows[0]
  return r ? { id: r.id, name: r.name, days: r.a && r.b ? eachDay(r.a.slice(0, 10), r.b.slice(0, 10)).length : 0 } : undefined
}

async function currentQuote(q: Queryable, projectId: string) {
  const { rows } = await q.query<Row>('SELECT id, status, lines, discount_pct, notes FROM quotes WHERE project_id = $1 ORDER BY version DESC LIMIT 1', [projectId])
  const r = rows[0]
  return r ? { id: r.id as string, status: r.status as string, lines: r.lines as QuoteLine[], discountPct: Number(r.discount_pct), notes: r.notes as string } : undefined
}

async function linesOf(q: Queryable, quoteId: string): Promise<unknown> {
  return (await q.query<Row>('SELECT lines FROM quotes WHERE id = $1', [quoteId])).rows[0]?.lines ?? null
}

/** The jobs a thread could be about: enquiries, quotes and confirmed jobs from a month ago on, soonest first. */
async function openJobs(q: Queryable, today: string): Promise<{ id: string; name: string }[]> {
  const { rows } = await q.query<Row>(
    `SELECT p.id, p.name, p.status, c.name AS client, v.name AS venue,
       (SELECT min(start_day)::text FROM phases WHERE project_id = p.id) AS from, (SELECT max(end_day)::text FROM phases WHERE project_id = p.id) AS to
     FROM projects p LEFT JOIN clients c ON c.id = p.client_id LEFT JOIN venues v ON v.id = p.venue_id
     WHERE p.status IN ('enquiry', 'quoted', 'confirmed')
       AND coalesce((SELECT max(end_day) FROM phases WHERE project_id = p.id), $1::date) >= $1::date - 30
     ORDER BY 6 NULLS LAST LIMIT $2`,
    [today, MOST_JOBS]
  )
  return rows.map((r) => ({ id: r.id, name: r.name, status: r.status, client: r.client ?? '', venue: r.venue ?? '', from: r.from?.slice(0, 10) ?? '', to: r.to?.slice(0, 10) ?? '' }))
}

/** The stock list and the price list, as the device has them, so Claude's lines are matched and priced as on the screen. */
export async function pricingFrom(q: Queryable): Promise<Pricing> {
  const models = (await q.query<{ id: string; name: string; department: Department; aliases: string[] }>('SELECT id, name, department, aliases FROM models')).rows
  const prices = new Map((await q.query<{ model_id: string; day_cents: number; rate: RateRule | null }>('SELECT model_id, day_cents, rate FROM product_prices')).rows.map((p) => [p.model_id, p]))
  const roles = (await q.query<{ role: string; day_cents: number | null }>('SELECT role, day_cents FROM role_prices UNION ALL SELECT DISTINCT role, NULL::integer FROM crew_calls')).rows
  const byId = new Map(models.map((m) => [m.id, m]))
  return {
    matcher: matcherFor(models.map((m) => ({ ...m, aliases: m.aliases ?? [] }))),
    model: (id) => byId.get(id),
    productPrice: (id) => prices.get(id)?.day_cents,
    productRate: (id) => prices.get(id)?.rate ?? undefined,
    rolePrice: (role) => roles.find((r) => r.day_cents != null && roleKey(r.role) === roleKey(role))?.day_cents ?? undefined,
    roles: [...new Set(roles.map((r) => r.role))],
  }
}

