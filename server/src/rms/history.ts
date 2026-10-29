import {
  irishToday,
  matchOpportunities,
  MOST_LAST_CHARGED_NAMES,
  rmsClients,
  sameClient,
  type RmsCharge,
  type RmsClientStats,
  type RmsLastCharged,
  type RmsMatches,
  type RmsMatchRow,
} from '@sh/shared'
import type { FastifyInstance } from 'fastify'
import type { Db, Queryable } from '../db.ts'

/**
 * Current RMS's history put to use (ADR 0092), for the office and
 * directors, answered by the server from its copy as the past quotes are
 * (ADR 0078): each opportunity matched to its job and linked by the office,
 * the past quotes a job has, what a product or service was last charged,
 * and how each client's quotes went. Linking is the office's own record of
 * which job an opportunity was for; nothing in Current RMS changes.
 */

type Row = Record<string, any>
const iso = (v: unknown) => (v ? new Date(v as string).toISOString() : null)
const day = (v: unknown) => (v ? new Date(v as string).toISOString().slice(0, 10) : null)

async function jobsToMatch(q: Queryable) {
  const { rows } = await q.query<Row>(
    `SELECT p.id, p.name, COALESCE(c.name, '') AS client, min(ph.start_day) AS start, max(ph.end_day) AS "end"
       FROM projects p LEFT JOIN clients c ON c.id = p.client_id JOIN phases ph ON ph.project_id = p.id
      GROUP BY p.id, p.name, c.name`
  )
  return rows.map((r) => ({ id: r.id as string, name: r.name as string, client: r.client as string, start: day(r.start)!, end: day(r.end)! }))
}

/** What each client's quotes came to, and the past quotes linked to a job. */
async function allOpportunities(q: Queryable) {
  const { rows } = await q.query<Row>(`SELECT id, number, subject, client, state, status, starts_at, ends_at, net_cents, undiscounted_cents FROM rms_opportunities`)
  return rows.map((r) => ({
    id: r.id as number,
    number: r.number as string,
    subject: r.subject as string,
    client: r.client as string,
    state: r.state as string,
    status: r.status as string,
    startsAt: iso(r.starts_at),
    endsAt: iso(r.ends_at),
    netCents: Number(r.net_cents),
    undiscountedCents: Number(r.undiscounted_cents),
  }))
}

const MOST_LINKS = 2000

