import compress from '@fastify/compress'
import fastifyStatic from '@fastify/static'
import websocket from '@fastify/websocket'
import { FEED, MONEY_ENTITY_NAMES, plural, pushRequest, readsEverything, readsEveryRate, roleSeesMoney, type Change, type Beat, type ClientConfig, type EntityName, type MutationResult, type Poke, type PullResponse, type PushResponse } from '@sh/shared'
import Fastify, { LogController, type FastifyError, type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify'
import { readFileSync } from 'node:fs'
import { join, sep } from 'node:path'
import { constants as zlib } from 'node:zlib'
import type { WebSocket } from 'ws'
import type { AuthConfig } from './auth/config.ts'
import { registerAuth } from './auth/routes.ts'
import { guardStaffPages } from './auth/staff-pages.ts'
import { registerBackupRoutes } from './backup/routes.ts'
import { Backups, type BackupWatch } from './backup/service.ts'
import type { BackupStore } from './backup/store.ts'
import { Google } from './calendar/google.ts'
import { registerImportRoutes } from './calendar/import.ts'
import { registerCalendarRoutes } from './calendar/routes.ts'
import { CalendarSync, type CalendarSyncOptions } from './calendar/sync.ts'
import { applyMutationIn, currentSeq } from './commands.ts'
import { clearedSince, startedFresh } from './data/fresh.ts'
import { registerDataRoutes } from './data/routes.ts'
import { Feeds, type FeedsOptions } from './crew/feeds.ts'
import { registerPeopleImportRoutes } from './crew/import.ts'
import { registerCrewLinks } from './crew/links.ts'
import { COPY_SCRIPT } from './crew/page.ts'
import { OwnCalendars, type OwnCalendarsOptions } from './crew/own-calendars.ts'
import { registerOwnCalendarRoutes } from './crew/own-calendar-routes.ts'
import { faultForLog, type Db, type Queryable } from './db.ts'
import { describeDevice } from './devices.ts'
import { DocumentFiles } from './documents/files.ts'
import { registerDocumentRoutes } from './documents/routes.ts'
import { registerPhotoRoutes } from './documents/photos.ts'
import { DueErasures } from './erasure/due.ts'
import { ErasureList } from './erasure/list.ts'
import { everythingJson, everythingZip, exportRowCount, readEverything, zipName } from './export.ts'
import { BadCursor, readHistory, recordExport } from './history.ts'
import { appShellPolicy, inlineScripts, pagePolicy, publicOrigin, requestForLog } from './http.ts'
import { CHARACTERS, isCharacterError, isLockBusy, takeWriteLock } from './kernel.ts'
import { migrateAll } from './modules.ts'
import { registerNoticeRoutes } from './notices.ts'
import { reportError, reportNowAndThen, type ErrorReporting } from './monitoring.ts'
import { keptSyncTestTables } from './schema.ts'
import { asRead, readingOf } from './reading.ts'
import { registerStockImportRoutes, type StockImportRound } from './stock/import.ts'
import { takeTurns } from './turns.ts'
import { registerItemLogRoutes } from './stock/log.ts'
import { nominatim, registerPlaceRoutes, type PlaceSearch } from './projects/places.ts'
import { aaFuel, FuelUpdates, registerFuelRoutes, type FuelLookup } from './finance/fuel.ts'
import { RmsApi, type RmsConfig } from './rms/api.ts'
import { RmsReader } from './rms/reader.ts'
import { registerRmsRoutes } from './rms/routes.ts'

const PULL_LIMIT = 500
/** The longest the server waits for a whole request to arrive. */
export const REQUEST_TIMEOUT_MS = 5 * 60 * 1000
/**
 * How long a push from a device that takes part of an answer runs before it's
 * answered with what's done: well inside the 30 seconds a phone waits, so a
 * slow database never leaves it giving up on a push that went through.
 */
export const PUSH_BUDGET_MS = 20_000
/**
 * How long a push waits for the write lock while a long change holds it (a bring-in, a restore) before it answers
 * "busy" for the rest, which the device sends again shortly without showing a problem (audit finding 7). Waiting
 * longer held a connection each, until pulls and the health check queued behind them and every phone said "No signal".
 */
export const PUSH_LOCK_WAIT_MS = 3_000
/**
 * How often the live connection says it's still there (audit, P3). Without, a connection dropped somewhere along the
 * way (a phone's signal gone, a proxy giving up on it) looked open to both ends, and a device waited on pokes that never
 * came. The server lets go of a connection that didn't answer its last ping; a device counts one gone after two beats
 * missed, and then polls again and reconnects (web/src/transport.ts).
 */
export const LIVE_BEAT_MS = 25_000
/**
 * A request is logged only when it fails or takes at least this long (audit finding 15): every device's pull and the
 * uptime checks made two lines each, and the ones worth reading were lost among them.
 */
export const SLOW_REQUEST_MS = 1_000

export interface AppOptions {
  db: Db
  /** Log each request, with private addresses masked (ADR 0012). */
  logger?: boolean
  /** Where the log goes instead of standard output, for tests. */
  logTo?: { write(line: string): void }
  /** SLOW_REQUEST_MS unless a test wants every request logged (0). */
  slowRequestMs?: number
  /** Built web app to serve alongside the API (web/dist), if any. */
  webRoot?: string
  /** The longest to wait for a whole request; REQUEST_TIMEOUT_MS unless a test wants it shorter. */
  requestTimeoutMs?: number
  /** PUSH_BUDGET_MS unless a test wants it shorter. */
  pushBudgetMs?: number
  /** PUSH_LOCK_WAIT_MS unless a test wants it shorter. */
  pushLockWaitMs?: number
  /** LIVE_BEAT_MS unless a test wants it shorter. */
  liveBeatMs?: number
  /** PULL_LIMIT unless a test wants smaller pages. */
  pullLimit?: number
  /** Staff sign-in. Without it the API is open to anyone who can reach it, which is only for tests and trials. */
  auth?: AuthConfig
  /** A shared passcode for a demo copy (DEMO_PASSCODE); only used while Google sign-in is off. */
  passcode?: string
  /** Where nightly backups go (ADR 0004). Without it there are none. */
  backupStore?: BackupStore
  /** Encrypts each backup file (docs/backups.md). Without it they are plain text inside. */
  backupKey?: Buffer
  /**
   * Where documents' files go (ADR 0029) when there are no backups: a folder, for local use and the browser tests
   * (DOCUMENTS_DIR). With backups, the backups' storage, under documents/. Encrypted with the backup key.
   */
  documentStore?: BackupStore
  /** Which code is running, recorded in each backup. */
  commit?: string
  /** Where errors are reported (ADR 0005), which the app on each device needs to know too. */
  errorReporting?: ErrorReporting
  /** Watches the nightly backup from outside, such as Sentry (ADR 0005). */
  backupWatch?: BackupWatch
  /**
   * Google Calendar (ADR 0008): the same Google client as sign-in. Without
   * it the Account tab says the calendar needs the Google key first.
   */
  calendar?: CalendarSetup
  /** How long calendar feeds are kept in memory at most (ADR 0012), and the clock, for tests. */
  feeds?: FeedsOptions
  /** How much one call bringing in the stock list does (ADR 0026), for tests. */
  stockImport?: StockImportRound
  /** Reading freelancers' own calendars (ADR 0044): how often, and the local stand-ins tests may read from. */
  ownCalendars?: OwnCalendarsOptions
  /** Finding venues on the map (ADR 0057): OpenStreetMap's search unless a test stands in for it. */
  places?: PlaceSearch
  /** The fuel price from AA Ireland's survey (ADR 0086), unless a test stands in for it. */
  fuel?: FuelLookup
  /** Current RMS's API, read only (ADR 0078): the subdomain and key. Without it Admin says it isn't set up. */
  currentRms?: RmsConfig
  /** Where what the server notices about itself is reported: Sentry's (reportError) unless a test listens instead. */
  report?: typeof reportError
}

export interface CalendarSetup extends Pick<CalendarSyncOptions, 'appUrl' | 'settleMs' | 'gapMs' | 'now' | 'nightly' | 'pollMs' | 'retryMs' | 'writes'> {
  clientId: string
  clientSecret: string
  /** Stands in for the network in tests. */
  fetch?: typeof fetch
}

declare module 'fastify' {
  interface FastifyInstance {
    /** The nightly backup; the caller starts its schedule once the server is listening. */
    backups: Backups
    /** The calendar sync, when the Google key is set; the caller starts it once the server is listening. */
    calendar: CalendarSync | undefined
    /** The list of erasures kept beside the backups (ADR 0027), when there is somewhere to keep them. */
    erasures: ErasureList | undefined
    /** What erasures kept, taken on the day the law stops asking for it (ADR 0027); the caller starts it. */
    dueErasures: DueErasures
    /** The fuel price taken from each new month of the AA's survey (ADR 0086); the caller starts it. */
    fuelUpdates: FuelUpdates
    /** Documents' files (ADR 0029): where they're kept, and the list of files to delete; the caller starts its daily look. */
    documents: DocumentFiles
    /** Freelancers' own calendars, read only (ADR 0044); the caller starts reading them on a schedule. */
    ownCalendars: OwnCalendars
    /** Reading Current RMS (ADR 0078), run from Admin. */
    rms: RmsReader
  }
}

type FeedRow = { seq: string; entity: EntityName; entity_id: string; op: 'put' | 'delete'; data: unknown }

/** The feed after `after`, a page and one more (to tell there's more), as each change was made. */
async function feedPage(db: Queryable, after: number, limit: number): Promise<{ rows: FeedRow[]; upTo?: undefined }> {
  const { rows } = await db.query<FeedRow>('SELECT seq, entity, entity_id, op, data FROM changes WHERE seq > $1 ORDER BY seq LIMIT $2', [after, limit + 1])
  return { rows }
}

/**
 * The feed after `after` with only the latest change of each record (audit finding 17): a new device is sent the
 * records as they are, not every change ever made to them, and the feed carries on from there for what's new. A record
 * changed again since a page was read is sent again, as it is then, on a later page, so the copy ends as one that read
 * every change would. A delete at or before `deletesTo` is left out: the copy that asks began empty no later than that,
 * so it never held what it deletes. "new" is the first page of an empty copy, which leaves out every delete the feed
 * holds as this page is read, and says how far that was, for the pages after to leave out the same. `upTo` is how far the
 * feed went as this page was read, in the same statement, so a change committed after it is past it.
 */
async function latestPage(db: Queryable, after: number, limit: number, deletesTo: number | 'new'): Promise<{ rows: FeedRow[]; upTo: number }> {
  const { rows } = await db.query<Partial<FeedRow> & { up_to: string | null }>(
    `SELECT h.up_to, p.seq, p.entity, p.entity_id, p.op, p.data
       FROM (SELECT max(seq) AS up_to FROM changes) h
       LEFT JOIN LATERAL (
         SELECT c.seq, c.entity, c.entity_id, c.op, c.data FROM changes c
          WHERE c.seq > $1
            AND NOT (c.op = 'delete' AND c.seq <= coalesce($3::bigint, h.up_to))
            AND NOT EXISTS (SELECT 1 FROM changes n WHERE n.entity_id = c.entity_id AND n.entity = c.entity AND n.seq > c.seq)
          ORDER BY c.seq
          LIMIT $2
       ) p ON true
      ORDER BY p.seq`,
    [after, limit + 1, deletesTo === 'new' ? null : deletesTo]
  )
  return { rows: rows.filter((r) => r.seq != null) as FeedRow[], upTo: Number(rows[0]?.up_to ?? 0) }
}

/**
 * Fastify's two lines for every request (it came in, it was answered) are one, and only for a request that failed or was
 * slow, with how long it took (audit finding 15). Its other lines, such as an error's, are as they were.
 */
class QuietRequests extends LogController {
  constructor(private readonly slowMs: number) {
    super()
  }

  override incomingRequest() {}

  override requestCompleted(error: Error | null | undefined, req: FastifyRequest, reply: FastifyReply) {
    const ms = reply.elapsedTime
    if (error) reply.log.error({ req, res: reply, err: error, responseTime: Math.round(ms) }, 'Request errored')
    else if (reply.statusCode >= 400) reply.log.info({ req, res: reply, responseTime: Math.round(ms) }, 'Request failed')
    else if (ms >= this.slowMs) reply.log.warn({ req, res: reply, responseTime: Math.round(ms) }, 'Slow request')
  }
}

/**
 * The status an error asks for, by either name libraries give it; without one, it's a fault, unless it's Postgres
 * turning down a character it can't hold (a NUL in a query string, say), which is the request's, so a refusal.
 */
const statusOf = (err: { statusCode?: number; status?: number }) => err.statusCode ?? err.status ?? (isCharacterError(err) ? 400 : 500)

class EmptyPullBehindHead extends Error {
  override name = 'EmptyPullBehindHead'
}

/**
 * The sync API. Three routes do the work (push, pull, live); `history` and
 * `export` keep the principles' promises of an audit trail on everything and
 * "your data, always reachable" (ADR 0006).
 */
export async function buildApp(options: AppOptions): Promise<FastifyInstance> {
  const { db, logger = false, logTo, webRoot, auth, passcode, backupStore, backupKey, commit, errorReporting, backupWatch, calendar, requestTimeoutMs = REQUEST_TIMEOUT_MS, pushBudgetMs = PUSH_BUDGET_MS, pushLockWaitMs = PUSH_LOCK_WAIT_MS, liveBeatMs = LIVE_BEAT_MS, pullLimit = PULL_LIMIT, slowRequestMs = SLOW_REQUEST_MS } = options
  await migrateAll(db)
  const app = Fastify({
    // Railway keeps the log, so a request is logged by its method and path only, with private links masked.
    logger: logger && { serializers: { req: requestForLog }, ...(logTo && { stream: logTo }) },
    logController: new QuietRequests(slowRequestMs),
    bodyLimit: 5 * 1024 * 1024,
    // Without a limit, someone sending a request a byte at a time could hold a connection open for ever; the freelancer's
    // link takes posts from anyone. Five minutes still lets a 10 MB photo through on a poor mobile signal (ADR 0029).
    requestTimeout: requestTimeoutMs,
  })
  // The old sync test's tables go only when empty (schema.ts), so one still holding rows is said once, here at start.
  const kept = await keptSyncTestTables(db)
  if (kept.length > 0) {
    const which = kept.map((k) => `${k.table} (${plural(k.rows, 'row')})`).join(', ')
    app.log.warn({ tables: kept }, `Kept the old sync test's tables that still hold rows: ${which}. Nothing uses them now; drop them by hand once the rows are copied somewhere.`)
  }
  const backups = await new Backups(db, backupStore, { log: app.log, commit, watch: backupWatch, key: backupKey }).load()
  app.decorate('backups', backups)
  await app.register(websocket)
  // The API's answers go compressed to a device that takes it (audit finding 6): a phone's first pull is a few megabytes
  // of JSON, a tenth of that compressed, and on a weak signal that's the difference between finishing and not. Only the
  // API: the app's own files are compressed once, when it's built (scripts/compress-web.mjs), and served as they are.
  // Only what compresses: the export's zip, documents' files and photos are compressed already, and are left alone by
  // their type; so is an answer under a kilobyte. The live connection is a WebSocket, which this never touches.
  // Set before the plugin, so its own look at each route sees it.
  app.addHook('onRoute', (route) => {
    if (!route.url.startsWith('/api/') || route.websocket) route.compress = false
  })
  // Brotli at a middling quality: nearly as small as its best, at a fraction of the time on the server's one thread.
  await app.register(compress, {
    encodings: ['br', 'gzip'],
    threshold: 1024,
    brotliOptions: { params: { [zlib.BROTLI_PARAM_QUALITY]: 5 } },
    // What devices send stays as it is: nothing sends it compressed.
    globalDecompression: false,
  })

  const sockets = new Set<WebSocket>()
  const feeds = new Feeds(db, options.feeds)
  /** Something changed: calendar feeds are built again when next asked for, and devices are told to pull. */
  const poke = async () => {
    feeds.stale()
    if (sockets.size === 0) return
    // A poke that fails (the database hiccuping right after a push, say) is
    // the server's own trouble: the change is already made, and devices
    // pull on their own clock anyway. Left to throw, it would stop the server.
    try {
      const msg: Poke = { type: 'poke', cursor: await currentSeq(db.reads) }
      const text = JSON.stringify(msg)
      for (const ws of sockets) if (ws.readyState === ws.OPEN) ws.send(text)
    } catch (err) {
      app.log.error({ err }, 'Could not tell devices about a change')
      reportError(err, { area: 'poke' })
    }
  }

  const google = calendar ? new Google({ clientId: calendar.clientId, clientSecret: calendar.clientSecret, fetch: calendar.fetch }) : undefined
  const calendarSync =
    calendar && google
      ? new CalendarSync({
          ...calendar,
          db,
          google,
          secret: calendar.clientSecret,
          log: app.log,
          onChange: () => void poke(),
          report: (err) => reportError(err, { area: 'calendar' }),
        })
      : undefined
  app.decorate('calendar', calendarSync)
  // A restore must never bring back someone erased on request, so the list of erasures is kept beside the backups too (ADR 0027).
  const erasures = backupStore ? new ErasureList(db, backupStore, app.log) : undefined
  app.decorate('erasures', erasures)
  // Documents' files go in the same storage as the backups, under a prefix of their own (ADR 0029).
  const documents = new DocumentFiles(db, options.documentStore ?? backupStore, { key: backupKey, log: app.log, report: (err) => reportError(err, { area: 'documents' }) })
  app.decorate('documents', documents)
  /** Something changed in the app: devices pull it, the calendar catches up, an erasure is written beside the backups, and files no document has any more are deleted. */
  const changed = () => {
    void poke()
    calendarSync?.kick()
    void erasures?.keep()
    void documents.tidy()
  }
  // Their own calendars (ADR 0044): read again every few hours, from the time the caller starts it.
  const ownCalendars = new OwnCalendars(db, { ...options.ownCalendars, onChange: changed, report: (err) => reportError(err, { area: 'own-calendar' }) })
  app.decorate('ownCalendars', ownCalendars)
  app.decorate('dueErasures', new DueErasures(db, { changed, log: app.log, report: (err) => reportError(err, { area: 'erasure' }) }))
  // AA_FUEL_URL points the AA's page elsewhere, as the browser tests do, so they never read the real one.
  const fuel = options.fuel ?? aaFuel(process.env.AA_FUEL_URL ? { url: process.env.AA_FUEL_URL } : {})
  app.decorate('fuelUpdates', new FuelUpdates(db, fuel, { changed, log: app.log }))

  // A request that failed on the server is reported (ADR 0005) by the route as the
  // code names it, never the address used, which could hold a private link.
  app.addHook('onError', async (req, _reply, err) => {
    if (statusOf(err) < 500) return
    reportError(err, { route: req.routeOptions.url ?? 'unknown', method: req.method })
  })

  // What goes back when a request fails on the server: never the error's own
  // words, which could be Postgres's, with a value from the request in them.
  // A request turned away (400, 401, 404) keeps Fastify's answer saying why.
  app.setErrorHandler((err: FastifyError, req, reply) => {
    const status = statusOf(err)
    if (isCharacterError(err)) {
      reply.code(status).send({ error: CHARACTERS })
      return
    }
    if (status < 500) {
      reply.send(err)
      return
    }
    // A database error's detail holds the row it was about: the log gets the fault without it.
    const logged = faultForLog(err)
    req.log.error({ req, res: reply, err: logged }, logged === err ? err.message : (logged as { message: string }).message)
    reply.code(status).send({ error: 'Something went wrong on the server.' })
  })

  // On every answer, files and faults included: a browser never guesses a file's
  // type, never shows the app inside another site's frame, and tells other sites
  // only where a link came from, not which page. Browsers remember the https
  // rule for a year, so it goes out only on https (Railway says so in the
  // forwarded protocol), never from a local server on http.
  // The server's own pages get a strict content security policy (audit finding 24); the app shell sets its own as it's
  // served, below, and a document's file a stricter one of its own (ADR 0029). Anything else isn't a page, and needs only
  // to stay out of other sites' frames.
  const pages = pagePolicy([COPY_SCRIPT])
  app.addHook('onSend', async (req, reply) => {
    reply.header('x-content-type-options', 'nosniff')
    if (!reply.hasHeader('content-security-policy')) {
      const html = String(reply.getHeader('content-type') ?? '').startsWith('text/html')
      reply.header('content-security-policy', html ? pages : "frame-ancestors 'none'")
    }
    reply.header('referrer-policy', 'strict-origin-when-cross-origin')
    if (publicOrigin(req).startsWith('https:')) reply.header('strict-transport-security', 'max-age=31536000; includeSubDomains')
  })

  registerAuth(app, db, auth, passcode)
  // Staff's own pages need Google too, once it is on (ADR 0052).
  if (auth) guardStaffPages(app, db, auth.admins)

  app.get('/api/health', { config: { public: true } }, async () => {
    const backup = backups.status()
    return {
      ok: true,
      db: db.kind,
      auth: auth ? 'google' : passcode ? 'passcode' : 'off',
      errors: errorReporting ? 'sentry' : 'off',
      // "read-only": calendars can be read to bring jobs in, but nothing is written to Google (CALENDAR_WRITES).
      calendar: calendarSync ? (calendarSync.writes ? 'writing' : 'read-only') : 'off',
      // "fresh" false means the nightly backup has stopped working.
      backups: backup.configured ? { last: backup.lastOk?.finishedAt ?? null, fresh: backup.fresh } : 'off',
      // On the reads' own connections, so the health check answers while a long change holds the write lock.
      cursor: await currentSeq(db.reads),
    }
  })

  // For uptime checks every few minutes: answers without asking the database
  // anything, so the checks don't keep Neon awake (and billing) all night.
  app.get('/api/up', { config: { public: true } }, async (_req, reply) => {
    reply.header('cache-control', 'no-store')
    return { ok: true }
  })

  // Read by the app before anyone signs in, so it can report its own errors too.
  app.get('/api/config', { config: { public: true } }, async (): Promise<ClientConfig> => ({
    errors: errorReporting ? { dsn: errorReporting.dsn, environment: errorReporting.environment } : null,
  }))

  app.post('/api/sync/push', async (req, reply): Promise<PushResponse | void> => {
    const parsed = pushRequest.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0]?.message })
    const { clientId, mutations, sentAt, generation, partial } = parsed.data
    const started = Date.now()
    // Who is asking, for the history and for the handlers that check it (ADR 0024); nobody while sign-in is off.
    const from = {
      userId: req.user?.id,
      ...(req.user ? { user: { id: req.user.id, email: req.user.email } } : {}),
      // What they may change (ADR 0034); nothing is checked while roles are off.
      ...(req.role ? { role: req.role, reader: req.reader ?? {} } : {}),
      sentAt,
      device: describeDevice(req.headers['user-agent']),
    }
    const results: MutationResult[] = []
    let stale = false
    let busy = false
    // What's already applied, in one look, answered as it was the first time: a phone sending again what it sent before
    // it gave up waiting is answered at once, rather than at a dozen trips to the database a change. Starting fresh
    // empties this table (ADR 0019), so nothing found here belongs to a copy that's gone.
    // An id with a character the database can't hold fails the look, so then each is looked up on its own, as before.
    const seen = await db
      .query<{ id: string; result: MutationResult }>('SELECT id, result FROM mutations WHERE id = ANY($1::text[])', [mutations.map((m) => m.id)])
      .then(({ rows }) => rows)
      .catch((err: unknown) => {
        if (!isCharacterError(err)) throw err
        return []
      })
    const answered = new Map(seen.map((r) => [r.id, r.result]))
    // In order: a device's later request may depend on an earlier one.
    for (const m of mutations) {
      // Out of time for a device that takes part of an answer: the rest go again in its next push, after these.
      if (partial && results.length > 0 && Date.now() - started > pushBudgetMs) break
      const before = answered.get(m.id)
      if (before) {
        results.push({ ...before, duplicate: true })
        continue
      }
      const result = await db
        .transaction(async (tx) => {
          await takeWriteLock(tx, pushLockWaitMs)
          // Made on a copy of the data from before someone started fresh (ADR 0019): none of it belongs any more.
          if (generation && (await clearedSince(tx, generation))) return 'stale' as const
          return applyMutationIn(tx, clientId, m as never, from, req.log)
        })
        .catch((err: unknown): MutationResult | 'busy' => {
          // A long change holds the write lock: this one and the rest go again shortly, and what's done is answered now.
          if (isLockBusy(err)) return 'busy'
          // A character the database can't hold where it can't be cleaned, such as in the change's own id or the
          // device's: nothing of it can be recorded, so it's answered here, as a refusal, and the rest of the push
          // carries on rather than failing with it and stranding the phone. A resend gets the same answer.
          if (!isCharacterError(err)) throw err
          req.log.info({ command: m.name }, 'Turned down a change with a character the database cannot hold')
          return { id: m.id, status: 'rejected', reason: { code: 'invalid', message: CHARACTERS } }
        })
      if (result === 'stale') {
        stale = true
        break
      }
      if (result === 'busy') {
        req.log.info({ answered: results.length, waiting: mutations.length - results.length }, 'Push answered busy: the write lock is held by a long change')
        busy = true
        break
      }
      results.push(result)
    }
    if (results.some((r) => r.status === 'applied' && !r.duplicate)) changed()
    return stale ? { results: [], stale } : busy ? { results, busy } : { results }
  })

  // A pull that found nothing new while the feed's head is past the device (audit finding 19). One change landing between
  // the page and the head is enough, and is harmless now: the device keeps its cursor and the next pull brings it. Often,
  // though, it says writes are slow to commit, and it is how finding 1 lost changes before it was fixed.
  const reportBehind = reportNowAndThen(10 * 60_000, options.report)
  app.get<{ Querystring: { after?: string; latest?: string } }>('/api/sync/pull', async (req): Promise<PullResponse> => {
    const after = Math.max(0, Number(req.query.after ?? 0) || 0)
    // Pulls never take the write lock, and read on connections of their own, so a phone keeps hearing everyone else's
    // changes while a long one is written, rather than waiting behind the pushes queued for it (audit finding 7).
    const db = options.db.reads
    // Only each record's latest change, when the device asks (see `latestPage`); "new" only from the start, where the copy is empty.
    const latest = req.query.latest === 'new' ? (after === 0 ? ('new' as const) : 0) : /^\d+$/.test(req.query.latest ?? '') ? Number(req.query.latest) : undefined
    const { rows, upTo } = latest === undefined ? await feedPage(db, after, pullLimit) : await latestPage(db, after, pullLimit, latest)
    const more = rows.length > pullLimit
    const page = rows.slice(0, pullLimit)
    // Money (ADR 0042) goes only to the roles that see it: for the rest its changes are left out, and the cursor still
    // moves past them, so a phone never holds a price or a quote it couldn't show.
    const money = roleSeesMoney(req.role)
    // Crew rates and private links (ADR 0046) are on records every role needs, so those go to everyone, cut down to what
    // the role reads: a booking without its rate, a person without their link.
    const reading = await readingOf(db, req.role, req.reader ?? {})
    const changes: Change[] = await asRead(
      db,
      page.filter((r) => money || !MONEY_ENTITY_NAMES.includes(r.entity)).map((r) => ({ seq: Number(r.seq), entity: r.entity, id: r.entity_id, op: r.op, data: r.data })),
      reading
    )
    // Where the feed ends, and which copy of the data this is: a device ahead of the
    // head, or holding another generation, has seen data this server no longer has.
    // Read each time, so a new generation counts at once, without a restart.
    const { rows: meta } = await db.query<{ head: string | null; generation: string | null; made_up: boolean }>(
      `SELECT (SELECT max(seq) FROM changes) AS head, (SELECT value FROM server_meta WHERE key = 'generation') AS generation,
              EXISTS (SELECT 1 FROM server_meta WHERE key = 'made_up') AS made_up`
    )
    const head = Number(meta[0]?.head ?? 0)
    const generation = meta[0]?.generation ?? undefined
    // Nothing new keeps the device where it was. Not the head: a change committed after the page was read and before
    // the head was would fall between the two, and the device would never be sent it (audit, 18 October 2026). A page of
    // the latest that isn't full goes as far as the feed did when that page was read, in the same statement, so past
    // whatever it left out (deletes, changes made again since), and nothing committed after can fall behind it.
    const cursor = more ? Number(page[page.length - 1]!.seq) : Math.max(after, page.length ? Number(page[page.length - 1]!.seq) : after, upTo ?? 0)
    if (page.length === 0 && cursor === after && head > after) {
      req.log.warn({ after, head }, 'A pull found nothing after the device, with the head of the feed past it')
      reportBehind(new EmptyPullBehindHead(`A pull found nothing after ${after}, with the head of the feed at ${head}`), { area: 'pull' })
    }
    // Began with someone starting fresh: a device starting its copy afresh drops what it had waiting (ADR 0019).
    const cleared = generation !== undefined && (await startedFresh(db, generation))
    return {
      changes,
      cursor,
      more,
      generation,
      ...(cleared ? { cleared } : {}),
      ...(meta[0]?.made_up ? { madeUp: true } : {}),
      head,
      feed: FEED,
      ...(money ? {} : { money: false }),
      ...(readsEverything(reading) ? {} : { reading }),
      // Answered with the latest of each record: up to where deletes are left out, for the device to ask with next time.
      ...(latest !== undefined ? { latest: latest === 'new' ? (upTo ?? 0) : latest } : {}),
    }
  })

  // The live connection's heartbeat: a beat each way, with nothing asked of the database, so it never keeps Neon awake.
  // The device hears the beat as a message (a browser's page never sees a ping); the server hears the browser's own
  // answer to its ping, and lets go of a connection that has missed one.
  const heard = new WeakMap<WebSocket, boolean>()
  const beat = JSON.stringify({ type: 'beat' } satisfies Beat)
  const beating = setInterval(() => {
    for (const ws of sockets) {
      if (!heard.get(ws)) {
        ws.terminate()
        sockets.delete(ws)
        continue
      }
      heard.set(ws, false)
      if (ws.readyState !== ws.OPEN) continue
      ws.ping()
      ws.send(beat)
    }
  }, liveBeatMs)
  beating.unref()

  app.get('/api/sync/live', { websocket: true }, async (socket) => {
    sockets.add(socket)
    heard.set(socket, true)
    socket.on('pong', () => heard.set(socket, true))
    socket.on('close', () => sockets.delete(socket))
    socket.send(JSON.stringify({ type: 'poke', cursor: await currentSeq(db.reads) } satisfies Poke))
  })

  // Freelancers' private links: no app or login needed to answer an offer.
  registerCrewLinks(app, db, changed, feeds, { demo: !auth && !!passcode, ownCalendars })
  registerOwnCalendarRoutes(app, { ownCalendars })
  registerDocumentRoutes(app, { db, files: documents, onChange: changed })
  registerPhotoRoutes(app, { db, files: documents, onChange: changed })
  registerBackupRoutes(app, backups)
  registerDataRoutes(app, { db, backups, documents, onChange: changed })
  registerPeopleImportRoutes(app, { db, onChange: changed })
  registerStockImportRoutes(app, { db, onChange: changed, round: options.stockImport })
  registerItemLogRoutes(app, { db })
  registerNoticeRoutes(app, { db })
  registerPlaceRoutes(app, { search: options.places ?? nominatim() })
  registerFuelRoutes(app, { lookup: fuel })
  registerCalendarRoutes(app, { db, google, sync: calendarSync, secret: calendar?.clientSecret, onChange: () => void poke() })
  registerImportRoutes(app, { db, sync: calendarSync, onChange: () => void poke() })
  const rms = new RmsReader(db, options.currentRms && new RmsApi(options.currentRms), app.log)
  app.decorate('rms', rms)
  registerRmsRoutes(app, { db, reader: rms })

  // The history (ADR 0006): newest first, a page at a time, for everyone, one person or one record.
  app.get<{ Querystring: { before?: string; limit?: string; who?: string; entity?: string; id?: string } }>('/api/history', async (req, reply) => {
    try {
      // Read by every member of staff, so in words without crew pay for a role that doesn't see it (ADR 0046), nor for a
      // head who sees only their department's (ADR 0062): the history names everyone's.
      const reading = await readingOf(db, req.role, req.reader ?? {})
      return await readHistory(db, { ...req.query, limit: Number(req.query.limit) || undefined }, readsEveryRate(reading), (reading.details ?? 'all') === 'all')
    } catch (err) {
      if (err instanceof BadCursor) return reply.code(400).send({ error: err.message })
      throw err
    }
  })

  // Everything, from one moment (ADR 0006). It holds everyone's details, so each download
  // goes in the history: who, when and on what device. The app records it with this
  // post as it asks for the file, so a fetch of the address alone (a browser warming
  // up a link, say) writes nothing. `client` is the app's device code.
  app.post<{ Querystring: { client?: string }; Body: { format?: unknown } }>('/api/export/record', { config: { needs: 'settings' } }, async (req, reply) => {
    const format = req.body?.format === 'json' ? 'json' : 'zip'
    const client = req.query.client ?? ''
    // The file is fetched after this, with this record in it, so the count includes it.
    const rows = (await exportRowCount(db)) + 1
    await recordExport(db, {
      clientId: /^[a-z0-9]{1,64}$/.test(client) ? client : 'server',
      userId: req.user?.id,
      device: describeDevice(req.headers['user-agent']),
      format,
      rows,
    })
    return reply.header('cache-control', 'no-store').send({ rows })
  })

  // Taking turns with a backup, which also holds the whole company in memory (turns.ts, audit, 20 October 2026, finding 9).
  app.get('/api/export.zip', { config: { needs: 'settings' } }, async (req, reply) => {
    const { everything, zip } = await takeTurns(async () => {
      const everything = await readEverything(db)
      return { everything, zip: everythingZip(everything, req.user ?? undefined) }
    })
    return reply
      .type('application/zip')
      .header('content-disposition', `attachment; filename="${zipName(everything)}"`)
      .header('cache-control', 'no-store')
      .send(Buffer.from(zip.buffer, zip.byteOffset, zip.byteLength))
  })

  // The same, as JSON, for scripts. A script that wants its download in the history posts to /api/export/record first.
  app.get('/api/export', { config: { needs: 'settings' } }, async (_req, reply) => {
    const json = await takeTurns(async () => everythingJson(await readEverything(db)))
    return reply.header('cache-control', 'no-store').send(json)
  })

  if (webRoot) {
    // A file under /assets/ has its content's hash in its name, so a new build never
    // reuses a name: browsers can keep it for a year without asking. The page, the
    // service worker and the manifest keep their names, so they are checked every time.
    // Judged from the web root, so a checkout in a folder that happens to be called assets changes nothing.
    const assets = join(webRoot, 'assets') + sep
    const page = join(webRoot, 'index.html')
    // Its inline theme script is let in by its hash, read from the page as built (audit finding 24).
    const shell = appShellPolicy(inlineScripts(readFileSync(page, 'utf8')), errorReporting?.dsn)
    await app.register(fastifyStatic, {
      root: webRoot,
      // The .br and .gz beside each file, made when the app is built, go to a browser that takes them (audit finding 6).
      preCompressed: true,
      cacheControl: false,
      setHeaders: (reply, path) => {
        reply.header('cache-control', path.startsWith(assets) ? 'public, max-age=31536000, immutable' : 'no-cache')
        // The page may go as its .br or .gz, which is still the page.
        if (path === page || path === `${page}.br` || path === `${page}.gz`) reply.header('content-security-policy', shell)
      },
    })
    // Anything that is not an API call, a private link, a feed or a file is the app; the app routes it.
    // A missing file under /assets/ is a plain 404, never the page: a page from before a deploy
    // asking for a file that's gone should see it fail (and reload), not get HTML as its script.
    app.setNotFoundHandler((req, reply) =>
      /^\/(api|f|cal|assets)\//.test(req.url) ? reply.code(404).send({ error: 'Not found' }) : reply.sendFile('index.html')
    )
    // Fastify's own answer would write the whole address in the log.
  } else app.setNotFoundHandler((_req, reply) => reply.code(404).send({ error: 'Not found' }))

  app.addHook('onClose', async () => {
    rms.stop()
    await rms.done?.catch(() => {})
    backups.stop()
    app.dueErasures.stop()
    app.fuelUpdates.stop()
    documents.stop()
    calendarSync?.stop()
    ownCalendars.stop()
    clearInterval(beating)
    for (const ws of sockets) ws.close()
  })
  return app
}
