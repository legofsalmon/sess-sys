import { GoogleError } from './google.ts'

/**
 * What stops or delays the calendar sync (ADR 0008): when it tries again,
 * and the problems Admin shows, in words.
 */

/** After Google was busy: a minute, five, a quarter of an hour, then hourly. */
export const RETRY_MS = [60_000, 5 * 60_000, 15 * 60_000, 60 * 60_000]
/** After a run failed on something unexpected (the database, say): a minute, five, then twenty-five; after that, the next change. */
export const FAULT_RETRY_MS = [60_000, 5 * 60_000, 25 * 60_000]

export const problems = {
  revoked: (account: string | null) =>
    `Google no longer accepts the app's access to ${account ?? 'the account'}'s calendars, so the calendar isn't being updated. Connect again to carry on.`,
  locked: "The app's Google key has changed since the calendar was connected, so its saved access can't be used. Connect again to carry on.",
  apiOff:
    "The Google Calendar API is switched off in the app's Google Cloud project, so nothing can be written. Switch it on (see the setup steps), then press Check the calendar.",
  noAccess: (calendar: string, account: string | null) =>
    `${account ?? 'The connected account'} can't change ${calendar} any more: it may have been deleted, or its sharing changed. Choose another calendar, or give that account permission to change it again.`,
  writesOff:
    "Writing to Google Calendar is switched off on the server, so the app puts nothing on the calendar and invites nobody. Bringing jobs in from Google still works. To switch writing on, set CALENDAR_WRITES to on in Railway.",
  busy: (at: Date) =>
    `Google Calendar isn't answering, so some days are still on their way. Trying again at ${at.toLocaleTimeString('en-IE', { timeZone: 'Europe/Dublin', hour: '2-digit', minute: '2-digit' })}.`,
  badClient:
    "Google doesn't accept the app's own Google key (its client id and secret), so nothing can be written. Check GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in Railway, then press Check the calendar.",
  refused: (reason: string) => `Google turned this day down${reason ? ` (${reason})` : ''}. It is tried again when the job changes, and each night.`,
  leftBehind: (n: number, calendar: string) =>
    `${n === 1 ? '1 day was' : `${n} days were`} left on ${calendar}, because Google no longer accepts the app's access. Delete ${n === 1 ? 'it' : 'them'} in Google Calendar if ${n === 1 ? "it isn't" : "they aren't"} wanted.`,
  /** An answer in Google the offer couldn't take, with the reason the link would have given. */
  notTaken: (answer: 'accept' | 'decline', reason: string) =>
    `Said ${answer === 'accept' ? 'yes' : 'no'} on Google Calendar, but the app couldn't take it: ${reason.replace(/^Sorry, (\w)/, (_, c: string) => c.toUpperCase())}`,
}

/** The Calendar API is switched off in the app's Google Cloud project. */
export const apiOff = (err: GoogleError) => err.reason === 'accessNotConfigured' || err.reason === 'SERVICE_DISABLED'

/** Stops a run, or a request from Admin: the calendar or the account needs a person, or Google needs time. */
export class Halt extends Error {
  constructor(
    readonly why: 'revoked' | 'blocked' | 'busy',
    readonly problem: string | null
  ) {
    super(why)
  }
}
