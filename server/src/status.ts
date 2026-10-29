import { APP_VERSION, compareVersions, plural, versionInChangelog, type StatusCheck, type SystemStatus } from '@sh/shared'
import type { FastifyInstance } from 'fastify'
import type { AuthConfig } from './auth/config.ts'
import { PREFIX as BACKUPS, type Backups } from './backup/service.ts'
import type { BackupStore } from './backup/store.ts'
import { readLink } from './calendar/store.ts'
import { Halt, type CalendarSync } from './calendar/sync.ts'
import type { Db } from './db.ts'
import type { DocumentFiles } from './documents/files.ts'
import type { FuelLookup } from './finance/fuel.ts'
import { getQuoteSettings } from './finance/store.ts'
import type { RmsReader } from './rms/reader.ts'
import type { Assistant } from './assistant/routes.ts'

/**
 * Admin › Status (ADR 0093): everything the app relies on, looked at together, each in words with what to do when it
 * needs someone. Most is what the server already knows (the backups' last run, the calendar's connection); the rest
 * asks the service itself, read only, the way the app uses it: Google for the connected account's calendars, Current
 * RMS for one opportunity, the AA's survey page, the map search's own status page, and GitHub for the newest version
 * on main. Nothing is written anywhere, nobody is contacted, and the answer is kept for a minute, so opening the page
 * twice asks nothing twice.
 */

/** A minute: long enough that a page opened twice asks nothing twice, short enough to be what's true now. */
const KEEP_MS = 60_000
/** The longest one look outside waits before it counts as not answering. */
const LOOK_MS = 10_000
/** A database answering slower than this to the simplest question is a database to look at. */
const SLOW_DB_MS = 1_000
/** A freelancer's calendar not read for this long has stopped being read (they're read every few hours). */
const OWN_CALENDAR_STALE_MS = 2 * 24 * 60 * 60 * 1000
/** How long after a merge Railway usually has it live; past this, a newer version on main is worth a look. */
const DEPLOY_MS = 15 * 60_000

/** The looks outside the server, which tests stand in for. Each throws, in words, when the service doesn't answer. */
export interface OutsideLooks {
  /** The map search (Nominatim) answers. */
  maps?: () => Promise<void>
  /** The newest version merged into main, from the changelog on GitHub. */
  latest?: () => Promise<string>
}

/** The real ones: the map search's own status page, and the changelog on GitHub's main. */
export function outsideLooks({ mapsBase, latestUrl, fetch: get = fetch }: { mapsBase?: string; latestUrl?: string; fetch?: typeof fetch } = {}): OutsideLooks {
  const headers = { 'user-agent': 'SessionHire/1.0 (+https://github.com/legofsalmon/sess-sys)' }
  return {
    maps: async () => {
      const res = await get(new URL('/status', mapsBase ?? 'https://nominatim.openstreetmap.org'), { headers, signal: AbortSignal.timeout(LOOK_MS) })
      if (!res.ok) throw new Error(`The map search answered ${res.status}.`)
    },
    latest: async () => {
      const res = await get(latestUrl ?? LATEST_URL, { headers, signal: AbortSignal.timeout(LOOK_MS) })
      if (!res.ok) throw new Error(`GitHub answered ${res.status}.`)
      const version = versionInChangelog(await res.text())
      if (!version) throw new Error("GitHub's copy of the changelog didn't read as one.")
      return version
    },
  }
}

export const LATEST_URL = 'https://raw.githubusercontent.com/legofsalmon/sess-sys/main/shared/src/changelog.ts'

export interface StatusSources {
  db: Db
  auth?: AuthConfig
  passcode?: string
  errorReporting: boolean
  backups: Backups
  backupStore?: BackupStore
  documents: DocumentFiles
  calendar?: CalendarSync
  rms: RmsReader
  /** Claude inside the app (ADR 0096); a test without it has no Claude check. */
  assistant?: Assistant
  fuel: FuelLookup
  outside: OutsideLooks
  commit?: string
  /** How many devices hold the live connection now. */
  live: () => number
  now?: () => Date
}

const started = new Date()

/** Waits at most LOOK_MS for a look, and answers how long it took. */
async function timed<T>(look: () => Promise<T>): Promise<{ value: T; ms: number }> {
  const t = performance.now()
  let timer: NodeJS.Timeout | undefined
  const value = await Promise.race([
    look(),
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`No answer in ${LOOK_MS / 1000} seconds.`)), LOOK_MS)
    }),
  ]).finally(() => clearTimeout(timer))
  return { value, ms: Math.round(performance.now() - t) }
}

