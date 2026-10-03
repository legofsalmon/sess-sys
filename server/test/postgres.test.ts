import { irishToday, itemLogWords, newId, type ItemLogPage, type Mutation, type Person, type StockListReading, type StockListResult } from '@sh/shared'
import { strFromU8, unzipSync } from 'fflate'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { buildApp } from '../src/app.ts'
import type { IdentityProvider } from '../src/auth/google.ts'
import { migrateAuth } from '../src/auth/schema.ts'
import { createSession, endSession, sessionUser, upsertUser } from '../src/auth/sessions.ts'
import { restoreBackup, writeBackup } from '../src/backup/format.ts'
import { checkRestores } from '../src/backup/service.ts'
import { postgresDb, type Db } from '../src/db.ts'
import { eraseWhatIsDue } from '../src/erasure/due.ts'
import { ERASED_WHEN_DUE_ACTION } from '../src/history.ts'
import { FakeGoogle } from './fake-google-calendar.ts'
import { IPHONE, onLink, staff, typedOnly } from './people.ts'

/**
 * PGlite runs one query at a time, so it cannot show what happens when
 * several devices sync at the same moment. This runs against a real
 * Postgres when TEST_DATABASE_URL is set (CI sets it).
 */
const url = process.env.TEST_DATABASE_URL

/**
 * Years opened for leave in a test's setup, straight into the table as the migration opens a year with leave in it:
 * these tests keep leave from years long gone, which no approver can open today (ADR 0024).
 */
const openYears = (db: Db, ...years: number[]) => db.query(`INSERT INTO leave_years (year) SELECT unnest($1::int[]) ON CONFLICT DO NOTHING`, [years])

