import { addDays, irishToday, newId, type AssistantStatus, type TodoList, type CommandInput, type CommandName, type EnquiryReading, type Mutation, type QuoteAdvice } from '@sh/shared'
import type { FastifyInstance } from 'fastify'
import { afterEach, describe, expect, it } from 'vitest'
import { buildApp } from '../src/app.ts'
import { NoAnswer, type Ask, type Asked } from '../src/assistant/claude.ts'
import { pgliteDb } from '../src/db.ts'
import { Assistant } from '../src/assistant/routes.ts'
import { Todo } from '../src/assistant/todo.ts'

/**
 * Claude inside the app (ADR 0096): it reads an enquiry and suggests
 * changes to a quote, only when the server has a key, the office turned it
 * on, and the month's limit isn't spent. Anthropic is stood in for here.
 */

let cleanup: (() => Promise<void>)[] = []
afterEach(async () => {
  for (const fn of cleanup.reverse()) await fn()
  cleanup = []
})

function m<N extends CommandName>(name: N, args: CommandInput<N>): Mutation {
  return { id: newId(), name, args, createdAt: new Date().toISOString() } as Mutation
}

async function ok(app: FastifyInstance, ...mutations: Mutation[]) {
  const res = await app.inject({ method: 'POST', url: '/api/sync/push', payload: { clientId: 'office', mutations } })
  for (const r of res.json().results) expect(r).toMatchObject({ status: 'applied' })
}

const reading: EnquiryReading = {
  name: 'Nissan launch',
  client: 'Nissan Ireland',
  venue: 'The Convention Centre',
  start: '2027-03-04',
  end: '2027-03-05',
  phases: [],
  kit: [{ qty: 8, what: 'd&b Y10P', department: 'audio' }],
  crew: [{ qty: 1, role: 'Sound engineer', days: null }],
  other: [],
  questions: ['What time are doors?'],
  summary: 'A car launch.',
}

async function setup({ answer = reading as unknown, limitCents = 5_000, key = true, fail }: { answer?: unknown; limitCents?: number; key?: boolean; fail?: Error } = {}) {
  const asked: Asked[] = []
  const ask: Ask = async (a) => {
    asked.push(a)
    if (fail) throw fail
    return { json: answer, model: 'claude-opus-5-5', inputTokens: 10_000, outputTokens: 2_000 }
  }
  const db = await pgliteDb()
  const app = await buildApp({ db, claude: key ? { apiKey: 'test', model: 'claude-opus-5-5', limitCents, ask } : undefined })
  cleanup.push(async () => {
    await app.close()
    await db.close()
  })
  return { app, db, asked }
}

const status = async (app: FastifyInstance) => (await app.inject({ url: '/api/assistant' })).json() as AssistantStatus
const enquiry = (app: FastifyInstance, text = 'Hi, we need a PA and a sound engineer for our launch on 4 and 5 March.') =>
  app.inject({ method: 'POST', url: '/api/assistant/enquiry', payload: { text } })

describe('Claude inside the app', () => {
  it('is turned down until the server has a key and the office turns it on', async () => {
    const none = await setup({ key: false })
    expect(await status(none.app)).toMatchObject({ configured: false, on: false })
    expect((await enquiry(none.app)).statusCode).toBe(409)

    const { app, asked } = await setup()
    expect(await status(app)).toMatchObject({ configured: true, on: false, spentCents: 0, uses: 0 })
    const off = await enquiry(app)
    expect(off.statusCode).toBe(409)
    expect(off.json().error).toMatch(/turned off/)
    expect(asked).toHaveLength(0)
  })

  it('reads an enquiry, told the clients, venues and roles the company has, and counts what it cost', async () => {
    const { app, db, asked } = await setup()
    await ok(
      app,
      m('assistant.use', { on: true }),
      m('client.upsert', { id: 'nissan', name: 'Nissan Ireland', contacts: [], notes: '' }),
      m('price.role', { role: 'Sound engineer', dayCents: 45_000 })
    )
    const res = await enquiry(app)
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual(reading)
    expect(asked[0]!.user).toContain('<enquiry>\nHi, we need a PA')
    expect(asked[0]!.system).toContain('Clients already known: Nissan Ireland.')
    expect(asked[0]!.system).toContain('Sound engineer')
    // 10,000 in at $4 a million and 2,000 out at $20: 4 + 4 cents.
    expect(await status(app)).toMatchObject({ on: true, spentCents: 8, uses: 1 })
    // Neither the words nor who asked are kept.
    expect((await db.query(`SELECT * FROM assistant_uses`)).rows[0]).toMatchObject({ kind: 'enquiry', input_tokens: 10_000, output_tokens: 2_000, cost_cents: 8, ok: true })
  })

  it('stops for the month once the limit is spent', async () => {
    const { app } = await setup({ limitCents: 8 })
    await ok(app, m('assistant.use', { on: true }))
    expect((await enquiry(app)).statusCode).toBe(200)
    const spent = await enquiry(app)
    expect(spent.statusCode).toBe(429)
    expect(spent.json().error).toMatch(/limit/)
  })

  it('says why when Claude gives no answer, and counts what it cost', async () => {
    const { app } = await setup({ fail: new NoAnswer('Claude wouldn’t answer that one.', { model: 'claude-opus-5-5', inputTokens: 1_000, outputTokens: 0 }) })
    await ok(app, m('assistant.use', { on: true }))
    const res = await enquiry(app)
    expect(res.statusCode).toBe(502)
    expect(res.json().error).toBe('Claude wouldn’t answer that one.')
    expect(await status(app)).toMatchObject({ spentCents: 1, uses: 1 })
  })

  it('reads an answer that strays leniently, and turns down a short enquiry before asking', async () => {
    const { app, asked } = await setup({ answer: { ...reading, start: '4 March', kit: [{ qty: 0, what: 'Mics', department: 'sound' }], questions: 'none' } })
    await ok(app, m('assistant.use', { on: true }))
    expect((await enquiry(app, 'PA?')).statusCode).toBe(400)
    expect(asked).toHaveLength(0)
    const res = (await enquiry(app)).json() as EnquiryReading
    expect(res).toMatchObject({ start: '', kit: [{ qty: 1, what: 'Mics', department: 'other' }], questions: [] })
  })
})

