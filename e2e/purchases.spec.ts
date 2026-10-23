import { expect, test, type APIRequestContext } from '@playwright/test'

/**
 * The purchase list (ADR 0077), as the crew and the office meet it: asking
 * for something on Stock › Purchase list, the list ranked by votes, a
 * request's page where the office says where it's at, and a list brought
 * in from a spreadsheet, twice, the second time adding nothing. The test
 * server is shared and has sign-in off, so votes come in through the
 * device's own name for who is voting, and names carry this run's tag.
 * SHOTS=1 refreshes the blueprint's pictures.
 */

const shot = (name: string) => (process.env.SHOTS ? { path: `docs/hub/img/${name}.png` } : undefined)
const deskSize = { width: 1280, height: 900 }
const phoneSize = { width: 390, height: 844 }

async function push(request: APIRequestContext, id: string, mutations: [string, Record<string, unknown>][]) {
  const res = await request.post('/api/sync/push', {
    data: { clientId: `buy-${id}`, mutations: mutations.map(([name, args], i) => ({ id: `buy-${id}-${i}`, name, args, createdAt: new Date().toISOString() })) },
  })
  const { results } = (await res.json()) as { results: { status: string; reason?: { message: string } }[] }
  expect(results.map((r) => r.reason?.message ?? r.status)).toEqual(mutations.map(() => 'applied'))
}

const PERSON = { kind: 'staff', email: null, phone: null, skills: [], dayRateCents: null, notes: '' }

test('asking, votes, where it is at, and a list brought in once', async ({ browser, request }) => {
  const id = Date.now().toString(36)
  const tape = `Gaffer tape ${id}`
  const ups = `UPS for FOH ${id}`
  await push(request, id, [
    ['person.upsert', { id: `ro-${id}`, name: `Róisín Test ${id}`, ...PERSON }],
    ['person.upsert', { id: `ky-${id}`, name: `Kyle Test ${id}`, knownAs: `Sparky${id}`, ...PERSON }],
    ['purchase.ask', { id: `ups-${id}`, title: ups, details: '4, 1U', link: 'https://example.com/ups', department: 'Audio', by: `ro-${id}` }],
    ['purchase.vote', { requestId: `ups-${id}`, vote: true, by: `ro-${id}` }],
    ['purchase.vote', { requestId: `ups-${id}`, vote: true, by: `ky-${id}` }],
  ])

  const page = await (await browser.newContext({ viewport: phoneSize })).newPage()
  await page.goto('/#stock/buy')
  await expect(page.locator('.conn')).toHaveText('Up to date')
  await page.getByRole('button', { name: 'Ask for something to be bought' }).click()
  const form = page.getByRole('form', { name: 'Ask for something to be bought' })
  await form.getByLabel('What to buy').fill(tape)
  await form.getByLabel('How many, and anything else').fill('24 rolls, black')
  await form.getByLabel('Department').selectOption('Production')
  await form.getByRole('button', { name: 'Ask for it' }).click()
  await expect(form.getByRole('status')).toHaveText(`“${tape}” is on the list.`)

  // Most votes first: the UPS, with two, is above the tape, with none.
  const open = page.getByRole('region', { name: /^Asked for/ })
  await expect(open.getByRole('link', { name: new RegExp(ups) })).toBeVisible()
  const order = await open.locator('.purchase-row .job-row > div > b').allTextContents()
  expect(order.indexOf(ups)).toBeLessThan(order.indexOf(tape))
  await page.screenshot(shot('purchase-list-phone'))

  // The office says where it's at, on the request's page.
  await open.getByRole('link', { name: new RegExp(ups) }).click()
  await expect(page.getByRole('heading', { name: ups, level: 1 })).toBeVisible()
  await expect(page.getByText(`Voted for by Kyle Test ${id}, Róisín Test ${id}.`)).toBeVisible()
  await page.getByLabel(/^Ordered/).check()
  await page.getByLabel('Notes').fill('From Reichelt, due Friday')
  await page.getByRole('button', { name: "Save where it's at" }).click()
  await expect(page.locator('.title .pill').last()).toHaveText('Ordered')
  await page.evaluate(() => scrollTo(0, 0))
  await page.screenshot(shot('purchase-request-phone'))
  await page.getByRole('link', { name: 'Purchase list' }).first().click()
  await expect(page.getByRole('region', { name: /^Ordered/ }).getByRole('link', { name: new RegExp(ups) })).toBeVisible()

  // A list from a spreadsheet: who asked is matched to the one person it can be, a row it can't read says why.
  const csv = [
    'Asked on,Asked by,What,How many and details,Link,Department,Where it’s at,Notes',
    `22/04/2026,Sparky${id},Mic stands ${id},20 tall booms,,Audio,Ordered,On the April order`,
    `24/04/2026,Someone Else,Isolation feet ${id},,studiocare.com/feet,Audio,,`,
    `25/04/2026,Someone Else,,,,,,`,
  ].join('\n')
  const desk = await (await browser.newContext({ viewport: deskSize })).newPage()
  await desk.goto('/#stock/buy/bring-in')
  await expect(desk.locator('.conn')).toHaveText('Up to date')
  const file = { name: 'purchase-list.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) }
  await desk.getByLabel('Purchase list file').setInputFiles(file)
  await expect(desk.getByLabel(`Sparky${id}`)).toHaveValue(`ky-${id}`)
  await expect(desk.getByLabel('Someone Else')).toHaveValue('')
  await expect(desk.getByText('It says nothing under What.')).toBeVisible()
  await desk.getByRole('button', { name: 'Bring in 2 requests' }).click()
  await expect(desk.getByRole('heading', { name: 'Brought in', level: 1 })).toBeVisible()

  // The same list again adds nothing.
  await desk.goto('/#stock/buy')
  await desk.goto('/#stock/buy/bring-in')
  await desk.getByLabel('Purchase list file').setInputFiles(file)
  await expect(desk.getByText('Already on the list', { exact: true })).toHaveCount(2)
  await expect(desk.getByRole('button', { name: 'Bring in 0 requests' })).toBeDisabled()

  await desk.goto('/#stock/buy')
  await expect(desk.getByRole('region', { name: /^Ordered/ }).getByRole('link', { name: new RegExp(`Mic stands ${id}`) })).toContainText(`Kyle Test ${id}`)
  await expect(desk.getByRole('region', { name: /^Asked for/ }).getByRole('link', { name: new RegExp(`Isolation feet ${id}`) })).toContainText('Someone Else, Fri 24 Apr')
  await desk.screenshot(shot('purchase-list'))
})
