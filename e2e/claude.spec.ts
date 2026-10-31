import { createServer, type Server } from 'node:http'
import { expect, test } from '@playwright/test'

/**
 * Claude inside the app (ADR 0096, 0098): the office turns it on under
 * Admin, pastes an enquiry into New quote, checks what Claude read and the
 * lines it suggests (choosing a product for one it wasn't sure of, leaving
 * one out), and starts the quote with them; then takes what the mail in
 * the operations mailbox asks for, and finds the thread on Quotes.
 * Anthropic is a stand-in here, started on the port the server was told,
 * and the mailbox's answers are played in the page. Uses the made-up data
 * (ADR 0019), so it starts fresh before and after.
 */

const phoneSize = { width: 390, height: 844 }
const fresh = { data: { confirm: 'delete everything' } }
const standInPort = Number(process.env.E2E_PORT ?? '3099') + 1001

const year = new Date().getFullYear() + 1
const reading = {
  name: 'Harbour launch',
  client: 'Liffey Brands',
  venue: 'The Printworks',
  start: `${year}-03-04`,
  end: `${year}-03-05`,
  phases: [],
  kit: [
    { qty: 6, what: 'Y10P', department: 'audio' },
    { qty: 4, what: 'Spider moving heads', department: 'lighting' },
    { qty: 1, what: 'Hazer', department: 'lighting' },
  ],
  crew: [{ qty: 2, role: 'Stagehands', days: null }],
  other: [{ qty: 1, what: 'Delivery and collection' }],
  questions: ['What time can we get in?'],
  summary: 'A product launch for about 300 people over two days.',
}

let standIn: Server
const asked: { system: string; user: string }[] = []

test.beforeAll(async () => {
  standIn = createServer((req, res) => {
    let body = ''
    req.on('data', (c) => (body += c))
    req.on('end', () => {
      if (req.method !== 'POST' || !req.url?.startsWith('/v1/messages')) return res.writeHead(404).end()
      const sent = JSON.parse(body) as { model: string; system: string; messages: { content: string }[] }
      asked.push({ system: sent.system, user: sent.messages[0]!.content })
      // The to-do list names the first job in the facts, by its id.
      const job = sent.messages[0]!.content.match(/"jobId":"([^"]+)","job":"([^"]+)"/)
      const answer = sent.system.includes('writing the to-do list')
        ? { summary: 'One quote to chase.', items: [{ jobId: job?.[1] ?? '', where: 'quote', title: `Chase the quote for ${job?.[2] ?? 'the job'}`, why: 'Sent over a week ago with no answer.' }, { jobId: 'not-a-job', where: 'crew', title: 'Book a lighting tech', why: '' }] }
        : reading
      res.writeHead(200, { 'content-type': 'application/json' }).end(
        JSON.stringify({
          id: 'msg_stand_in',
          type: 'message',
          role: 'assistant',
          model: sent.model,
          content: [{ type: 'text', text: JSON.stringify(answer) }],
          stop_reason: 'end_turn',
          stop_sequence: null,
          usage: { input_tokens: 3_000, output_tokens: 800 },
        })
      )
    })
  })
  await new Promise<void>((resolve) => standIn.listen(standInPort, '127.0.0.1', resolve))
})
test.afterAll(async ({ request }) => {
  await new Promise((resolve) => standIn.close(resolve))
  await request.post('/api/data/start-fresh', fresh)
})

