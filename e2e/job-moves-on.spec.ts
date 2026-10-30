import { expect, test } from '@playwright/test'

/**
 * How a job moves on (ADR 0103): the steps across the top of the job page
 * offer the one next thing for the step it's at, and the Confirmed step is
 * the client's answer itself, so yes confirms the job and records the yes on
 * the quote that went, and the two never say different things. A past quote
 * from Current RMS for a job already here goes on that job's quote rather
 * than making the same job twice. Uses the made-up data (ADR 0019), so it
 * starts fresh before and after.
 */

const phoneSize = { width: 390, height: 844 }
const fresh = { data: { confirm: 'delete everything' } }

test("the client's yes, from the job's steps, confirms the job and the quote together", async ({ browser, request }) => {
  expect((await request.post('/api/data/start-fresh', fresh)).ok()).toBe(true)
  expect((await request.post('/api/data/made-up')).ok()).toBe(true)
  const office = await (await browser.newContext({ viewport: phoneSize })).newPage()

  // Corrib Arts Week's quote is with the client, so the job is quoted and at Confirmed.
  await office.goto('/#jobs')
  await office.locator('.job-row', { hasText: 'Corrib Arts Week' }).click()
  const steps = office.getByRole('region', { name: 'Steps' })
  await expect(steps.getByText(/· at Confirmed$/)).toBeVisible()
  if (process.env.SHOTS_DIR) await office.screenshot({ path: `${process.env.SHOTS_DIR}/next-thing.png` })
  await steps.getByRole('button', { name: "Record the client's answer" }).click()
  await expect(steps.getByRole('heading', { name: '2. Confirmed' })).toBeVisible()
  // No tick that would say it's going ahead while it stays quoted: the answer is the job's own.
  await expect(steps.getByRole('button', { name: 'Mark confirmed done' })).toHaveCount(0)
  await expect(steps).toContainText('records the yes on version 1 of the quote')
  if (process.env.SHOTS_DIR) await office.screenshot({ path: `${process.env.SHOTS_DIR}/confirm-step.png` })
  await steps.getByRole('button', { name: 'Confirm the job' }).click()

  await expect(steps.getByRole('button', { name: /^2\. Confirmed, done/ })).toBeVisible()
  await expect(steps.getByText(/· at Confirmed$/)).toHaveCount(0)
  await office.goto('/#jobs')
  await expect(office.locator('.job-row', { hasText: 'Corrib Arts Week' })).toContainText('Confirmed')

  // The quote says the same: accepted today, and nothing left to put in step.
  await office.goto('/#quotes')
  const row = office.getByRole('region', { name: 'All quotes' }).getByRole('listitem').filter({ hasText: 'Corrib Arts Week' })
  await expect(row).toContainText(/Accepted \w{3} \d+ \w{3}/)
  await expect(office.getByRole('region', { name: 'To follow up' })).not.toContainText('Corrib Arts Week')

  expect((await request.post('/api/data/start-fresh', fresh)).ok()).toBe(true)
})

test('a past quote for a job already here goes on its quote, not on a second job', async ({ browser, request }) => {
  expect((await request.post('/api/data/start-fresh', fresh)).ok()).toBe(true)
  expect((await request.post('/api/data/made-up')).ok()).toBe(true)
  const office = await (await browser.newContext({ viewport: phoneSize })).newPage()

  const gala = {
    id: 9, number: '1099', subject: 'Corrib Arts Week', client: 'Corrib Arts Collective', state: 'Quotation', status: 'Provisional', startsAt: null, endsAt: null, netCents: 30000,
    venue: '', grossCents: 0, rentalCents: 0, saleCents: 0, serviceCents: 0, surchargeCents: 0, taxCents: 0, undiscountedCents: 0, chargeableDays: 1, discountCategory: '', priceCategory: '',
    tags: [], createdAt: null, updatedAt: null,
  }
  const line = {
    id: 1, opportunityId: 9, path: '0001', kind: 'Principal', transaction: 'Service', itemType: 'Service', itemId: null, name: 'Sound engineer', description: '', quantity: 1, priceCents: 30000,
    discountPct: 0, chargeableDays: 1, rateDefinition: '', period: '', unitCents: 30000, totalCents: 30000, taxCents: 0, subRent: false, startsAt: null, endsAt: null,
  }
  // Linked to the job already, as Match to jobs would have. Routed before the first page, so the app's own worker doesn't answer first.
  let jobId = ''
  await office.route('**/api/rms/opportunities/9', (route) => route.fulfill({ json: { opportunity: gala, lines: [line], job: { id: jobId, name: 'Corrib Arts Week' } } }))
  let linked = false
  await office.route('**/api/rms/matches', (route) => {
    linked = true
    return route.fulfill({ json: { linked: 1 } })
  })

  await office.goto('/#jobs')
  await office.locator('.job-row', { hasText: 'Corrib Arts Week' }).click()
  jobId = decodeURIComponent(/#jobs\/([^/]+)/.exec(office.url())![1]!)

  await office.goto('/#jobs/money/current-rms/9')
  // The job it's for comes first; another job is the second choice.
  await expect(office.getByRole('button', { name: "Put it on Corrib Arts Week's quote" })).toHaveClass(/primary/)
  await office.getByRole('button', { name: 'Make a new job from this' }).click()
  const making = office.getByRole('region', { name: 'Make a job from this' })
  await expect(making).toContainText('which is already a job here. Making another makes the same job twice.')
  if (process.env.SHOTS_DIR) await making.screenshot({ path: `${process.env.SHOTS_DIR}/same-job-twice.png` })
  await making.getByRole('button', { name: "Put it on Corrib Arts Week's quote instead" }).click()

  const onto = office.getByRole('region', { name: "Put it on a job's quote" })
  await expect(onto.getByLabel('The job')).toHaveValue('Corrib Arts Week')
  await expect(onto).toContainText('It has no draft, so these start one.')
  await onto.getByRole('button', { name: /^Put 1 line on the quote$/ }).click()

  await expect(office).toHaveURL(new RegExp(`#jobs/${jobId}/quote$`))
  const draft = office.getByRole('form', { name: 'Version 2, a draft' })
  await expect(draft).toContainText('Sound engineer')
  // Already linked to this job, so nothing to link.
  expect(linked).toBe(false)

  expect((await request.post('/api/data/start-fresh', fresh)).ok()).toBe(true)
})
