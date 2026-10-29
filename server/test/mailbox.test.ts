import { newId, type CommandInput, type CommandName, type EnquiryReading, type MailboxStatus, type MailReading, type MailThread, type Mutation, type QuoteAdvice } from '@sh/shared'
import type { FastifyInstance } from 'fastify'
import { afterEach, describe, expect, it } from 'vitest'
import { buildApp } from '../src/app.ts'
import type { Ask, Asked } from '../src/assistant/claude.ts'
import { bodyOf, Gmail, withoutQuoted } from '../src/assistant/gmail.ts'
import { seal } from '../src/calendar/crypto.ts'
import { pgliteDb } from '../src/db.ts'

/**
 * Claude reading the operations mailbox (ADR 0098): a new enquiry becomes
 * a job with its quote drafted, the draft follows the thread until someone
 * changes it, and after that what the mail asks for is offered to take or
 * leave. Gmail, Google and Anthropic are all stood in for here.
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

const SECRET = 'google-secret'
const b64 = (s: string) => Buffer.from(s).toString('base64url')

interface FakeMail {
  id: string
  threadId: string
  from: string
  subject: string
  text: string
  at: number
  bulk?: boolean
}

function fakeGoogle(mails: FakeMail[]) {
  const asked: string[] = []
  const fetch = (async (input: string | URL | Request) => {
    const url = String(input)
    asked.push(url)
    const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
    if (url.startsWith('https://oauth2.googleapis.com/token')) return json({ access_token: 'access', expires_in: 3600 })
    if (url.startsWith('https://oauth2.googleapis.com/revoke')) return json({})
    if (url.startsWith('https://gmail.test/messages')) return json({ messages: [...mails].sort((a, b) => b.at - a.at).map((x) => ({ id: x.id, threadId: x.threadId })) })
    const thread = url.match(/^https:\/\/gmail\.test\/threads\/([^?]+)/)?.[1]
    if (thread)
      return json({
        messages: mails
          .filter((x) => x.threadId === thread)
          .sort((a, b) => a.at - b.at)
          .map((x) => ({
            id: x.id,
            threadId: x.threadId,
            internalDate: String(x.at),
            payload: {
              mimeType: 'multipart/alternative',
              headers: [
                { name: 'From', value: x.from },
                { name: 'To', value: 'Adam <adam@sessionhire.com>' },
                { name: 'Cc', value: 'operations@sessionhire.com' },
                { name: 'Subject', value: x.subject },
                ...(x.bulk ? [{ name: 'List-Unsubscribe', value: '<mailto:out@news.ie>' }] : []),
              ],
              parts: [{ mimeType: 'text/plain', body: { data: b64(x.text) } }],
            },
          })),
      })
    return new Response('{}', { status: 404 })
  }) as typeof globalThis.fetch
  return { fetch, asked }
}

const empty = { name: '', client: '', venue: '', start: '', end: '', phases: [], kit: [], crew: [], other: [], questions: [], summary: '' }
const noAdvice: QuoteAdvice = { note: '', add: [], remove: [], change: [], discountPct: null }
const year = new Date().getFullYear() + 1
const launch: EnquiryReading = {
  ...empty,
  name: 'Nissan launch',
  client: 'Nissan Ireland',
  venue: 'The Convention Centre',
  start: `${year}-03-04`,
  end: `${year}-03-05`,
  kit: [{ qty: 8, what: 'Y10P', department: 'audio' }],
  questions: ['What time are doors?'],
  summary: 'A car launch for 300.',
}

async function setup(answer: (a: Asked) => Partial<MailReading>) {
  const mails: FakeMail[] = []
  const google = fakeGoogle(mails)
  const asked: Asked[] = []
  const ask: Ask = async (a) => {
    asked.push(a)
    return { json: { kind: 'other', jobId: '', enquiry: empty, advice: noAdvice, ...answer(a) }, model: 'claude-opus-5-5', inputTokens: 8_000, outputTokens: 1_500 }
  }
  const db = await pgliteDb()
  const app = await buildApp({
    db,
    claude: { apiKey: 'test', model: 'claude-opus-5-5', limitCents: 5_000, ask },
    calendar: { clientId: 'client', clientSecret: SECRET, fetch: google.fetch, gapMs: 0, settleMs: 3_600_000, pollMs: 0 },
    gmail: new Gmail(google.fetch, 'https://gmail.test'),
  })
  cleanup.push(async () => {
    await app.close()
    await db.close()
  })
  await ok(app, m('assistant.use', { on: true }), m('model.create', { id: 'y10p', name: 'd&b Y10P', department: 'audio', category: '', tracking: 'bulk', isCase: false, valueCents: null, notes: '' } as never), m('price.product', { modelId: 'y10p', dayCents: 4_000 } as never))
  const mailbox = app.assistantMailbox
  const connect = async () => {
    await mailbox.connected({ email: 'operations@sessionhire.com', sub: 'ops-sub', sealedKey: seal(SECRET, 'refresh', 'ops-sub'), by: null })
    await mailbox.look()
  }
  const mail = (x: Omit<FakeMail, 'at'>) => mails.push({ ...x, at: Date.now() + mails.length * 1000 })
  return { app, db, asked, mailbox, connect, mail, google }
}

const threads = async (app: FastifyInstance, projectId?: string) =>
  ((await app.inject({ url: `/api/assistant/mail${projectId ? `?projectId=${projectId}` : ''}` })).json() as { threads: MailThread[] }).threads

describe('Claude reading the operations mailbox (ADR 0098)', () => {
  it('drafts a new enquiry into a job and its quote, as Claude in the history', async () => {
    const s = await setup(() => ({ kind: 'enquiry', enquiry: launch }))
    s.mail({ id: 'm1', threadId: 't1', from: 'Aoife Byrne <aoife@nissan.ie>', subject: 'Launch in March', text: 'Hi, could you quote for 8 Y10Ps on 4 and 5 March?\n\nOn Mon, someone wrote:\n> old stuff' })
    await s.connect()

    // What Claude was shown: the thread without what it quotes, and that the office is @sessionhire.com.
    expect(s.asked).toHaveLength(1)
    expect(s.asked[0]!.user).toContain('could you quote for 8 Y10Ps')
    expect(s.asked[0]!.user).not.toContain('old stuff')
    expect(s.asked[0]!.system).toContain('@sessionhire.com is the office')

    const { rows: jobs } = await s.db.query<{ id: string; name: string; status: string; notes: string; client: string; venue: string }>(
      'SELECT p.id, p.name, p.status, p.notes, c.name AS client, v.name AS venue FROM projects p LEFT JOIN clients c ON c.id = p.client_id LEFT JOIN venues v ON v.id = p.venue_id'
    )
    expect(jobs).toEqual([expect.objectContaining({ name: 'Nissan launch', status: 'enquiry', client: 'Nissan Ireland', venue: 'The Convention Centre' })])
    expect(jobs[0]!.notes).toContain('Aoife Byrne <aoife@nissan.ie>')
    const { rows: quotes } = await s.db.query<{ status: string; lines: { what: string; qty: number; days: number; unitCents: number; modelId: string }[] }>('SELECT status, lines FROM quotes')
    // Matched to the stock list and priced from the price list, for the job's two days.
    expect(quotes).toEqual([{ status: 'draft', lines: [expect.objectContaining({ what: 'd&b Y10P', qty: 8, days: 2, unitCents: 4_000, modelId: 'y10p' })] }])
    const { rows: made } = await s.db.query<{ client_id: string; device: string; name: string }>(`SELECT client_id, device, name FROM mutations WHERE client_id = 'claude' ORDER BY received_at`)
    expect(made.map((x) => x.name)).toEqual(['client.upsert', 'venue.upsert', 'project.create', 'phase.add', 'quote.save'])
    expect(made[0]!.device).toBe('Claude, from the operations mailbox')
    const history = (await s.app.inject({ url: '/api/history' })).json() as { entries: { who: { kind: string; name: string } }[] }
    expect(history.entries.find((e) => e.who.kind === 'claude')?.who.name).toBe('Claude')

    const [t] = await threads(s.app)
    expect(t).toMatchObject({ id: 't1', subject: 'Launch in March', from: 'Aoife Byrne', kind: 'enquiry', projectId: jobs[0]!.id, drafting: true, questions: ['What time are doors?'], advice: null })
    expect(await (await s.app.inject({ url: '/api/assistant/mailbox' })).json()).toMatchObject({ state: 'on', account: 'operations@sessionhire.com', threads: 1 } satisfies Partial<MailboxStatus>)

    // Nothing new: nothing asked again.
    await s.mailbox.look()
    expect(s.asked).toHaveLength(1)
  })

  it('keeps its draft up to date as the thread goes on, then offers changes once someone has changed it', async () => {
    let reading: Partial<MailReading> = { kind: 'enquiry', enquiry: launch }
    const s = await setup(() => reading)
    s.mail({ id: 'm1', threadId: 't1', from: 'aoife@nissan.ie', subject: 'Launch', text: 'Quote for 8 Y10Ps please, 4 and 5 March.' })
    await s.connect()
    const { rows } = await s.db.query<{ id: string; project_id: string }>('SELECT id, project_id FROM quotes')
    const quote = rows[0]!

    // The client adds a sound engineer: the draft nobody has changed follows, and the thread knows its job.
    reading = { kind: 'job', enquiry: { ...launch, crew: [{ qty: 1, role: 'Sound engineer', days: null }] } }
    s.mail({ id: 'm2', threadId: 't1', from: 'aoife@nissan.ie', subject: 'Re: Launch', text: 'And a sound engineer, thanks.' })
    await s.mailbox.look()
    expect(s.asked[1]!.system).toContain('This thread is about the job "Nissan launch"')
    expect(s.asked[1]!.user).not.toContain('<quote>')
    let lines = (await s.db.query<{ lines: { id: string; what: string }[] }>('SELECT lines FROM quotes')).rows[0]!.lines
    expect(lines.map((l) => l.what)).toEqual(['d&b Y10P', 'Sound engineer'])

    // Someone changes it by hand: Claude stops changing it, and is shown its lines to say what the next mail changes.
    await ok(s.app, m('quote.save', { id: quote.id, projectId: quote.project_id, lines: lines.slice(0, 1) as never, discountPct: 5, notes: '' }))
    lines = (await s.db.query<{ lines: { id: string; what: string }[] }>('SELECT lines FROM quotes')).rows[0]!.lines
    const y10 = lines[0]!.id
    reading = { kind: 'job', enquiry: launch, advice: { note: 'Two more Y10Ps.', add: [], remove: [], change: [{ lineId: y10, qty: 10, days: null, discountPct: null, priceCents: null }, { lineId: 'made-up', qty: 1, days: null, discountPct: null, priceCents: null }], discountPct: null } }
    s.mail({ id: 'm3', threadId: 't1', from: 'aoife@nissan.ie', subject: 'Re: Launch', text: 'Make it 10 Y10Ps.' })
    await s.mailbox.look()
    expect(s.asked[2]!.user).toContain(`<quote>\n{"status":"draft","discountPct":5,"lines":[{"id":"${y10}"`)
    expect((await s.db.query<{ lines: unknown[] }>('SELECT lines FROM quotes')).rows[0]!.lines).toHaveLength(1)
    const [t] = await threads(s.app, quote.project_id)
    // A line that isn't on the quote is left out.
    expect(t).toMatchObject({ drafting: false, advice: { note: 'Two more Y10Ps.', change: [{ lineId: y10, qty: 10 }] } })

    // Taken or left, the changes go.
    expect((await s.app.inject({ method: 'POST', url: '/api/assistant/mail/t1/done' })).statusCode).toBe(200)
    expect((await threads(s.app, quote.project_id))[0]!.advice).toBeNull()
  })

  it('links mail about a job already in the app, and leaves the rest alone', async () => {
    const s = await setup((a) => (a.user.includes('Gala') ? { kind: 'job', jobId: 'gala' } : { kind: 'other' }))
    await ok(s.app, m('project.create', { id: 'gala', name: 'Autumn gala', clientId: null, venueId: null, status: 'quoted', kind: 'gig', notes: '' }))
    s.mail({ id: 'm1', threadId: 'gala-thread', from: 'events@hotel.ie', subject: 'Gala timings', text: 'Gala load in is 2pm.' })
    s.mail({ id: 'm2', threadId: 'invoice', from: 'accounts@supplier.ie', subject: 'Invoice 42', text: 'Please find attached.' })
    s.mail({ id: 'm3', threadId: 'news', from: 'news@shop.ie', subject: 'Sale on now', text: 'Big sale!', bulk: true })
    await s.connect()
    // The newsletter is never sent to Claude.
    expect(s.asked).toHaveLength(2)
    expect(s.asked[0]!.system).toContain('"id":"gala"')
    expect((await s.db.query('SELECT id FROM projects')).rows).toHaveLength(1)
    expect((await threads(s.app)).map((t) => [t.id, t.kind, t.projectId])).toEqual([['gala-thread', 'job', 'gala']])
  })

  it('stops while Claude is off, and hands the key back when disconnected', async () => {
    const s = await setup(() => ({ kind: 'other' }))
    await ok(s.app, m('assistant.use', { on: false }))
    s.mail({ id: 'm1', threadId: 't1', from: 'a@b.ie', subject: 'Hello', text: 'Hi' })
    await s.connect()
    expect(s.asked).toHaveLength(0)
    expect(s.google.asked.some((u) => u.includes('gmail.test'))).toBe(false)

    await s.mailbox.disconnect()
    expect(await (await s.app.inject({ url: '/api/assistant/mailbox' })).json()).toMatchObject({ state: 'off' })
    expect(s.google.asked.some((u) => u.includes('/revoke'))).toBe(true)
  })
})

describe('reading an email', () => {
  it('takes the text part, or the HTML as text, without what it quotes', () => {
    expect(bodyOf({ mimeType: 'text/html', body: { data: b64('<p>Hi&nbsp;there</p><p>Two <b>mics</b></p>') } })).toBe('Hi there\nTwo mics')
    expect(withoutQuoted('Yes please.\n\nOn Tue, 3 Mar 2027, Adam <adam@sessionhire.com> wrote:\n> Shall we?')).toBe('Yes please.')
    expect(withoutQuoted('Fine\n-----Original Message-----\nFrom: x')).toBe('Fine')
  })
})