describe.skipIf(!url)('real Postgres, many devices at once', () => {
  it('never moves more than are counted, and keeps the change feed gap-free under concurrent pushes', async () => {
    const db = postgresDb(url!)
    await db.exec('DROP SCHEMA public CASCADE; CREATE SCHEMA public')
    const app = await buildApp({ db })
    try {
      const push = (clientId: string, mutations: Mutation[]) =>
        app.inject({ method: 'POST', url: '/api/sync/push', payload: { clientId, mutations } }).then((r) => r.json())
      const m = (name: Mutation['name'], args: object): Mutation => ({ id: newId(), name, args: args as never, createdAt: new Date().toISOString() })

      await push('office', [
        m('model.create', { id: 'y10p', name: 'd&b Y10P', department: 'audio', category: '', tracking: 'bulk', isCase: false, valueCents: null, notes: '' }),
        m('place.upsert', { id: 'a3', name: 'Bay A3', notes: '' }),
        m('place.upsert', { id: 'van1', name: 'Van 1', notes: '' }),
        m('stock.set', { modelId: 'y10p', placeId: 'a3', caseId: null, qty: 4 }),
      ])

      // Twenty devices each try to move one of the four speakers out of Bay A3 at the same moment.
      const answers = await Promise.all(
        Array.from({ length: 20 }, (_, i) =>
          push(`phone-${i}`, [m('stock.move', { modelId: 'y10p', fromPlaceId: 'a3', fromCaseId: null, toPlaceId: 'van1', toCaseId: null, qty: 1 })])
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
        m('model.create', { id: 'y10p', name: 'd&b Y10P "line array"', department: 'audio', category: '', tracking: 'bulk', isCase: false, valueCents: null, notes: '' }),
        m('place.upsert', { id: 'a3', name: 'Féile na nDéise 🎶', notes: 'Tab\there' }),
        m('stock.set', { modelId: 'y10p', placeId: 'a3', caseId: null, qty: 2 }),
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
      const next = await restored.inject({ method: 'POST', url: '/api/sync/push', payload: { clientId: 'office', mutations: [m('place.upsert', { id: 'van1', name: 'Van 1', notes: '' })] } })
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
      await colly.send('place.upsert', { id: 'a3', name: 'Bay A3', notes: '' })
      await colly.send('model.create', { id: 'y10p', name: 'd&b Y10P', department: 'audio', category: '', tracking: 'bulk', isCase: false, valueCents: null, notes: '' }, { hoursWaiting: 2 })
      expect((await colly.send('place.upsert', { id: 'a4', name: 'Bay A3', notes: '' })).status).toBe('rejected')
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
        ['Saved the place Bay A3', 'turned-down', false],
        ['Added the product d&b Y10P (Audio, counted)', 'done', true],
        ['Saved the place Bay A3', 'done', false],
      ])
      expect(second.next).toBeUndefined()
      expect(second.entries[1]).toMatchObject({ device: 'Safari on iPhone', deviceCode: 'c0ffee', waitedSeconds: 7200 })
      expect((await colly.history('?who=link:p1')).entries.map((e) => e.who)).toEqual([{ kind: 'link', name: 'Seán Ó Briain', key: 'link:p1' }])
      expect((await colly.history('?id=y10p&entity=model')).entries.map((e) => e.id)).toEqual([second.entries[1]!.id])

      // Everything at one moment, with no link secret in it, and the download itself in the history:
      // the app records it as it asks for the file (audit finding 20), so the file holds the record too.
      const recorded = await app.inject({
        method: 'POST',
        url: '/api/export/record?client=phonec0ffee',
        cookies: colly.cookies,
        headers: { 'user-agent': IPHONE },
        payload: { format: 'zip' },
      })
      expect(recorded.statusCode).toBe(200)
      const res = await app.inject({ url: '/api/export.zip?client=phonec0ffee', cookies: colly.cookies, headers: { 'user-agent': IPHONE } })
      expect(res.statusCode).toBe(200)
      const files = Object.fromEntries(Object.entries(unzipSync(new Uint8Array(res.rawPayload))).map(([name, data]) => [name, strFromU8(data)]))
      const everything = JSON.parse(files['everything.json']!) as Record<string, unknown[]>
      const rows = Object.entries(everything).reduce((n, [key, value]) => (key === 'exportedAt' ? n : n + value.length), 0)
      expect(recorded.json()).toEqual({ rows })
      expect(files['history.csv']).toContain('Seán Ó Briain accepted Audio tech on Electric Picnic')
      for (const [name, text] of Object.entries(files)) expect(text, name).not.toContain(linkToken)
      expect(files['tables/people.csv']).not.toContain('link_token')
      expect(JSON.parse(files['everything.json']!).mutations[0].received_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d+\+00:00$/)
      expect((await colly.history('?limit=1')).entries[0]).toMatchObject({ what: `Downloaded everything (${rows} rows)`, deviceCode: 'c0ffee' })
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

  it('brings jobs in from Google Calendar (ADR 0011), as on PGlite', async () => {
    const db = postgresDb(url!)
    await db.exec('DROP SCHEMA public CASCADE; CREATE SCHEMA public')
    const google = new FakeGoogle()
    const now = () => new Date('2031-03-05T10:00:00Z')
    google.clock = now
    const app = await buildApp({
      db,
      auth: { provider: {} as IdentityProvider, domains: ['sessionhire.com'], emails: [] },
      calendar: { clientId: google.clientId, clientSecret: google.clientSecret, fetch: google.fetch, gapMs: 0, settleMs: 3_600_000, now },
    })
    try {
      const colly = await staff(app, db, 'Colly Hewson', IPHONE, 'phone-c0ffee')
      const start = await app.inject({ url: '/api/calendar/connect?client=phonec0ffee', cookies: colly.cookies })
      const { code, state } = google.consent(start.headers.location as string)
      const attempt = start.cookies.find((c) => c.name === 'sh_calendar')!.value
      await app.inject({ url: `/api/calendar/callback?code=${code}&state=${state}`, cookies: { ...colly.cookies, sh_calendar: attempt } })
      const ops = 'ops@sessionhire.com'
      const guests = [{ email: 'aoife.byrne@gmail.com', displayName: 'Aoife Byrne', responseStatus: 'accepted' as const }]
      google.add(ops, { summary: 'Nissan - Build 1/2', days: '2031-03-10', location: 'Convention Centre Dublin, Spencer Dock', guests })
      google.add(ops, { summary: 'Nissan - Build 2/2', days: '2031-03-11', location: 'Convention Centre Dublin, Spencer Dock', guests })
      const post = (url: string, payload: object) => app.inject({ method: 'POST', url, cookies: colly.cookies, payload })

      const preview = (await post('/api/calendar/import/look', { calendarId: ops, from: '2031-01-01' })).json()
      expect(preview.jobs.map((j: { name: string; phases: unknown[] }) => [j.name, j.phases.length])).toEqual([['Nissan', 1]])
      const choices = {
        calendarId: ops,
        from: '2031-01-01',
        jobs: preview.jobs.map((j: { key: string; name: string }) => ({ key: j.key, name: j.name, include: true })),
        people: preview.people.map((p: { email: string }) => ({ email: p.email, include: true })),
      }
      const brought = await post('/api/calendar/import/bring', choices)
      expect(brought.json()).toEqual({ jobs: 1, added: 0, days: 2, venues: 1, people: 1, crew: 1, missing: [] })
      const { rows } = await db.query<{ name: string; source_calendar: string; phases: number; imported: number }>(
        `SELECT p.name, p.source_calendar, (SELECT count(*)::int FROM phases WHERE project_id = p.id) AS phases,
                (SELECT count(*)::int FROM calendar_imports WHERE project_id = p.id) AS imported
           FROM projects p`
      )
      expect(rows).toEqual([{ name: 'Nissan', source_calendar: ops, phases: 1, imported: 2 }])
      const again = (await post('/api/calendar/import/look', { calendarId: ops, from: '2031-01-01' })).json()
      expect(again.jobs).toEqual([])
      expect(again.leftOut).toEqual([{ reason: 'before', count: 2, examples: ['Nissan - Build 1/2', 'Nissan - Build 2/2'] }])
    } finally {
      await app.close()
      await db.close()
    }
  })

  it('erases a person on request from their record, the change feed, the history and their account, as on PGlite (ADR 0027)', async () => {
    // Proves: the rewrite of the feed and the history (jsonb, and regular expressions that match whole addresses only) does on Postgres what it does on PGlite.
    const db = postgresDb(url!)
    await db.exec('DROP SCHEMA public CASCADE; CREATE SCHEMA public')
    const app = await buildApp({ db, auth: { provider: {} as IdentityProvider, domains: ['sessionhire.com'], emails: [] } })
    try {
      const colly = await staff(app, db, 'Colly Hewson', IPHONE, 'phone-c0ffee')
      const cian = await staff(app, db, 'Cian Ó Murchú', IPHONE, 'phone-c1an00')
      const person = (id: string, name: string, email: string, phone: string | null, notes = '') =>
        colly.send('person.upsert', { id, name, kind: 'staff', email, phone, skills: [], dayRateCents: null, notes, approvesLeave: id === 'colly' })
      await person('colly', 'Colly Hewson', colly.email, null)
      await person('cian', 'Cian Ó Murchú', cian.email, '+353 87 444 0909', 'Vegetarian')
      await person('dara', 'Dara Quinn', 'dara.cian@sessionhire.com', '+353 87 444 09090')
      await colly.send('person.contact', { id: 'cian', phone: '+353 87 444 1010' })
      // Leave from four years ago, whose three years are up, so it goes and his name with it (Colly's decision, 2 October
      // 2026, keeps anything newer); declined first, as leave still waiting stops an erasure.
      const old = Number(irishToday().slice(0, 4)) - 4
      await openYears(db, old)
      await cian.send('leave.request', { id: 'r1', personId: 'cian', type: 'annual', start: `${old}-03-02`, end: `${old}-03-06`, note: 'Skiing in Andorra' })
      expect(await colly.send('leave.decide', { id: 'r1', approved: false, reason: '' })).toMatchObject({ status: 'applied' })
      await colly.send('person.archive', { id: 'cian', archived: true })
      expect(await colly.send('person.level', { id: 'cian', level: 2 })).toMatchObject({ status: 'rejected' })
      expect(await colly.send('person.erase', { id: 'cian' })).toMatchObject({ status: 'applied' })

      const all = async (table: string) => typedOnly((await db.query<{ j: string }>(`SELECT row_to_json(t)::text AS j FROM ${table} t`)).rows.map((r) => r.j).join('\n'))
      for (const table of ['people', 'changes', 'mutations', 'users', 'leave_requests', 'sessions'])
        for (const t of ['Murchú', '"cian@', '444 0909"', '444 1010', 'Vegetarian', 'Andorra']) expect(await all(table), `${table} still holds "${t}"`).not.toContain(t)
      expect((await db.query(`SELECT name, email, disabled FROM users WHERE id = $1`, [cian.id])).rows[0]).toEqual({ name: 'Erased person', email: '', disabled: true })
      expect((await db.query(`SELECT result->'reason'->>'message' AS said FROM mutations WHERE status = 'rejected'`)).rows).toEqual([
        { said: 'Erased person has been archived. Bring them back on the Crew tab to change their level.' },
      ])
      // Dara's address and number, which hold Cian's inside them, are as they were.
      expect((await db.query(`SELECT args->>'email' AS email, args->>'phone' AS phone FROM mutations WHERE args->>'id' = 'dara'`)).rows).toEqual([
        { email: 'dara.cian@sessionhire.com', phone: '+353 87 444 09090' },
      ])
      const fresh = await app.inject({ url: '/api/sync/pull?after=0', cookies: colly.cookies })
      expect(fresh.body).not.toContain('Murchú')
      expect(fresh.json().changes.filter((c: { entity: string }) => c.entity === 'leaveRequest').map((c: { op: string }) => c.op)).toEqual(['delete', 'delete', 'delete'])
    } finally {
      await app.close()
      await db.close()
    }
  })

  it("keeps a member of staff's leave for three years without what anyone wrote in it, as on PGlite (ADR 0027)", async () => {
    // Proves: the reading of each record's year, and the rewrite of its rows and earlier copies, do on Postgres what they do
    // on PGlite: this year's request stays without its note or reason, and the name with it; four years ago's goes.
    const db = postgresDb(url!)
    await db.exec('DROP SCHEMA public CASCADE; CREATE SCHEMA public')
    const app = await buildApp({ db, auth: { provider: {} as IdentityProvider, domains: ['sessionhire.com'], emails: [] } })
    try {
      const colly = await staff(app, db, 'Colly Hewson', IPHONE, 'phone-c0ffee')
      const aoife = await staff(app, db, 'Aoife Byrne', IPHONE, 'phone-a0f1e0')
      const person = (id: string, name: string, email: string) =>
        colly.send('person.upsert', { id, name, kind: 'staff', email, phone: null, skills: [], dayRateCents: null, notes: '', approvesLeave: id === 'colly' })
      await person('colly', 'Colly Hewson', colly.email)
      await person('aoife', 'Aoife Byrne', aoife.email)
      const year = Number(irishToday().slice(0, 4))
      await openYears(db, year, year - 4)
      for (const [id, y, note] of [['now', year, 'Family wedding in Kerry'], ['old', year - 4, 'Lanzarote with the girls']] as const) {
        expect(await aoife.send('leave.request', { id, personId: 'aoife', type: 'annual', start: `${y}-02-09`, end: `${y}-02-13`, note })).toMatchObject({ status: 'applied' })
        expect(await colly.send('leave.decide', { id, approved: true, reason: 'Covered by Cian' })).toMatchObject({ status: 'applied' })
      }
      await colly.send('person.archive', { id: 'aoife', archived: true })
      expect(await colly.send('person.erase', { id: 'aoife' })).toMatchObject({ status: 'applied' })

      expect((await db.query(`SELECT id, start_day::text AS start, status, note, reason FROM leave_requests`)).rows).toEqual([
        { id: 'now', start: `${year}-02-09`, status: 'approved', note: '', reason: '' },
      ])
      expect((await db.query(`SELECT p.name, e.name_kept_until::text AS until FROM people p JOIN erasures e ON e.person_id = p.id`)).rows).toEqual([
        { name: 'Aoife Byrne', until: `${year + 4}-01-01` },
      ])
      const copies = (await db.query<{ id: string; op: string; data: string | null }>(`SELECT entity_id AS id, op, data::text AS data FROM changes WHERE entity = 'leaveRequest'`)).rows
      expect([...new Set(copies.filter((c) => c.id === 'now').map((c) => c.op))]).toEqual(['put'])
      expect([...new Set(copies.filter((c) => c.id === 'old').map((c) => c.op))]).toEqual(['delete'])
      for (const t of ['Kerry', 'Lanzarote', 'Covered by']) expect(JSON.stringify(copies), t).not.toContain(t)
    } finally {
      await app.close()
      await db.close()
    }
  })

  it('takes what an erasure kept on its day once, with two copies of the server looking at the same moment (ADR 0027)', async () => {
    // Proves: each run looks again under the lock every change takes, so two servers on one database, each looking twice,
    // delete two years ago's leave on the day its three years are up once, in one history entry, and leave this year's.
    const db = postgresDb(url!)
    await db.exec('DROP SCHEMA public CASCADE; CREATE SCHEMA public')
    const app = await buildApp({ db })
    const other = postgresDb(url!)
    try {
      const m = (name: Mutation['name'], args: object): Mutation => ({ id: newId(), name, args: args as never, createdAt: new Date().toISOString() })
      const person = (id: string, name: string) =>
        m('person.upsert', { id, name, kind: 'staff', email: null, phone: null, skills: [], dayRateCents: null, notes: '', approvesLeave: id === 'colly' })
      const year = Number(irishToday().slice(0, 4))
      await openYears(db, year, year - 2)
      const mutations = [person('colly', 'Colly Hewson'), person('aoife', 'Aoife Byrne')]
      for (const [id, y] of [['then', year - 2], ['now', year]] as const)
        mutations.push(
          m('leave.request', { id, personId: 'aoife', type: 'annual', start: `${y}-02-09`, end: `${y}-02-13`, note: 'Family wedding in Kerry' }),
          m('leave.decide', { id, approved: true, reason: '', by: 'colly' })
        )
      mutations.push(m('person.archive', { id: 'aoife', archived: true }), m('person.erase', { id: 'aoife' }))
      const res = await app.inject({ method: 'POST', url: '/api/sync/push', payload: { clientId: 'office', mutations } })
      expect(res.json().results.map((r: { status: string }) => r.status)).toEqual(mutations.map(() => 'applied'))

      const day = `${year + 2}-01-01`
      expect((await Promise.all([eraseWhatIsDue(db, day), eraseWhatIsDue(other, day), eraseWhatIsDue(db, day), eraseWhatIsDue(other, day)])).sort()).toEqual([0, 0, 0, 1])
      expect((await db.query(`SELECT id FROM leave_requests`)).rows).toEqual([{ id: 'now' }])
      expect((await db.query(`SELECT count(*)::int AS n FROM mutations WHERE name = $1`, [ERASED_WHEN_DUE_ACTION])).rows).toEqual([{ n: 1 }])
      const sent = await db.query(`SELECT c.entity_id AS id, c.op FROM changes c JOIN mutations m ON m.id = c.mutation_id WHERE m.name = $1 AND c.entity = 'leaveRequest'`, [
        ERASED_WHEN_DUE_ACTION,
      ])
      expect(sent.rows).toEqual([{ id: 'then', op: 'delete' }])
    } finally {
      await app.close()
      await other.close()
      await db.close()
    }
  })

  it('starts fresh while phones are sending, and leaves nothing from before (ADR 0019)', async () => {
    const db = postgresDb(url!)
    await db.exec('DROP SCHEMA public CASCADE; CREATE SCHEMA public')
    const app = await buildApp({ db })
    try {
      expect((await app.inject({ method: 'POST', url: '/api/data/made-up' })).statusCode).toBe(200)
      const { generation } = (await app.inject({ url: '/api/sync/pull?after=0' })).json()
      const send = (i: number) =>
        app.inject({
          method: 'POST',
          url: '/api/sync/push',
          payload: {
            clientId: `phone${i}`,
            generation,
            mutations: [{ id: newId(), name: 'place.upsert', args: { id: `p${i}`, name: `Phone ${i}'s place`, notes: '' }, createdAt: new Date().toISOString() }],
          },
        })

      // Twenty phones, on the copy from before, send while the office starts fresh.
      const fresh = app.inject({ method: 'POST', url: '/api/data/start-fresh', payload: { confirm: 'delete everything' } })
      const [done, ...answers] = await Promise.all([fresh, ...Array.from({ length: 20 }, (_, i) => send(i))])
      expect(done.statusCode).toBe(200)
      // Each went in before and was deleted with the rest, or was turned away after.
      for (const a of answers) expect(a.json().stale === true || a.json().results[0].status === 'applied').toBe(true)
      expect((await send(20)).json()).toEqual({ results: [], stale: true })
      const { rows } = await db.query<{ places: number; changes: number; mutations: number }>(
        `SELECT (SELECT count(*)::int FROM places) AS places, (SELECT count(*)::int FROM changes) AS changes, (SELECT count(*)::int FROM mutations) AS mutations`
      )
      expect(rows[0]).toEqual({ places: 0, changes: 0, mutations: 1 })

      // Made-up data goes in again, numbered from the start.
      expect((await app.inject({ method: 'POST', url: '/api/data/made-up' })).statusCode).toBe(200)
      const { rows: numbers } = await db.query<{ first: string }>(`SELECT min(value) AS first FROM identifiers WHERE kind = 'sh'`)
      expect(numbers[0]!.first).toBe('SH-000001')
    } finally {
      await app.close()
      await db.close()
    }
  })

  it('brings the stock list in a call at a time, and reads an item’s log a page at a time, as on PGlite (ADR 0026)', async () => {
    const db = postgresDb(url!)
    await db.exec('DROP SCHEMA public CASCADE; CREATE SCHEMA public')
    const app = await buildApp({ db, auth: { provider: {} as IdentityProvider, domains: ['sessionhire.com'], emails: [] }, stockImport: { ms: 60_000, commands: 10 } })
    try {
      const colly = await staff(app, db, 'Colly Hewson', IPHONE, 'phone-c0ffee')
      const text = readFileSync(new URL('../../docs/samples/stock-list.csv', import.meta.url), 'utf8').replace('09/30/2027', '30/09/2027')
      const options = { make: true, defaultPlace: '' }
      const preview = async () => (await app.inject({ method: 'POST', url: '/api/stock/import/preview', cookies: colly.cookies, payload: { text, options } })).json() as StockListReading
      let rows = (await preview()).rows.map((r) => ({ row: r.row, cells: r.cells, skip: r.skip, does: r.does }))
      for (let going = false; ; going = true) {
        const res = await app.inject({ method: 'POST', url: '/api/stock/import', cookies: colly.cookies, payload: { rows, options, going } })
        expect(res.statusCode, res.body).toBe(200)
        const { left } = res.json() as StockListResult
        if (!left) break
        rows = rows.map((r) => ({ ...r, does: left.rows.find((x) => x.row === r.row)!.does }))
      }
      // The PAT due day read back as a day, and old numbers kept; the same file again finds everything as it says.
      const { rows: k12 } = await db.query<{ id: string; old: string; due: string }>(
        `SELECT a.id, a.old_number AS old, a.pat_due::text AS due FROM assets a JOIN identifiers i ON i.asset_id = a.id WHERE i.value = 'SH-000505'`
      )
      expect(k12[0]).toMatchObject({ old: 'A-0101', due: '2027-09-30' })
      expect((await preview()).counts).toMatchObject({ rows: 10, unchanged: 10, problems: 0 })

      // The amps' rack scanned out takes them along; a fault on one; then more than a page of changes to it.
      const amp = (await db.query<{ id: string; rack: string }>(`SELECT a.id, a.case_id AS rack FROM assets a JOIN identifiers i ON i.asset_id = a.id WHERE i.value = 'SH-000501'`)).rows[0]!
      await colly.send('project.create', { id: 'gig', name: 'Harbour gig', clientId: null, venueId: null, status: 'confirmed', notes: '' })
      await colly.send('move.record', { id: 'rack-out', projectId: 'gig', direction: 'out', assetId: amp.rack, modelId: 'x', qty: 1, at: new Date().toISOString() })
      await colly.send('fault.report', { id: 'hum', kind: 'damaged', assetId: amp.id, modelId: 'x', qty: 1, projectId: 'gig', usable: true, note: 'Hums', at: new Date().toISOString() })
      await colly.send('fault.update', { id: 'hum', repair: 'Earth lifted' })
      for (let n = 1; n <= 100; n++) await colly.send('asset.update', { id: amp.id, notes: `Check ${n}` })
      const log = async (before?: string) =>
        (await app.inject({ url: `/api/stock/items/${amp.id}/log${before ? `?before=${encodeURIComponent(before)}` : ''}`, cookies: colly.cookies })).json() as ItemLogPage
      const first = await log()
      const second = await log(first.next)
      expect(first.entries).toHaveLength(100)
      expect(second.next).toBeUndefined()
      const all = [...first.entries, ...second.entries]
      // Added, put in the rack, out with it, the fault and its repair notes, and the hundred changes: each once.
      expect(new Set(all.map((e) => e.key)).size).toBe(all.length)
      expect(all).toHaveLength(105)
      expect(second.entries.map((e) => itemLogWords(e.event))).toEqual([
        'Repair notes: Earth lifted',
        'Reported damaged back from Harbour gig, fit to go out: Hums',
        'Out to Harbour gig, in SH-000503 (Amp rack 1)',
        'Put in SH-000503 (Amp rack 1)',
        'Added as SH-000501',
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