export function registerRmsHistoryRoutes(app: FastifyInstance, { db }: { db: Db }) {
  app.get('/api/rms/matches', { config: { needs: 'money' } }, async (_req, reply): Promise<RmsMatches> => {
    reply.header('cache-control', 'no-store')
    const [opps, jobs, links] = await Promise.all([
      allOpportunities(db.reads),
      jobsToMatch(db.reads),
      db.reads.query<Row>('SELECT m.opportunity_id, m.project_id FROM rms_matches m JOIN projects p ON p.id = m.project_id'),
    ])
    const linked = new Map(links.rows.map((r) => [r.opportunity_id as number, r.project_id as string]))
    const suggested = new Map(matchOpportunities(opps, jobs).map((m) => [m.opportunityId, m]))
    const byId = new Map(jobs.map((j) => [j.id, j]))
    const named: RmsMatches['jobs'] = {}
    const rows = opps
      .sort((a, b) => (b.startsAt ?? '').localeCompare(a.startsAt ?? '') || b.id - a.id)
      .map((o): RmsMatchRow => {
        const s = suggested.get(o.id)!
        for (const id of [linked.get(o.id), ...s.candidates.map((c) => c.projectId)]) {
          const j = id ? byId.get(id) : undefined
          if (j) named[j.id] = { name: j.name, client: j.client, start: j.start, end: j.end }
        }
        const { undiscountedCents: _, ...opportunity } = o
        return { opportunity, linked: linked.get(o.id) ?? null, suggested: s }
      })
    return { rows, jobs: named }
  })

  /** Link opportunities to jobs, or with no job take a link off: one at a time, or all the sure ones in one press. */
  app.post<{ Body: { links?: { opportunityId?: unknown; projectId?: unknown }[] } }>('/api/rms/matches', { config: { needs: 'money' } }, async (req, reply) => {
    const links = Array.isArray(req.body?.links) ? req.body.links : null
    if (!links || links.length > MOST_LINKS) return reply.code(400).send({ error: `Send up to ${MOST_LINKS} links at a time.` })
    const clean: { opportunityId: number; projectId: string | null }[] = []
    for (const l of links) {
      const id = Number(l.opportunityId)
      const project = l.projectId === null ? null : typeof l.projectId === 'string' && l.projectId.length <= 64 ? l.projectId : undefined
      if (!Number.isSafeInteger(id) || project === undefined) return reply.code(400).send({ error: 'Each link is an opportunity and a job, or no job to take it off.' })
      clean.push({ opportunityId: id, projectId: project })
    }
    const by = req.user?.email ?? ''
    const done = await db.transaction(async (tx) => {
      let n = 0
      for (const l of clean) {
        if (l.projectId === null) {
          await tx.query('DELETE FROM rms_matches WHERE opportunity_id = $1', [l.opportunityId])
          continue
        }
        const { rows } = await tx.query<Row>('SELECT (SELECT 1 FROM rms_opportunities WHERE id = $1) AS o, (SELECT 1 FROM projects WHERE id = $2) AS p', [l.opportunityId, l.projectId])
        if (!rows[0]?.o || !rows[0]?.p) continue
        await tx.query(
          `INSERT INTO rms_matches (opportunity_id, project_id, linked_by) VALUES ($1, $2, $3)
           ON CONFLICT (opportunity_id) DO UPDATE SET project_id = EXCLUDED.project_id, linked_by = EXCLUDED.linked_by, linked_at = now()`,
          [l.opportunityId, l.projectId, by]
        )
        n++
      }
      return n
    })
    return { linked: done }
  })

  /** A job's past quotes from Current RMS, and how its client's quotes went there. */
  app.get<{ Params: { id: string } }>('/api/rms/jobs/:id', { config: { needs: 'money' } }, async (req, reply) => {
    reply.header('cache-control', 'no-store')
    const { rows: job } = await db.reads.query<Row>('SELECT COALESCE(c.name, \'\') AS client FROM projects p LEFT JOIN clients c ON c.id = p.client_id WHERE p.id = $1', [req.params.id])
    if (!job[0]) return reply.code(404).send({ error: 'That job no longer exists.' })
    const { rows } = await db.reads.query<Row>(
      `SELECT o.id, o.number, o.subject, o.client, o.state, o.status, o.starts_at, o.ends_at, o.net_cents
         FROM rms_matches m JOIN rms_opportunities o ON o.id = m.opportunity_id WHERE m.project_id = $1 ORDER BY o.starts_at DESC NULLS LAST, o.id DESC`,
      [req.params.id]
    )
    const client = job[0].client as string
    const stats: RmsClientStats | null = client ? (rmsClients((await allOpportunities(db.reads)).filter((o) => sameClient(o.client, client)), irishToday()).reduce(merge, null as RmsClientStats | null)) : null
    return {
      opportunities: rows.map((r) => ({ id: r.id, number: r.number, subject: r.subject, client: r.client, state: r.state, status: r.status, startsAt: iso(r.starts_at), endsAt: iso(r.ends_at), netCents: Number(r.net_cents) })),
      client: stats,
    }
  })

  /** How each client's quotes went in Current RMS, most quoted first. */
  app.get('/api/rms/clients', { config: { needs: 'money' } }, async (_req, reply): Promise<RmsClientStats[]> => {
    reply.header('cache-control', 'no-store')
    return rmsClients(await allOpportunities(db.reads), irishToday())
  })

  /**
   * What each of a quote's lines was last charged (ADR 0092), asked by the names it goes by: a product's own and its
   * other names, a crew role, a package. Answered with the last to the job's client and the last to anyone, priced.
   */
  app.post<{ Body: { projectId?: unknown; names?: unknown } }>('/api/rms/last-charged', { config: { needs: 'money' } }, async (req, reply): Promise<RmsLastCharged | void> => {
    const names = Array.isArray(req.body?.names) ? req.body.names.filter((n): n is string => typeof n === 'string' && n.trim() !== '' && n.length <= 200) : []
    if (names.length > MOST_LAST_CHARGED_NAMES) return reply.code(400).send({ error: `Ask about up to ${MOST_LAST_CHARGED_NAMES} names at a time.` })
    const keys = [...new Set(names.map((n) => n.trim().toLowerCase()))]
    const out: RmsLastCharged = {}
    if (!keys.length) return out
    const project = typeof req.body?.projectId === 'string' ? req.body.projectId : ''
    const { rows: job } = await db.reads.query<Row>("SELECT COALESCE(c.name, '') AS client FROM projects p LEFT JOIN clients c ON c.id = p.client_id WHERE p.id = $1", [project])
    const client = (job[0]?.client as string | undefined) ?? ''
    // The last of each name to each client: the newest to anyone is the newest of those, and the client's is theirs.
    const { rows } = await db.reads.query<Row>(
      `SELECT DISTINCT ON (lower(trim(l.name)), lower(trim(o.client))) lower(trim(l.name)) AS key, l.price_cents, l.unit_cents, l.discount_pct, l.rate_definition,
              o.client, o.number, o.id, o.starts_at
         FROM rms_lines l JOIN rms_opportunities o ON o.id = l.opportunity_id
        WHERE lower(trim(l.name)) = ANY($1) AND l.price_cents > 0 AND l.kind <> 'Group'
        ORDER BY lower(trim(l.name)), lower(trim(o.client)), o.starts_at DESC NULLS LAST, l.id DESC`,
      [keys]
    )
    const newer = (a: RmsCharge | null, b: RmsCharge) => (!a || (b.on ?? '') > (a.on ?? '') ? b : a)
    for (const r of rows) {
      const charge: RmsCharge = {
        priceCents: Number(r.price_cents),
        unitCents: Number(r.unit_cents),
        discountPct: Number(r.discount_pct),
        rate: r.rate_definition,
        client: r.client,
        number: r.number,
        opportunityId: r.id,
        on: day(r.starts_at),
      }
      const found = (out[r.key] ??= { client: null, any: null })
      found.any = newer(found.any, charge)
      if (client && sameClient(r.client, client)) found.client = newer(found.client, charge)
    }
    return out
  })
}

/** A client spelt more than one way in Current RMS ("Verve", "Verve Live"), added up as one. */
function merge(a: RmsClientStats | null, b: RmsClientStats): RmsClientStats {
  if (!a) return b
  const decided = a.decided + b.decided
  const ahead = a.ahead + b.ahead
  return {
    client: a.client,
    quotes: a.quotes + b.quotes,
    ahead,
    decided,
    winPct: decided ? Math.round((ahead / decided) * 100) : null,
    // Weighted by what each went ahead with, near enough for a hint.
    discountPct:
      a.discountPct === null ? b.discountPct : b.discountPct === null ? a.discountPct : Math.round(((a.discountPct * a.aheadCents + b.discountPct * b.aheadCents) / Math.max(1, a.aheadCents + b.aheadCents)) * 10) / 10,
    aheadCents: a.aheadCents + b.aheadCents,
    lastOn: !a.lastOn ? b.lastOn : !b.lastOn ? a.lastOn : a.lastOn > b.lastOn ? a.lastOn : b.lastOn,
  }
}
