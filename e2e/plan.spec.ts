import { expect, test, type APIRequestContext, type Page } from '@playwright/test'

/**
 * The planner end to end (ADR 0010): a week of jobs on a phone, the same
 * week by person with a clash and an offer to check, and a month on a laptop
 * whose dates open their week. The jobs, crew and people are made through
 * the sync API, in a month no other browser test uses, since the test server
 * is shared. To refresh the blueprint screenshots, run this file on its own
 * with SHOTS=1: the names are then plain, as the office would type them.
 */

const shot = (name: string) => (process.env.SHOTS ? { path: `docs/hub/img/${name}.png` } : undefined)
const phoneSize = { width: 390, height: 844 }
const laptopSize = { width: 1440, height: 900 }
const id = Math.random().toString(36).slice(2, 8)
const named = (name: string) => (process.env.SHOTS ? name : `${name} ${id}`)

type M = [string, Record<string, unknown>]
const k = (key: string) => `${key}-${id}`

/** Monday 3 to Sunday 9 March 2031, and St Patrick's week after it. */
async function seed(request: APIRequestContext) {
  const job = (key: string, name: string, status: string): M => [
    'project.create',
    { id: k(key), name: named(name), clientId: null, venueId: null, status, notes: '' },
  ]
  const phase = (key: string, of: string, name: string, start: string, end = start): M => [
    'phase.add',
    { id: k(key), projectId: k(of), name, start, end, venueId: null, notes: '' },
  ]
  const call = (key: string, of: { phase: string } | { project: string }, role: string, start: string, end: string, needed: number): M => [
    'call.create',
    {
      id: k(key),
      phaseId: 'phase' in of ? k(of.phase) : null,
      project: 'project' in of ? named(of.project) : 'From the job',
      phase: '',
      venue: '',
      role,
      start,
      end,
      callTime: '08:00',
      needed,
      dayRateCents: 25000,
      details: '',
      replyBy: null,
    },
  ]
  const person = (key: string, name: string, skills: string[]): M => [
    'person.upsert',
    { id: k(key), name: named(name), kind: 'freelancer', email: null, phone: null, skills, dayRateCents: 25000, notes: '' },
  ]
  const offer = (key: string, of: string, to: string, override = false): M => ['offer.send', { id: k(key), callId: k(of), personId: k(to), override }]
  const yes = (key: string): M => ['offer.respond', { id: k(key), answer: 'accept', days: null, note: '' }]
  const confirm = (key: string): M => ['offer.confirm', { id: k(key) }]
  const away = (key: string, who: string, start: string, end: string, note: string): M => [
    'unavailability.add',
    { id: k(key), personId: k(who), start, end, note },
  ]

  const mutations: M[] = [
    job('summit', 'Web Summit', 'confirmed'),
    phase('summit-build', 'summit', 'Build', '2031-03-03', '2031-03-04'),
    phase('summit-show', 'summit', 'Show', '2031-03-05', '2031-03-06'),
    job('nissan', 'Nissan launch', 'confirmed'),
    phase('nissan-show', 'nissan', 'Show', '2031-03-06'),
    job('awards', 'Tech Ireland awards', 'quoted'),
    phase('awards-show', 'awards', 'Show', '2031-03-08'),
    job('paddys', "St Patrick's Festival", 'confirmed'),
    phase('paddys-build', 'paddys', 'Build', '2031-03-14', '2031-03-16'),
    phase('paddys-show', 'paddys', 'Show', '2031-03-17'),
    phase('paddys-out', 'paddys', 'Load out', '2031-03-18'),
    job('expo', 'Dublin Tech expo', 'enquiry'),
    phase('expo-show', 'expo', 'Show', '2031-03-25', '2031-03-26'),
    call('summit-build-audio', { phase: 'summit-build' }, 'Audio tech', '2031-03-03', '2031-03-04', 3),
    call('summit-show-audio', { phase: 'summit-show' }, 'Audio tech', '2031-03-05', '2031-03-06', 2),
    call('nissan-lx', { phase: 'nissan-show' }, 'LX op', '2031-03-06', '2031-03-06', 1),
    call('awards-audio', { phase: 'awards-show' }, 'Audio tech', '2031-03-08', '2031-03-08', 1),
    call('dinner', { project: 'Mansion House dinner' }, 'Stage hand', '2031-03-07', '2031-03-07', 1),
    call('paddys-audio', { phase: 'paddys-show' }, 'Audio tech', '2031-03-17', '2031-03-17', 2),
    person('aoife', 'Aoife Byrne', ['audio', 'monitors']),
    person('niamh', 'Niamh Kelly', ['audio']),
    person('conor', 'Conor Walsh', ['audio', 'stage']),
    person('dara', 'Dara Nolan', ['lighting']),
    person('sean', 'Seán Murphy', ['rigging']),
    // Aoife is booked on the build, then says she can't do the Tuesday: a clash.
    offer('aoife-build', 'summit-build-audio', 'aoife'),
    yes('aoife-build'),
    confirm('aoife-build'),
    away('aoife-dentist', 'aoife', '2031-03-04', '2031-03-04', 'Dentist'),
    offer('niamh-build', 'summit-build-audio', 'niamh'),
    yes('niamh-build'),
    offer('niamh-show', 'summit-show-audio', 'niamh'),
    offer('conor-build', 'summit-build-audio', 'conor'),
    // Dara is away for a wedding, and was sent the awards anyway: one to check.
    offer('dara-nissan', 'nissan-lx', 'dara'),
    yes('dara-nissan'),
    confirm('dara-nissan'),
    away('dara-wedding', 'dara', '2031-03-08', '2031-03-09', 'Wedding'),
    offer('dara-awards', 'awards-audio', 'dara', true),
    offer('niamh-paddys', 'paddys-audio', 'niamh'),
    yes('niamh-paddys'),
    confirm('niamh-paddys'),
  ]
  const res = await request.post('/api/sync/push', {
    data: {
      clientId: `plan-${id}`,
      mutations: mutations.map(([name, args], i) => ({ id: `${k('m')}-${i}`, name, args, createdAt: new Date().toISOString() })),
    },
  })
  const { results } = await res.json()
  expect(results.map((r: { status: string; reason?: { message: string } }) => r.reason?.message ?? r.status)).toEqual(mutations.map(() => 'applied'))
}

