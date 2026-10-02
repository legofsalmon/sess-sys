import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { buildApp } from './app.ts'
import { assertSignInKept, authFromEnv, googleClientFromEnv } from './auth/config.ts'
import { backupKeyFromEnv } from './backup/crypto.ts'
import { restoreFrom } from './backup/service.ts'
import { storeFromEnv } from './backup/store.ts'
import { dbFromEnv } from './db.ts'
import { eraseAgainFromStore } from './erasure/list.ts'
import { backupWatch, errorReportingFromEnv, flushReports, reportError, startErrorReporting } from './monitoring.ts'

// Error reporting first, so a start-up that goes wrong is reported too (ADR 0005).
const errorReporting = errorReportingFromEnv()
if (errorReporting) startErrorReporting(errorReporting)

try {
  await main()
} catch (err) {
  reportError(err, { area: 'start-up' })
  await flushReports()
  console.error(err)
  process.exit(1)
}

async function main() {
  const webDist = process.env.WEB_ROOT ?? fileURLToPath(new URL('../../web/dist', import.meta.url))
  const auth = authFromEnv()
  const google = googleClientFromEnv()
  const backupStore = storeFromEnv()
  const backupKey = backupKeyFromEnv()
  const commit = process.env.RAILWAY_GIT_COMMIT_SHA?.slice(0, 12)
  const db = await dbFromEnv()

  // Putting the data back after a disaster (ADR 0004): deploy against a new,
  // empty database with RESTORE_FROM set. Ignored once the database has tables.
  const restored = process.env.RESTORE_FROM ? await restoreFrom(db, backupStore, process.env.RESTORE_FROM.trim(), backupKey) : undefined

  const app = await buildApp({
    db,
    logger: true,
    webRoot: existsSync(webDist) ? webDist : undefined,
    auth,
    backupStore,
    backupKey,
    commit,
    errorReporting,
    backupWatch: errorReporting ? backupWatch() : undefined,
    calendar: google ? { ...google, appUrl: process.env.PUBLIC_URL?.replace(/\/$/, '') } : undefined,
  })
  await assertSignInKept(db, auth)
  if (backupStore) {
    // Before anyone can use it: someone erased on request whom this copy has back (a wind-back with Neon's own
    // history, or a restore that stopped part way) is erased again, and the list beside the backups kept up to date (ADR 0027).
    try {
      const again = await eraseAgainFromStore(db, backupStore, { everyone: false })
      if (again) app.log.warn({ erasedAgain: again }, 'People erased on request were back in this copy of the data, so they were erased again')
    } catch (err) {
      app.log.warn({ err }, 'Could not check the list of erasures beside the backups')
    }
    await app.erasures?.keep()
  }
  const port = Number(process.env.PORT ?? 3030)
  await app.listen({ port, host: process.env.HOST ?? '0.0.0.0' })
  app.log.info({ db: db.kind }, db.kind === 'memory' ? 'Database: in memory (nothing is kept after a restart)' : `Database: ${db.kind}`)
  if (auth) app.log.info({ domains: auth.domains, emails: auth.emails.length }, 'Sign-in: Google, staff only')
  else app.log.warn('Sign-in is off: anyone who can reach the app can use it. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET to switch it on.')
  if (restored)
    app.log.warn(
      { from: restored.key, rows: restored.report.rows, madeAt: restored.report.header.createdAt, erasedAgain: restored.erasedAgain },
      'Restored the database from a backup. Remove RESTORE_FROM now.'
    )
  else if (process.env.RESTORE_FROM) app.log.info('RESTORE_FROM is set but the database already has data, so nothing was restored. It can be removed.')
  if (backupStore) {
    app.backups.start()
    app.log.info({ where: backupStore.where, next: app.backups.status().next, encrypted: !!backupKey }, 'Backups: nightly, each checked by a test restore')
    if (!backupKey) app.log.warn('Backups are not encrypted: each file holds every private link in plain text. Set BACKUP_KEY to encrypt them (docs/backups.md).')
  } else {
    app.log.warn('Backups are off: set the BACKUP_S3_ settings to switch them on (docs/backups.md).')
    // Said plainly, since a wind-back with Neon's own history to before an erasure would bring that person back (ADR 0027).
    app.log.warn('The list of people erased on request is kept only in the database, in its erasures table, until backups are on.')
  }
  if (errorReporting) app.log.info({ environment: errorReporting.environment }, 'Errors: reported to Sentry, with no personal details')
  else app.log.warn('Error reporting is off: set SENTRY_DSN to switch it on (docs/monitoring.md).')
  if (app.calendar) {
    await app.calendar.start()
    app.log.info('Google Calendar: available; connect a calendar on the Account tab')
  } else app.log.info('Google Calendar: needs GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET, like sign-in.')

  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.on(signal, async () => {
      await app.close()
      await db.close()
      await flushReports()
      process.exit(0)
    })
  }
}
