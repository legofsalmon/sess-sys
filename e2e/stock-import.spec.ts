import { expect, test, type Page } from '@playwright/test'

/**
 * Bringing in the stock list (ADR 0026) end to end, with sign-in off: the
 * empty Stock tab offers it; the made-up sample file has a title row and a
 * column the app doesn't know, so it asks which column is which; the
 * preview waits on the tick to make the list's places, and on one date
 * that reads two ways, fixed in place a key at a time; brought in past the
 * question, the items are on the Stock tab with their old numbers, and an
 * old number typed in the search finds its item. Then an item scanned out
 * and back, reported damaged with no signal, shows all of it in its log,
 * saying plainly what needs signal, and fills in the rest once it's back.
 * The made-up file's numbers are its own, so this starts fresh first, as
 * the made-up data test does.
 */

const phoneSize = { width: 390, height: 844 }
const sample = 'docs/samples/stock-list.csv'

async function ready(page: Page, hash: string) {
  await page.goto(`/${hash}`)
  await expect(page.locator('.conn')).toHaveText('Up to date')
}

test.beforeAll(async ({ request }) => {
  expect((await request.post('/api/data/start-fresh', { data: { confirm: 'delete everything' } })).ok()).toBe(true)
})

test('brings the made-up stock list in, fixing a row in place, and shows its items', async ({ browser }) => {
  const office = await (await browser.newContext({ viewport: phoneSize })).newPage()
  await ready(office, '#stock')
  // The empty catalogue offers the list.
  const stock = office.getByRole('region', { name: 'Stock', exact: true })
  await expect(stock.locator('.empty')).toHaveText('Nothing here yet. Add the first product below, or bring in the stock list.')
  await stock.getByRole('link', { name: 'bring in the stock list' }).click()
  await expect(office).toHaveURL(/#account\/import-stock$/)
  await expect(office.getByRole('heading', { name: 'Bring in the stock list' })).toBeVisible()

  // Supplier isn't a column the app knows, so it asks; the others are chosen already.
  await office.getByLabel('Stock list file').setInputFiles(sample)
  const columns = office.getByRole('region', { name: 'Which column is which' })
  await expect(columns.getByLabel('What Supplier holds')).toHaveValue('')
  await expect(columns.getByLabel('What Item holds')).toHaveValue('product')
  await expect(columns.getByLabel('What Replacement Value (€) holds')).toHaveValue('value')
  await expect(columns.locator('li', { hasText: 'Supplier' })).toContainText('Corvo Ireland · Corvo Ireland · Cable Co')
  await columns.getByRole('button', { name: 'Read the rows' }).click()

  const read = office.getByRole('region', { name: 'What was read' })
  await expect(read.getByRole('status')).toHaveText('10 rows read: 9 new products, 12 new items, 4 counts, 9 with problems.')
  await expect(read).toContainText('Not read: Supplier.')
  const places = office.getByRole('region', { name: 'Places and cases' })
  await expect(places).toContainText('Places not here yet: Bay A1, Bay B2, Bay C1, Yard')
  const rows = office.getByRole('region', { name: 'Rows' })
  const k12 = rows.getByRole('listitem', { name: 'Row 3' })
  await expect(k12).toContainText('Corvo K12')
  await expect(k12).toContainText('4 items · Audio · Speakers · €1,250 · PAT due 30 Sep 2027')
  await expect(k12).toContainText("Bay A1 isn't a place here yet.")
  // Nothing goes in while a row has a problem; the tick solves the places.
  const bring = office.getByRole('button', { name: /^Bring in/ })
  await expect(bring).toHaveText('Bring in 10 rows')
  await expect(bring).toBeDisabled()
  await places.getByRole('checkbox', { name: /Make the places and cases this list names/ }).check()
  await expect(read.getByRole('status')).toHaveText('10 rows read: 9 new products, 12 new items, 4 counts, 2 with problems.')
  await expect(k12).not.toContainText("isn't a place here yet")
  await expect(k12).toContainText('At Bay A1 (new place)')

  // The date written month first, fixed in place a key at a time; the field stays put as the problem clears, and with it the
  // problem of a date that could have been written either way.
  const d32 = rows.getByRole('listitem', { name: 'Row 10' })
  await expect(d32).toContainText('"09/30/2027" looks like the month first.')
  await expect(rows.getByRole('listitem', { name: 'Row 4' })).toContainText('Row 10 writes its date month first, so "1.3.27" could be either.')
  const due = d32.getByLabel('PAT due for row 10')
  await due.fill('3')
  await due.pressSequentially('0/09/2027')
  await expect(due).toHaveValue('30/09/2027')
  await expect(d32).not.toContainText('looks like the month first')
  await expect(d32).toContainText('1 item · Power · Distros · €1,100 · PAT due 30 Sep 2027')
  await expect(read.getByRole('status')).toHaveText('10 rows read: 9 new products, 12 new items, 4 counts.')
  expect(await office.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)

  // A question first, since there's no undo for the lot.
  await expect(bring).toBeEnabled()
  await bring.click()
  await expect(office.getByText("9 new products, 12 new items, 4 counts, 4 new places. Each can be changed afterwards, but this can't be undone in one go.")).toBeVisible()
  await office.getByRole('button', { name: 'Bring them in' }).click()
  await expect(office.getByRole('heading', { name: 'Brought in' })).toBeVisible()
  await expect(office.getByRole('status').filter({ hasText: 'Brought in' })).toHaveText('Brought in 10 rows: 9 new products, 12 new items, 4 counts, 4 new places.')

  // On the Stock tab: the products, and each item with its Session Hire number and its old one.
  await office.getByRole('link', { name: 'Stock tab' }).click()
  await expect(office.locator('.conn')).toHaveText('Up to date')
  await expect(stock.getByRole('button', { name: 'Show all 9 products' })).toBeVisible()
  await stock.getByRole('link', { name: /^Corvo K12/ }).click()
  const items = office.getByRole('region', { name: 'Items' })
  await expect(items.locator('.item-row')).toHaveCount(4)
  await expect(items.locator('.item-row').first()).toContainText('SH-000505')
  // The old tag still finds its item, typed or scanned into the search.
  await ready(office, '#stock')
  await stock.getByRole('searchbox', { name: 'Find' }).fill('a-0102')
  await stock.getByRole('searchbox', { name: 'Find' }).press('Enter')
  await expect(office.getByRole('heading', { level: 1, name: 'SH-000506' })).toBeVisible()
  await expect(office.locator('.facts')).toContainText('Old numberA-0102')
  await expect(office.getByRole('region', { name: 'Inspections' })).toContainText('PAT due 30 Sept 2027, as the stock list says')

  // An old tag puts its item in a case too, typed or scanned.
  await ready(office, '#stock')
  await stock.getByRole('searchbox', { name: 'Find' }).fill('SH-000503')
  await stock.getByRole('searchbox', { name: 'Find' }).press('Enter')
  const put = office.locator('form').filter({ has: office.getByRole('heading', { name: 'Put an item in', exact: true }) })
  await put.getByLabel('Its number').fill('a-0102')
  await put.getByRole('button', { name: 'Put it in SH-000503' }).click()
  await expect(put.getByRole('status', { name: 'Put in' })).toContainText('SH-000506 (Corvo K12) is in SH-000503 now.')
  await expect(office.getByRole('region', { name: 'In it' }).locator('.item-row', { hasText: 'SH-000506' })).toBeVisible()
})

test('shows an item’s log: scanned out and back, a fault with no signal, and who did what once there’s signal', async ({ browser, request }) => {
  // The first speaker the list brought in, out to a job and back, by another phone.
  const pull = await (await request.get('/api/sync/pull?after=0')).json()
  const speaker = pull.changes.find((c: { entity: string; data: { number?: string } }) => c.entity === 'asset' && c.data?.number === 'SH-000505').id as string
  // After it was brought in, and before anything this test does on the phone.
  const start = Date.now()
  const after = (seconds: number) => new Date(start + seconds * 1000).toISOString()
  const mutations: [string, Record<string, unknown>][] = [
    ['project.create', { id: 'harbour', name: 'Harbour gig', clientId: null, venueId: null, status: 'confirmed', notes: '' }],
    ['move.record', { id: 'harbour-out', projectId: 'harbour', direction: 'out', assetId: speaker, modelId: 'x', qty: 1, at: after(0) }],
    ['move.record', { id: 'harbour-in', projectId: 'harbour', direction: 'in', assetId: speaker, modelId: 'x', qty: 1, at: after(0.1) }],
  ]
  const res = await request.post('/api/sync/push', {
    data: { clientId: 'warehouse-phone', mutations: mutations.map(([name, args], i) => ({ id: `log-${i}`, name, args, createdAt: new Date().toISOString() })) },
  })
  expect((await res.json()).results.map((r: { status: string }) => r.status)).toEqual(['applied', 'applied', 'applied'])

  const context = await browser.newContext({ viewport: phoneSize })
  const page = await context.newPage()
  await ready(page, `#stock/item/${speaker}`)
  const log = page.getByRole('region', { name: 'Log' })
  const entries = log.locator('.log li .what')
  await expect(entries).toHaveText(['Back in from Harbour gig', 'Out to Harbour gig', 'Added as SH-000505 at Bay A1'])

  // No signal: a fault reported here waits, and the log says so.
  await context.setOffline(true)
  await page.getByRole('button', { name: 'Report damage' }).click()
  const damage = page.getByRole('form', { name: /damaged$/ })
  await damage.getByLabel("What's wrong").fill('Grille dented')
  await damage.getByRole('button', { name: 'Report damage' }).click()
  await expect(entries.first()).toHaveText("Reported damaged, can't go out: Grille dented")
  await expect(log.locator('.log li').first()).toContainText('Waiting to sync')
  await expect(page.locator('.conn')).toContainText('No signal')
  // Opened afresh with no signal, the log is what this phone holds, and says what needs signal.
  await page.evaluate(() => (location.hash = '#stock'))
  await page.evaluate((id) => (location.hash = `#stock/item/${id}`), speaker)
  await expect(log.locator('.hint')).toHaveText(
    'With no signal, this shows the scans, faults and tests on this phone. Who did each, and when it was added, moved or relabelled, come with signal.'
  )
  await expect(entries).toHaveText(["Reported damaged, can't go out: Grille dented", 'Back in from Harbour gig', 'Out to Harbour gig'])
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)

  // Signal back: the fault syncs, and the server fills in the rest.
  await context.setOffline(false)
  await expect(page.locator('.conn')).toHaveText('Up to date')
  await expect(entries).toHaveText(["Reported damaged, can't go out: Grille dented", 'Back in from Harbour gig', 'Out to Harbour gig', 'Added as SH-000505 at Bay A1'])
  await expect(log.locator('.hint')).toHaveCount(0)
  await expect(log.locator('.log li').first()).not.toContainText('Waiting to sync')
})

