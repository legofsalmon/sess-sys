import cors from '@fastify/cors'
import fastifyStatic from '@fastify/static'
import websocket from '@fastify/websocket'
import { pushRequest, type Change, type ClientConfig, type EntityName, type Poke, type PullResponse, type PushResponse } from '@sh/shared'
import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify'
import type { WebSocket } from 'ws'
import type { AuthConfig } from './auth/config.ts'
import { registerAuth } from './auth/routes.ts'
import { registerBackupRoutes } from './backup/routes.ts'
import { Backups, type BackupWatch } from './backup/service.ts'
import type { BackupStore } from './backup/store.ts'
import { Google } from './calendar/google.ts'
import { registerImportRoutes } from './calendar/import.ts'
import { registerCalendarRoutes } from './calendar/routes.ts'
import { CalendarSync, type CalendarSyncOptions } from './calendar/sync.ts'
import { applyMutation, currentSeq } from './commands.ts'
import { startedFresh } from './data/fresh.ts'
import { registerDataRoutes } from './data/routes.ts'
import { Feeds, type FeedsOptions } from './crew/feeds.ts'
import { registerCrewLinks } from './crew/links.ts'
import type { Db } from './db.ts'
import { describeDevice } from './devices.ts'
import { everythingJson, everythingZip, readEverything, rowCount, zipName } from './export.ts'
import { BadCursor, readHistory, recordExport } from './history.ts'
import { requestForLog } from './http.ts'
import { migrateAll } from './modules.ts'
import { reportError, type ErrorReporting } from './monitoring.ts'

const PULL_LIMIT = 500

export interface AppOptions {
  db: Db
  /** Log each request, with private addresses masked (ADR 0012). */
  logger?: boolean
  /** Where the log goes instead of standard output, for tests. */
  logTo?: { write(line: string): void }
  /** Built web app to serve alongside the API (web/dist), if any. */
  webRoot?: string
  /** Staff sign-in. Without it the API is open to anyone who can reach it, which is only for tests and trials. */
  auth?: AuthConfig
  /** Where nightly backups go (ADR 0004). Without it there are none. */
  backupStore?: BackupStore
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
}

export interface CalendarSetup extends Pick<CalendarSyncOptions, 'appUrl' | 'settleMs' | 'gapMs' | 'now' | 'nightly' | 'pollMs'> {
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
  }
}

/**
 * The sync API. Three routes do the work (push, pull, live); `history` and
 * `export` keep the principles' promises of an audit trail on everything and
 * "your data, always reachable" (ADR 0006).
 */
