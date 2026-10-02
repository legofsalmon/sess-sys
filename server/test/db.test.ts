import { mkdtempSync, rmSync } from 'node:fs'
import { createServer, type AddressInfo, type Socket } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import pg from 'pg'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildApp } from '../src/app.ts'
import { dbFromEnv, postgresDb, type Db } from '../src/db.ts'

/**
 * A deploy must never look healthy while quietly keeping its data in
 * memory. These pin down which database each setting gives, that the
 * health check says so, and that a connection failing, idle in the pool or
 * in the middle of a transaction, is heard rather than left to stop the
 * server (audit finding 20).
 */

let opened: Db[] = []
afterEach(async () => {
  for (const db of opened) await db.close()
  opened = []
})

async function open(env: NodeJS.ProcessEnv) {
  const db = await dbFromEnv(env)
  opened.push(db)
  return db
}

describe('choosing the database', () => {
  it('uses memory for local development with nothing set', async () => {
    expect((await open({})).kind).toBe('memory')
  })

  it('uses Postgres when DATABASE_URL is set', async () => {
    // The pool connects lazily, so no server is needed to check the choice.
    expect((await open({ DATABASE_URL: 'postgresql://nobody@127.0.0.1:1/none', NODE_ENV: 'production' })).kind).toBe('postgres')
  })

  it('uses a file database when DATA_DIR is set, even on a host', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sh-db-'))
    try {
      expect((await open({ DATA_DIR: dir, RAILWAY_ENVIRONMENT_NAME: 'production' })).kind).toBe('file')
    } finally {
      for (const db of opened.splice(0)) await db.close()
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it.each([{ RAILWAY_ENVIRONMENT_NAME: 'production' }, { RAILWAY_ENVIRONMENT: 'production' }, { NODE_ENV: 'production' }])(
    'refuses to start on a host without a database (%o)',
    async (env) => {
      await expect(dbFromEnv(env)).rejects.toThrow('No database configured')
    }
  )

  it('reports the database in the health check', async () => {
    const app = await buildApp({ db: await open({}) })
    try {
      const health = (await app.inject('/api/health')).json()
      expect(health).toMatchObject({ ok: true, db: 'memory', cursor: 0 })
    } finally {
      await app.close()
    }
  })
})

describe('a connection that fails while idle', () => {
  it('is logged and reported, not left to stop the server', () => {
    // Proves: the pool raises the failure as an event, and the event has a listener; without one it would end the process.
    const on = vi.spyOn(pg.Pool.prototype, 'on')
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const heard: Error[] = []
      opened.push(postgresDb('postgresql://nobody@127.0.0.1:1/none', (err) => heard.push(err)))
      const handler = on.mock.calls.find(([event]) => event === 'error')?.[1] as ((err: Error) => void) | undefined
      expect(handler).toBeDefined()
      handler!(new Error('terminating connection due to administrator command'))
      expect(heard.map((e) => e.message)).toEqual(['terminating connection due to administrator command'])

      // By default it goes to the log, with the error reporter told too.
      opened.push(postgresDb('postgresql://nobody@127.0.0.1:1/none'))
      const byDefault = on.mock.calls.filter(([event]) => event === 'error').at(-1)?.[1] as (err: Error) => void
      expect(() => byDefault(new Error('connection reset'))).not.toThrow()
      expect(log).toHaveBeenCalledWith(expect.stringContaining('failed while idle'), 'connection reset')
    } finally {
      on.mockRestore()
      log.mockRestore()
    }
  })
})

describe('a connection that fails in the middle of a transaction', () => {
  it('fails that transaction, not the server', async () => {
    // Proves: out of the pool, pg raises the failure as an event too; with nobody listening it would end the process.
    const pretend = await pretendPostgres()
    const db = postgresDb(pretend.url, () => {})
    opened.push(db)
    const uncaught: unknown[] = []
    const heard = (err: unknown) => void uncaught.push(err)
    process.on('uncaughtException', heard)
    try {
      const work = db.transaction(async (tx) => {
        await tx.query('SELECT 1')
        await tx.query('SELECT 2 -- the connection drops here')
      })
      await expect(work).rejects.toThrow('Connection terminated unexpectedly')
      await new Promise((r) => setTimeout(r, 50))
      expect(uncaught).toEqual([])
      expect(pretend.queries).toEqual(['BEGIN', 'SELECT 1', 'SELECT 2 -- the connection drops here'])
    } finally {
      process.off('uncaughtException', heard)
    }
  })
})

/**
 * Just enough of a Postgres server for pg to connect and run plain
 * statements, each answered as done; one that says "drops" ends the
 * connection mid-statement, as a database restarting would.
 */
async function pretendPostgres() {
  const queries: string[] = []
  const sockets = new Set<Socket>()
  const message = (type: string, body: string | Buffer) => {
    const data = typeof body === 'string' ? Buffer.from(body) : body
    const head = Buffer.alloc(5)
    head.write(type)
    head.writeInt32BE(data.length + 4, 1)
    return Buffer.concat([head, data])
  }
  const server = createServer((socket) => {
    sockets.add(socket)
    let started = false
    let buffered = Buffer.alloc(0)
    socket.on('data', (data) => {
      buffered = Buffer.concat([buffered, data])
      while (buffered.length >= (started ? 5 : 4)) {
        const length = started ? buffered.readInt32BE(1) + 1 : buffered.readInt32BE(0)
        if (buffered.length < length) return
        const [type, body] = started ? [String.fromCharCode(buffered[0]!), buffered.subarray(5, length)] : ['', buffered.subarray(4, length)]
        buffered = buffered.subarray(length)
        if (!started) {
          // pg asks for TLS first (that code), and is told no; then it is signed in at once, and ready.
          if (body.readInt32BE(0) === 80877103) socket.write('N')
          else {
            started = true
            socket.write(Buffer.concat([message('R', Buffer.alloc(4)), message('Z', 'I')]))
          }
        } else if (type === 'Q') {
          const sql = body.toString('utf8', 0, body.length - 1)
          queries.push(sql)
          if (sql.includes('drops')) return void socket.destroy()
          socket.write(Buffer.concat([message('C', `${sql.split(' ')[0]}\0`), message('Z', sql === 'COMMIT' || sql === 'ROLLBACK' ? 'I' : 'T')]))
        }
      }
    })
    socket.on('error', () => {})
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const close = () => {
    for (const s of sockets) s.destroy()
    return new Promise<void>((resolve) => server.close(() => resolve()))
  }
  opened.push({ close } as Db)
  return { url: `postgresql://nobody:x@127.0.0.1:${(server.address() as AddressInfo).port}/none`, queries }
}
