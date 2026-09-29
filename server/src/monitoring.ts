import * as Sentry from '@sentry/node'
import type { BackupRun } from '@sh/shared'
import { redact } from '@sh/shared'
import type { BackupWatch } from './backup/service.ts'

/**
 * Error alerts (ADR 0005). With SENTRY_DSN set, the server reports its own
 * faults to Sentry, which emails whoever looks after the app: a request
 * that failed on the server, a crash, a start-up that went wrong, and a
 * nightly backup that failed or never ran.
 *
 * A report carries only what it takes to fix the fault: the error, where in
 * the code it happened, which route (as the code names it, never the
 * address used, which could hold a freelancer's private link) and which
 * version of the app. Never a request's body, headers, cookies or query,
 * nor who was using the app. That is by construction: the SDK's own
 * collectors, which gather all of those by default, are never switched on.
 */

export interface ErrorReporting {
  dsn: string
  /** Kept apart in Sentry, so a trial copy's errors don't mix with the real app's. */
  environment: string
  /** Which code is running. */
  release?: string
}

/** Error reporting as the environment sets it up, or undefined when SENTRY_DSN isn't set. */
export function errorReportingFromEnv(env: NodeJS.ProcessEnv = process.env): ErrorReporting | undefined {
  const dsn = env.SENTRY_DSN?.trim()
  if (!dsn) return undefined
  if (!/^https?:\/\/[^@/\s]+@[^/\s]+\/.*\d$/.test(dsn)) {
    // Not repeated back: whatever was pasted in by mistake could be a secret.
    throw new Error('SENTRY_DSN should be the DSN Sentry shows for the project, like https://abc123@o123.ingest.de.sentry.io/456.')
  }
  return {
    dsn,
    environment: env.SENTRY_ENVIRONMENT?.trim() || 'production',
    release: env.RAILWAY_GIT_COMMIT_SHA?.slice(0, 12),
  }
}

/** Switch reporting on for this process. Call once, as early as possible. */
export function startErrorReporting({ dsn, environment, release }: ErrorReporting) {
  Sentry.init({
    dsn,
    environment,
    release,
    // Only the integrations that report errors; none that gather requests,
    // variables or anything else about the people using the app.
    defaultIntegrations: false,
    integrations: [
      Sentry.onUncaughtExceptionIntegration(),
      // A promise nobody handled still stops the server, as it did before reporting
      // was added, so Railway restarts it rather than it carrying on half-broken.
      Sentry.onUnhandledRejectionIntegration({ mode: 'strict' }),
      Sentry.linkedErrorsIntegration(),
      Sentry.dedupeIntegration(),
      Sentry.functionToStringIntegration(),
      Sentry.eventFiltersIntegration(),
      Sentry.nodeContextIntegration(),
      Sentry.contextLinesIntegration(),
    ],
    // Belt and braces, should an integration that collects ever be added.
    dataCollection: NOTHING,
    maxBreadcrumbs: 0,
    beforeSend: scrub,
  })
}

const NOTHING: Sentry.NodeOptions['dataCollection'] = {
  userInfo: false,
  cookies: false,
  httpHeaders: false,
  httpBodies: [],
  urlQueryParams: false,
  graphQL: { document: false, variables: false },
  genAI: { inputs: false, outputs: false },
  databaseQueryData: false,
  queues: false,
  stackFrameVariables: false,
}

/** The last step before a report leaves: drop anything about people, and redact text. */
export function scrub<E extends Sentry.ErrorEvent>(event: E): E {
  delete event.request
  delete event.user
  delete event.breadcrumbs
  delete event.extra
  if (event.message) event.message = redact(event.message)
  if (event.logentry) event.logentry = { message: event.logentry.message && redact(event.logentry.message) }
  if (event.transaction) event.transaction = redact(event.transaction)
  for (const ex of event.exception?.values ?? []) {
    if (ex.value) ex.value = redact(ex.value)
    for (const frame of ex.stacktrace?.frames ?? []) delete frame.vars
  }
  return event
}

/** Report an error, with a few tags saying where it came from. Does nothing while reporting is off. */
export function reportError(err: unknown, tags: Record<string, string | undefined> = {}) {
  if (!Sentry.getClient()) return
  Sentry.withScope((scope) => {
    for (const [k, v] of Object.entries(tags)) if (v !== undefined) scope.setTag(k, v)
    Sentry.captureException(err)
  })
}

/** Send what's waiting, before the process exits. */
export async function flushReports(timeoutMs = 2000) {
  if (Sentry.getClient()) await Sentry.flush(timeoutMs)
}

/** The Sentry monitor watching the nightly backup, set up by the first check-in. */
export const BACKUP_MONITOR = 'nightly-backup'

/**
 * The nightly backup, watched from Sentry. Each scheduled run checks in as
 * it starts and again with how it went, and Sentry raises an alert when a
 * run fails or no run arrives around 02:00 (the server was down, say). A
 * failed run is also reported as an error, with its reason. "Back up now"
 * doesn't check in, being outside the schedule, but its failures are
 * reported too.
 */
export function backupWatch(hourUtc = 2): BackupWatch {
  const monitor: MonitorConfig = {
    schedule: { type: 'crontab', value: `0 ${hourUtc} * * *` },
    timezone: 'Etc/UTC',
    // Late by more than this, and the run counts as missed.
    checkinMargin: 60,
    // Still running after this long, and it counts as failed.
    maxRuntime: 30,
    failureIssueThreshold: 1,
    recoveryThreshold: 1,
  }
  return {
    started(trigger) {
      if (trigger === 'manual' || !Sentry.getClient()) return undefined
      return Sentry.captureCheckIn({ monitorSlug: BACKUP_MONITOR, status: 'in_progress' }, monitor)
    },
    finished(checkInId, run: BackupRun) {
      if (typeof checkInId === 'string') {
        Sentry.captureCheckIn({ checkInId, monitorSlug: BACKUP_MONITOR, status: run.status === 'ok' ? 'ok' : 'error' }, monitor)
      }
      if (run.status === 'failed') reportError(new BackupFailed(run.error ?? 'no reason given'), { area: 'backups', trigger: run.trigger })
    },
    couldNotStart(err) {
      reportError(err, { area: 'backups' })
    },
  }
}

type MonitorConfig = NonNullable<Parameters<typeof Sentry.captureCheckIn>[1]>

class BackupFailed extends Error {
  override name = 'BackupFailed'
}
