import { expect, test, type Page } from '@playwright/test'

/**
 * Google Calendar in the browser (ADR 0008). The test server runs without
 * Google, so a server with the calendar available is played here: Colly is
 * signed in, the connection and each day's state arrive in the normal pull
 * like any other record, and the calendar's own calls are answered here.
 * What the server itself does with Google is tested against a pretend
 * Google in server/test/calendar.test.ts. To refresh the blueprint
 * screenshots, run this file on its own with SHOTS=1.
 */

const shot = (name: string) => (process.env.SHOTS ? { path: `docs/hub/img/${name}.png` } : undefined)
const phoneSize = { width: 390, height: 844 }
const tag = () => Math.random().toString(36).slice(2, 8)
const named = (name: string, id: string) => (process.env.SHOTS ? name : `${name} ${id}`)

const TEST_CAL = 'test-cal@group.calendar.google.com'

interface Link {
  id: 'main'
  state: 'off' | 'choosing' | 'on' | 'stopping' | 'reconnect'
  account: string | null
  calendarId: string | null
  calendarName: string | null
  problem: string | null
  connectedBy: string | null
  connectedAt: string | null
}

const connected = (changes: Partial<Link> = {}): Link => ({
  id: 'main',
  state: 'on',
  account: 'ops@sessionhire.com',
  calendarId: TEST_CAL,
  calendarName: 'Test calendar',
  problem: null,
  connectedBy: 'Colly Hewson',
  connectedAt: new Date().toISOString(),
  ...changes,
})

interface PhaseData {
  id: string
  projectId: string
  name: string
  start: string
  end: string
}

type DayState = { state: 'on' | 'failed'; title: string; problem: string | null; link: string | null }

