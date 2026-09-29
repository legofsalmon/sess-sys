import type { BackupRun, BackupStatus } from '@sh/shared'
import type { FastifyInstance } from 'fastify'
import { Busy, type Backups } from './service.ts'

/**
 * For the Account screen: when the last backup was made, and "Back up now"
 * for the first run after setting up storage, or before a risky change.
 * Both need sign-in like the rest of the API.
 */
export function registerBackupRoutes(app: FastifyInstance, backups: Backups) {
  app.get('/api/backups', async (_req, reply): Promise<BackupStatus> => {
    reply.header('cache-control', 'no-store')
    return backups.status()
  })

  app.post('/api/backups/run', async (_req, reply): Promise<BackupRun | void> => {
    if (!backups.store) return reply.code(409).send({ error: 'Backups are off: no storage is set up on the server yet.' })
    try {
      return await backups.run('manual')
    } catch (err) {
      if (err instanceof Busy) return reply.code(429).send({ error: err.message })
      throw err
    }
  })
}