const why = (err: unknown) => (err instanceof Error && err.message ? err.message : 'no reason given')
const mb = (bytes: number) => (bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(bytes < 100 * 1024 * 1024 ? 1 : 0)} MB`)
const iso = (v: Date | string | null | undefined) => (v ? new Date(v).toISOString() : null)

export class Status {
  private kept: { at: number; status: SystemStatus } | undefined
  private looking: Promise<SystemStatus> | undefined
  private readonly now: () => Date

  constructor(private readonly s: StatusSources) {
    this.now = s.now ?? (() => new Date())
  }

  /** Every check, from the last minute unless `again`; looks asked for at once share one. */
  read(again = false): Promise<SystemStatus> {
    if (!again && this.kept && this.now().getTime() - this.kept.at < KEEP_MS) return Promise.resolve(this.kept.status)
    this.looking ??= this.look().finally(() => (this.looking = undefined))
    return this.looking
  }

  private async look(): Promise<SystemStatus> {
    const looks: Promise<StatusCheck>[] = [
      this.server(),
      this.updates(),
      this.database(),
      this.signIn(),
      this.errors(),
      this.liveConnections(),
      this.backups(),
      this.storage(),
      this.calendar(),
      this.ownCalendars(),
      this.currentRms(),
      this.claude(),
      this.fuel(),
      this.maps(),
    ].map((p, i) => p.catch((err): StatusCheck => ({ id: `check-${i}`, group: 'app', name: 'A check', state: 'bad', says: `This check went wrong itself: ${why(err)}` })))
    const status: SystemStatus = { checkedAt: this.now().toISOString(), version: APP_VERSION, commit: this.s.commit ?? null, upSince: started.toISOString(), checks: await Promise.all(looks) }
    this.kept = { at: this.now().getTime(), status }
    return status
  }

  private async server(): Promise<StatusCheck> {
    const memory = process.memoryUsage().rss
    return {
      id: 'server',
      group: 'app',
      name: 'The server',
      state: 'ok',
      says: `Running version ${APP_VERSION}${this.s.commit ? ` (code ${this.s.commit.slice(0, 7)})` : ''}, using ${mb(memory)} of memory.`,
      at: started.toISOString(),
    }
  }

  /** Whether main has a newer version than this server runs: Railway skipped or is still deploying a merge. */
  private async updates(): Promise<StatusCheck> {
    const base = { id: 'updates', group: 'app' as const, name: 'Updates' }
    if (!this.s.outside.latest) return { ...base, state: 'off', says: 'This copy of the app doesn’t look for newer versions.' }
    try {
      const { value: latest, ms } = await timed(this.s.outside.latest)
      if (compareVersions(latest, APP_VERSION) <= 0) return { ...base, state: 'ok', says: `Up to date: ${APP_VERSION} is the newest version.`, ms }
      return {
        ...base,
        state: 'warn',
        says: `Version ${latest} has been merged, but this server still runs ${APP_VERSION}.`,
        todo: `Railway usually has a merge live within ${DEPLOY_MS / 60_000} minutes. If it's been longer, open the shserver service in Railway and choose Deploy Latest Commit.`,
        ms,
      }
    } catch (err) {
      return { ...base, state: 'off', says: `Couldn't ask GitHub for the newest version just now (${why(err)}). The app itself is unaffected.` }
    }
  }

  private async database(): Promise<StatusCheck> {
    const { db } = this.s
    const base = { id: 'database', group: 'app' as const, name: 'Database' }
    try {
      const { ms } = await timed(() => db.reads.query('SELECT 1'))
      const size = await db.reads
        .query<{ bytes: string }>('SELECT pg_database_size(current_database()) AS bytes')
        .then(({ rows }) => Number(rows[0]?.bytes ?? 0))
        .catch(() => 0)
      const holds = size ? `, holding ${mb(size)}` : ''
      if (db.kind === 'memory')
        return { ...base, state: 'bad', says: `Kept in memory only${holds}: everything goes when the server restarts.`, todo: 'Set DATABASE_URL in Railway to the Neon database.', ms }
      if (db.kind === 'file') return { ...base, state: 'warn', says: `Kept in a folder on the server${holds}, not in Neon.`, todo: 'For the live app, set DATABASE_URL in Railway to the Neon database.', ms }
      if (ms > SLOW_DB_MS)
        return { ...base, state: 'warn', says: `Answering, but slowly: ${(ms / 1000).toFixed(1)} seconds for the simplest question${holds}.`, todo: 'If it stays slow, look at the database in Vercel › Storage (Neon). It can be slow for a moment as it wakes up.', ms }
      return { ...base, state: 'ok', says: `Neon is answering${holds}.`, ms }
    } catch (err) {
      return { ...base, state: 'bad', says: `The database isn't answering: ${why(err)}`, todo: 'Look at the database in Vercel › Storage (Neon), and at the shserver logs in Railway.' }
    }
  }

  private async signIn(): Promise<StatusCheck> {
    const base = { id: 'sign-in', group: 'app' as const, name: 'Sign-in' }
    const { auth, passcode } = this.s
    if (auth) {
      const who = [...auth.domains.map((d) => `anyone at ${d}`), ...(auth.emails.length ? [plural(auth.emails.length, 'other address', 'other addresses')] : [])]
      return { ...base, state: 'ok', says: `With Google, for ${who.join(' and ') || 'nobody yet'}.` }
    }
    if (passcode) return { ...base, state: 'warn', says: 'A shared passcode, as for a demo copy, so anyone with it can get in.', todo: 'For real data, set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in Railway.' }
    return { ...base, state: 'bad', says: 'Off: anyone with the address can use the app.', todo: 'Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in Railway (docs/sign-in-setup.md).' }
  }

  private async errors(): Promise<StatusCheck> {
    const base = { id: 'errors', group: 'app' as const, name: 'Error reports' }
    if (this.s.errorReporting) return { ...base, state: 'ok', says: 'Anything that goes wrong is reported to Sentry, without anyone’s personal details, and Sentry emails about it.' }
    return { ...base, state: 'warn', says: 'Off: nobody is told when something goes wrong on the server or a phone.', todo: 'Set SENTRY_DSN in Railway (docs/monitoring.md).' }
  }

  private async liveConnections(): Promise<StatusCheck> {
    const n = this.s.live()
    return {
      id: 'live',
      group: 'app',
      name: 'Live updates',
      state: 'ok',
      says: n === 0 ? 'No device is open on the app just now. Each one that opens it is told of changes as they’re made.' : `${plural(n, 'device is', 'devices are')} open on the app now, each told of changes as they’re made.`,
    }
  }

  private async backups(): Promise<StatusCheck> {
    const base = { id: 'backups', group: 'safe' as const, name: 'Nightly backups' }
    const b = this.s.backups.status()
    if (!b.configured) return { ...base, state: 'bad', says: 'Off: nothing is being backed up.', todo: 'Set the BACKUP_S3_ settings in Railway (docs/backups.md).' }
    const at = b.lastOk?.finishedAt ?? null
    const failed = b.last?.status === 'failed' ? b.last : undefined
    const encrypted = b.encrypted ? '' : ' The files aren’t encrypted.'
    if (!at) return { ...base, state: 'warn', says: `None made yet.${encrypted}`, todo: 'Press Back up now under Admin › Data to make the first.', at }
    if (!b.fresh)
      return {
        ...base,
        state: 'bad',
        says: `The last good backup is more than a day old, so the nightly backup has stopped working.${failed ? ` The last try said: ${failed.error ?? 'no reason given'}` : ''}`,
        todo: 'Press Back up now under Admin › Data, and if it fails, look at the shserver logs in Railway.',
        at,
      }
    if (failed) return { ...base, state: 'warn', says: `The last try failed (${failed.error ?? 'no reason given'}), though a good one was made within the day.`, todo: 'Press Back up now under Admin › Data to try again.', at }
    if (!b.encrypted) return { ...base, state: 'warn', says: 'Made every night and checked by a test restore, but the files aren’t encrypted.', todo: 'Set BACKUP_KEY in Railway (docs/backups.md).', at }
    return { ...base, state: 'ok', says: 'Made every night, encrypted, and each checked by a test restore.', at }
  }

  /** The bucket backups and documents' files go in, asked for its list of backups. */
  private async storage(): Promise<StatusCheck> {
    const base = { id: 'storage', group: 'safe' as const, name: 'Storage for backups and files' }
    const store = this.s.backupStore
    if (!store) {
      if (this.s.documents.on) return { ...base, state: 'warn', says: 'Documents’ files are kept in a folder on the server, not in a bucket.', todo: 'Set the BACKUP_S3_ settings in Railway (docs/backups.md).' }
      return { ...base, state: 'bad', says: 'No storage is set up, so there are no backups and documents can’t keep files.', todo: 'Set the BACKUP_S3_ settings in Railway (docs/backups.md).' }
    }
    try {
      const { value: files, ms } = await timed(() => store.list(BACKUPS))
      const bytes = files.reduce((n, f) => n + f.bytes, 0)
      return { ...base, state: 'ok', says: `The bucket answers, holding ${plural(files.length, 'backup')} (${mb(bytes)}) and documents’ files.`, ms }
    } catch (err) {
      return { ...base, state: 'bad', says: `The bucket isn't answering: ${why(err)}`, todo: 'Look at the bucket in Railway, and that the BACKUP_S3_ settings still match it.' }
    }
  }

  private async calendar(): Promise<StatusCheck> {
    const base = { id: 'calendar', group: 'outside' as const, name: 'Google Calendar' }
    const sync = this.s.calendar
    if (!sync) return { ...base, state: 'off', says: 'Needs the app’s Google key, as sign-in does.', todo: 'Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in Railway.' }
    const link = await readLink(this.s.db.reads)
    if (!link || link.state === 'off') return { ...base, state: 'off', says: 'No Google account is connected.', todo: 'Connect one under Admin › Connections.' }
    if (link.state === 'reconnect') return { ...base, state: 'bad', says: link.problem ?? 'Google no longer accepts the app’s access.', todo: 'Connect again under Admin › Connections.' }
    const writing = sync.writes ? `writing jobs to ${link.calendarName ?? 'the chosen calendar'}` : 'reading only: nothing is written to Google and nobody is invited'
    try {
      const { value: calendars, ms } = await timed(() => sync.calendars())
      if (link.problem) return { ...base, state: 'warn', says: `Google answers for ${link.accountEmail ?? 'the connected account'}, but: ${link.problem}`, todo: 'Admin › Connections has the way to put it right.', ms }
      return { ...base, state: 'ok', says: `Google answers for ${link.accountEmail ?? 'the connected account'} (${plural(calendars.length, 'calendar')} it can change), ${writing}.`, ms }
    } catch (err) {
      if (err instanceof Halt && err.why === 'revoked') return { ...base, state: 'bad', says: err.problem ?? 'Google no longer accepts the app’s access.', todo: 'Connect again under Admin › Connections.' }
      return { ...base, state: 'bad', says: `Google isn't answering for the connected account: ${err instanceof Halt ? (err.problem ?? err.why) : why(err)}`, todo: 'Try again in a few minutes. If it keeps failing, press Check the calendar under Admin › Connections.' }
    }
  }

  /** Freelancers' own calendars, read every few hours (ADR 0044): how many could be read last time. */
  private async ownCalendars(): Promise<StatusCheck> {
    const base = { id: 'own-calendars', group: 'outside' as const, name: 'Crew’s own calendars' }
    const { rows } = await this.s.db.reads.query<{ n: string; problems: string; stale: string; last: Date | string | null }>(
      `SELECT count(*) AS n, count(*) FILTER (WHERE problem IS NOT NULL) AS problems,
              count(*) FILTER (WHERE read_at IS NULL OR read_at < $1) AS stale, max(read_at) AS last
         FROM own_calendars`,
      [new Date(this.now().getTime() - OWN_CALENDAR_STALE_MS)]
    )
    const n = Number(rows[0]?.n ?? 0)
    const problems = Number(rows[0]?.problems ?? 0)
    const stale = Number(rows[0]?.stale ?? 0)
    const at = iso(rows[0]?.last)
    if (n === 0) return { ...base, state: 'off', says: 'Nobody has shared their own calendar yet.' }
    if (problems) return { ...base, state: 'warn', says: `${problems} of ${n} couldn’t be read last time.`, todo: 'Each one’s person page says why; usually the address has changed.', at }
    if (stale) return { ...base, state: 'warn', says: `${stale} of ${n} haven’t been read for over two days.`, todo: 'Open their person page and press Read it now.', at }
    return { ...base, state: 'ok', says: `All ${n} read in the last two days.`, at }
  }

  private async currentRms(): Promise<StatusCheck> {
    const base = { id: 'current-rms', group: 'outside' as const, name: 'Current RMS' }
    const { rms } = this.s
    if (!rms.configured) return { ...base, state: 'off', says: 'Not set up.', todo: 'Set CURRENT_RMS_API_KEY in Railway.' }
    const last = (await rms.status()).last
    const at = last?.finishedAt ?? null
    try {
      const { value: total, ms } = await timed(() => rms.check())
      if (last?.error) return { ...base, state: 'warn', says: `Answers, but the last read stopped: ${last.error}`, todo: 'Read it again under Admin › Connections.', at, ms }
      return { ...base, state: 'ok', says: `Answers, read only, holding ${plural(total, 'opportunity', 'opportunities')}.`, at, ms }
    } catch (err) {
      return { ...base, state: 'bad', says: `Current RMS isn't answering: ${why(err)}`, todo: 'Check CURRENT_RMS_API_KEY in Railway is still the key in Current RMS’s System Setup › Integrations.', at }
    }
  }

  /** Claude (ADR 0096) isn't asked anything here, since each ask costs: only whether it's set up, on, and what it's spent. */
  private async claude(): Promise<StatusCheck> {
    const base = { id: 'claude', group: 'outside' as const, name: 'Claude' }
    const a = this.s.assistant
    if (!a?.config) return { ...base, state: 'off', says: 'Not set up.', todo: 'Set ANTHROPIC_API_KEY in Railway to offer Claude on the quote screens.' }
    const s = await a.status()
    const spent = `$${(s.spentCents / 100).toFixed(2)} of $${(s.limitCents / 100).toFixed(2)} this month, asked ${plural(s.uses, 'time')}`
    if (!s.on) return { ...base, state: 'off', says: `Set up, and turned off. ${spent}.`, todo: 'Turn it on under Admin › Company to offer it.' }
    if (s.spentCents >= s.limitCents) return { ...base, state: 'warn', says: `This month’s limit is used: ${spent}.`, todo: 'It starts again on the 1st, or raise CLAUDE_MONTHLY_LIMIT_USD in Railway.' }
    return { ...base, state: 'ok', says: `On, using ${s.model}: ${spent}.` }
  }

  private async fuel(): Promise<StatusCheck> {
    const base = { id: 'fuel', group: 'outside' as const, name: 'AA fuel price' }
    const settings = await getQuoteSettings(this.s.db.reads)
    const ours = settings?.fuelCentsPerLitre != null ? `${settings.fuelCentsPerLitre}c a litre${settings.fuelMonth ? `, from the AA’s ${settings.fuelMonth} survey` : ', typed in'}` : 'none set yet'
    if (settings?.fuelAuto === false) return { ...base, state: 'off', says: `Taken by hand: the switch to take each month’s is off. The price now is ${ours}.` }
    try {
      const { value: found, ms } = await timed(this.s.fuel)
      if (settings?.fuelMonth && settings.fuelMonth !== found.month)
        return { ...base, state: 'warn', says: `The AA’s ${found.month} survey (${found.centsPerLitre}c) hasn’t been taken; the price now is ${ours}.`, todo: 'It’s tried each day. A price far from the last waits for someone: set it under Admin › Company › Travel.', ms }
      return { ...base, state: 'ok', says: `The AA’s survey reads. The price now is ${ours}.`, ms }
    } catch (err) {
      return { ...base, state: 'warn', says: `The AA’s page can’t be read just now (${why(err)}). The price now is ${ours}, and quotes still use it.`, todo: 'If it stays this way into a new month, type the price in under Admin › Company › Travel.' }
    }
  }

  private async maps(): Promise<StatusCheck> {
    const base = { id: 'maps', group: 'outside' as const, name: 'Map search' }
    if (!this.s.outside.maps) return { ...base, state: 'off', says: 'This copy of the app doesn’t look.' }
    try {
      const { ms } = await timed(this.s.outside.maps)
      return { ...base, state: 'ok', says: 'OpenStreetMap’s search answers, for finding venues on the map.', ms }
    } catch (err) {
      return { ...base, state: 'warn', says: `OpenStreetMap’s search isn’t answering (${why(err)}). Venues already pinned still show; finding new ones waits.`, todo: 'Nothing to do: it’s theirs, and usually back within the hour.' }
    }
  }
}

export function registerStatusRoutes(app: FastifyInstance, status: Status) {
  // What the app relies on, for those who look after the company's settings (ADR 0093).
  app.get<{ Querystring: { again?: string } }>('/api/status', { config: { needs: 'settings' } }, async (req, reply): Promise<SystemStatus> => {
    reply.header('cache-control', 'no-store')
    return status.read(req.query.again === '1')
  })
}
