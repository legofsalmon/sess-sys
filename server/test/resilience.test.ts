import { MemoryStorage, newId, SyncClient, type CommandInput, type CommandName, type Mutation, type Transport } from '@sh/shared'
import type { FastifyInstance } from 'fastify'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildApp } from '../src/app.ts'
import { applyMutationIn } from '../src/commands.ts'
import { pgliteDb, type Db, type Queryable } from '../src/db.ts'
import { reportError } from '../src/monitoring.ts'

/**
 * One bad change must never strand a phone (audit of 30 September 2026, P0
 * 2). A fault the server didn't expect drops that one change with a reason,
 * is reported, and the device carries on; what a device or browser is
 * told about a failed request never carries the fault's own words; a
 * fault while telling devices about a change never stops the server; and a
 * character the database can't hold is cleaned from typed text, or else
 * turned down in words, never taken for a fault.
 */

/** What a change, or a request, with a character the database can't hold where it can't be cleaned is told. */
const CHARACTERS = "Something in this has a character the app can't keep, so it wasn't saved. Check it and try again."

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
 * Postgres raises the error itself (dividing by zero, unless another fault
 * is given), so the transaction is left in the aborted state a real fault
 * inside a handler leaves it in.
 */
function withFault(db: Db, statement: (sql: string) => boolean, fault = 'SELECT 1/0'): Db & { failNext: boolean } {
  const faulty: Db & { failNext: boolean } = {
    ...db,
    failNext: false,
    transaction: (fn) =>
      db.transaction((tx) => {
        const query: Queryable['query'] = <T>(sql: string, params?: unknown[]) => {
          if (faulty.failNext && statement(sql)) {
            faulty.failNext = false
            return tx.query<T>(fault)
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

const A3 = { id: 'a3', name: 'Bay A3', notes: '' }
const VAN1 = { id: 'van1', name: 'Van 1', notes: '' }
const VAN2 = { id: 'van2', name: 'Van 2', notes: '' }

describe('a fault the server did not expect', () => {
  it('drops that one change with a reason, reports it, and lets the device carry on', async () => {
    // Proves: a Postgres error inside a handler answers 200 with that change
    // turned down in plain words, the history says so, the same device's next
    // change applies, and a resend of the bad one gets the same answer back.
    const db = withFault(await pgliteDb(), (sql) => sql.startsWith('INSERT INTO places'))
    const app = await server(db)

    db.failNext = true
    const bad = mutation('place.upsert', A3)
    const res = await push(app, [bad])
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({
      results: [
        {
          id: bad.id,
          status: 'rejected',
          reason: { code: 'invalid', message: "The server couldn't apply this change, so it was dropped. Check it and send it again." },
        },
      ],
    })

    // Reported by the command's name, never with what was in it.
    expect(reportError).toHaveBeenCalledTimes(1)
    const [err, tags] = vi.mocked(reportError).mock.calls[0]!
    expect((err as Error).message).toBe('division by zero')
    expect(tags).toEqual({ area: 'commands', command: 'place.upsert' })

    // Nothing of it was kept, but the answer was, as for any other refusal.
    expect((await db.query('SELECT 1 FROM places')).rows).toHaveLength(0)
    const { rows } = await db.query<{ status: string; result: { reason: { code: string } } }>('SELECT status, result FROM mutations WHERE id = $1', [bad.id])
    expect(rows[0]).toMatchObject({ status: 'rejected', result: { reason: { code: 'invalid' } } })
    const history = (await app.inject('/api/history')).json()
    expect(history.entries).toMatchObject([{ command: 'place.upsert', outcome: 'turned-down', reason: expect.stringContaining('dropped') }])

    // The same device's next change goes through; a resend of the bad one is a duplicate, not a second try.
    const next = mutation('place.upsert', VAN1)
    expect((await push(app, [next])).json().results).toMatchObject([{ id: next.id, status: 'applied' }])
    expect((await push(app, [bad])).json().results).toMatchObject([{ id: bad.id, status: 'rejected', duplicate: true, reason: { code: 'invalid' } }])
    expect((await db.query('SELECT id FROM places')).rows).toEqual([{ id: 'van1' }])
  })

  it('takes a change whose time of making is not a time Postgres keeps, as made when it arrived', async () => {
    // Proves: a bad createdAt, or one in a year Postgres has no room for, costs
    // that one change its device-clock time, not the whole push.
    const db = await pgliteDb()
    const app = await server(db)
    const good = mutation('place.upsert', A3)
    const odd = mutation('place.upsert', VAN1, 'not a date')
    const yearNought = mutation('place.upsert', VAN2, '0000-01-01T00:00:00Z')
    const res = await push(app, [good, odd, yearNought])
    expect(res.statusCode).toBe(200)
    expect(res.json().results.map((r: { status: string }) => r.status)).toEqual(['applied', 'applied', 'applied'])
    expect(reportError).not.toHaveBeenCalled()

    const { rows } = await db.query<{ id: string; gap: string | number }>(
      'SELECT id, extract(epoch FROM received_at - created_at) AS gap FROM mutations ORDER BY received_at'
    )
    expect(rows.map((r) => r.id)).toEqual([good.id, odd.id, yearNought.id])
    for (const row of rows.slice(1)) {
      expect(Number(row.gap)).toBeGreaterThanOrEqual(0)
      expect(Number(row.gap)).toBeLessThan(1)
    }
  })

  it('is left to the calendar sync, which tries again next round', async () => {
    // Proves: an answer from Google Calendar is not dropped for good; the fault goes up to the sync's own round.
    const db = withFault(await pgliteDb(), (sql) => sql.startsWith('INSERT INTO places'))
    await server(db)
    db.failNext = true
    const m = mutation('place.upsert', A3)
    await expect(db.transaction((tx) => applyMutationIn(tx, 'calendar:someone', m, { via: 'calendar' }))).rejects.toThrow('division by zero')
    expect(reportError).not.toHaveBeenCalled()
    expect((await db.query('SELECT 1 FROM mutations')).rows).toHaveLength(0)
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
    // With the headers every answer carries (audit finding 20).
    expect(res.headers['x-content-type-options']).toBe('nosniff')
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

describe('telling devices about a change', () => {
  it('can fail without stopping the server: the change stands, and the fault is reported', async () => {
    // Proves: a database hiccup right after a push, as the devices listening are told, is caught and
    // reported rather than left as an unhandled rejection, which would end the process (audit finding 20).
    const db = await pgliteDb()
    const fault = { next: false }
    const app = await server({
      ...db,
      query: (sql, params) => {
        if (fault.next && sql.includes('max(seq)')) {
          fault.next = false
          return db.query('SELECT 1/0')
        }
        return db.query(sql, params)
      },
    })
    await app.ready()
    const told: string[] = []
    const ws = await app.injectWS('/api/sync/live', {}, { onInit: (socket) => socket.on('message', (data) => told.push(String(data))) })
    try {
      await vi.waitFor(() => expect(told).toHaveLength(1))
      fault.next = true
      const m = mutation('place.upsert', A3)
      expect((await push(app, [m])).json().results).toMatchObject([{ id: m.id, status: 'applied' }])
      await vi.waitFor(() => expect(reportError).toHaveBeenCalledWith(expect.objectContaining({ message: 'division by zero' }), { area: 'poke' }))
      expect(told).toHaveLength(1)
      expect((await db.query('SELECT id FROM places')).rows).toEqual([{ id: 'a3' }])
      expect((await app.inject({ method: 'GET', url: '/api/health' })).statusCode).toBe(200)
    } finally {
      ws.terminate()
    }
  })
})

describe('a character the database cannot hold', () => {
  it("is cleaned from a person's name sent through the sync push, so the phone and the server hold the same words", async () => {
    // Proves: a NUL, which neither Postgres's text nor its JSON can hold, with other control characters and half an emoji,
    // in a person's name and notes from an older app that sent them as typed, is applied cleaned, not a 500, and the history
    // keeps it; this app cleans the same text on the phone before it's sent, so the phone's copy and the server's agree.
    const db = await pgliteDb()
    const app = await server(db)
    const person = (id: string, name: string, notes: string) => ({ id, name, kind: 'freelancer' as const, email: null, phone: null, skills: [], dayRateCents: null, notes })
    const older = mutation('person.upsert', person('p1', 'Seán\u0000 Ó Briain\u007f\ud83c', 'Rang\u000bfrom the M50\tlate\u0001'))
    const res = await push(app, [older])
    expect(res.statusCode).toBe(200)
    expect(res.json().results).toMatchObject([{ id: older.id, status: 'applied' }])
    expect((await db.query('SELECT name, notes FROM people')).rows).toEqual([{ name: 'Seán Ó Briain', notes: 'Rang\nfrom the M50\tlate' }])
    expect((await app.inject('/api/history')).json().entries).toMatchObject([{ what: "Saved Seán Ó Briain's details", outcome: 'done' }])

    const transport: Transport = {
      push: async (req) => (await app.inject({ method: 'POST', url: '/api/sync/push', payload: req })).json(),
      pull: async (after) => (await app.inject({ url: `/api/sync/pull?after=${after}` })).json(),
    }
    const phone = await new SyncClient({ storage: new MemoryStorage(), transport }).open()
    await phone.mutate('person.upsert', person('p2', 'Dara\u0000 Quinn', 'Own van\u000bno trailer'))
    const shown = phone.view().crew.people.find((p) => p.id === 'p2')
    expect([shown?.name, shown?.notes]).toEqual(['Dara Quinn', 'Own van\nno trailer'])
    await phone.sync()
    const kept = (await db.query<{ name: string; notes: string }>("SELECT name, notes FROM people WHERE id = 'p2'")).rows[0]
    expect(kept).toEqual({ name: 'Dara Quinn', notes: 'Own van\nno trailer' })
    expect(phone.view().crew.people.find((p) => p.id === 'p2')).toMatchObject(kept!)
    expect(reportError).not.toHaveBeenCalled()
  })

  it("anywhere it can't be cleaned, such as an id, is a refusal in plain words for that change alone, never a 500, and isn't reported", async () => {
    // Proves: the server's safety net: a NUL in an id inside a change is turned down with a reason and recorded like any refusal;
    // one in the change's own id, or half an emoji there, which Postgres's JSON calls bad, can't even be recorded, and is turned
    // down all the same; the rest of the push goes through; a NUL in a request's address answers 400 with the same plain words;
    // and none of it is reported as a fault of the server's.
    const db = await pgliteDb()
    const app = await server(db)
    const inArgs = mutation('place.upsert', { ...A3, id: 'a\u00003' })
    const ownId = { ...mutation('place.upsert', VAN1), id: 'm\u0000' }
    const halfEmoji = { ...mutation('place.upsert', VAN1), id: 'm\ud83c' }
    const fine = mutation('place.upsert', VAN2)
    const res = await push(app, [inArgs, ownId, halfEmoji, fine])
    expect(res.statusCode).toBe(200)
    expect(res.json().results).toEqual([
      { id: inArgs.id, status: 'rejected', reason: { code: 'invalid', message: CHARACTERS } },
      { id: ownId.id, status: 'rejected', reason: { code: 'invalid', message: CHARACTERS } },
      { id: halfEmoji.id, status: 'rejected', reason: { code: 'invalid', message: CHARACTERS } },
      { id: fine.id, status: 'applied', seq: expect.any(Number) },
    ])
    expect((await db.query('SELECT id FROM places')).rows).toEqual([{ id: 'van2' }])
    expect((await app.inject('/api/history')).json().entries).toMatchObject([
      { command: 'place.upsert', outcome: 'done' },
      { command: 'place.upsert', outcome: 'turned-down', reason: CHARACTERS },
    ])

    const asked = await app.inject({ url: '/api/documents/d1%00/file' })
    expect(asked.statusCode).toBe(400)
    expect(asked.json()).toEqual({ error: CHARACTERS })
    expect(reportError).not.toHaveBeenCalled()
  })

  it('is told apart from JSON the server built wrong, which is still a fault, dropped or answered as one and reported', async () => {
    // Proves: Postgres calls JSON the server built wrong bad JSON under the same code as half an emoji; that's the server's
    // own fault, never something sent, so a change it hits is dropped and reported, and a request it hits answers 500 and is
    // reported, rather than either being told about a character nobody typed.
    const BUILT_WRONG = `SELECT '[object Object]'::jsonb`
    const db = withFault(await pgliteDb(), (sql) => sql.startsWith('INSERT INTO places'), BUILT_WRONG)
    const app = await server(db)
    db.failNext = true
    const bad = mutation('place.upsert', A3)
    expect((await push(app, [bad])).json().results).toMatchObject([{ id: bad.id, status: 'rejected', reason: { message: expect.stringContaining('dropped') } }])
    expect(reportError).toHaveBeenCalledWith(expect.objectContaining({ code: '22P02' }), { area: 'commands', command: 'place.upsert' })

    vi.mocked(reportError).mockClear()
    const app2 = await server({ ...db, query: (sql, params) => (sql.includes('max(seq)') ? db.query(BUILT_WRONG) : db.query(sql, params)) })
    const res = await app2.inject({ method: 'GET', url: '/api/health' })
    expect([res.statusCode, res.json()]).toEqual([500, { error: 'Something went wrong on the server.' }])
    expect(reportError).toHaveBeenCalledWith(expect.objectContaining({ code: '22P02' }), { route: '/api/health', method: 'GET' })
  })
})