describe('Claude’s to-do list (ADR 0097)', () => {
  const today = irishToday()
  const jobs = [
    m('project.create', { id: 'launch', name: 'Harbour launch', clientId: null, venueId: null, status: 'enquiry', kind: 'gig', notes: 'Client wants the quote by Friday.' }),
    m('phase.add', { id: 'launch-show', projectId: 'launch', name: 'Show', start: addDays(today, 10), end: addDays(today, 11), venueId: null, notes: '' }),
    m('project.create', { id: 'gala', name: 'Autumn gala', clientId: null, venueId: null, status: 'quoted', kind: 'gig', notes: '' }),
    m('phase.add', { id: 'gala-show', projectId: 'gala', name: 'Show', start: addDays(today, 30), end: addDays(today, 30), venueId: null, notes: '' }),
    m('quote.save', { id: 'gala-q', projectId: 'gala', lines: [{ id: 'l1', kind: 'other', what: 'PA', ref: null, group: '', qty: 1, days: 1, unitCents: 100_000, vat: '23', per: 'once' }], discountPct: 0, notes: '' }),
    m('quote.sent', { id: 'gala-q', on: addDays(today, -9) }),
  ]
  const answer = {
    summary: 'A quote to chase and one to send.',
    items: [
      { jobId: 'gala', where: 'quote', title: 'Chase the Autumn gala quote', why: 'Sent nine days ago and not answered.' },
      { jobId: 'made-up', where: 'job', title: 'Ring the Nissan people', why: 'Because.' },
    ],
  }

  it('is written from what wants doing, each thing linked to its job, and ticked done', async () => {
    const { app, asked } = await setup({ answer })
    await ok(app, m('assistant.use', { on: true }), ...jobs)
    expect((await app.inject({ url: '/api/assistant/todo' })).json()).toEqual({ list: null })
    const made = await app.inject({ method: 'POST', url: '/api/assistant/todo' })
    expect(made.statusCode).toBe(200)
    const list = made.json().list as TodoList
    expect(list).toMatchObject({ how: 'asked', summary: 'A quote to chase and one to send.' })
    // A job Claude named that the app doesn't have links nowhere.
    expect(list.items).toMatchObject([
      { key: '1', jobId: 'gala', where: 'quote', doneAt: null },
      { key: '2', jobId: null, title: 'Ring the Nissan people' },
    ])
    const facts = JSON.parse(asked[0]!.user.replace(/^<facts>\n|\n<\/facts>$/g, ''))
    expect(facts.enquiriesWithNoQuoteSent).toMatchObject([{ jobId: 'launch', job: 'Harbour launch', quote: 'none yet' }])
    expect(facts.quotesWaitingForAnAnswer).toMatchObject([{ jobId: 'gala', sentOn: addDays(today, -9), total: '€1230.00' }])
    expect(facts.notesOfJobsComingUp).toMatchObject([{ jobId: 'launch', notes: 'Client wants the quote by Friday.' }])

    const done = await app.inject({ method: 'POST', url: '/api/assistant/todo/done', payload: { listId: list.id, key: '1', done: true } })
    expect(done.json().list.items[0].doneAt).toEqual(expect.any(String))
    expect((await app.inject({ url: '/api/assistant/todo' })).json().list.items[0].doneAt).toEqual(expect.any(String))
    expect((await app.inject({ method: 'POST', url: '/api/assistant/todo/done', payload: { listId: 999, key: '1', done: true } })).statusCode).toBe(404)
  })

  it('is turned down while Claude is off, like the rest', async () => {
    const { app, asked } = await setup({ answer })
    expect((await app.inject({ method: 'POST', url: '/api/assistant/todo' })).statusCode).toBe(409)
    expect(asked).toHaveLength(0)
  })

  it('comes each weekday from 7am in Ireland, once a day, and not at the weekend', async () => {
    const { app, db } = await setup({ answer })
    await ok(app, m('assistant.use', { on: true }))
    let now = new Date('2026-11-02T06:30:00Z') // a Monday, 6.30am in Ireland
    const assistant = new Assistant(db, { apiKey: 'test', model: 'claude-opus-5-5', limitCents: 5_000, ask: async () => ({ json: answer, model: 'claude-opus-5-5', inputTokens: 1, outputTokens: 1 }) })
    const todo = new Todo(db, assistant, undefined, () => now)
    expect(await todo.due()).toBe(false)
    now = new Date('2026-11-02T07:05:00Z')
    expect(await todo.due()).toBe(true)
    await todo.make('morning')
    expect(await todo.due()).toBe(false)
    now = new Date('2026-11-07T09:00:00Z') // Saturday
    expect(await todo.due()).toBe(false)
    now = new Date('2026-11-09T07:00:00Z') // the next Monday
    expect(await todo.due()).toBe(true)
  })
})
