import { readFileSync } from 'node:fs'
import { expect, test, type APIRequestContext, type Page } from '@playwright/test'
import { strFromU8, unzipSync } from 'fflate'

/**
 * The History tab and "Download everything" (ADR 0006), in a real browser:
 * days, and one device's changes one after another as one line that opens
 * on a tap, since sign-in is off here and nobody has a name. The test
 * server is shared with the other browser tests, so each test looks for its
 * own entries by name rather than at the whole history.
 */

const unique = () => Math.random().toString(36).slice(2, 8)

/** The end of this device's own code, as the Account tab shows it. */
async function deviceCode(page: Page) {
  await page.goto('/#account')
  const text = await page.getByText(/^Device \w{6} ·/).textContent()
  return /^Device (\w{6})/.exec(text ?? '')![1]!
}

async function addPlace(page: Page, name: string) {
  const open = page.getByRole('button', { name: 'Add place' })
  if (!(await page.getByLabel('New place').count())) await open.click()
  await page.getByLabel('New place').fill(name)
  await page.getByRole('button', { name: 'Add place' }).click()
  await expect(page.getByRole('status').filter({ hasText: `Added ${name}.` })).toBeVisible()
}

/** Changes sent straight to the server from a device of the test's own, ending in `code`: places, the second one's name already taken, so it's turned down. */
async function changesFrom(request: APIRequestContext, code: string, names: string[]) {
  const createdAt = new Date().toISOString()
  const mutations = names.map((name, i) => ({ id: `h${code}${i}`, name: 'place.upsert', args: { id: `h${code}${i}`, name, notes: '' }, createdAt }))
  const res = await request.post('/api/sync/push', { data: { clientId: `e2ehistory${code}`, mutations, sentAt: createdAt } })
  return (await res.json()).results.map((r: { status: string }) => r.status) as string[]
}

test('shows who did what, on which device, and what was made offline', async ({ page }) => {
  // Proves: with sign-in off a change says its device and time but no "Someone", the top says why once, and one made with no signal says so.
  // The phone's clock, so two hours can pass without waiting for them.
  await page.clock.install()
  const code = await deviceCode(page)
  const [bay, van] = [`Bay ${unique()}`, `Van ${unique()}`]

  await page.goto('/#stock')
  await expect(page.locator('.conn')).toHaveText('Up to date')
  await addPlace(page, bay)
  await expect(page.locator('.conn')).toHaveText('Up to date')

  // Added with no signal, and sent two hours later. The signal comes back by the same route letting the push through,
  // not by taking the route away: the two hours fire the app's retry, and a push caught mid-route as it was taken away
  // was left hanging, never sent nor failed, so the app waited out its 30 seconds with "No signal" showing.
  let signal = false
  await page.route('**/api/sync/push', (route) => (signal ? route.continue() : route.abort('internetdisconnected')))
  await addPlace(page, van)
  await expect(page.locator('.conn')).toHaveText(/1 waiting/)
  await page.clock.fastForward('02:00:00')
  signal = true
  await page.evaluate(() => dispatchEvent(new Event('online')))
  await expect(page.locator('.conn')).toHaveText('Up to date')

  await page.getByRole('link', { name: 'History' }).click()
  await expect(page.getByText('Names show once sign-in is on. Until then, changes are grouped by the device they came from.')).toBeVisible()
  // Two hours apart, so not one run: each its own line.
  const added = page.locator('.entry', { hasText: `Saved the place ${van}` })
  await expect(added).toBeVisible()
  await expect(added).toContainText(`Chrome on Linux, device ${code} · `)
  await expect(added).not.toContainText('Someone')
  await expect(added).toContainText('Made offline; it reached the server 2 h later.')

  const first = page.locator('.entry', { hasText: `Saved the place ${bay}` })
  await expect(first).toBeVisible()
  await expect(first).not.toContainText('Made offline')
})

