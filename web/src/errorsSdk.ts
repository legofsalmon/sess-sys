import {
  browserApiErrorsIntegration,
  dedupeIntegration,
  eventFiltersIntegration,
  globalHandlersIntegration,
  init,
  linkedErrorsIntegration,
  makeBrowserOfflineTransport,
  makeFetchTransport,
  type BrowserOptions,
  type ErrorEvent,
} from '@sentry/browser'
import { redact, type ClientConfig } from '@sh/shared'

/**
 * Sentry in the app, loaded only when error reporting is on (see errors.ts).
 * A report holds the error, where in the code it happened, which screen
 * (without anything after the address's path) and what kind of device.
 * Nothing about the person, what they typed or what the app was showing.
 */

declare const __APP_VERSION__: string

export function start({ dsn, environment }: NonNullable<ClientConfig['errors']>) {
  init({
    dsn,
    environment,
    release: __APP_VERSION__,
    // Only the integrations that catch errors: no breadcrumbs of clicks, typing or requests.
    defaultIntegrations: false,
    integrations: [
      globalHandlersIntegration(),
      browserApiErrorsIntegration(),
      linkedErrorsIntegration(),
      dedupeIntegration(),
      // Only the app's own errors, not those of browser extensions or other sites' scripts.
      eventFiltersIntegration({ allowUrls: [location.origin] }),
    ],
    // Reports made with no signal wait on the device, and go when it's back online.
    transport: makeBrowserOfflineTransport(makeFetchTransport),
    transportOptions: { flushAtStartup: true } as BrowserOptions['transportOptions'],
    dataCollection: NOTHING,
    maxBreadcrumbs: 0,
    beforeSend: scrub,
  })
}

const NOTHING: BrowserOptions['dataCollection'] = {
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

function scrub(event: ErrorEvent): ErrorEvent {
  event.request = { url: redact(location.origin + location.pathname), headers: { 'User-Agent': navigator.userAgent } }
  delete event.user
  delete event.breadcrumbs
  delete event.extra
  if (event.message) event.message = redact(event.message)
  if (event.logentry) event.logentry = { message: event.logentry.message && redact(event.logentry.message) }
  if (event.transaction) event.transaction = redact(event.transaction)
  for (const ex of event.exception?.values ?? []) {
    if (ex.value) ex.value = redact(ex.value)
    for (const frame of ex.stacktrace?.frames ?? []) {
      delete frame.vars
      if (frame.filename) frame.filename = redact(frame.filename.replace(/[?#].*$/, ''))
    }
  }
  return event
}
