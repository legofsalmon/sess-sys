import { newId, splitName, type CommandInput, type CommandName, type MutationResult, type Person } from '@sh/shared'
import type { FastifyInstance } from 'fastify'
import { afterEach, describe, expect, it } from 'vitest'
import { buildApp } from '../src/app.ts'
import { CREW, migrateCrew } from '../src/crew/schema.ts'
import { pgliteDb } from '../src/db.ts'
import { readEverything } from '../src/export.ts'
import { migrateAll } from '../src/modules.ts'

/** A first and a last name in place of one name (ADR 0066): the people already here split on deploy, and the two kept from then on. */

let cleanup: (() => Promise<void>)[] = []
afterEach(async () => {
  for (const fn of cleanup.reverse()) await fn()
  cleanup = []
})

async function server() {
  const db = await pgliteDb()
  const app = await buildApp({ db })
  cleanup.push(async () => {
    await app.close()
    await db.close()
  })
  return { app, db }
}

async function send<N extends CommandName>(app: FastifyInstance, name: N, args: CommandInput<N>): Promise<MutationResult> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/sync/push',
    payload: { clientId: 'ops-laptop', mutations: [{ id: newId(), name, args, createdAt: new Date().toISOString() }] },
  })
  return res.json().results[0]
}

async function person(app: FastifyInstance, id: string): Promise<Person> {
  const res = await app.inject({ method: 'GET', url: '/api/sync/pull?after=0' })
  const changes = res.json().changes.filter((c: { entity: string; id: string }) => c.entity === 'person' && c.id === id)
  return changes[changes.length - 1].data
}

const details = (id: string, name: string) => ({ id, name, kind: 'freelancer' as const, email: null, phone: null, skills: [], dayRateCents: null, notes: '' })

/** Names as the calendars and the crew list brought them in, and as people type them. */
const NAMES = [
  'Aoife Byrne',
  'Seán Ó Briain',
  'Áine Nic Dhonnchadha',
  'Ciarán Mac Mathúna',
  'Mary Ann Smith',
  '  Dara   Quinn  ',
  'Jan van der Berg',
  'Ó Briain',
  'Cher',
  'craicaudio',
  'Erased person',
  'Eoin O Neill',
  'DÓNAL Ó SÉ',
]

describe('first and last names', () => {
  it('split as the people already here are split on deploy, the same way the app splits a name', async () => {
    const db = await pgliteDb()
    cleanup.push(() => db.close())
    await migrateAll(db)
    // As the database was the day before: one name each.
    const split = CREW.migrations.findIndex((m) => m.includes('sh_split_name'))
    expect(split).toBeGreaterThan(0)
    await db.query('ALTER TABLE people DROP COLUMN first_name, DROP COLUMN last_name')
    await db.query('UPDATE crew_schema_version SET version = $1', [split])
    for (const [i, name] of NAMES.entries()) await db.query(`INSERT INTO people (id, name, kind, link_token) VALUES ($1, $2, 'freelancer', $3)`, [`p${i}`, name, `t${i}`])
    await migrateCrew(db)

    const { rows } = await db.query<{ id: string; first_name: string; last_name: string }>('SELECT id, first_name, last_name FROM people ORDER BY id')
    const got = Object.fromEntries(rows.map((r) => [r.id, { firstName: r.first_name, lastName: r.last_name }]))
    expect(NAMES.map((n, i) => got[`p${i}`])).toEqual(NAMES.map(splitName))
    expect(got.p1).toEqual({ firstName: 'Seán', lastName: 'Ó Briain' })
    expect(got.p6).toEqual({ firstName: 'Jan', lastName: 'van der Berg' })
    expect(got.p8).toEqual({ firstName: 'Cher', lastName: '' })
    // Nothing else of theirs changes, and the function that split them is gone.
    expect((await db.query(`SELECT name FROM people WHERE id = 'p5'`)).rows).toEqual([{ name: '  Dara   Quinn  ' }])
    expect((await db.query(`SELECT count(*)::int AS n FROM pg_proc WHERE proname = 'sh_split_name'`)).rows).toEqual([{ n: 0 }])
  })

  it('make the whole name, and are kept by a change that sends only the name', async () => {
    const { app, db } = await server()
    const id = newId()
    expect((await send(app, 'person.upsert', { ...details(id, 'Seán Ó Briain'), firstName: ' Seán ', lastName: 'Ó Briain' })).status).toBe('applied')
    expect(await person(app, id)).toMatchObject({ name: 'Seán Ó Briain', firstName: 'Seán', lastName: 'Ó Briain' })

    // A version of the app from before sends the whole name: unchanged, the two stay as typed.
    expect((await send(app, 'person.upsert', { ...details(id, 'Seán Ó Briain'), phone: '+353871234567' })).status).toBe('applied')
    expect(await person(app, id)).toMatchObject({ name: 'Seán Ó Briain', firstName: 'Seán', lastName: 'Ó Briain', phone: '+353871234567' })

    // A new whole name is split.
    expect((await send(app, 'person.upsert', details(id, 'Seán Óg Ó Briain'))).status).toBe('applied')
    expect(await person(app, id)).toMatchObject({ name: 'Seán Óg Ó Briain', firstName: 'Seán Óg', lastName: 'Ó Briain' })

    // Two that don't make the name sent (an older copy spread into the change) give way to it.
    expect((await send(app, 'person.upsert', { ...details(id, 'Seán Óg Mac Mathúna'), firstName: 'Seán Óg', lastName: 'Ó Briain' })).status).toBe('applied')
    expect(await person(app, id)).toMatchObject({ name: 'Seán Óg Mac Mathúna', firstName: 'Seán Óg', lastName: 'Mac Mathúna' })

    // A first name alone is a whole name; one is needed.
    expect((await send(app, 'person.upsert', { ...details(id, 'Cher'), firstName: 'Cher', lastName: '' })).status).toBe('applied')
    expect(await person(app, id)).toMatchObject({ name: 'Cher', firstName: 'Cher', lastName: '' })
    const refused = await send(app, 'person.upsert', { ...details(id, 'Cher'), firstName: '  ', lastName: 'Smith' })
    expect(refused).toMatchObject({ status: 'rejected', reason: { message: 'A first name is needed.' } })

    // Each is a column of its own in Download everything.
    const people = (await readEverything(db)).tables.find((t) => t.name === 'people')!
    expect(people.rows.find((r) => r.id === id)).toMatchObject({ name: 'Cher', first_name: 'Cher', last_name: '' })
  })

  it('come split for someone added from a calendar or before the two were asked for', async () => {
    const { app, db } = await server()
    const id = newId()
    expect((await send(app, 'person.upsert', details(id, 'Áine Nic Dhonnchadha'))).status).toBe('applied')
    expect(await person(app, id)).toMatchObject({ firstName: 'Áine', lastName: 'Nic Dhonnchadha' })
    // A row the split never reached reads split all the same.
    await db.query(`UPDATE people SET first_name = '', last_name = '' WHERE id = $1`, [id])
    expect((await send(app, 'person.level', { id, level: 2 })).status).toBe('applied')
    expect(await person(app, id)).toMatchObject({ firstName: 'Áine', lastName: 'Nic Dhonnchadha' })
  })
})