export async function buildApp(options: AppOptions): Promise<FastifyInstance> {
  const { db, logger = false, logTo, webRoot, auth, backupStore, commit, errorReporting, backupWatch, calendar } = options
  await migrateAll(db)
  const app = Fastify({
    // Railway keeps the log, so a request is logged by its method and path only, with private links masked.
    logger: logger && { serializers: { req: requestForLog }, ...(logTo && { stream: logTo }) },
    bodyLimit: 5 * 1024 * 1024,
  })
  const backups = await new Backups(db, backupStore, { log: app.log, commit, watch: backupWatch }).load()
  app.decorate('backups', backups)
  await app.register(cors, { origin: true })
  await app.register(websocket)

  const sockets = new Set<WebSocket>()
  const feeds = new Feeds(db, options.feeds)
  /** Something changed: calendar feeds are built again when next asked for, and devices are told to pull. */
  const poke = async () => {
    feeds.stale()
    if (sockets.size === 0) return
    const msg: Poke = { type: 'poke', cursor: await currentSeq(db) }
    const text = JSON.stringify(msg)
    for (const ws of sockets) if (ws.readyState === ws.OPEN) ws.send(text)
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
  /** Something changed in the app: devices pull it, and the calendar catches up. */
  const changed = () => {
    void poke()
    calendarSync?.kick()
  }

  // A request that failed on the server is reported (ADR 0005) by the route as the
  // code names it, never the address used, which could hold a private link.
  app.addHook('onError', async (req, _reply, err) => {
    if ((err.statusCode ?? 500) < 500) return
    reportError(err, { route: req.routeOptions.url ?? 'unknown', method: req.method })
  })

  registerAuth(app, db, auth)

  app.get('/api/health', { config: { public: true } }, async () => {
    const backup = backups.status()
    return {
      ok: true,
      db: db.kind,
      auth: auth ? 'google' : 'off',
      errors: errorReporting ? 'sentry' : 'off',
      // "fresh" false means the nightly backup has stopped working.
      backups: backup.configured ? { last: backup.lastOk?.finishedAt ?? null, fresh: backup.fresh } : 'off',
      cursor: await currentSeq(db),
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
    const { clientId, mutations, sentAt, generation } = parsed.data
    // Made on a copy of the data from before someone started fresh (ADR 0018): none of it belongs any more.
    if (generation) {
      const { rows } = await db.query<{ value: string }>(`SELECT value FROM server_meta WHERE key = 'generation'`)
      const current = rows[0]?.value
      if (current && generation !== current && (await startedFresh(db, current))) return { results: [], stale: true }
    }
    const from = { userId: req.user?.id, sentAt, device: describeDevice(req.headers['user-agent']) }
    const results = []
    // In order: a device's later request may depend on an earlier one.
    for (const m of mutations) results.push(await applyMutation(db, clientId, m as never, from))
    if (results.some((r) => r.status === 'applied' && !r.duplicate)) changed()
    return { results }
  })

  app.get<{ Querystring: { after?: string } }>('/api/sync/pull', async (req): Promise<PullResponse> => {
    const after = Math.max(0, Number(req.query.after ?? 0) || 0)
    const { rows } = await db.query<{ seq: string; entity: EntityName; entity_id: string; op: 'put' | 'delete'; data: unknown }>(
      'SELECT seq, entity, entity_id, op, data FROM changes WHERE seq > $1 ORDER BY seq LIMIT $2',
      [after, PULL_LIMIT + 1]
    )
    const more = rows.length > PULL_LIMIT
    const changes: Change[] = rows
      .slice(0, PULL_LIMIT)
      .map((r) => ({ seq: Number(r.seq), entity: r.entity, id: r.entity_id, op: r.op, data: r.data }))
    // Where the feed ends, and which copy of the data this is: a device ahead of the
    // head, or holding another generation, has seen data this server no longer has.
    // Read each time, so a new generation counts at once, without a restart.
    const { rows: meta } = await db.query<{ head: string | null; generation: string | null; made_up: boolean }>(
      `SELECT (SELECT max(seq) FROM changes) AS head, (SELECT value FROM server_meta WHERE key = 'generation') AS generation,
              EXISTS (SELECT 1 FROM server_meta WHERE key = 'made_up') AS made_up`
    )
    const head = Number(meta[0]?.head ?? 0)
    const generation = meta[0]?.generation ?? undefined
    const cursor = changes.length ? changes[changes.length - 1]!.seq : Math.max(after, head)
    // Began with someone starting fresh: a device starting its copy afresh drops what it had waiting (ADR 0018).
    const cleared = generation !== undefined && (await startedFresh(db, generation))
    return { changes, cursor, more, generation, ...(cleared ? { cleared } : {}), ...(meta[0]?.made_up ? { madeUp: true } : {}), head }
  })

  app.get('/api/sync/live', { websocket: true }, async (socket) => {
    sockets.add(socket)
    socket.on('close', () => sockets.delete(socket))
    socket.send(JSON.stringify({ type: 'poke', cursor: await currentSeq(db) } satisfies Poke))
  })

  // Freelancers' private links: no app or login needed to answer an offer.
  registerCrewLinks(app, db, changed, feeds)
  registerBackupRoutes(app, backups)
  registerDataRoutes(app, { db, backups, onChange: changed })
  registerCalendarRoutes(app, { db, google, sync: calendarSync, secret: calendar?.clientSecret, onChange: () => void poke() })
  registerImportRoutes(app, { db, sync: calendarSync, onChange: () => void poke() })

  // The history (ADR 0006): newest first, a page at a time, for everyone, one person or one record.
  app.get<{ Querystring: { before?: string; limit?: string; who?: string; entity?: string; id?: string } }>('/api/history', async (req, reply) => {
    try {
      return await readHistory(db, { ...req.query, limit: Number(req.query.limit) || undefined })
    } catch (err) {
      if (err instanceof BadCursor) return reply.code(400).send({ error: err.message })
      throw err
    }
  })

  // Everything, from one moment (ADR 0006). It holds everyone's details, so each download
  // goes in the history: who, when and on what device. `client` is the app's device code.
  const exported = async (req: FastifyRequest<{ Querystring: { client?: string } }>, format: 'zip' | 'json', rows: number) => {
    const client = req.query.client ?? ''
    await recordExport(db, {
      clientId: /^[a-z0-9]{1,64}$/.test(client) ? client : 'server',
      userId: req.user?.id,
      device: describeDevice(req.headers['user-agent']),
      format,
      rows,
    })
  }

  app.get<{ Querystring: { client?: string } }>('/api/export.zip', async (req, reply) => {
    const everything = await readEverything(db)
    const zip = everythingZip(everything, req.user ?? undefined)
    await exported(req, 'zip', rowCount(everything))
    return reply
      .type('application/zip')
      .header('content-disposition', `attachment; filename="${zipName(everything)}"`)
      .header('cache-control', 'no-store')
      .send(Buffer.from(zip.buffer, zip.byteOffset, zip.byteLength))
  })

  // The same, as JSON, for scripts.
  app.get<{ Querystring: { client?: string } }>('/api/export', async (req, reply) => {
    const everything = await readEverything(db)
    await exported(req, 'json', rowCount(everything))
    return reply.header('cache-control', 'no-store').send(everythingJson(everything))
  })

  if (webRoot) {
    await app.register(fastifyStatic, { root: webRoot })
    // Anything that is not an API call, a private link, a feed or a file is the app; the app routes it.
    app.setNotFoundHandler((req, reply) =>
      /^\/(api|f|cal)\//.test(req.url) ? reply.code(404).send({ error: 'Not found' }) : reply.sendFile('index.html')
    )
    // Fastify's own answer would write the whole address in the log.
  } else app.setNotFoundHandler((_req, reply) => reply.code(404).send({ error: 'Not found' }))

  app.addHook('onClose', async () => {
    backups.stop()
    calendarSync?.stop()
    for (const ws of sockets) ws.close()
  })
  return app
}
