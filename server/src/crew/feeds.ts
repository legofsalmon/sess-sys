import { createHash } from 'node:crypto'
import { feedCodeFor, type CrewCall, type Offer, type Person } from '@sh/shared'
import type { FastifyReply, FastifyRequest } from 'fastify'
import type { Queryable } from '../db.ts'
import { calendarFeed } from './ical.ts'
import { everyonesBookings } from './store.ts'

/**
 * Everyone's calendar feed, kept in memory (ADR 0012). Calendar apps look
 * at a feed every hour or so whether anything changed or not; answering
 * from memory keeps them from waking the database. Anything that changes
 * in the app marks the feeds out of date, and the next look builds them
 * all again from two reads. They are rebuilt every 6 hours anyway, for the
 * few minutes of a deploy when a change can land on the other server.
 */

export interface Feed {
  personId: string
  ics: string
  etag: string
  /** When this person's feed last changed, to the second, for Last-Modified. */
  changedAt: Date
  /** What the feed says, leaving out when it was made: the same means nothing changed. */
  key: string
}

interface Built {
  version: number
  at: number
  byCode: Map<string, Feed>
  byLink: Map<string, Feed>
}

export interface FeedsOptions {
  maxAgeMs?: number
  now?: () => Date
}

const SIX_HOURS = 6 * 60 * 60 * 1000
const hash = (s: string) => createHash('sha256').update(s).digest('base64url')

export class Feeds {
  private version = 0
  private built?: Built
  private building?: { version: number; done: Promise<Built> }
  /** Feed codes already worked out, by link. */
  private codes = new Map<string, string>()

  constructor(
    private readonly db: Queryable,
    private readonly options: FeedsOptions = {}
  ) {}

  /** Something changed in the app: the next look builds the feeds again. */
  stale() {
    this.version++
  }

  /** A feed by the code in its read-only address, /cal/<code>.ics. */
  async byCode(code: string): Promise<Feed | undefined> {
    return (await this.current()).byCode.get(code)
  }

  /** A feed by the person's private link, the address crew booking first gave out (ADR 0002). */
  async byLink(token: string): Promise<Feed | undefined> {
    return (await this.current()).byLink.get(token)
  }

  private now() {
    return this.options.now?.() ?? new Date()
  }

  private current(): Promise<Built> {
    const built = this.built
    if (built && built.version === this.version && this.now().getTime() - built.at < (this.options.maxAgeMs ?? SIX_HOURS)) return Promise.resolve(built)
    // Looks that arrive together share one build; a change during a build starts another.
    if (this.building?.version !== this.version) {
      const building = { version: this.version, done: this.build(this.version) }
      this.building = building
      building.done.then(
        () => this.building === building && (this.building = undefined),
        () => this.building === building && (this.building = undefined)
      )
    }
    return this.building!.done
  }

  private async build(version: number): Promise<Built> {
    const now = this.now()
    const { people, bookings } = await everyonesBookings(this.db)
    const jobsOf = new Map<string, { offer: Offer; call: CrewCall }[]>()
    for (const b of bookings) jobsOf.set(b.offer.personId, [...(jobsOf.get(b.offer.personId) ?? []), b])
    const before = new Map([...(this.built?.byLink.values() ?? [])].map((f) => [f.personId, f]))
    const codes = new Map<string, string>()
    const built: Built = { version, at: now.getTime(), byCode: new Map(), byLink: new Map() }
    for (const person of people) {
      const jobs = jobsOf.get(person.id) ?? []
      const key = hash(calendarFeed(person, jobs, new Date(0)))
      const last = before.get(person.id)
      // Unchanged keeps its stamp and ETag, so calendar apps asking "anything new?" hear no.
      const feed = last?.key === key ? last : make(person, jobs, key, now)
      const code = this.codes.get(person.linkToken) ?? (await feedCodeFor(person.linkToken))
      codes.set(person.linkToken, code)
      built.byCode.set(code, feed)
      built.byLink.set(person.linkToken, feed)
    }
    this.codes = codes
    if (!this.built || this.built.version <= version) this.built = built
    return built
  }
}

function make(person: Person, jobs: { offer: Offer; call: CrewCall }[], key: string, now: Date): Feed {
  const changedAt = new Date(Math.floor(now.getTime() / 1000) * 1000)
  const ics = calendarFeed(person, jobs, changedAt)
  return { personId: person.id, ics, etag: `"${hash(ics).slice(0, 27)}"`, changedAt, key }
}

/** A feed, or "not modified" when the calendar app already has this one, or "not found". */
export function sendFeed(req: FastifyRequest, reply: FastifyReply, feed: Feed | undefined) {
  // Private: never kept by a shared cache. No-cache: kept, but asked about each time.
  reply.header('cache-control', 'private, no-cache').header('x-robots-tag', 'noindex')
  if (!feed) return reply.code(404).type('text/plain; charset=utf-8').send('Not found')
  reply.header('etag', feed.etag).header('last-modified', feed.changedAt.toUTCString())
  if (unchanged(req, feed)) return reply.code(304).send()
  return reply.type('text/calendar; charset=utf-8').header('content-disposition', 'inline; filename="session-hire.ics"').send(feed.ics)
}

function unchanged(req: FastifyRequest, feed: Feed): boolean {
  const tags = req.headers['if-none-match']
  // An ETag, when sent, decides on its own (RFC 9110).
  if (tags) return tags.trim() === '*' || tags.split(',').some((t) => t.trim().replace(/^W\//, '') === feed.etag)
  const since = Date.parse(req.headers['if-modified-since'] ?? '')
  return Number.isFinite(since) && since >= feed.changedAt.getTime()
}
