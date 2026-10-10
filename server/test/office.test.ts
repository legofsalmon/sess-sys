import { addDays, irishToday, newId, type CommandInput, type CommandName, type HistoryPage, type Mutation, type MutationResult, type Setting } from '@sh/shared'
import type { FastifyInstance } from 'fastify'
import { afterEach, describe, expect, it } from 'vitest'
import { buildApp } from '../src/app.ts'
import { pgliteDb } from '../src/db.ts'

/**
 * The office's own details (audit finding 10): set once on the Account
 * tab, synced to every device, and on every freelancer page as a way back
 * to the office. Nothing is shown until they are set.
 */

let cleanup: (() => Promise<void>)[] = []
afterEach(async () => {
  for (const fn of cleanup.reverse()) await fn()
  cleanup = []
})

const today = irishToday()
const day = (n: number) => addDays(today, n)

function m<N extends CommandName>(name: N, args: CommandInput<N>): Mutation {
  return { id: newId(), name, args, createdAt: new Date().toISOString() } as Mutation
}

async function send(app: FastifyInstance, ...mutations: Mutation[]): Promise<MutationResult[]> {
  const res = await app.inject({ method: 'POST', url: '/api/sync/push', payload: { clientId: 'office', mutations } })
  return res.json().results
}

/** A freelancer booked on a job that started yesterday, so all three of her pages exist. */
async function company() {
  const db = await pgliteDb()
  const app = await buildApp({ db })
  cleanup.push(async () => {
    await app.close()
    await db.close()
  })
  const results = await send(
    app,
    m('person.upsert', { id: 'aoife', name: 'Aoife Byrne', kind: 'freelancer', email: 'aoife@example.com', phone: '+353871234567', skills: [], dayRateCents: 30000, notes: '' }),
    m('call.create', {
      id: 'show',
      project: 'Harbour Lights Festival',
      phase: 'Show',
      venue: 'Riverside Park',
      role: 'Sound No.1',
      start: day(-1),
      end: day(1),
      callTime: '12:00',
      needed: 1,
      dayRateCents: 32000,
      details: '',
      replyBy: null,
    }),
    m('offer.send', { id: 'o1', callId: 'show', personId: 'aoife', override: false }),
    m('offer.respond', { id: 'o1', answer: 'accept', days: null, note: '' }),
    m('offer.confirm', { id: 'o1' })
  )
  for (const r of results) expect(r).toMatchObject({ status: 'applied' })
  const token = (await db.query<{ t: string }>(`SELECT link_token AS t FROM people WHERE id = 'aoife'`)).rows[0]!.t
  const pages = async () => {
    const out: Record<string, string> = {}
    for (const [name, url] of [
      ['offers', `/f/${token}`],
      ['sheet', `/f/${token}/sheet/show`],
      ['timesheet', `/f/${token}/timesheet/o1`],
    ] as const) {
      const res = await app.inject({ url })
      expect(res.statusCode, name).toBe(200)
      out[name] = res.body
    }
    return out
  }
  return { app, db, token, pages }
}

describe('the office’s details', () => {
  it('are set from the app, reach every device, go in the history and the export, and need a real email', async () => {
    const { app } = await company()
    const [bad] = await send(app, m('office.update', { name: 'Session Hire office', phone: '01 234 5678', email: 'not an address' }))
    expect(bad).toMatchObject({ status: 'rejected', reason: { message: 'That email address doesn’t look right.' } })

    const [ok] = await send(app, m('office.update', { name: 'Session Hire office', phone: '01 234 5678', email: 'office@sessionhire.com' }))
    expect(ok).toMatchObject({ status: 'applied' })
    const pulled = (await app.inject({ url: '/api/sync/pull?after=0' })).json()
    const setting = pulled.changes.find((c: { entity: string }) => c.entity === 'setting')
    expect(setting).toMatchObject({ id: 'office', data: { id: 'office', name: 'Session Hire office', phone: '01 234 5678', email: 'office@sessionhire.com' } satisfies Setting })

    // Changed again: the same record, replaced whole.
    await send(app, m('office.update', { name: 'Session Hire', phone: null, email: 'office@sessionhire.com' }))
    const again = (await app.inject({ url: '/api/sync/pull?after=0' })).json().changes.filter((c: { entity: string }) => c.entity === 'setting')
    expect(again).toHaveLength(2)
    expect(again[1].data).toEqual({ id: 'office', name: 'Session Hire', phone: null, email: 'office@sessionhire.com' })

    const history: HistoryPage = (await app.inject({ url: '/api/history' })).json()
    expect(history.entries.map((e) => e.what).slice(0, 3)).toEqual([
      'Set the office details: Session Hire, no phone and office@sessionhire.com',
      'Set the office details: Session Hire office, 01 234 5678 and office@sessionhire.com',
      'Set the office details: Session Hire office, 01 234 5678 and not an address',
    ])
    expect(history.entries[2]).toMatchObject({ outcome: 'turned-down' })

    const exported = (await app.inject({ url: '/api/export' })).json()
    expect(exported.settings).toEqual([expect.objectContaining({ id: 'office', name: 'Session Hire', phone: null, email: 'office@sessionhire.com' })])
  })

  it('are on every freelancer page as links to ring and email, and nowhere until they are set', async () => {
    const { app, pages } = await company()
    for (const [name, html] of Object.entries(await pages())) expect(html, name).not.toContain('class="office"')

    await send(app, m('office.update', { name: 'Session Hire office', phone: '+353 1 234 5678', email: 'office@sessionhire.com' }))
    const block = '<p class="office">Session Hire office · <a href="tel:+35312345678">+353 1 234 5678</a> · <a href="mailto:office@sessionhire.com">office@sessionhire.com</a></p>'
    for (const [name, html] of Object.entries(await pages())) {
      expect(html, name).toContain(block)
      // At the top, before anything else on the page.
      expect(html.indexOf(block), name).toBeLessThan(html.indexOf('<section'))
    }
    // A link that no longer works says who to ask for a new one (rule 15).
    expect((await app.inject({ url: '/f/not-a-real-token-at-all' })).body).toContain(block)
    // The way out of a booking says ringing is quickest, with the number.
    expect((await pages()).offers).toContain('Ringing +353 1 234 5678 is quickest.')

    // A name alone is no way back, so nothing is shown; an email alone is.
    await send(app, m('office.update', { name: 'Session Hire office', phone: null, email: null }))
    expect((await pages()).offers).not.toContain('class="office"')
    await send(app, m('office.update', { name: '', phone: null, email: 'office@sessionhire.com' }))
    expect((await pages()).sheet).toContain('<p class="office">The office · <a href="mailto:office@sessionhire.com">office@sessionhire.com</a></p>')
  })
})
