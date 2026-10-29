import { newId, type AssistantStatus, type CommandInput, type CommandName, type EnquiryReading, type Mutation, type QuoteAdvice } from '@sh/shared'
import type { FastifyInstance } from 'fastify'
import { afterEach, describe, expect, it } from 'vitest'
import { buildApp } from '../src/app.ts'
import { NoAnswer, type Ask, type Asked } from '../src/assistant/claude.ts'
import { pgliteDb } from '../src/db.ts'

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

  it('suggests changes to a quote only to the lines it was shown', async () => {
    const advice: QuoteAdvice = {
      note: 'Two more mics, and 10% off the lighting.',
      add: [{ kind: 'kit', what: 'Shure SM58', department: 'audio', qty: 2, days: null, per: 'day', priceCents: null }],
      remove: ['made-up', 'l2'],
      change: [
        { lineId: 'l1', qty: null, days: null, discountPct: 10, priceCents: null },
        { lineId: 'l1x', qty: 3, days: null, discountPct: null, priceCents: null },
        { lineId: 'l3', qty: 1, days: null, discountPct: null, priceCents: null },
      ],
      discountPct: null,
    }
    const { app, asked } = await setup({ answer: advice })
    await ok(app, m('assistant.use', { on: true }))
    const line = (id: string, what: string) => ({ id, kind: 'kit' as const, what, group: 'Lighting', qty: 1, days: 2, per: 'day' as const, unitCents: 5_000, discountPct: 0 })
    const res = await app.inject({
      method: 'POST',
      url: '/api/assistant/quote',
      payload: { ask: 'Add two SM58s and take 10% off the lighting', name: 'Nissan launch', jobDays: 2, discountPct: 0, lines: [line('l1', 'Robe Spiider'), line('l2', 'Haze'), line('l3', 'Par')] },
    })
    expect(res.statusCode).toBe(200)
    // Only l2 of those taken off is on the quote; l1x isn't, and l3's change changes nothing.
    expect(res.json()).toMatchObject({ remove: ['l2'], change: [{ lineId: 'l1', discountPct: 10 }], add: [{ what: 'Shure SM58' }] })
    expect(asked[0]!.user).toContain('<ask>\nAdd two SM58s')
    expect(asked[0]!.user).toContain('"id":"l1"')
  })
})
