import { newId, type Mutation } from '@sh/shared'
import { describe, expect, it } from 'vitest'
import { buildApp } from '../src/app.ts'
import { postgresDb } from '../src/db.ts'

/**
 * PGlite runs one query at a time, so it cannot show what happens when
 * several devices sync at the same moment. This runs against a real
 * Postgres when TEST_DATABASE_URL is set (CI sets it).
 */
const url = process.env.TEST_DATABASE_URL

describe.skipIf(!url)('real Postgres, many devices at once', () => {
  it('never overbooks and keeps the change feed gap-free under concurrent pushes', async () => {
    const db = postgresDb(url!)
    await db.exec('DROP TABLE IF EXISTS changes, mutations, bookings, scans, issues, products, schema_version CASCADE')
    const app = await buildApp({ db })
    try {
      const push = (clientId: string, mutations: Mutation[]) =>
        app.inject({ method: 'POST', url: '/api/sync/push', payload: { clientId, mutations } }).then((r) => r.json())
      const m = (name: Mutation['name'], args: object): Mutation => ({ id: newId(), name, args: args as never, createdAt: new Date().toISOString() })

      await push('office', [m('product.upsert', { id: 'y10p', name: 'd&b Y10P', quantity: 4 })])

      // Twenty devices each try to book one speaker for the same day.
      const answers = await Promise.all(
        Array.from({ length: 20 }, (_, i) =>
          push(`phone-${i}`, [m('booking.create', { id: `b${i}`, productId: 'y10p', project: `Job ${i}`, qty: 1, start: '2026-10-05', end: '2026-10-05' })])
        )
      )
      const statuses = answers.map((a) => a.results[0].status)
      expect(statuses.filter((s) => s === 'applied')).toHaveLength(4)
      expect(statuses.filter((s) => s === 'rejected')).toHaveLength(16)

      const { rows } = await db.query<{ seq: string }>('SELECT seq FROM changes ORDER BY seq')
      const seqs = rows.map((r) => Number(r.seq))
      expect(seqs).toEqual(seqs.map((_, i) => seqs[0]! + i))
    } finally {
      await app.close()
      await db.close()
    }
  })
})
