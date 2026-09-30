import { newId, type Mutation, type Person } from '@sh/shared'
import { strFromU8, unzipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import { buildApp } from '../src/app.ts'
import type { IdentityProvider } from '../src/auth/google.ts'
import { migrateAuth } from '../src/auth/schema.ts'
import { createSession, endSession, sessionUser, upsertUser } from '../src/auth/sessions.ts'
import { restoreBackup, writeBackup } from '../src/backup/format.ts'
import { checkRestores } from '../src/backup/service.ts'
import { postgresDb, type Db } from '../src/db.ts'
import { FakeGoogle } from './fake-google-calendar.ts'
import { IPHONE, onLink, staff } from './people.ts'

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

  it('keeps staff sessions: sign in, renew while used, sign out', async () => {
    const db = postgresDb(url!)
    await db.exec('DROP TABLE IF EXISTS sessions, users, auth_schema_version CASCADE')
    await migrateAuth(db)
    try {
      const identity = { subject: 's1', email: 'aoife@sessionhire.com', emailVerified: true, name: 'Aoife Byrne', hostedDomain: 'sessionhire.com' }
      const user = await upsertUser(db, identity)
      expect(await upsertUser(db, { ...identity, name: 'Aoife B.' })).toEqual(user)
      const token = await createSession(db, user.id, 'test')
      expect(await sessionUser(db, token)).toEqual({ user: { id: user.id, email: 'aoife@sessionhire.com', name: 'Aoife B.' }, renewed: false })

      await db.query("UPDATE sessions SET last_seen_at = now() - interval '2 days', expires_at = now() + interval '1 day'")
      expect((await sessionUser(db, token))?.renewed).toBe(true)
      const { rows } = await db.query<{ days: number }>('SELECT round(extract(epoch FROM expires_at - now()) / 86400)::int AS days FROM sessions')
      expect(rows[0]!.days).toBe(60)

      await endSession(db, token)
      expect(await sessionUser(db, token)).toBeUndefined()
    } finally {
      await db.close()
    }
  })

  it('backs up and restores exactly, into Postgres and into the nightly test restore', { timeout: 60_000 }, async () => {
    const db = postgresDb(url!)
    await db.exec('DROP SCHEMA public CASCADE; CREATE SCHEMA public')
    const scratchUrl = new URL(url!)
    scratchUrl.pathname = '/sh_restore_test'
    await db.query('DROP DATABASE IF EXISTS sh_restore_test')
    await db.query('CREATE DATABASE sh_restore_test')
    const target = postgresDb(scratchUrl.toString())
    const app = await buildApp({ db })
    try {
      const push = (...mutations: Mutation[]) => app.inject({ method: 'POST', url: '/api/sync/push', payload: { clientId: 'office', mutations } })
      const m = (name: Mutation['name'], args: object): Mutation => ({ id: newId(), name, args: args as never, createdAt: new Date().toISOString() })
      await push(
        m('product.upsert', { id: 'y10p', name: 'd&b Y10P "line array"', quantity: 4 }),
        m('booking.create', { id: 'b1', productId: 'y10p', project: 'Féile na nDéise 🎶', qty: 2, start: '2026-10-05', end: '2026-10-06' }),
        m('person.upsert', { id: 'p1', name: 'Seán Ó Briain', kind: 'freelancer', email: null, phone: null, skills: ['audio'], dayRateCents: 25000, notes: 'Tab\there\nand a new line' })
      )
      await db.query(`UPDATE mutations SET received_at = '2026-09-29 19:36:08.123456+00'`)
      const head = Number((await db.query<{ n: string }>('SELECT max(seq) AS n FROM changes')).rows[0]!.n)

      const backup = await writeBackup(db)
      // What the server does every night: restore into PGlite in memory and check every table.
      expect((await checkRestores(backup.data)).rows).toBe(backup.rows)
      // What a real restore does: into a new, empty Postgres database.
      await restoreBackup(target, backup.data)
      for (const table of backup.header.tables) expect(await contents(target, table)).toEqual(await contents(db, table))

      const restored = await buildApp({ db: target })
      const next = await restored.inject({ method: 'POST', url: '/api/sync/push', payload: { clientId: 'office', mutations: [m('product.upsert', { id: 'ls9', name: 'Yamaha LS9', quantity: 1 })] } })
      expect(next.json().results[0]).toMatchObject({ status: 'applied', seq: head + 1 })
      await restored.close()
    } finally {
      await app.close()
      await target.close()
      await db.query('DROP DATABASE IF EXISTS sh_restore_test')
      await db.close()
    }
  })

  it('keeps the history and downloads everything, as on PGlite', async () => {
    const db = postgresDb(url!)
    await db.exec('DROP SCHEMA public CASCADE; CREATE SCHEMA public')
    const app = await buildApp({ db, auth: { provider: {} as IdentityProvider, domains: ['sessionhire.com'], emails: [] } })
    try {
      const colly = await staff(app, db, 'Colly Hewson', IPHONE, 'phone-c0ffee')
      await colly.send('product.upsert', { id: 'y10p', name: 'd&b Y10P', quantity: 4 })
      await colly.send('booking.create', { id: 'b1', productId: 'y10p', project: 'Electric Picnic', qty: 4, start: '2026-10-02', end: '2026-10-04' }, { hoursWaiting: 2 })
      await colly.send('booking.create', { id: 'b2', productId: 'y10p', project: 'Body & Soul', qty: 1, start: '2026-10-03', end: '2026-10-03' })
      await colly.send('person.upsert', { id: 'p1', name: 'Seán Ó Briain', kind: 'freelancer', email: null, phone: null, skills: [], dayRateCents: 25000, notes: '' })
      await colly.send('call.create', {
        id: 'c1',
        project: 'Electric Picnic',
        phase: 'Build',
        venue: 'Stradbally Hall',
        role: 'Audio tech',
        start: '2026-10-02',
        end: '2026-10-04',
        callTime: '08:00',
        needed: 1,
        dayRateCents: 25000,
        details: '',
        replyBy: null,
      })
      await colly.send('offer.send', { id: 'o1', callId: 'c1', personId: 'p1', override: false })
      const { linkToken } = await colly.record<Person>('person', 'p1')
      await onLink(app, `/f/${linkToken}/offers/o1`, { answer: 'accept' })

      // Newest first, a page at a time, as the History tab reads it.
      const first = await colly.history('?limit=4')
      expect(first.entries.map((e) => [e.who.name, e.what])).toEqual([
        ['Seán Ó Briain', 'Seán Ó Briain accepted Audio tech on Electric Picnic'],
        ['Colly Hewson', 'Offered Audio tech on Electric Picnic to Seán Ó Briain'],
        ['Colly Hewson', 'Asked for 1 × Audio tech for Electric Picnic (Build), Fri 2 Oct to Sun 4 Oct'],
        ['Colly Hewson', "Saved Seán Ó Briain's details"],
      ])
      expect(first.people).toEqual([
        { key: `user:${colly.id}`, name: 'Colly Hewson' },
        { key: 'link:p1', name: 'Seán Ó Briain' },
      ])
      const second = await colly.history(`?limit=4&before=${first.next}`)
      expect(second.entries.map((e) => [e.what, e.outcome, e.madeOffline])).toEqual([
        ['Booked 1 × d&b Y10P for Body & Soul, Sat 3 Oct', 'turned-down', false],
        ['Booked 4 × d&b Y10P for Electric Picnic, Fri 2 Oct to Sun 4 Oct', 'done', true],
        ['Set d&b Y10P to 4 in stock', 'done', false],
      ])
      expect(second.next).toBeUndefined()
      expect(second.entries[1]).toMatchObject({ device: 'Safari on iPhone', deviceCode: 'c0ffee', waitedSeconds: 7200 })
      expect((await colly.history('?who=link:p1')).entries.map((e) => e.who)).toEqual([{ kind: 'link', name: 'Seán Ó Briain', key: 'link:p1' }])
      expect((await colly.history('?id=b1&entity=booking')).entries.map((e) => e.id)).toEqual([second.entries[1]!.id])

      // Everything at one moment, with no link secret in it, and the download itself in the history.
      const res = await app.inject({ url: '/api/export.zip?client=phonec0ffee', cookies: colly.cookies, headers: { 'user-agent': IPHONE } })
      expect(res.statusCode).toBe(200)
      const files = Object.fromEntries(Object.entries(unzipSync(new Uint8Array(res.rawPayload))).map(([name, data]) => [name, strFromU8(data)]))
      expect(files['history.csv']).toContain('Seán Ó Briain accepted Audio tech on Electric Picnic')
      for (const [name, text] of Object.entries(files)) expect(text, name).not.toContain(linkToken)
      expect(files['tables/people.csv']).not.toContain('link_token')
      expect(JSON.parse(files['everything.json']!).mutations[0].received_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d+\+00:00$/)
      expect((await colly.history('?limit=1')).entries[0]).toMatchObject({ what: expect.stringMatching(/^Downloaded everything \(\d+ rows\)$/), deviceCode: 'c0ffee' })
    } finally {
      await app.close()
      await db.close()
    }
  })

  it('puts confirmed jobs on Google Calendar, and takes crew answers from it, as on PGlite', async () => {
    const db = postgresDb(url!)
    await db.exec('DROP SCHEMA public CASCADE; CREATE SCHEMA public')
    const google = new FakeGoogle()
    const now = () => new Date('2030-03-02T10:00:00Z')
    google.clock = now
    const app = await buildApp({
      db,
      auth: { provider: {} as IdentityProvider, domains: ['sessionhire.com'], emails: [] },
      calendar: { clientId: google.clientId, clientSecret: google.clientSecret, fetch: google.fetch, gapMs: 0, settleMs: 3_600_000, now },
    })
    try {
      const colly = await staff(app, db, 'Colly Hewson', IPHONE, 'phone-c0ffee')
      await colly.send('client.upsert', { id: 'nissan', name: 'Nissan Ireland', contacts: [], notes: '' })
      await colly.send('venue.upsert', { id: 'ccd', name: 'The Convention Centre Dublin', address: 'Spencer Dock, Dublin 1', notes: '' })
      await colly.send('project.create', { id: 'j1', name: 'Nissan', clientId: 'nissan', venueId: 'ccd', status: 'confirmed', notes: '' })
      await colly.send('phase.add', { id: 'build', projectId: 'j1', name: 'Build', start: '2030-03-01', end: '2030-03-03', venueId: null, notes: '' })
      await colly.send('person.upsert', { id: 'p1', name: 'Seán Ó Briain', kind: 'freelancer', email: null, phone: null, skills: [], dayRateCents: 25000, notes: '' })
      await colly.send('call.create', {
        id: 'c1',
        projectId: 'j1',
        phaseId: 'build',
        project: 'Nissan',
        phase: 'Build',
        venue: '',
        role: 'Audio tech',
        start: '2030-03-01',
        end: '2030-03-03',
        callTime: '08:00',
        needed: 2,
        dayRateCents: 25000,
        details: '',
        replyBy: null,
      })
      await colly.send('offer.send', { id: 'o1', callId: 'c1', personId: 'p1', override: false })
      const { linkToken } = await colly.record<Person>('person', 'p1')
      await onLink(app, `/f/${linkToken}/offers/o1`, { answer: 'accept' })

      const start = await app.inject({ url: '/api/calendar/connect?client=phonec0ffee', cookies: colly.cookies })
      const { code, state } = google.consent(start.headers.location as string)
      const attempt = start.cookies.find((c) => c.name === 'sh_calendar')!.value
      const back = await app.inject({ url: `/api/calendar/callback?code=${code}&state=${state}`, cookies: { ...colly.cookies, sh_calendar: attempt } })
      expect(back.headers.location).toBe('/?calendar=connected#account')
      const cal = 'test-cal@group.calendar.google.com'
      expect((await app.inject({ method: 'POST', url: '/api/calendar/use?client=phonec0ffee', cookies: colly.cookies, payload: { calendarId: cal } })).statusCode).toBe(200)

      // Yesterday is left alone; today and tomorrow go on.
      expect(await app.calendar!.run()).toEqual({ written: 2, removed: 0, failed: 0 })
      expect(google.visible(cal).map((e) => [e.start.date, e.summary])).toEqual([
        ['2030-03-02', 'Nissan - Build 2/3'],
        ['2030-03-03', 'Nissan - Build 3/3'],
      ])
      expect(google.visible(cal)[0]!.description).toContain('Audio tech, call 08:00: Seán Ó Briain (to confirm) and 1 still to find')
      const day = await colly.record<{ day: string; state: string; title: string }>('calendarDay', 'build/2030-03-02')
      expect(day).toMatchObject({ day: '2030-03-02', state: 'on', title: 'Nissan - Build 2/3' })
      expect(await colly.record('calendarLink', 'main')).toMatchObject({ state: 'on', calendarName: 'Test calendar', connectedAt: expect.stringMatching(/Z$/) })

      // Nothing changed: the check finds the calendar as the app left it.
      expect(await app.calendar!.run(true)).toEqual({ written: 0, removed: 0, failed: 0 })
      expect((await colly.history('?limit=2')).entries.map((e) => e.what)).toEqual([
        'Chose Test calendar as the calendar for jobs',
        'Connected Google Calendar as ops@sessionhire.com',
      ])

      // Crew invites (ADR 0009): Niamh is offered the other place, says yes on Google Calendar, and the app takes it as her answer.
      await colly.send('person.upsert', { id: 'p2', name: 'Niamh Kelly', kind: 'freelancer', email: 'niamh@example.com', phone: null, skills: [], dayRateCents: 25000, notes: '' })
      await colly.send('offer.send', { id: 'o2', callId: 'c1', personId: 'p2', override: false })
      const on = await app.inject({ method: 'POST', url: '/api/calendar/invites?client=phonec0ffee', cookies: colly.cookies, payload: { on: true } })
      expect(on.statusCode, on.body).toBe(200)
      expect(await app.calendar!.run()).toEqual({ written: 2, removed: 0, failed: 0 })
      const [today, tomorrow] = google.visible(cal)
      expect(google.guests(cal, today!.id)).toEqual(['niamh@example.com needsAction'])
      expect(google.sent.map((m) => `${m.what} ${m.to} ${m.event}`)).toEqual([
        'invited niamh@example.com 2030-03-02 Nissan - Build 2/3',
        'invited niamh@example.com 2030-03-03 Nissan - Build 3/3',
      ])
      expect(await app.calendar!.poll()).toBe(0)
      google.respond(cal, today!.id, 'niamh@example.com', 'accepted')
      google.respond(cal, tomorrow!.id, 'niamh@example.com', 'accepted', 'See you there')
      // Two answers, one for each day, put to the offer together as one Yes.
      expect(await app.calendar!.poll()).toBe(2)
      expect(await app.calendar!.poll()).toBe(0)
      expect(await colly.record('offer', 'o2')).toMatchObject({ status: 'accepted', respondedVia: 'calendar', note: 'See you there' })
      expect((await colly.history('?limit=2')).entries.map((e) => [e.who.name, e.what])).toEqual([
        ['Niamh Kelly', expect.stringMatching(/^Niamh Kelly accepted /)],
        ['Colly Hewson', 'Turned on crew invites on Google Calendar (2 invites to 1 person)'],
      ])
    } finally {
      await app.close()
      await db.close()
    }
  })
})

function contents(db: Db, table: string) {
  return db.transaction(async (tx) => {
    await tx.query(`SET LOCAL TIME ZONE 'UTC'`)
    const { rows } = await tx.query<{ j: string }>(`SELECT row_to_json(r)::text AS j FROM ${table} r`)
    return rows.map((r) => r.j).sort()
  })
}
