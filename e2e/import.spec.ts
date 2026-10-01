import { expect, test, type Page } from '@playwright/test'

/**
 * Bringing jobs in from Google Calendar in the browser (ADR 0011). The test
 * server runs without Google, so a server with the calendar connected is
 * played here: the connection arrives in the normal pull, and the import's
 * own calls are answered here with what the server would say. What the
 * server itself makes of a calendar is tested against a pretend Google in
 * server/test/import.test.ts. To refresh the blueprint screenshots, run
 * this file on its own with SHOTS=1.
 */

const shot = (name: string) => (process.env.SHOTS ? { path: `docs/hub/img/${name}.png` } : undefined)
const phoneSize = { width: 390, height: 844 }
const laptopSize = { width: 1280, height: 900 }
const OPS = 'ops@sessionhire.com'

const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Dublin' })
const day = (n: number) => {
  const d = new Date(`${today}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}
const threeMonthsBack = (() => {
  const [y, m] = today.split('-').map(Number) as [number, number]
  return new Date(Date.UTC(y, m - 4, 1)).toISOString().slice(0, 10)
})()

const phase = (name: string, start: string, end = start, more: Record<string, unknown> = {}) => ({
  name,
  start,
  end,
  guessed: false,
  venue: null,
  sheet: false,
  extends: false,
  ...more,
})

/** What the server says the organiser's calendar holds. */
const preview = () => ({
  calendar: { id: OPS, name: OPS, primary: true },
  from: threeMonthsBack,
  to: day(731),
  events: 148,
  jobs: [
    {
      key: `nissan|${day(10)}`,
      name: 'Nissan',
      status: 'confirmed',
      adds: null,
      phases: [phase('Build', day(10), day(11), { sheet: true }), phase('Show', day(12), day(13), { sheet: true }), phase('Load out', day(13), day(13), { sheet: true })],
      start: day(10),
      end: day(13),
      venue: { name: 'Convention Centre Dublin', isNew: true },
      crew: { booked: 2, waiting: 1, declined: 1, notInApp: 3 },
      events: 4,
    },
    {
      key: `aviva|${day(16)}`,
      name: 'Aviva',
      status: 'confirmed',
      adds: { id: 'j-aviva', name: 'Aviva' },
      phases: [phase('Babysit', day(16), day(16), { extends: true })],
      start: day(16),
      end: day(16),
      venue: null,
      crew: { booked: 1, waiting: 0, declined: 0, notInApp: 0 },
      events: 1,
    },
    {
      key: `web summit|${day(20)}`,
      name: 'Web Summit',
      status: 'confirmed',
      adds: null,
      phases: [phase('Show', day(20), day(21), { guessed: true })],
      start: day(20),
      end: day(21),
      venue: null,
      crew: { booked: 0, waiting: 0, declined: 0, notInApp: 0 },
      events: 1,
    },
    {
      key: `christmas party|${day(70)}`,
      name: 'Christmas party',
      status: 'enquiry',
      adds: null,
      phases: [phase('Show', day(70), day(70), { guessed: true })],
      start: day(70),
      end: day(70),
      venue: { name: 'The Marker Hotel', isNew: true },
      crew: { booked: 0, waiting: 0, declined: 0, notInApp: 0 },
      events: 1,
    },
  ],
  people: [
    { email: 'aoife.byrne@gmail.com', name: 'Aoife Byrne', kind: 'freelancer', suggested: true, jobs: 2 },
    { email: 'sean@sessionhire.com', name: 'Seán Murphy', kind: 'staff', suggested: true, jobs: 1 },
    { email: 'hire@stagesupplies.ie', name: 'Stage Supplies', kind: 'freelancer', suggested: false, jobs: 1 },
  ],
  leftOut: [
    { reason: 'timed', count: 96, examples: ['Call with Nissan', 'Accounts meeting'] },
    { reason: 'repeating', count: 22, examples: ['Stock check'] },
    { reason: 'special', count: 5, examples: ['Out of office'] },
    { reason: 'before', count: 12, examples: ['Aviva - Show'] },
  ],
  changed: [{ jobId: 'j-aviva', job: 'Aviva', title: 'Aviva - Build', was: [day(-3)], now: [] }],
})

/**
 * Pages signed in here read every pull through a route of their own. Each
 * is closed after its test, its routes first, so a pull still under way
 * then (the later tests' changes keep them syncing) is dropped quietly
 * rather than failing once the test is over.
 */
const signedInPages: Page[] = []
test.afterEach(async () => {
  for (const page of signedInPages.splice(0)) {
    await page.unrouteAll({ behavior: 'ignoreErrors' })
    await page.context().close()
  }
})

/** Colly, signed in, on a server with Google Calendar connected, and one job brought in before. */
async function signedIn(page: Page) {
  signedInPages.push(page)
  const calls = { looked: [] as unknown[], brought: [] as unknown[] }
  await page.route('**/api/me', (route) => route.fulfill({ json: { auth: 'google', user: { id: 'u1', email: 'colly@sessionhire.com', name: 'Colly Hewson' } } }))
  await page.route(/\/api\/sync\/pull/, async (route) => {
    const res = await route.fetch()
    const body = (await res.json()) as { cursor: number; changes: { seq: number; entity: string; id: string; op: string; data: unknown }[] }
    const put = (entity: string, id: string, data: unknown) => body.changes.push({ seq: body.cursor, entity, id, op: 'put', data })
    put('calendarLink', 'main', {
      id: 'main',
      state: 'on',
      account: OPS,
      calendarId: 'test-cal@group.calendar.google.com',
      calendarName: 'Test calendar',
      problem: null,
      connectedBy: 'Colly Hewson',
      connectedAt: new Date().toISOString(),
      invites: false,
    })
    put('project', 'j-aviva', { id: 'j-aviva', name: 'Aviva', clientId: null, venueId: null, status: 'confirmed', notes: '', sourceCalendar: OPS })
    put('phase', 'j-aviva-babysit', { id: 'j-aviva-babysit', projectId: 'j-aviva', name: 'Babysit', start: day(15), end: day(15), venueId: null, notes: '' })
    return route.fulfill({ response: res, json: body })
  })
  await page.route(/\/api\/calendar\/import\/calendars/, (route) =>
    route.fulfill({
      json: [
        { id: OPS, name: OPS, primary: true },
        { id: 'aoife@sessionhire.com', name: 'Aoife Byrne', primary: false },
        { id: 'gigs@group.calendar.google.com', name: 'Session Hire Gigs', primary: false },
      ],
    })
  )
  await page.route(/\/api\/calendar\/import\/look/, (route) => {
    calls.looked.push(route.request().postDataJSON())
    return route.fulfill({ json: preview() })
  })
  await page.route(/\/api\/calendar\/import\/bring/, (route) => {
    calls.brought.push(route.request().postDataJSON())
    return route.fulfill({ json: { jobs: 2, added: 1, days: 8, venues: 2, people: 2, crew: 6, missing: [] } })
  })
  return calls
}

test('bringing in the jobs on an organiser’s calendar: look, choose, bring in', async ({ browser }) => {
  const page = await (await browser.newContext({ viewport: phoneSize })).newPage()
  const calls = await signedIn(page)

  // From the Jobs tab, with Google Calendar connected.
  await page.goto('/#jobs')
  await page.getByRole('link', { name: 'Bring them in' }).click()
  await expect(page).toHaveURL(/#import$/)
  await expect(page.getByRole('heading', { name: 'Bring in from Google Calendar' })).toBeVisible()
  await expect(page.getByRole('navigation', { name: 'Areas' }).getByRole('link', { name: 'Jobs' })).toHaveAttribute('aria-current', 'page')

  // The account's own calendar first, chosen already; three months back by default.
  const form = page.getByRole('form', { name: 'Calendar to bring in from' })
  await expect(form.getByRole('radio')).toHaveCount(3)
  await expect(form.getByRole('radio', { name: /^ops@sessionhire\.com/ })).toBeChecked()
  await expect(form.getByLabel('First day')).toHaveValue(threeMonthsBack)
  await page.screenshot(shot('import-choose'))
  await form.getByRole('button', { name: 'Look at the calendar' }).click()
  // The request goes a moment after the press.
  await expect.poll(() => calls.looked).toEqual([{ calendarId: OPS, from: threeMonthsBack }])

  // What would come in, before anything is saved.
  await expect(page.getByRole('region', { name: 'What was found' })).toContainText('4 jobs found in 148 events.')
  const changed = page.getByRole('region', { name: 'Changed in Google' })
  await expect(changed).toContainText('“Aviva - Build”')
  await expect(changed).toContainText('no longer on the calendar')
  await expect(changed.getByRole('link', { name: 'Aviva' })).toHaveAttribute('href', '#jobs/j-aviva')
  const jobs = page.getByRole('region', { name: 'Jobs found' })
  await expect(jobs.getByRole('listitem')).toHaveCount(4)
  const nissan = jobs.getByRole('listitem').filter({ has: page.getByRole('textbox', { name: 'Name for Nissan' }) })
  await expect(nissan).toContainText('Convention Centre Dublin (new venue)')
  await expect(nissan).toContainText('Crew: 2 booked, 1 not answered, 1 said no (3 not in the app yet)')
  await expect(nissan).toContainText('job sheet in the notes')
  await expect(jobs.getByRole('listitem').filter({ hasText: 'More days for the job brought in before.' })).toContainText('Babysit')
  await expect(jobs.getByRole('listitem').filter({ has: page.getByRole('textbox', { name: 'Name for Web Summit' }) })).toContainText(
    'No phase in the title, so it comes in as a Show.'
  )
  await expect(jobs.getByRole('listitem').filter({ has: page.getByRole('textbox', { name: 'Name for Christmas party' }) })).toContainText('Pencilled in')

  // Suppliers and clients on the invites start unticked.
  const people = page.getByRole('region', { name: 'People not in the app' })
  await expect(people.getByRole('checkbox', { name: /Aoife Byrne/ })).toBeChecked()
  await expect(people.getByRole('checkbox', { name: /Seán Murphy/ })).toBeChecked()
  await expect(people.getByRole('checkbox', { name: /Stage Supplies/ })).not.toBeChecked()

  // What was left out, and why.
  const leftOut = page.getByRole('region', { name: 'Left out' })
  await leftOut.getByText('What was left out, and why').click()
  await expect(leftOut).toContainText('96 events with a start time (meetings, calls)')
  await expect(leftOut).toContainText('12 events brought in before')

  // Web Summit isn't a job this time; the party gets its real name.
  await jobs.getByRole('checkbox', { name: 'Bring in Web Summit' }).uncheck()
  await jobs.getByRole('textbox', { name: 'Name for Christmas party' }).fill('EY Christmas party')
  const bring = page.getByRole('button', { name: 'Bring in 2 jobs and more days for 1 job' })
  await expect(bring).toBeEnabled()
  await leftOut.getByText('What was left out, and why').click()
  await jobs.evaluate((e) => scrollTo(0, e.getBoundingClientRect().top + scrollY - 76))
  await page.screenshot(shot('import-look'))
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)

  // Renaming Nissan to the party's name would bring them in as one.
  await jobs.getByRole('textbox', { name: 'Name for Nissan' }).fill('EY Christmas party')
  await expect(page.getByRole('button', { name: 'Bring in 1 job and more days for 1 job' })).toBeVisible()
  await jobs.getByRole('textbox', { name: 'Name for Nissan' }).fill('')
  await expect(page.getByText('Give Nissan a name, or untick it.')).toBeVisible()
  await expect(page.getByRole('button', { name: /^Bring in/ })).toBeDisabled()
  await jobs.getByRole('textbox', { name: 'Name for Nissan' }).fill('Nissan')

  // The question comes in the app, in the bar the button was in, with what will happen in words.
  await bring.click()
  const question = page.getByRole('group', {
    name: 'Bring in 2 jobs and more days for 1 job, adding 2 people to the crew list? They can be changed or cancelled afterwards like any other job. Nothing is written to Google, and nobody is emailed.',
  })
  await expect(question).toBeVisible()
  await question.getByRole('button', { name: 'Bring them in' }).click()
  await expect(page.getByRole('heading', { name: 'Brought in' })).toBeVisible()
  await expect(page.getByRole('status').filter({ hasText: 'Brought in' })).toHaveText(
    'Brought in 2 jobs and more days for 1 job from ops@sessionhire.com: 8 days, 6 crew bookings and offers, 2 new people, 2 new venues.'
  )
  expect(calls.brought).toEqual([
    {
      calendarId: OPS,
      from: threeMonthsBack,
      jobs: [
        { key: `nissan|${day(10)}`, name: 'Nissan', include: true },
        { key: `aviva|${day(16)}`, name: 'Aviva', include: true },
        { key: `web summit|${day(20)}`, name: 'Web Summit', include: false },
        { key: `christmas party|${day(70)}`, name: 'EY Christmas party', include: true },
      ],
      people: [
        { email: 'aoife.byrne@gmail.com', include: true },
        { email: 'sean@sessionhire.com', include: true },
        { email: 'hire@stagesupplies.ie', include: false },
      ],
    },
  ])
  await expect(page.getByRole('link', { name: 'See them in the planner' })).toHaveAttribute('href', /^#plan\/month\/\d{4}-\d{2}-01$/)

  // A job brought in says where its days are: on the calendar it came from, not the jobs calendar.
  await page.goto('/#jobs/j-aviva')
  await expect(page.getByText(`Brought in from ${OPS}, which keeps its days, so the app doesn't add them to the jobs calendar.`)).toBeVisible()
})

test('on a laptop, and when the calendar can’t be read', async ({ browser }) => {
  const page = await (await browser.newContext({ viewport: laptopSize })).newPage()
  await signedIn(page)
  await page.route(/\/api\/calendar\/import\/look/, (route) =>
    route.fulfill({ status: 409, json: { error: "The connected Google account can't see that calendar any more. Choose another, or share it with that account again." } })
  )
  await page.goto('/#import')
  const form = page.getByRole('form', { name: 'Calendar to bring in from' })
  await form.getByRole('radio', { name: /Aoife Byrne/ }).check()
  await form.getByRole('button', { name: 'Look at the calendar' }).click()
  await expect(form.getByRole('alert')).toHaveText("The connected Google account can't see that calendar any more. Choose another, or share it with that account again.")
  await expect(form.getByRole('button', { name: 'Look at the calendar' })).toBeEnabled()
  // Nothing wider than the page.
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
})
