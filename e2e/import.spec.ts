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
  note: '',
  venue: null,
  sheet: false,
  extends: false,
  ...more,
})

const nobody = { booked: 0, waiting: 0, declined: 0, notInApp: 0, noted: 0 }

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
      kind: 'gig',
      adds: null,
      phases: [
        phase('Build', day(10), day(11), { sheet: true, note: 'Client walk through' }),
        phase('Show', day(12), day(13), { sheet: true }),
        phase('Load out', day(13), day(13), { sheet: true }),
      ],
      start: day(10),
      end: day(13),
      venue: { name: 'Convention Centre Dublin', isNew: true },
      crew: { booked: 2, waiting: 1, declined: 1, notInApp: 3, noted: 0 },
      events: 4,
    },
    {
      key: `aviva|${day(16)}`,
      name: 'Aviva',
      status: 'confirmed',
      kind: 'gig',
      adds: { id: 'j-aviva', name: 'Aviva' },
      phases: [phase('Babysit', day(16), day(16), { extends: true })],
      start: day(16),
      end: day(16),
      venue: null,
      crew: { ...nobody, booked: 1 },
      events: 1,
    },
    {
      key: `web summit|${day(20)}`,
      name: 'Web Summit',
      status: 'confirmed',
      kind: 'gig',
      adds: null,
      phases: [phase('Show', day(20), day(21), { guessed: true })],
      start: day(20),
      end: day(21),
      venue: null,
      crew: nobody,
      events: 1,
    },
    {
      key: `murt lx hire|${day(-6)}`,
      name: 'Murt lx hire',
      status: 'confirmed',
      kind: 'hire',
      adds: null,
      phases: [phase('Hire', day(-6), day(-2), { guessed: true })],
      start: day(-6),
      end: day(-2),
      venue: null,
      crew: { ...nobody, booked: 1, noted: 1 },
      events: 1,
    },
    {
      key: `christmas party|${day(70)}`,
      name: 'Christmas party',
      status: 'enquiry',
      kind: 'gig',
      adds: null,
      phases: [phase('Show', day(70), day(70), { guessed: true })],
      start: day(70),
      end: day(70),
      venue: { name: 'The Marker Hotel', isNew: true },
      crew: nobody,
      events: 1,
    },
  ],
  people: [
    { email: 'aoife.byrne@gmail.com', name: 'Aoife Byrne', kind: 'freelancer', suggested: true, needsName: false, jobs: 2 },
    { email: 'craicaudio@gmail.com', name: 'Craicaudio', kind: 'freelancer', suggested: true, needsName: true, jobs: 1 },
    { email: 'sean@sessionhire.com', name: 'Seán Murphy', kind: 'staff', suggested: true, needsName: false, jobs: 1 },
    { email: 'client@example.ie', name: 'Client', kind: 'freelancer', suggested: false, needsName: true, jobs: 1 },
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
  const calls = { looked: [] as unknown[], brought: [] as unknown[], takenBack: 0 }
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
  // What the first bring-in put in, until it's taken back (ADR 0037).
  await page.route(/\/api\/calendar\/import\/brought/, (route) =>
    route.fulfill({ json: calls.takenBack ? { jobs: 0, days: 0, crew: 0, people: 0, calendars: [], blocked: null } : { jobs: 141, days: 157, crew: 179, people: 36, calendars: ['Adam', 'Olan'], blocked: null } })
  )
  await page.route(/\/api\/calendar\/import\/take-back/, (route) => {
    calls.takenBack++
    return route.fulfill({ json: { jobs: 141, days: 157, crew: 179, people: 36, calendars: ['Adam', 'Olan'] } })
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
  // The first bring-in is still in, and can be taken back to come in again with corrections.
  const brought = page.getByRole('region', { name: 'Brought in so far' })
  await expect(brought).toContainText('141 jobs over 157 days, with 179 crew bookings and offers, from Adam and Olan, and 36 people added from the invites.')
  await page.screenshot(shot('import-choose'))
  await form.getByRole('button', { name: 'Look at the calendar' }).click()
  // The request goes a moment after the press.
  await expect.poll(() => calls.looked).toEqual([{ calendarId: OPS, from: threeMonthsBack }])

  // What would come in, before anything is saved.
  await expect(page.getByRole('region', { name: 'What was found' })).toContainText('5 jobs found in 148 events.')
  const changed = page.getByRole('region', { name: 'Changed in Google' })
  await expect(changed).toContainText('“Aviva - Build”')
  await expect(changed).toContainText('no longer on the calendar')
  await expect(changed.getByRole('link', { name: 'Aviva' })).toHaveAttribute('href', '#jobs/j-aviva')
  const jobs = page.getByRole('region', { name: 'Jobs found' })
  await expect(jobs.getByRole('listitem')).toHaveCount(5)
  const nissan = jobs.getByRole('listitem').filter({ has: page.getByRole('textbox', { name: 'Name for Nissan' }) })
  await expect(nissan).toContainText('Convention Centre Dublin (new venue)')
  await expect(nissan).toContainText('Build ')
  await expect(nissan).toContainText('(Client walk through)')
  await expect(nissan).toContainText('Crew: 2 booked, 1 not answered, 1 said no (3 not in the app yet)')
  await expect(nissan).toContainText('job sheet in the notes')
  await expect(nissan.getByRole('combobox', { name: 'Kind of Nissan' })).toHaveValue('gig')
  // A dry hire comes in with no crew call; the office can say it's a gig after all, and its guessed day follows.
  const hire = jobs.getByRole('listitem').filter({ has: page.getByRole('textbox', { name: 'Name for Murt lx hire' }) })
  await expect(hire.getByRole('combobox', { name: 'Kind of Murt lx hire' })).toHaveValue('hire')
  await expect(hire).toContainText('Hire ')
  await expect(hire).toContainText('its days come in as Hire')
  await expect(hire).toContainText('On the invites: 1 booked, 1 on days gone, noted (noted on the job, not booked)')
  await hire.getByRole('combobox', { name: 'Kind of Murt lx hire' }).selectOption('gig')
  await expect(hire).toContainText('Show ')
  await expect(hire).toContainText('Crew: 1 booked, 1 on days gone, noted')
  await hire.getByRole('combobox', { name: 'Kind of Murt lx hire' }).selectOption('hire')
  await expect(jobs.getByRole('listitem').filter({ hasText: 'More days for the job brought in before.' })).toContainText('Babysit')
  await expect(jobs.getByRole('listitem').filter({ has: page.getByRole('textbox', { name: 'Name for Web Summit' }) })).toContainText(
    'No phase in the title, so it comes in as a Show.'
  )
  await expect(jobs.getByRole('listitem').filter({ has: page.getByRole('textbox', { name: 'Name for Christmas party' }) })).toContainText('Pencilled in')

  // Suppliers and clients on the invites start unticked; a name made from an address is flagged, and the office types the real one.
  const people = page.getByRole('region', { name: 'People not in the app' })
  await expect(people.getByRole('checkbox', { name: 'Add Aoife Byrne' })).toBeChecked()
  await expect(people.getByRole('checkbox', { name: 'Add Seán Murphy' })).toBeChecked()
  await expect(people.getByRole('checkbox', { name: 'Add Client' })).not.toBeChecked()
  const handle = people.getByRole('listitem').filter({ has: page.getByRole('textbox', { name: 'Name for craicaudio@gmail.com' }) })
  await expect(handle).toContainText('Named from their address: give them their name.')
  await handle.getByRole('textbox', { name: 'Name for craicaudio@gmail.com' }).fill('')
  await expect(page.getByText('Give craicaudio@gmail.com a name, or untick them.')).toBeVisible()
  await handle.getByRole('textbox', { name: 'Name for craicaudio@gmail.com' }).fill('Cathal Craic')

  // What was left out, and why.
  const leftOut = page.getByRole('region', { name: 'Left out' })
  await leftOut.getByText('What was left out, and why').click()
  await expect(leftOut).toContainText('96 events with a start time (meetings, calls)')
  await expect(leftOut).toContainText('12 events brought in before')

  // Web Summit isn't a job this time; the party gets its real name.
  await jobs.getByRole('checkbox', { name: 'Bring in Web Summit' }).uncheck()
  await jobs.getByRole('textbox', { name: 'Name for Christmas party' }).fill('EY Christmas party')
  const bring = page.getByRole('button', { name: 'Bring in 3 jobs and more days for 1 job' })
  await expect(bring).toBeEnabled()
  await leftOut.getByText('What was left out, and why').click()
  await jobs.evaluate((e) => scrollTo(0, e.getBoundingClientRect().top + scrollY - 76))
  await page.screenshot(shot('import-look'))
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)

  // Renaming Nissan to the party's name would bring them in as one.
  await jobs.getByRole('textbox', { name: 'Name for Nissan' }).fill('EY Christmas party')
  await expect(page.getByRole('button', { name: 'Bring in 2 jobs and more days for 1 job' })).toBeVisible()
  await jobs.getByRole('textbox', { name: 'Name for Nissan' }).fill('')
  await expect(page.getByText('Give Nissan a name, or untick it.')).toBeVisible()
  await expect(page.getByRole('button', { name: /^Bring in/ })).toBeDisabled()
  await jobs.getByRole('textbox', { name: 'Name for Nissan' }).fill('Nissan')

  // The question comes in the app, in the bar the button was in, with what will happen in words.
  await bring.click()
  const question = page.getByRole('group', {
    name: 'Bring in 3 jobs and more days for 1 job, adding 3 people to the crew list? They can be changed or cancelled afterwards like any other job. Nothing is written to Google, and nobody is emailed.',
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
        { key: `nissan|${day(10)}`, name: 'Nissan', kind: 'gig', include: true },
        { key: `aviva|${day(16)}`, name: 'Aviva', kind: 'gig', include: true },
        { key: `web summit|${day(20)}`, name: 'Web Summit', kind: 'gig', include: false },
        { key: `murt lx hire|${day(-6)}`, name: 'Murt lx hire', kind: 'hire', include: true },
        { key: `christmas party|${day(70)}`, name: 'EY Christmas party', kind: 'gig', include: true },
      ],
      people: [
        { email: 'aoife.byrne@gmail.com', name: 'Aoife Byrne', include: true },
        { email: 'craicaudio@gmail.com', name: 'Cathal Craic', include: true },
        { email: 'sean@sessionhire.com', name: 'Seán Murphy', include: true },
        { email: 'client@example.ie', name: 'Client', include: false },
      ],
    },
  ])
  await expect(page.getByRole('link', { name: 'See them in the planner' })).toHaveAttribute('href', /^#plan\/month\/\d{4}-\d{2}-01$/)

  // Taking the first bring-in back: asked in the app, done in one go, and then the calendar can come in again.
  await page.getByRole('button', { name: 'Look at another calendar' }).click()
  await brought.getByRole('button', { name: 'Take it all back' }).click()
  const takeBack = page.getByRole('group', { name: /^Take back 141 jobs, their crew bookings and offers and 36 people added from the invites\?/ })
  await takeBack.getByRole('button', { name: 'Take it all back' }).click()
  await expect(page.getByRole('region', { name: 'Taken back' }).getByRole('status')).toHaveText(
    'Taken back: 141 jobs, 157 days and 179 crew bookings and offers, and 36 people added from the invites. Look at the calendar again to bring it in afresh.'
  )
  expect(calls.takenBack).toBe(1)

  // A job brought in says where its days are: on the calendar it came from, not the jobs calendar.
  await page.goto('/#jobs/j-aviva')
  await page.locator('.phase-details summary').first().click()
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