function eachDay(start: string, end: string) {
  const out: string[] = []
  for (const d = new Date(`${start}T00:00:00Z`); d <= new Date(`${end}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + 1)) out.push(d.toISOString().slice(0, 10))
  return out
}

/**
 * Colly, signed in, on a server whose calendar connection is `server.link`.
 * For the job named `server.job`, each day of each phase is on the calendar
 * as `server.day` says.
 */
async function signedIn(page: Page) {
  const server = {
    link: undefined as Link | undefined,
    job: '',
    jobId: '',
    phases: new Map<string, PhaseData>(),
    day: (_phase: string, _i: number, _n: number): DayState | undefined => undefined,
    /** Days of other jobs on the calendar, by day. */
    otherDays: [] as string[],
  }
  await page.route('**/api/me', (route) => route.fulfill({ json: { auth: 'google', user: { id: 'u1', email: 'colly@sessionhire.com', name: 'Colly Hewson' } } }))
  await page.route(/\/api\/sync\/pull/, async (route) => {
    const res = await route.fetch()
    const body = (await res.json()) as { cursor: number; changes: { seq: number; entity: string; id: string; op: string; data: unknown }[] }
    for (const c of body.changes) {
      if (c.entity === 'project' && c.op === 'put' && (c.data as { name: string }).name === server.job) server.jobId = c.id
      if (c.entity === 'phase' && c.op === 'put') server.phases.set(c.id, c.data as PhaseData)
    }
    const put = (entity: string, id: string, data: unknown) => body.changes.push({ seq: body.cursor, entity, id, op: 'put', data })
    if (server.link) put('calendarLink', 'main', server.link)
    for (const day of server.otherDays)
      put('calendarDay', `other/${day}`, { id: `other/${day}`, phaseId: 'other', projectId: 'other', day, calendarId: TEST_CAL, state: 'on', title: 'Another job', problem: null, link: null })
    for (const p of server.phases.values()) {
      if (!server.jobId || p.projectId !== server.jobId) continue
      const days = eachDay(p.start, p.end)
      days.forEach((day, i) => {
        const d = server.day(p.name, i, days.length)
        if (d) put('calendarDay', `${p.id}/${day}`, { id: `${p.id}/${day}`, phaseId: p.id, projectId: p.projectId, day, calendarId: TEST_CAL, ...d })
      })
    }
    return route.fulfill({ response: res, json: body })
  })
  return server
}

test('connecting Google Calendar, choosing its calendar, checking and disconnecting', async ({ browser }) => {
  const page = await (await browser.newContext({ viewport: phoneSize })).newPage()
  const server = await signedIn(page)
  const card = page.getByRole('region', { name: 'Google Calendar' })

  // Back from Google with a permission left unticked: the app says so, and tidies the address.
  await page.goto('/?calendar=missing#account')
  await expect(card.getByRole('alert')).toContainText("a permission was left unticked on Google's page")
  await expect(page).toHaveURL(/\/#account$/)
  await expect(card.getByRole('link', { name: 'Connect Google Calendar' })).toHaveAttribute('href', /^\/api\/calendar\/connect\?client=[a-z0-9]+$/)

  // Connected this time: the app asks which of the account's calendars the jobs go on.
  server.link = connected({ state: 'choosing', calendarId: null, calendarName: null })
  await page.route(/\/api\/calendar\/calendars/, (route) =>
    route.fulfill({
      json: [
        { id: 'ops@sessionhire.com', name: 'ops@sessionhire.com', primary: true, access: 'owner' },
        { id: 'gigs@group.calendar.google.com', name: 'Session Hire Gigs', primary: false, access: 'writer' },
        { id: TEST_CAL, name: 'Test calendar', primary: false, access: 'owner' },
      ],
    })
  )
  let chosen: unknown
  await page.route(/\/api\/calendar\/use/, (route) => {
    chosen = route.request().postDataJSON()
    server.link = connected()
    server.otherDays = ['2030-10-07', '2030-10-08', '2030-10-09', '2031-01-01']
    return route.fulfill({ json: server.link })
  })
  await page.goto('/?calendar=connected#account')
  await expect(card.getByRole('status')).toHaveText('Connected to Google.')
  await expect(card.getByRole('heading', { name: 'Choose the calendar' })).toBeVisible()
  await expect(card).toContainText('Connected as ops@sessionhire.com.')
  await expect(card.getByRole('radio')).toHaveCount(3)
  await card.getByRole('radio', { name: /Test calendar/ }).check()
  await card.getByRole('button', { name: 'Use this calendar' }).click()
  await expect(card.getByRole('status')).toHaveText('Jobs go on Test calendar from now on.')
  expect(chosen).toEqual({ calendarId: TEST_CAL })
  await expect(card).toContainText('Confirmed jobs go on Test calendar, written by ops@sessionhire.com.')
  await expect(card).toContainText('4 days on it from today. Connected by Colly Hewson today at')

  // Check now looks at the calendar itself and says what it did.
  await page.route(/\/api\/calendar\/check/, (route) => route.fulfill({ json: { written: 2, removed: 1, failed: 0 } }))
  await card.getByRole('button', { name: 'Check now' }).click()
  await expect(card.getByRole('status')).toHaveText('Checked: wrote 2 days and took 1 off.')
  await page.evaluate(() => scrollTo(0, 0))
  await page.screenshot(shot('account-calendar'))

  // Something wrong shows on the card, in words.
  server.link = connected({
    problem:
      "The Google Calendar API is switched off in the app's Google Cloud project, so nothing can be written. Switch it on (see the setup steps), then press Check now.",
  })
  await page.reload()
  await expect(card.getByRole('alert')).toContainText('The Google Calendar API is switched off')

  // Changing calendar moves the days, after saying so.
  let asked = ''
  page.once('dialog', (d) => {
    asked = d.message()
    void d.dismiss()
  })
  await card.getByRole('button', { name: 'Change calendar' }).click()
  await card.getByRole('radio', { name: /Session Hire Gigs/ }).check()
  await card.getByRole('button', { name: 'Use this calendar' }).click()
  expect(asked).toBe("Move the app's days from Test calendar to Session Hire Gigs? Days before today stay where they are.")
  await card.getByRole('button', { name: 'Keep Test calendar' }).click()

  // Disconnecting takes the days off, after saying so.
  await page.route(/\/api\/calendar\/disconnect/, (route) => {
    server.link = connected({ state: 'stopping' })
    return route.fulfill({ json: server.link })
  })
  page.once('dialog', (d) => {
    asked = d.message()
    void d.accept()
  })
  await card.getByRole('button', { name: 'Disconnect' }).click()
  expect(asked).toBe('Disconnect Google Calendar? The app takes its days off Test calendar from today on, and hands back its access. Days before today stay.')
  await expect(card).toContainText("Disconnecting: taking the app's days off Test calendar…")

  // Google no longer accepts the app's key: connect again.
  server.link = connected({
    state: 'reconnect',
    problem: "Google no longer accepts the app's access to ops@sessionhire.com's calendars, so the calendar isn't being updated. Connect again to carry on.",
  })
  await page.reload()
  await expect(card.getByRole('heading', { name: 'Google Calendar needs connecting again' })).toBeVisible()
  await expect(card.getByRole('link', { name: 'Connect again' })).toHaveAttribute('href', /^\/api\/calendar\/connect\?client=[a-z0-9]+$/)
})

test('each phase of a job says how it stands on the calendar', async ({ browser }) => {
  const id = tag()
  const job = named('Nissan launch', id)
  const renamed = named('Nissan Qashqai launch', id)
  const page = await (await browser.newContext({ viewport: phoneSize })).newPage()
  const server = await signedIn(page)
  server.link = connected()
  server.job = job
  server.day = (phase, i, n) =>
    phase === 'Show'
      ? {
          state: 'failed',
          title: `${job} - Show`,
          problem: 'Google turned this day down (badRequest). It is tried again when the job changes, and each night.',
          link: null,
        }
      : { state: 'on', title: `${job} - ${phase} ${i + 1}/${n}`, problem: null, link: 'https://www.google.com/calendar/event?eid=abc' }

  await page.goto('/#jobs')
  await expect(page.getByRole('status')).toHaveText('Up to date')
  const form = page.locator('form').filter({ has: page.getByRole('button', { name: 'Add job' }) })
  await form.getByLabel('Job').fill(job)
  await form.getByLabel('Client').fill(named('Nissan Ireland', id))
  await form.getByLabel('Phase 1', { exact: true }).fill('Build')
  await form.getByLabel('Phase 1 from').fill('2030-10-07')
  await form.getByLabel('Phase 1 to').fill('2030-10-08')
  await form.getByRole('button', { name: 'Add a phase' }).click()
  await form.getByLabel('Phase 2', { exact: true }).fill('Show')
  await form.getByLabel('Phase 2 from').fill('2030-10-09')
  await form.getByLabel('Phase 2 to').fill('2030-10-09')
  await form.getByRole('button', { name: 'Add job' }).click()
  await expect(page.getByRole('heading', { name: job })).toBeVisible()
  await expect(page.getByRole('status')).toHaveText('Up to date')

  const build = page.getByRole('article', { name: 'Build' })
  const show = page.getByRole('article', { name: 'Show' })
  await expect(build.locator('.cal')).toHaveText(`On Test calendar as “${job} - Build 1/2” and “${job} - Build 2/2”. Open it`)
  await expect(build.getByRole('link', { name: 'Open it' })).toHaveAttribute('href', 'https://www.google.com/calendar/event?eid=abc')
  await expect(show.locator('.warn-line')).toHaveText(
    "Show couldn't go on Test calendar. Google turned this day down (badRequest). It is tried again when the job changes, and each night."
  )
  await page.evaluate(() => scrollTo(0, 0))
  await page.screenshot(shot('jobs-calendar'))

  // Renamed: on its way until the server has rewritten the days.
  await page.getByRole('button', { name: 'Change details' }).click()
  await page.getByLabel('Job', { exact: true }).fill(renamed)
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(page.getByRole('heading', { name: renamed })).toBeVisible()
  await expect(build.locator('.cal')).toHaveText(`Going on Test calendar as “${renamed} - Build 1/2” and “${renamed} - Build 2/2”…`)
})
