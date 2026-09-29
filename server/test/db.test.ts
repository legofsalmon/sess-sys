import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { buildApp } from '../src/app.ts'
import { dbFromEnv, type Db } from '../src/db.ts'

/**
 * A deploy must never look healthy while quietly keeping its data in
 * memory. These pin down which database each setting gives, and that the
 * health check says so.
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