// Proves an item's log with more than the server's page leaves nothing out when a change arrives after older entries were read.
test('keeps an item’s long log whole when a change arrives after older entries were read', async ({ browser, request }) => {
  const pull = await (await request.get('/api/sync/pull?after=0')).json()
  const item = pull.changes.find((c: { entity: string; data: { number?: string } }) => c.entity === 'asset' && c.data?.number === 'SH-000507').id as string
  const serial = (n: number) => ({ id: `serial-${n}`, name: 'asset.update', args: { id: item, serial: `S${n}` }, createdAt: new Date().toISOString() })
  const send = async (from: number, to: number) => {
    const res = await request.post('/api/sync/push', { data: { clientId: 'office-laptop', mutations: Array.from({ length: to - from + 1 }, (_, i) => serial(from + i)) } })
    expect((await res.json()).results.every((r: { status: string }) => r.status === 'applied')).toBe(true)
  }
  await send(1, 105)

  const page = await (await browser.newContext({ viewport: phoneSize })).newPage()
  await ready(page, `#stock/item/${item}`)
  const log = page.getByRole('region', { name: 'Log' })
  await expect(log.getByRole('button', { name: 'Show all 100 entries' })).toBeVisible()
  await log.getByRole('button', { name: 'Show older' }).click()
  await expect(log.getByRole('button', { name: 'Show all 106 entries' })).toBeVisible()
  await log.getByRole('button', { name: 'Show all 106 entries' }).click()
  await expect(log.locator('.log li')).toHaveCount(106)

  // Another change, from another device: the newest page is read again, and none of the log goes missing in between.
  await send(106, 106)
  const entries = log.locator('.log li .what')
  await expect(entries.first()).toHaveText('Changed its serial to S106')
  const serials = (await entries.allTextContents()).map((t) => /S(\d+)$/.exec(t)?.[1]).filter(Boolean).map(Number)
  expect(serials).toEqual(Array.from({ length: serials.length }, (_, i) => 106 - i))
})
