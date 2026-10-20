import { expect, test, type BrowserContext, type Page } from '@playwright/test'

/**
 * Error reports from the app (ADR 0005). The test server has no Sentry
 * project, so the app is told of a made-up one here, at an address of
 * Sentry's own that the app's content security policy lets it report to,
 * and each report the app sends it is caught on the way out, before it
 * leaves the browser, and kept, or turned away as if the device had no
 * signal.
 */

// The service worker would otherwise stand between the page and the stand-ins below.
test.use({ serviceWorkers: 'block' })

interface Report {
  exception: { values: { type: string; value: string; stacktrace?: { frames: { filename?: string }[] } }[] }
  request?: { url: string }
  environment: string
}

/** A stand-in for Sentry: keeps what the app reports, or fails it while `signal` is off. */
async function standIn(context: BrowserContext) {
  const sentry = { reports: [] as { body: Report; raw: string }[], signal: true, turnedAway: 0 }
  await context.route('**/api/config', (route) =>
    route.fulfill({ json: { errors: { dsn: 'https://publickey@o1.ingest.de.sentry.io/1', environment: 'e2e' } } })
  )
  await context.route('https://o1.ingest.de.sentry.io/**', (route) => {
    if (!sentry.signal) {
      sentry.turnedAway++
      return route.abort('internetdisconnected')
    }
    const lines = (route.request().postData() ?? '').split('\n').filter(Boolean)
    for (let i = 1; i + 1 < lines.length; i += 2) {
      if (JSON.parse(lines[i]!).type === 'event') sentry.reports.push({ body: JSON.parse(lines[i + 1]!), raw: lines[i + 1]! })
    }
    return route.fulfill({ json: {}, headers: { 'access-control-allow-origin': '*' } })
  })
  return sentry
}

const messages = (sentry: Awaited<ReturnType<typeof standIn>>) => sentry.reports.map((r) => r.body.exception.values.at(-1)?.value)

/** Sentry's code has loaded and started, which it does just after the app asks the server where to report. */
const reporting = (page: Page) => page.waitForFunction(() => '__SENTRY__' in window)

/** An error nobody caught, thrown by the script at `from` (by default, one of the app's own). */
async function fault(page: Page, message: string, from = '/fault.js') {
  const url = new URL(from, page.url()).href
  await page.context().route(
    (u) => u.href === url,
    (route) => route.fulfill({ contentType: 'text/javascript', body: `setTimeout(() => { throw new Error(${JSON.stringify(message)}) })` })
  )
  await page.addScriptTag({ url })
}

/** Reports waiting on the device for a signal, which Sentry keeps in IndexedDB. */
const waiting = (page: Page) =>
  page.evaluate(
    () =>
      new Promise<number>((resolve, reject) => {
        const open = indexedDB.open('sentry-offline')
        open.onupgradeneeded = () => open.result.createObjectStore('queue')
        open.onerror = () => reject(open.error)
        open.onsuccess = () => {
          const count = open.result.transaction('queue').objectStore('queue').count()
          count.onsuccess = () => {
            open.result.close()
            resolve(count.result)
          }
        }
      })
  )

test.describe(() => {
  // A browser extension's script runs whatever the page's policy says, which turns away any other site's (audit finding 24); the bypass stands in for that.
  test.use({ bypassCSP: true })

  test('reports an error in the app, with nothing about the person using it', async ({ context, page }) => {
    const sentry = await standIn(context)
    await page.goto('/?from=aoife@example.ie')
    await reporting(page)
    // A browser extension's error is none of the app's business, and isn't sent.
    await fault(page, 'The extension broke', 'https://extension.example/content.js')
    await fault(page, 'Stock count failed for aoife.byrne@sessionhire.com', '/fault.js?from=aoife@example.ie')

    await expect.poll(() => messages(sentry)).toEqual(['Stock count failed for [email]'])
    const { body, raw } = sentry.reports[0]!
    // Which screen and which script, but not what followed the path in either address.
    expect(body.request?.url).toBe(new URL('/', page.url()).href)
    expect(body.exception.values.at(-1)?.stacktrace?.frames.map((f) => f.filename)).toContain(new URL('/fault.js', page.url()).href)
    expect(body.environment).toBe('e2e')
    expect(body).not.toHaveProperty('user')
    expect(body).not.toHaveProperty('breadcrumbs')
    for (const secret of ['aoife', 'example.ie', 'sessionhire.com']) expect(raw).not.toContain(secret)
  })
})

