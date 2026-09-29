import cors from '@fastify/cors'
import fastifyStatic from '@fastify/static'
import websocket from '@fastify/websocket'
import { pushRequest, type Change, type ClientConfig, type EntityName, type Poke, type PullResponse, type PushResponse } from '@sh/shared'
import Fastify, { type FastifyInstance } from 'fastify'
import type { WebSocket } from 'ws'
import type { AuthConfig } from './auth/config.ts'
import { registerAuth } from './auth/routes.ts'
import { registerBackupRoutes } from './backup/routes.ts'
import { Backups, type BackupWatch } from './backup/service.ts'
import type { BackupStore } from './backup/store.ts'
import { applyMutation, currentSeq } from './commands.ts'
import { registerCrewLinks } from './crew/links.ts'
import { CREW_TABLES } from './crew/schema.ts'
import type { Db } from './db.ts'
import { migrateAll } from './modules.ts'
import { reportError, type ErrorReporting } from './monitoring.ts'

const PULL_LIMIT = 500

export interface AppOptions {
  db: Db
  logger?: boolean
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
}

declare module 'fastify' {
  interface FastifyInstance {
    /** The nightly backup; the caller starts its schedule once the server is listening. */
    backups: Backups
  }
}

/**
 * The sync API. Three routes do the work (push, pull, live); `export` is
 * the "your data, always reachable" promise from the principles, present
 * from the first commit rather than bolted on.
 */
export async function buildApp({ db, logger = false, webRoot, auth, backupStore, commit, errorReporting, backupWatch }: AppOptions): Promise<FastifyInstance> {
  await migrateAll(db)
  const app = Fastify({ logger, bodyLimit: 5 * 1024 * 1024 })
  const backups = await new Backups(db, backupStore, { log: app.log, commit, watch: backupWatch }).load()
  app.decorate('backups', backups)
  await app.register(cors, { origin: true })
  await app.register(websocket)

  const sockets = new Set<WebSocket>()
  const poke = async () => {
    if (sockets.size === 0) return
    const msg: Poke = { type: 'poke', cursor: await currentSeq(db) }
    const text = JSON.stringify(msg)
    for (const ws of sockets) if (ws.readyState === ws.OPEN) ws.send(text)
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
    const { clientId, mutations } = parsed.data
    const results = []
    // In order: a device's later request may depend on an earlier one.
    for (const m of mutations) results.push(await applyMutation(db, clientId, m as never, 'app', req.user?.id))
    if (results.some((r) => r.status === 'applied' && !r.duplicate)) void poke()
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
    const { rows: meta } = await db.query<{ head: string | null; generation: string | null }>(
      `SELECT (SELECT max(seq) FROM changes) AS head, (SELECT value FROM server_meta WHERE key = 'generation') AS generation`
    )
    const head = Number(meta[0]?.head ?? 0)
    const generation = meta[0]?.generation ?? undefined
    const cursor = changes.length ? changes[changes.length - 1]!.seq : Math.max(after, head)
    return { changes, cursor, more, generation, head }
  })

  app.get('/api/sync/live', { websocket: true }, async (socket) => {
    sockets.add(socket)
    socket.on('close', () => sockets.delete(socket))
    socket.send(JSON.stringify({ type: 'poke', cursor: await currentSeq(db) } satisfies Poke))
  })

  // Freelancers' private links: no app or login needed to answer an offer.
  registerCrewLinks(app, db, () => void poke())
  registerBackupRoutes(app, backups)

  app.get('/api/export', async () => {
    const tables = ['products', 'bookings', 'scans', 'issues', ...CREW_TABLES, 'users', 'mutations'] as const
    const out: Record<string, unknown[]> = {}
    for (const t of tables) out[t] = (await db.query(`SELECT * FROM ${t}`)).rows
    return { exportedAt: new Date().toISOString(), ...out }
  })

  if (webRoot) {
    await app.register(fastifyStatic, { root: webRoot })
    // Anything that is not an API call or a file is the app; the app routes it.
    app.setNotFoundHandler((req, reply) =>
      req.url.startsWith('/api/') || req.url.startsWith('/f/') ? reply.code(404).send({ error: 'Not found' }) : reply.sendFile('index.html')
    )
  }

  app.addHook('onClose', async () => {
    backups.stop()
    for (const ws of sockets) ws.close()
  })
  return app
}
