import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { buildApp } from './app.ts'
import { assertSignInKept, authFromEnv } from './auth/config.ts'
import { restoreFrom } from './backup/service.ts'
import { storeFromEnv } from './backup/store.ts'
import { dbFromEnv } from './db.ts'

const webDist = process.env.WEB_ROOT ?? fileURLToPath(new URL('../../web/dist', import.meta.url))
const auth = authFromEnv()
const backupStore = storeFromEnv()
const commit = process.env.RAILWAY_GIT_COMMIT_SHA?.slice(0, 12)
const db = await dbFromEnv()

// Putting the data back after a disaster (ADR 0004): deploy against a new,
// empty database with RESTORE_FROM set. Ignored once the database has tables.
const restored = process.env.RESTORE_FROM ? await restoreFrom(db, backupStore, process.env.RESTORE_FROM.trim()) : undefined

const app = await buildApp({ db, logger: true, webRoot: existsSync(webDist) ? webDist : undefined, auth, backupStore, commit })
await assertSignInKept(db, auth)
const port = Number(process.env.PORT ?? 3030)
await app.listen({ port, host: process.env.HOST ?? '0.0.0.0' })
app.log.info({ db: db.kind }, db.kind === 'memory' ? 'Database: in memory (nothing is kept after a restart)' : `Database: ${db.kind}`)
if (auth) app.log.info({ domains: auth.domains, emails: auth.emails.length }, 'Sign-in: Google, staff only')
else app.log.warn('Sign-in is off: anyone who can reach the app can use it. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET to switch it on.')
if (restored) app.log.warn({ from: restored.key, rows: restored.report.rows, madeAt: restored.report.header.createdAt }, 'Restored the database from a backup. Remove RESTORE_FROM now.')
else if (process.env.RESTORE_FROM) app.log.info('RESTORE_FROM is set but the database already has data, so nothing was restored. It can be removed.')
if (backupStore) {
  app.backups.start()
  app.log.info({ where: backupStore.where, next: app.backups.status().next }, 'Backups: nightly, each checked by a test restore')
} else app.log.warn('Backups are off: set the BACKUP_S3_ settings to switch them on (docs/backups.md).')

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, async () => {
    await app.close()
    await db.close()
    process.exit(0)
  })
}