test('the office turns Claude on, pastes an enquiry, and sees what the mailbox asks for on the quote', async ({ browser, request }) => {
  expect((await request.post('/api/data/start-fresh', fresh)).ok()).toBe(true)
  expect((await request.post('/api/data/made-up')).ok()).toBe(true)
  const office = await (await browser.newContext({ viewport: phoneSize })).newPage()

  // Off to start: New quote offers no Claude.
  await office.goto('/#quotes')
  const quotes = office.getByRole('region', { name: 'To follow up' })
  await quotes.getByRole('button', { name: 'New quote' }).click()
  await expect(quotes.getByRole('region', { name: 'From an enquiry' })).toHaveCount(0)

  // Turned on under Admin › Company.
  await office.goto('/#admin')
  const card = office.getByRole('region', { name: 'Claude' })
  const toggle = card.getByRole('switch', { name: /Turn Claude on/ })
  await expect(toggle).not.toBeChecked()
  await toggle.click()
  await expect(toggle).toBeChecked()
  await expect(card).toContainText('This month: $0.00 of $50.00')
  // The mailbox is connected under Connections (ADR 0101); this test server has no Google key, so it can't be here.
  await expect(card).toContainText('once that’s connected under Connections')
  await office.goto('/#admin/connections')
  await expect(office.getByRole('region', { name: 'The operations mailbox' })).toContainText('needs the Google key')

  await office.goto('/#quotes')
  await quotes.getByRole('button', { name: 'New quote' }).click()
  const form = quotes.getByRole('form', { name: 'New quote' })
  // Pasting is the second way in, folded away: enquiries cc'd to operations@ are drafted by themselves.
  await form.getByText('Or paste an enquiry for Claude to read').click()
  await form.getByLabel('Paste an enquiry').fill('Hi, we have a launch at the Printworks on 4 and 5 March. Could you quote for 6 Y10Ps, 4 Spider moving heads, a hazer and two stagehands, delivered? Thanks, Liffey Brands')
  await form.getByRole('button', { name: 'Read it with Claude' }).click()

  // What Claude read fills the job in, labelled as Claude's, with what to ask the client.
  const read = form.getByRole('region', { name: 'Suggested by Claude' })
  await expect(read).toContainText('Read by Claude')
  await expect(read).toContainText('What time can we get in?')
  await expect(form.getByLabel("What's the job?")).toHaveValue('Harbour launch')
  await expect(form.getByLabel('Client')).toHaveValue('Liffey Brands')
  await expect(form.getByLabel('From', { exact: true })).toHaveValue(`${year}-03-04`)
  // The client's list of names went to Claude to match against.
  expect(asked[0]!.system).toContain('Liffey Brands')

  // Lines matched to the stock list and priced: the Y10P is sure; the hazer isn't in the stock list.
  const lines = form.getByRole('region', { name: 'Lines for the quote' })
  const y10 = lines.getByRole('listitem').filter({ hasText: '6 × d&b Y10P' })
  await expect(y10).toContainText('written “Y10P”')
  await expect(y10).toContainText('€45.00 a day')
  const hazer = lines.getByRole('listitem').filter({ hasText: 'Hazer' })
  await expect(hazer).toContainText('no price yet')
  await hazer.getByRole('checkbox').uncheck()
  await expect(lines.getByRole('listitem').filter({ hasText: 'Stagehand' })).toContainText('2 days')

  // The mailbox is played here: what the server would say Claude read. Its own reading is tested in server/test/mailbox.test.ts.
  const mailDone: string[] = []
  let advised = true
  const thread = (projectId: string | null) => ({
    id: 't1',
    subject: 'Launch in March',
    from: 'Aoife Byrne',
    lastAt: new Date().toISOString(),
    messages: 3,
    kind: 'enquiry',
    projectId,
    summary: 'A product launch for about 300 people.',
    questions: ['What time can we get in?'],
    drafting: false,
    advice: advised ? { note: 'Four SM58s and 10% off.', add: [{ kind: 'kit', what: 'SM58', department: 'audio', qty: 4, days: null, per: 'day', priceCents: null }], remove: [], change: [], discountPct: 10 } : null,
  })
  let jobId: string | null = null
  await office.route('**/api/assistant/mail?projectId=*', (route) => {
    jobId = new URL(route.request().url()).searchParams.get('projectId')
    return route.fulfill({ json: { threads: [thread(jobId)] } })
  })
  await office.route('**/api/assistant/mail', (route) => route.fulfill({ json: { threads: [thread(jobId)] } }))
  await office.route('**/api/assistant/mail/*/done', (route) => {
    mailDone.push(route.request().url().split('/').at(-2)!)
    advised = false
    return route.fulfill({ json: { ok: true } })
  })
  await form.getByRole('button', { name: /Start the quote with 4 lines/ }).click()
  await expect(office).toHaveURL(/#jobs\/[^/]+\/quote$/)
  const draft = office.getByRole('form', { name: 'Version 1, a draft' })
  await expect(draft).toContainText('d&b Y10P')
  await expect(draft).toContainText('Delivery and collection')
  await expect(draft).not.toContainText('Hazer')

  // What the thread in the operations mailbox asks for since someone changed the draft (ADR 0098): offered to take or leave.
  const advice = draft.getByRole('region', { name: 'Suggested by Claude' })
  await expect(advice).toContainText('Four SM58s and 10% off')
  await expect(advice).toContainText('Discount on the whole quote: 0% to 10%')
  await expect(advice.getByRole('listitem').filter({ hasText: '4 × Shure SM58' })).toBeVisible()
  const fromMail = draft.getByRole('region', { name: 'From the email “Launch in March”' })
  await expect(fromMail).toContainText('Aoife Byrne, 3 mails')
  await expect(fromMail).toContainText('What time can we get in?')
  await advice.getByRole('button', { name: 'Make these 2 changes' }).click()
  await expect(advice).toHaveCount(0)
  expect(mailDone).toEqual(['t1'])
  await expect(draft).toContainText('Shure SM58')
  await expect(draft.getByLabel('Discount, %', { exact: true })).toHaveValue('10')
  await expect(draft.locator('.save-state')).toHaveText('Saved')

  // What it cost is counted under Admin.
  await office.goto('/#admin')
  await expect(card).toContainText('asked once')

  // On Quotes, the threads Claude read, each opening its job's quote.
  await office.goto('/#quotes')
  const mailbox = office.getByRole('region', { name: 'From the operations mailbox' })
  await expect(mailbox.getByRole('link', { name: 'Launch in March' })).toHaveAttribute('href', `#jobs/${jobId}/quote`)
  await expect(mailbox).toContainText('New enquiry: Harbour launch')

  // Claude's to-do list (ADR 0097): none yet this morning, written on request, each thing a link and a tick.
  await office.goto('/#notifications')
  const todo = office.getByRole('region', { name: 'To do, from Claude' })
  await expect(todo).toContainText('each weekday from 7am')
  await todo.getByRole('button', { name: 'Write it now' }).click()
  await expect(todo).toContainText('One quote to chase.')
  await expect(todo).toContainText('Written by Claude today at')
  expect(asked.at(-1)!.system).toContain('writing the to-do list')
  const chase = todo.getByRole('listitem').filter({ hasText: 'Chase the quote for' })
  await expect(chase.getByRole('link')).toHaveAttribute('href', /^#jobs\/[^/]+\/quote$/)
  // A job Claude made up isn't linked to: it opens Quotes.
  await expect(todo.getByRole('link', { name: 'Book a lighting tech' })).toHaveAttribute('href', '#quotes')
  await chase.getByRole('checkbox').check()
  await expect(todo).toContainText('1 thing left.')
  // Ticked stays ticked, and the same list is on Home.
  await office.goto('/#home')
  const home = office.getByRole('region', { name: 'To do, from Claude' })
  await expect(home.getByRole('checkbox', { name: /Done: Chase the quote/ })).toBeChecked()
  await expect(home.getByRole('button', { name: 'Write it again now' })).toBeVisible()
})
