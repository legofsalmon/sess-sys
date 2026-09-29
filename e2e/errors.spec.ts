import { expect, test, type BrowserContext, type Page } from '@playwright/test'

/**
 * Error reports from the app (ADR 0005). The test server has no Sentry
 * project, so the app is told of a made-up one here, and each report the
 * app sends it is caught on the way out and kept, or turned away as if the
 * device had no signal.
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
    route.fulfill({ json: { errors: { dsn: 'https://publickey@errors.example/1', environment: 'e2e' } } })
  )
  await context.route('https://errors.example/**', (route) => {
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