test('keeps a report made with no signal on the device, and sends it when the signal is back', async ({ context, page }) => {
  const sentry = await standIn(context)
  await page.goto('/')
  await reporting(page)

  sentry.signal = false
  await fault(page, 'Could not save the count')
  await expect.poll(() => waiting(page)).toBe(1)
  expect(sentry.turnedAway).toBeGreaterThan(0)
  expect(sentry.reports).toEqual([])

  sentry.signal = true
  await page.evaluate(() => dispatchEvent(new Event('online')))
  await expect.poll(() => messages(sentry)).toEqual(['Could not save the count'])
  expect(await waiting(page)).toBe(0)
})

test('sends a report still waiting when the app was closed, the next time it opens', async ({ context, page }) => {
  const sentry = await standIn(context)
  await page.goto('/')
  await reporting(page)
  sentry.signal = false
  await fault(page, 'Could not save the count')
  await expect.poll(() => waiting(page)).toBe(1)
  await page.close()

  // Opened again later with signal, though the server doesn't answer at
  // first: the app goes by where it was told to report last time.
  sentry.signal = true
  await context.route('**/api/config', (route) => route.abort('internetdisconnected'))
  const again = await context.newPage()
  await again.goto('/')
  await expect.poll(() => messages(sentry), { timeout: 20_000 }).toEqual(['Could not save the count'])
})

/** Four speakers in a bay, on a product's page of their own, and a way to move them: a change for the phone to send. */
async function speakers(page: Page) {
  const id = Math.random().toString(36).slice(2, 8)
  const createdAt = new Date().toISOString()
  const setUp = [
    { name: 'model.create', args: { id: `m${id}`, name: `Speaker ${id}`, department: 'audio', category: 'Speakers', tracking: 'bulk', isCase: false, valueCents: null, notes: '' } },
    { name: 'place.upsert', args: { id: `a${id}`, name: `Bay ${id}`, notes: '' } },
    { name: 'place.upsert', args: { id: `v${id}`, name: `Van ${id}`, notes: '' } },
    { name: 'stock.set', args: { modelId: `m${id}`, placeId: `a${id}`, caseId: null, qty: 4 } },
  ].map((m, i) => ({ ...m, id: `errs${id}${i}`, createdAt }))
  await page.request.post('/api/sync/push', { data: { clientId: `office${id}`, mutations: setUp } })
  await page.goto(`/#stock/product/m${id}`)
  const row = page.getByRole('region', { name: 'Counted' }).locator('.count', { hasText: `Bay ${id}` })
  await expect(row).toContainText('4')
  return async () => {
    await row.getByRole('button', { name: 'Move some' }).click()
    await row.getByLabel('How many').fill('1')
    await row.getByLabel('To', { exact: true }).fill(`Van ${id}`)
    await row.getByRole('button', { name: `Move Speaker ${id}` }).click()
  }
}

test("reports a phone whose changes keep failing to send while it has a signal, once", async ({ context, page }) => {
  // Proves: a push the server keeps failing, which the phone only retries, reaches the error reports (audit finding 19).
  const sentry = await standIn(context)
  const move = await speakers(page)
  await reporting(page)
  let pushes = 0
  await context.route('**/api/sync/push', (route) => {
    pushes++
    return route.fulfill({ status: 500, json: { error: 'Something went wrong on the server.' } })
  })
  await move()
  await expect.poll(() => messages(sentry), { timeout: 40_000 }).toEqual(['Sending a change has failed 4 times in a row: Server answered 500'])
  expect(sentry.reports[0]!.body.exception.values.at(-1)?.type).toBe('PushFailing')
  // Still failing, and still said once.
  const after = pushes
  await expect.poll(() => pushes, { timeout: 40_000 }).toBeGreaterThan(after)
  expect(sentry.reports).toHaveLength(1)
})

test('reports a change that has waited on the phone for over a day', async ({ context, page }) => {
  const sentry = await standIn(context)
  await page.clock.install()
  const move = await speakers(page)
  await reporting(page)
  await context.route('**/api/sync/push', (route) => route.abort('internetdisconnected'))
  await move()
  await page.clock.fastForward('25:00:00')
  await page.clock.runFor(11 * 60_000)
  await expect.poll(() => messages(sentry), { timeout: 20_000 }).toContainEqual(expect.stringMatching(/^A change \(stock\.move\) has waited 2[45] hours on this device to be sent, with 1 waiting in all$/))
})