test.beforeAll(async ({ browser }) => {
  const context = await browser.newContext()
  await seed(context.request)
  await context.close()
})

async function ready(page: Page, hash: string) {
  await page.goto(`/${hash}`)
  await expect(page.getByRole('status')).toHaveText('Up to date')
}

/** On a phone the list of things to sort out comes first; the screenshots show the planner itself, scrolled sideways to a day. */
async function timeline(page: Page, day = 0) {
  await page.locator('.scroller').evaluate((el, day) => {
    el.closest('section')!.scrollIntoView()
    const heads = el.querySelectorAll<HTMLElement>('thead th')
    el.scrollLeft = heads[day + 1]!.offsetLeft - heads[0]!.offsetWidth
  }, day)
}

/** The row for a job or person, and its cells from Monday, the first day shown. */
function row(page: Page, name: string) {
  return page.locator('tbody tr', { has: page.getByRole('rowheader', { name: new RegExp(`^${name}`) }) }).getByRole('cell')
}

test('a week by job on a phone, then by person with its clashes', async ({ browser }) => {
  const phone = await (await browser.newContext({ viewport: phoneSize })).newPage()
  await ready(phone, '#jobs')
  await phone.getByRole('navigation', { name: 'Show jobs as' }).getByRole('link', { name: 'Week' }).click()
  await expect(phone).toHaveURL(/#plan\/week\/\d{4}-\d{2}-\d{2}$/)
  await expect(phone.getByRole('navigation', { name: 'Areas' }).getByRole('link', { name: 'Jobs' })).toHaveAttribute('aria-current', 'page')

  // Straight to the first week of March 2031, as a shared link would.
  await ready(phone, '#plan/week/2031-03-05')
  await expect(phone.getByRole('heading', { name: 'Mon 3 Mar to Sun 9 Mar 2031' })).toBeVisible()
  const summit = row(phone, named('Web Summit'))
  await expect(summit.nth(0)).toHaveText('Build 1/22 of 3 crew, 1 asked')
  await expect(summit.nth(0).locator('.blk')).toHaveClass(/solid short/)
  await expect(summit.nth(2)).toHaveText('Show 1/20 of 2 crew, 1 asked')
  await expect(row(phone, named('Nissan launch')).nth(3).locator('.blk')).toHaveClass(/solid full/)
  // Pencilled in: the quote is dashed and says so.
  await expect(phone.getByRole('rowheader', { name: named('Tech Ireland awards') })).toContainText('Quoted')
  await expect(row(phone, named('Tech Ireland awards')).nth(5).locator('.blk')).toHaveClass(/dashed/)
  // Crew asked for on the Crew tab, not part of a job, get a row of their own.
  await expect(phone.getByRole('rowheader', { name: named('Mansion House dinner') })).toContainText('On the Crew tab')
  await expect(row(phone, named('Mansion House dinner')).nth(4)).toHaveText('Stage hand0 of 1 crew')

  // What to sort out, in words, with the job to open.
  const sortOut = phone.locator('section', { has: phone.getByRole('heading', { name: 'To sort out' }) })
  const clash = sortOut.locator('.row', { hasText: named('Aoife Byrne') })
  await expect(clash).toContainText('Clash')
  await expect(clash).toContainText(`Tue 4 Mar: Booked on ${named('Web Summit')} but marked unavailable (Dentist)`)
  const check = sortOut.locator('.row', { hasText: named('Dara Nolan') })
  await expect(check).toContainText('Check')
  await expect(check).toContainText(`Sat 8 Mar: Offered ${named('Tech Ireland awards')} but marked unavailable (Wedding)`)
  await timeline(phone, 2)
  await phone.screenshot(shot('plan-week-jobs'))

  // By person: who is where, with the clash and the check on their days.
  await phone.getByRole('button', { name: 'People' }).click()
  await expect(phone).toHaveURL(/#plan\/week\/2031-03-03\/people$/)
  const aoife = row(phone, named('Aoife Byrne'))
  await expect(aoife.nth(0)).toHaveText(`${named('Web Summit')}Build · Audio tech`)
  await expect(aoife.nth(1)).toHaveClass(/clash/)
  await expect(aoife.nth(1)).toContainText('UnavailableDentist')
  await expect(row(phone, named('Dara Nolan')).nth(5)).toHaveClass(/check/)
  await expect(row(phone, named('Conor Walsh')).nth(0)).toContainText('Offered · Build · Audio tech')
  // Seán has nothing on, so he shows only when asked for, to see who is free.
  await expect(phone.getByRole('rowheader', { name: named('Seán Murphy') })).toHaveCount(0)
  await phone.getByLabel(/Show everyone/).check()
  await expect(phone.getByRole('rowheader', { name: named('Seán Murphy') })).toBeVisible()
  await phone.getByLabel(/Show everyone/).uncheck()

  // The clash's job opens from the list.
  await timeline(phone)
  await phone.screenshot(shot('plan-week-people'))
  await clash.getByRole('link', { name: 'Open job' }).click()
  await expect(phone.getByRole('heading', { name: named('Web Summit') })).toBeVisible()
})

test('a month on a laptop, whose dates open their week', async ({ browser }) => {
  const laptop = await (await browser.newContext({ viewport: laptopSize })).newPage()
  await ready(laptop, '#plan/month/2031-03-20')
  await expect(laptop).toHaveURL(/#plan\/month\/2031-03-20$/)
  await expect(laptop.getByRole('heading', { name: 'March 2031' })).toBeVisible()
  const paddys = row(laptop, named("St Patrick's Festival"))
  await expect(paddys.nth(13).locator('[aria-hidden]')).toHaveText('Bu')
  await expect(paddys.nth(16)).toHaveText('ShShow, 1 of 2 crew')
  await expect(paddys.nth(17).locator('[aria-hidden]')).toHaveText('Out')
  await expect(row(laptop, named('Dublin Tech expo')).nth(24).locator('.blk')).toHaveClass(/dashed/)
  await laptop.screenshot(shot('plan-month'))

  // By person, a month reads as codes, with the words for a screen reader and on hover.
  await laptop.getByRole('button', { name: 'People' }).click()
  const aoife = row(laptop, named('Aoife Byrne'))
  await expect(aoife.nth(3)).toHaveClass(/clash/)
  await expect(aoife.nth(3).locator('[aria-hidden]')).toHaveText('WS')
  await expect(aoife.nth(3).locator('.sr-only')).toHaveText(
    `Clash: Booked on ${named('Web Summit')} but marked unavailable (Dentist). Booked on ${named('Web Summit')}, Build. Unavailable (Dentist)`
  )

  // A date opens its week, still by person; Previous and Next move a week at a time.
  await laptop.getByRole('link', { name: 'Sat 8 Mar: open its week' }).click()
  await expect(laptop).toHaveURL(/#plan\/week\/2031-03-03\/people$/)
  await expect(laptop.getByRole('heading', { name: 'Mon 3 Mar to Sun 9 Mar 2031' })).toBeVisible()
  await laptop.getByRole('link', { name: 'Next week' }).click()
  await expect(laptop.getByRole('heading', { name: 'Mon 10 Mar to Sun 16 Mar 2031' })).toBeVisible()
  await laptop.getByRole('navigation', { name: 'Show jobs as' }).getByRole('link', { name: 'Month' }).click()
  await expect(laptop).toHaveURL(/#plan\/month\/2031-03-01\/people$/)
  await laptop.getByRole('navigation', { name: 'Show jobs as' }).getByRole('link', { name: 'List' }).click()
  await expect(laptop.getByRole('heading', { name: 'Jobs', exact: true })).toBeVisible()
})
