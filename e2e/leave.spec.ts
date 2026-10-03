import { expect, test, type APIRequestContext, type Page } from '@playwright/test'

/**
 * Staff leave (ADR 0024) end to end, with sign-in off: an approver opens
 * next year in place, and a request in it, turned down before, goes in; a
 * member of staff says who they are, applies for three days and sees the
 * count; an approver on another phone sees the Crew tab's badge count it
 * the moment he says who he is, approves it, and has a blanked allowance
 * turned down in place, and one the server turns down listed as not done
 * with its year as a year; the planner shows the days off; and an offer to
 * that person for those days warns. The staff and the crew call are made
 * through the sync API with this run's own names, since the test server is
 * shared, and this year is opened there too.
 */

const phoneSize = { width: 390, height: 844 }
const id = Math.random().toString(36).slice(2, 8)
const k = (key: string) => `${key}-${id}`

const addDays = (day: string, n: number) => {
  const d = new Date(`${day}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}
const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Dublin' })

/**
 * Tuesday to Thursday of the week three weeks on, moved a week when one of
 * them is a public holiday that sits on a fixed date: every other Irish
 * public holiday is a Monday, so three weekdays from a Tuesday are three days.
 */
function threeDays(): [string, string] {
  let monday = addDays(today, 21)
  monday = addDays(monday, -((new Date(`${monday}T12:00:00Z`).getUTCDay() + 6) % 7))
  const fixed = ['01-01', '03-17', '12-25', '12-26']
  for (;;) {
    const tue = addDays(monday, 1)
    const days = [tue, addDays(tue, 1), addDays(tue, 2)]
    if (!days.some((d) => fixed.includes(d.slice(5)))) return [tue, days[2]!]
    monday = addDays(monday, 7)
  }
}
const [FROM, TO] = threeDays()
const MIDDLE = addDays(FROM, 1)
const YEAR = Number(today.slice(0, 4))
const NEXT = YEAR + 1

/** The first Wednesday in February next year: a working day in any year, as no Irish public holiday falls on one then. */
function firstWednesday(): string {
  let d = `${NEXT}-02-01`
  while (new Date(`${d}T12:00:00Z`).getUTCDay() !== 3) d = addDays(d, 1)
  return d
}
const WEDNESDAY = firstWednesday()

/** Changes made through the sync API, as a phone would send them, each of which has to go in. */
async function push(request: APIRequestContext, mutations: [string, Record<string, unknown>][]) {
  const res = await request.post('/api/sync/push', {
    data: { clientId: `leave-${id}`, mutations: mutations.map(([name, args]) => ({ id: `${k('m')}-${Math.random().toString(36).slice(2, 10)}`, name, args, createdAt: new Date().toISOString() })) },
  })
  const { results } = await res.json()
  expect(results.map((r: { status: string; reason?: { message: string } }) => r.reason?.message ?? r.status)).toEqual(mutations.map(() => 'applied'))
}

test.beforeAll(async ({ browser }) => {
  const context = await browser.newContext()
  const person = (key: string, name: string, approvesLeave: boolean) => ({
    id: k(key),
    name: `${name} ${id}`,
    kind: 'staff',
    email: null,
    phone: null,
    skills: [],
    dayRateCents: null,
    notes: '',
    approvesLeave,
  })
  const mutations: [string, Record<string, unknown>][] = [
    ['person.upsert', person('nora', 'Nora Walsh', false)],
    ['person.upsert', person('eoin', 'Eoin Byrne', true)],
    ['person.upsert', person('siun', 'Siún Keogh', false)],
    // This year is open, as on the live server; opening it again, as another test may have, changes nothing.
    ['leave.open', { year: YEAR, by: k('eoin') }],
    // A one-off crew call on two of the days, so an offer to Nora for it has to warn.
    [
      'call.create',
      {
        id: k('call'),
        project: `Leave check ${id}`,
        phase: '',
        venue: '',
        role: 'Driver',
        start: FROM,
        end: MIDDLE,
        callTime: '08:00',
        needed: 1,
        dayRateCents: null,
        details: '',
        replyBy: null,
      },
    ],
  ]
  await push(context.request, mutations)
  await context.close()
})

/** The planner's row for a person, and its cells from Monday. */
function row(page: Page, name: string) {
  return page.locator('tbody tr', { has: page.getByRole('rowheader', { name: new RegExp(`^${name}`) }) }).getByRole('cell')
}

test('an approver opens next year in place, and a request in it, turned down until then, goes in', async ({ browser }) => {
  // Proves: Colly's decision (3 October 2026), at a phone's width. Siún is told next year isn't open, and asking for a day
  // in it is turned down on her phone in the server's words. Eoin, who approves time off, opens it with a question in
  // place, the safe answer first. Her phone hears of it without a reload, the same request goes in, and he approves it.
  const siun = await (await browser.newContext({ viewport: phoneSize })).newPage()
  await siun.goto('/#crew/leave')
  await expect(siun.getByRole('status')).toHaveText('Up to date')
  await siun.getByLabel('Your name').selectOption({ label: `Siún Keogh ${id}` })
  await siun.getByRole('button', { name: "That's me" }).click()
  const apply = siun.getByRole('region', { name: 'Apply for leave' })
  await expect(apply).toContainText(`Open for leave: ${YEAR}. ${NEXT} isn't open yet: the office opens each year when it's ready.`)
  await expect(apply.getByRole('button', { name: `Open ${NEXT} for leave` })).toHaveCount(0)
  await apply.getByLabel('From').fill(WEDNESDAY)
  await apply.getByLabel('To', { exact: true }).fill(WEDNESDAY)
  await apply.getByRole('button', { name: 'Apply' }).click()
  await expect(apply.getByRole('alert')).toHaveText(`Leave for ${NEXT} isn't open yet. The office opens each year when it's ready.`)

  const eoin = await (await browser.newContext({ viewport: phoneSize })).newPage()
  await eoin.goto('/#crew/leave')
  await expect(eoin.getByRole('status')).toHaveText('Up to date')
  await eoin.getByLabel('Your name').selectOption({ label: `Eoin Byrne ${id}` })
  await eoin.getByRole('button', { name: "That's me" }).click()
  const his = eoin.getByRole('region', { name: 'Apply for leave' })
  await his.getByRole('button', { name: `Open ${NEXT} for leave` }).click()
  const question = his.getByRole('group', { name: `Open ${NEXT} for leave? Staff can ask for leave in ${NEXT} from then on, and it can't be closed again.` })
  await expect(question.getByRole('button', { name: 'Not yet' })).toBeFocused()
  expect(await eoin.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(phoneSize.width)
  await question.getByRole('button', { name: `Open ${NEXT}` }).click()
  await expect(eoin.getByRole('status')).toHaveText('Up to date')
  await expect(his).toContainText(`Open for leave: ${YEAR} and ${NEXT}.`)
  await expect(his.getByRole('button', { name: `Open ${NEXT} for leave` })).toHaveCount(0)

  // Siún's phone hears of it by itself; the same request goes in, under next year.
  await expect(apply).toContainText(`Open for leave: ${YEAR} and ${NEXT}.`)
  await apply.getByRole('button', { name: 'Apply' }).click()
  await expect(siun.getByRole('status')).toHaveText('Up to date')
  await expect(apply.getByRole('alert')).toHaveCount(0)
  await siun.getByRole('button', { name: `${NEXT}, the year after` }).click()
  const mine = siun.getByRole('region', { name: `My requests, ${NEXT}` })
  await expect(mine).toContainText('1 day')
  await expect(mine.locator('.pill')).toHaveText('Waiting')
  await eoin.getByRole('region', { name: 'To approve' }).getByRole('button', { name: `Approve Siún Keogh ${id}'s request` }).click()
  await expect(mine.locator('.pill')).toHaveText('Approved')
})

test('staff apply for leave, an approver approves it, and the planner and offers respect it', async ({ browser }) => {
  // Late in December the three days fall in next year, so it's opened first, as Eoin would; once open, that changes nothing.
  const setup = await browser.newContext()
  await push(setup.request, [['leave.open', { year: Number(FROM.slice(0, 4)), by: k('eoin') }]])
  await setup.close()
  // Nora, on her phone: the Leave screen asks who she is, once.
  const nora = await (await browser.newContext({ viewport: phoneSize })).newPage()
  await nora.goto('/#crew/leave')
  await expect(nora.getByRole('status')).toHaveText('Up to date')
  await expect(nora.getByRole('heading', { name: 'Who are you?' })).toBeVisible()
  await nora.getByLabel('Your name').selectOption({ label: `Nora Walsh ${id}` })
  await nora.getByRole('button', { name: "That's me" }).click()
  await expect(nora.getByRole('heading', { name: `Nora Walsh ${id}` })).toBeVisible()
  await expect(nora.getByText('20 days (not set yet)')).toBeVisible()
  // Nothing to approve for her, and no allowances: she isn't an approver.
  await expect(nora.getByRole('region', { name: 'To approve' })).toHaveCount(0)

  // Three days asked for, counted before anything is sent.
  const apply = nora.getByRole('region', { name: 'Apply for leave' })
  await apply.getByLabel('From').fill(FROM)
  await apply.getByLabel('To', { exact: true }).fill(TO)
  await expect(apply.locator('.ts-total')).toContainText('3 days')
  await apply.getByLabel('Note').fill('Long weekend away')
  await apply.getByRole('button', { name: 'Apply' }).click()
  await expect(nora.getByRole('status')).toHaveText('Up to date')
  const mine = nora.getByRole('region', { name: /^My requests/ })
  await expect(mine).toContainText('Annual leave')
  await expect(mine).toContainText('3 days')
  await expect(mine.locator('.pill')).toHaveText('Waiting')

  // Eoin, who can approve time off, on his: the Crew tab's badge counts her request the moment he says who he is, with no reload, and the queue says what to weigh up.
  const eoin = await (await browser.newContext({ viewport: phoneSize })).newPage()
  await eoin.goto('/#crew/leave')
  await expect(eoin.getByRole('status')).toHaveText('Up to date')
  const crewBadge = eoin.getByRole('navigation', { name: 'Areas' }).getByRole('link', { name: /^Crew/ }).locator('.badge [aria-hidden="true"]')
  const before = (await crewBadge.count()) ? Number(await crewBadge.textContent()) : 0
  await eoin.getByLabel('Your name').selectOption({ label: `Eoin Byrne ${id}` })
  await eoin.getByRole('button', { name: "That's me" }).click()
  await expect(crewBadge).toHaveText(String(before + 1))
  await eoin.getByRole('link', { name: '‹ Crew' }).click()
  await expect(eoin.getByRole('region', { name: 'Leave' })).toContainText('1 request to approve.')
  await eoin.getByRole('link', { name: 'Open leave' }).click()
  const queue = eoin.getByRole('region', { name: 'To approve' })
  const request = queue.locator('.row', { hasText: `Nora Walsh ${id}` })
  await expect(request).toContainText('Annual leave')
  await expect(request).toContainText('(3 days)')
  await expect(request).toContainText('“Long weekend away”')
  await request.getByRole('button', { name: `Approve Nora Walsh ${id}'s request` }).click()
  await expect(eoin.getByRole('status')).toHaveText('Up to date')
  await expect(queue).toContainText('Nothing here yet.')
  // Nora sees it approved without doing anything.
  await expect(mine.locator('.pill')).toHaveText('Approved')

  // Her allowance: a blanked field is turned down in place, keeping what was typed; a number is saved.
  const allowance = eoin.getByRole('form', { name: `Nora Walsh ${id}'s allowance` })
  await allowance.getByLabel('Days').fill('')
  await allowance.getByRole('button', { name: 'Save' }).click()
  await expect(allowance.getByRole('alert')).toHaveText('The allowance is a whole number from 0 to 366.')
  await expect(allowance.getByLabel('Days')).toHaveValue('')
  // Turned down by the server, it's listed as not done, with the year written as a year.
  await eoin.route(/\/api\/sync\/push/, async (route) => {
    const { mutations } = route.request().postDataJSON() as { mutations: { id: string }[] }
    await route.fulfill({ json: { results: mutations.map((m) => ({ id: m.id, status: 'rejected', reason: { code: 'conflict', message: 'Pretend the server said no.' } })) } })
  })
  await allowance.getByLabel('Days').fill('22')
  await allowance.getByRole('button', { name: 'Save' }).click()
  await eoin.getByRole('button', { name: '1 not done' }).click()
  const notDone = eoin.getByRole('region', { name: 'Not done' })
  await expect(notDone.locator('.row')).toContainText(`Set Nora Walsh ${id}'s ${YEAR} allowance`)
  await notDone.getByRole('button', { name: 'Dismiss' }).click()
  await eoin.unroute(/\/api\/sync\/push/)
  await allowance.getByLabel('Days').fill('22')
  await allowance.getByRole('button', { name: 'Save' }).click()
  await expect(eoin.getByRole('status')).toHaveText('Up to date')
  // The three days are booked against the year they fall in, which late in December is the next one.
  await expect(allowance).toContainText(FROM.slice(0, 4) === today.slice(0, 4) ? '3 days approved, 19 days left' : 'no days approved, 22 days left')

  // The planner shows her days off, as it shows any days off.
  await eoin.goto(`/#plan/week/${FROM}/people`)
  await expect(eoin.getByRole('status')).toHaveText('Up to date')
  const cells = row(eoin, `Nora Walsh ${id}`)
  await expect(cells.nth(1)).toContainText('Unavailable')
  await expect(cells.nth(1)).toContainText('Annual leave')
  await expect(cells.nth(3)).toContainText('Annual leave')
  await expect(cells.nth(4)).not.toContainText('Annual leave')

  // An offer to her for those days warns, and needs "Offer anyway".
  await eoin.goto('/#crew')
  await expect(eoin.getByRole('status')).toHaveText('Up to date')
  const call = eoin.locator('.call-group', { hasText: `Leave check ${id}` }).getByRole('article', { name: 'Driver' })
  await call.getByRole('button', { name: 'Offer…' }).click()
  await call.getByLabel('Offer to').selectOption({ label: `Nora Walsh ${id} · Level 1 ⚠` })
  await expect(call.locator('.warn')).toContainText(`Marked unavailable ${FROM} to ${MIDDLE} (Annual leave)`)
  await expect(call.getByRole('button', { name: 'Offer', exact: true })).toBeDisabled()
})
