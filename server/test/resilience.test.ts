import { newId, type CommandInput, type CommandName, type Mutation } from '@sh/shared'
import type { FastifyInstance } from 'fastify'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildApp } from '../src/app.ts'
import { pgliteDb, type Db, type Queryable } from '../src/db.ts'
import { reportError } from '../src/monitoring.ts'

/**
 * One bad change must never strand a phone (audit of 30 September 2026, P0
 * 2). A fault the server didn't expect drops that one change with a reason,
 * is reported, and the device carries on; and what a device or browser is
 * told about a failed request never carries the fault's own words.
 */

// Reporting is stood in for, so a test can see what was reported, and with what.
vi.mock('../src/monitoring.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/monitoring.ts')>()),
  reportError: vi.fn(),
}))

let cleanup: (() => Promise<void>)[] = []
afterEach(async () => {
  for (const fn of cleanup.reverse()) await fn()
  cleanup = []
  vi.mocked(reportError).mockClear()
})

async function server(db: Db) {
  const app = await buildApp({ db })
  cleanup.push(async () => {
    await app.close()
    await db.close().catch(() => {})
  })
  return app
}

/**
 * The real database, with one statement made to fail the next time it runs.
 * Postgres raises the error itself (dividing by zero), so the transaction is
 * left in the aborted state a real fault inside a handler leaves it in.
 */
function withFault(db: Db, statement: (sql: string) => boolean): Db & { failNext: boolean } {
  const faulty: Db & { failNext: boolean } = {
    ...db,
    failNext: false,
    transaction: (fn) =>
      db.transaction((tx) => {
        const query: Queryable['query'] = <T>(sql: string, params?: unknown[]) => {
          if (faulty.failNext && statement(sql)) {
            faulty.failNext = false
            return tx.query<T>('SELECT 1/0')
          }
          return tx.query<T>(sql, params)
        }
        return fn({ ...tx, query })
      }),
  }
  return faulty
}

function mutation<N extends CommandName>(name: N, args: CommandInput<N>, createdAt = new Date().toISOString()): Mutation {
  return { id: newId(), name, args, createdAt } as Mutation
}

function push(app: FastifyInstance, mutations: Mutation[]) {
  return app.inject({ method: 'POST', url: '/api/sync/push', payload: { clientId: 'office-laptop', mutations } })
}

const Y10P = { id: 'y10p', name: 'd&b Y10P', quantity: 4 }
const LS9 = { id: 'ls9', name: 'Yamaha LS9', quantity: 1 }

describe('a fault the server did not expect', () => {
  it('drops that one change with a reason, reports it, and lets the device carry on', async () => {
    // Proves: a Postgres error inside a handler answers 200 with that change
    // turned down in plain words, the history says so, the same device's next
    // change applies, and a resend of the bad one gets the same answer back.
    const db = withFault(await pgliteDb(), (sql) => sql.startsWith('INSERT INTO products'))
    const app = await server(db)

    db.failNext = true
    const bad = mutation('product.upsert', Y10P)
    const res = await push(app, [bad])
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({
      results: [
        {
          id: bad.id,
          status: 'rejected',
          reason: { code: 'invalid', message: "The server couldn't apply this change, so it was dropped. It's been reported. Check it and send it again." },
        },
      ],
    })

    // Reported by the command's name, never with what was in it.
    expect(reportError).toHaveBeenCalledTimes(1)
    const [err, tags] = vi.mocked(reportError).mock.calls[0]!
    expect((err as Error).message).toBe('division by zero')
    expect(tags).toEqual({ area: 'commands', command: 'product.upsert' })

    // Nothing of it was kept, but the answer was, as for any other refusal.
    expect((await db.query('SELECT 1 FROM products')).rows).toHaveLength(0)
    const { rows } = await db.query<{ status: string; result: { reason: { code: string } } }>('SELECT status, result FROM mutations WHERE id = $1', [bad.id])
    expect(rows[0]).toMatchObject({ status: 'rejected', result: { reason: { code: 'invalid' } } })
    const history = (await app.inject('/api/history')).json()
    expect(history.entries).toMatchObject([{ command: 'product.upsert', outcome: 'turned-down', reason: expect.stringContaining('dropped') }])

    // The same device's next change goes through; a resend of the bad one is a duplicate, not a second try.
    const next = mutation('product.upsert', LS9)
    expect((await push(app, [next])).json().results).toMatchObject([{ id: next.id, status: 'applied' }])
    expect((await push(app, [bad])).json().results).toMatchObject([{ id: bad.id, status: 'rejected', duplicate: true, reason: { code: 'invalid' } }])
    expect((await db.query('SELECT id FROM products')).rows).toEqual([{ id: 'ls9' }])
  })

  it('takes a change whose time of making is not a time at all, as made when it arrived', async () => {
    // Proves: a bad createdAt costs that one change its device-clock time, not the whole push.
    const db = await pgliteDb()
    const app = await server(db)
    const good = mutation('product.upsert', Y10P)
    const odd = mutation('product.upsert', LS9, 'not a date')
    const res = await push(app, [good, odd])
    expect(res.statusCode).toBe(200)
    expect(res.json().results.map((r: { status: string }) => r.status)).toEqual(['applied', 'applied'])
    expect(reportError).not.toHaveBeenCalled()

    const { rows } = await db.query<{ id: string; gap: string | number }>(
      'SELECT id, extract(epoch FROM received_at - created_at) AS gap FROM mutations ORDER BY received_at'
    )
    expect(rows.map((r) => r.id)).toEqual([good.id, odd.id])
    expect(Number(rows[1]!.gap)).toBeGreaterThanOrEqual(0)
    expect(Number(rows[1]!.gap)).toBeLessThan(1)
  })
})

describe('a request that fails on the server', () => {
  it('answers with one plain line, never the fault itself', async () => {
    // Proves: a 500 says only that something went wrong; the fault's own words,
    // which could hold a value from the request, go to the log and the report.
    const db = await pgliteDb()
    const app = await server(db)
    await db.close()
    await expect(db.query('SELECT 1')).rejects.toThrow('PGlite is closed')

    const res = await app.inject({ method: 'GET', url: '/api/health' })
    expect(res.statusCode).toBe(500)
    expect(res.json()).toEqual({ error: 'Something went wrong on the server.' })
    expect(res.body).not.toContain('PGlite')
    expect(reportError).toHaveBeenCalledWith(expect.objectContaining({ message: 'PGlite is closed' }), { route: '/api/health', method: 'GET' })
  })

  it('leaves a request that was turned away to say why, as before', async () => {
    // Proves: the plain line is for faults only; a 400 keeps its reason and is not reported.
    const app = await server(await pgliteDb())
    const res = await app.inject({ method: 'POST', url: '/api/sync/push', headers: { 'content-type': 'application/json' }, payload: '{not json' })
    expect(res.statusCode).toBe(400)
    expect(res.json()).toMatchObject({ statusCode: 400, error: 'Bad Request', message: expect.any(String) })
    expect(reportError).not.toHaveBeenCalled()
  })
})
