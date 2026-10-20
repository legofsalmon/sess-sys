import { nameParts, type CommandName, type EntityName, type Mutation } from '@sh/shared'
import type { Queryable } from './db.ts'
import { Refused } from './kernel.ts'

/**
 * An edit made against an old copy isn't saved over a newer one (audit, 18
 * October 2026). Changes used to apply in the order they arrived, so a job
 * sheet typed on a phone with no signal on Monday replaced the office's
 * version from Tuesday when the phone came back, and neither said so.
 *
 * A device now says how far its copy had read the feed when the person made
 * the change (`seen`). For each field the change sets, the feed says whether
 * anyone else changed it after that:
 *
 * - nobody did: the change applies, as before;
 * - someone did, and it's already what this change sets: nothing to lose;
 * - someone did, and this change leaves it as the person saw it (a whole
 *   record saved from a form, a venue or a person): theirs is kept;
 * - someone did, and this change sets something else: the whole change is
 *   turned down as a conflict, in words, and the device keeps what was
 *   typed for the person to copy.
 *
 * The device's own earlier changes, in the feed after what it had read,
 * are what it was showing, so they never count against it. A change from an
 * older version of the app says nothing, and applies in arrival order as it
 * always did.
 */

interface Checked {
  entity: EntityName
  /** Each field it checks, as a change names it and as the record holds it, in words. */
  fields: Record<string, string>
  /** The record, in a few words, from what it holds now: "the job Electric Picnic". */
  what: (data: Record<string, unknown> | undefined) => string
  /** A copy as it reads now, for a field a copy from before it existed lacks. */
  read?: (data: Record<string, unknown>) => Record<string, unknown>
}

const named = (kind: string) => (d: Record<string, unknown> | undefined) => (typeof d?.name === 'string' && d.name ? `the ${kind} ${d.name}` : `this ${kind}`)

const CHECKED: Partial<Record<CommandName, Checked>> = {
  'project.update': {
    entity: 'project',
    fields: {
      name: 'name',
      clientId: 'client',
      venueId: 'venue',
      status: 'status',
      kind: 'kind of job',
      notes: 'notes',
      prepDays: 'days to get the kit ready',
      returnDays: 'days to check the kit back',
    },
    what: named('job'),
  },
  'phase.update': {
    entity: 'phase',
    fields: { name: 'name', start: 'first day', end: 'last day', venueId: 'venue', notes: 'notes', contactId: 'contact on the day' },
    what: named('phase'),
  },
  'venue.upsert': { entity: 'venue', fields: { name: 'name', address: 'address', notes: 'notes' }, what: named('venue') },
  'venue.pin': { entity: 'venue', fields: { pin: 'place on the map' }, what: named('venue') },
  'client.upsert': { entity: 'client', fields: { name: 'name', contacts: 'contacts', notes: 'notes' }, what: named('client') },
  'person.upsert': {
    entity: 'person',
    fields: {
      name: 'name',
      firstName: 'first name',
      lastName: 'last name',
      kind: 'staff or freelance',
      email: 'email address',
      phone: 'phone number',
      skills: 'skills',
      dayRateCents: 'day rate',
      notes: 'notes',
      department: 'department',
      level: 'level',
      knownAs: 'name they go by',
      certificates: 'certificates',
      company: 'company details',
    },
    what: (d) => (typeof d?.name === 'string' && d.name ? d.name : 'this person'),
    // A copy from before the name was asked for in two (ADR 0063) reads as split, as the server reads the row.
    read: (d) => (typeof d.name === 'string' ? { ...d, ...nameParts(d as { name: string; firstName?: string; lastName?: string }) } : d),
  },
  'call.update': {
    entity: 'crewCall',
    fields: {
      role: 'role',
      start: 'first day',
      end: 'last day',
      callTime: 'call time',
      needed: 'how many are needed',
      dayRateCents: 'rate',
      details: 'details for crew',
      replyBy: 'reply-by day',
      project: "job's name",
      phase: 'phase',
      venue: 'venue',
    },
    what: (d) => (typeof d?.role === 'string' && typeof d.project === 'string' ? `the call for ${d.role} on ${d.project}` : 'this call'),
  },
}

/** The same value, whatever order a record's keys came back in; missing and null are the same. */
function same(a: unknown, b: unknown): boolean {
  return canonical(a) === canonical(b)
}
function canonical(v: unknown): string {
  if (v === undefined || v === null) return 'null'
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`
  if (typeof v === 'object')
    return `{${Object.keys(v)
      .filter((k) => (v as Record<string, unknown>)[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical((v as Record<string, unknown>)[k])}`)
      .join(',')}}`
  return JSON.stringify(v)
}

const listed = (words: string[]) => (words.length < 2 ? words.join('') : `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`)

/**
 * The change's arguments as they should be applied: as sent, or with a field
 * the person didn't touch given what someone else has put there since.
 * Throws `Refused` when the person changed a field someone else changed too.
 */
export async function notOverwriting<A extends Record<string, unknown>>(
  tx: Queryable,
  clientId: string,
  m: Pick<Mutation, 'name' | 'seen'>,
  args: A,
  opts: { seesRates: boolean }
): Promise<A> {
  const checked = CHECKED[m.name as CommandName]
  if (!checked || m.seen === undefined || typeof args.id !== 'string') return args
  const fields = Object.keys(checked.fields).filter((f) => args[f] !== undefined && (f !== 'dayRateCents' || opts.seesRates))
  if (!fields.length) return args

  // Since the device's copy: who changed the record, in order. Usually nobody, and that's one indexed look.
  const { rows: since } = await tx.query<{ data: Record<string, unknown> | null; own: boolean }>(
    `SELECT c.data, coalesce(m.client_id = $3, false) AS own
       FROM changes c LEFT JOIN mutations m ON m.id = c.mutation_id
      WHERE c.entity_id = $2 AND c.entity = $1 AND c.seq > $4
      ORDER BY c.seq`,
    [checked.entity, args.id, clientId, m.seen]
  )
  if (!since.some((r) => !r.own)) return args
  const { rows: before } = await tx.query<{ data: Record<string, unknown> | null }>(
    `SELECT data FROM changes WHERE entity_id = $2 AND entity = $1 AND seq <= $3 ORDER BY seq DESC LIMIT 1`,
    [checked.entity, args.id, m.seen]
  )

  // What the person was looking at (the copy, with this device's own changes over it), and what others have changed since.
  const read = (d: Record<string, unknown> | null | undefined) => (d ? (checked.read?.(d) ?? d) : undefined)
  let prev = read(before[0]?.data)
  const saw: Record<string, unknown> = Object.fromEntries(fields.map((f) => [f, prev?.[f]]))
  const theirs = new Set<string>()
  for (const r of since) {
    const next = read(r.data)
    for (const f of fields) {
      if (same(prev?.[f], next?.[f])) continue
      if (r.own) saw[f] = next?.[f]
      else theirs.add(f)
    }
    prev = next
  }
  const now = prev
  // Gone since: the command's own check says so.
  if (!now) return args

  const out: Record<string, unknown> = { ...args }
  const clash: string[] = []
  for (const f of fields) {
    if (!theirs.has(f) || same(args[f], now[f])) continue
    if (same(args[f], saw[f])) {
      if (now[f] === undefined) delete out[f]
      else out[f] = now[f]
    } else clash.push(checked.fields[f]!)
  }
  if (clash.length)
    throw new Refused({
      code: 'conflict',
      message: `Someone changed the ${listed(clash)} of ${checked.what(now)} on another device before your change got here, so it wasn't saved over theirs. Check what's there now and make your change again.`,
    })
  return out as A
}
