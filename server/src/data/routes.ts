import { irishToday, START_FRESH_WORDS, type DataStatus } from '@sh/shared'
import type { FastifyInstance, FastifyRequest } from 'fastify'
import { Busy, type Backups } from '../backup/service.ts'
import type { Db } from '../db.ts'
import { describeDevice } from '../devices.ts'
import { putMadeUpFiles } from '../documents/actions.ts'
import type { DocumentFiles } from '../documents/files.ts'
import { dataStatus, DataRefused, fillWithMadeUpData, startFresh, type Who } from './fresh.ts'

/**
 * For the Account tab (ADR 0019): whether the app holds made-up data,
 * putting it in, and starting fresh. All of it needs sign-in like the rest
 * of the API, and `client` is the app's device code, for the history.
 */
export function registerDataRoutes(app: FastifyInstance, { db, backups, documents, onChange }: { db: Db; backups: Backups; documents: DocumentFiles; onChange: () => void }) {
  const who = (req: FastifyRequest<{ Querystring: { client?: string } }>): Who => ({
    userId: req.user?.id,
    name: req.user?.name,
    clientId: req.query.client,
    device: describeDevice(req.headers['user-agent']),
  })
  const status = () => dataStatus(db, !!backups.store)

  app.get('/api/data', async (_req, reply): Promise<DataStatus> => {
    reply.header('cache-control', 'no-store')
    return status()
  })

  app.post<{ Querystring: { client?: string } }>('/api/data/made-up', async (req, reply): Promise<DataStatus | void> => {
    try {
      await fillWithMadeUpData(db, who(req))
    } catch (err) {
      if (err instanceof DataRefused) return reply.code(409).send({ error: err.message })
      throw err
    }
    // Made-up files for the made-up documents, where there's a store to keep them in (ADR 0029). Made up, so a store
    // that won't take them leaves the documents as details only, as on a server with no bucket.
    await putMadeUpFiles(db, documents, irishToday(), { userId: req.user?.id, clientId: req.query.client }).catch((err) => req.log.warn({ err }, 'Could not put in the made-up documents\' files'))
    onChange()
    return status()
  })

  app.post<{ Querystring: { client?: string }; Body: { confirm?: unknown } }>('/api/data/start-fresh', async (req, reply): Promise<DataStatus | void> => {
    const typed = typeof req.body?.confirm === 'string' ? req.body.confirm.trim().toLowerCase() : ''
    if (typed !== START_FRESH_WORDS) return reply.code(400).send({ error: `Type “${START_FRESH_WORDS}” to start fresh.` })
    // A backup first, where there's somewhere to keep it, so starting fresh can be undone.
    if (backups.store) {
      try {
        const run = await backups.run('fresh')
        if (run.status !== 'ok')
          return reply.code(409).send({ error: `The backup before starting fresh didn't work (${run.error ?? 'no reason given'}), so nothing was deleted.` })
      } catch (err) {
        if (err instanceof Busy) return reply.code(429).send({ error: 'A backup is running now. Try again in a minute.' })
        throw err
      }
    }
    try {
      await startFresh(db, who(req))
    } catch (err) {
      if (err instanceof DataRefused) return reply.code(409).send({ error: err.message })
      throw err
    }
    onChange()
    return status()
  })
}