test("groups a day's changes, and one device's run of them is one line that opens on a tap", async ({ page, request }) => {
  // Proves: days are headings, a run is a button saying whose, how many and when, shut until tapped (aria-expanded), and opens to each change.
  const code = unique()
  const names = [1, 2, 3].map((n) => `Shelf ${n} ${code}`)
  expect(await changesFrom(request, code, names)).toEqual(['applied', 'applied', 'applied'])

  await page.goto('/#history')
  await expect(page.getByRole('heading', { level: 2, name: 'Today' })).toBeVisible()
  const run = page.getByRole('button', { name: new RegExp(`^Device ${code}, 3 changes, \\d\\d:\\d\\d`) })
  await expect(run).toHaveAttribute('aria-expanded', 'false')
  await expect(page.getByText(`Saved the place ${names[1]}`)).toHaveCount(0)

  await run.click()
  await expect(run).toHaveAttribute('aria-expanded', 'true')
  const list = page.locator(`#${await run.getAttribute('aria-controls')}`)
  await expect(list.locator('.entry')).toHaveText([new RegExp(`^Saved the place ${names[2]}`), new RegExp(`^Saved the place ${names[1]}`), new RegExp(`^Saved the place ${names[0]}`)])

  await run.click()
  await expect(run).toHaveAttribute('aria-expanded', 'false')
  await expect(page.getByText(`Saved the place ${names[1]}`)).toHaveCount(0)
})

test('keeps what the server turned down in view under its run while the run is shut', async ({ page, request }) => {
  // Proves: a run's line counts what was turned down, and each such change stays on show with its reason without opening the run.
  const code = unique()
  const taken = `Cage ${code}`
  expect(await changesFrom(request, code, [taken, taken, `Bench ${code}`])).toEqual(['applied', 'rejected', 'applied'])

  await page.goto('/#history')
  const run = page.getByRole('button', { name: new RegExp(`^Device ${code}, 3 changes`) })
  await expect(run).toHaveAttribute('aria-expanded', 'false')
  await expect(run).toContainText('1 turned down')
  const refused = page.locator('.entry.run', { has: run }).locator('.entry.turned-down')
  await expect(refused).toHaveCount(1)
  await expect(refused).toContainText(`Saved the place ${taken}`)
  await expect(refused).toContainText(`Turned down: There's already a place called ${taken}.`)
  await expect(page.getByText(`Saved the place Bench ${code}`)).toHaveCount(0)

  // Opened, it's in its place among the rest.
  await run.click()
  await expect(page.locator('.entry.run', { has: run }).locator('ol .entry')).toHaveText([
    new RegExp(`^Saved the place Bench ${code}`),
    new RegExp(`^Saved the place ${taken}.*Turned down`),
    new RegExp(`^Saved the place ${taken}`),
  ])
})

test('says the history needs signal', async ({ page }) => {
  await page.route('**/api/history**', (route) => route.abort('internetdisconnected'))
  await page.goto('/#history')
  await expect(page.getByText("The history needs signal: it's kept on the server, not on this device.")).toBeVisible()
  await page.unroute('**/api/history**')
  await page.getByRole('button', { name: 'Try again' }).click()
  await expect(page.locator('.entry').first()).toBeVisible()
})

test('downloads everything in one file, and the download shows in the history', async ({ page }) => {
  const code = await deviceCode(page)
  const downloading = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Download everything' }).click()
  const download = await downloading
  expect(download.suggestedFilename()).toMatch(/^session-hire-\d{4}-\d{2}-\d{2}\.zip$/)
  // The size is in KB, or MB from 1 MB; a test server shared by every spec can grow past it.
  await expect(page.getByText(/^Downloaded session-hire-\d{4}-\d{2}-\d{2}\.zip \((\d+ KB|\d+\.\d MB)\)\.$/)).toBeVisible()

  const files = unzipSync(readFileSync((await download.path())!))
  expect(Object.keys(files)).toEqual(expect.arrayContaining(['README.txt', 'history.csv', 'everything.json', 'tables/models.csv', 'tables/people.csv']))
  expect(Object.keys(files)).not.toContain('tables/products.csv')
  expect(strFromU8(files['README.txt']!)).toContain('Session Hire: everything, exported')

  // From 1,000 rows the count has a comma, as the history writes every number.
  await page.getByRole('link', { name: 'History' }).click()
  await expect(page.locator('.entry', { hasText: `Chrome on Linux, device ${code}` }).filter({ hasText: /^Downloaded everything \([\d,]+ rows\)/ })).not.toHaveCount(0)
})
