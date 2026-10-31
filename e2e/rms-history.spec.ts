import { expect, test } from '@playwright/test'

/**
 * Current RMS's history put to use (ADR 0092): the office matches past quotes to jobs, linking all the sure ones in a
 * press; a job's quote shows its past quotes and how its client's went; and a line being priced shows what it was last
 * charged, to the client and to anyone, with a press to use it. The server's answers are stood in for, since the copy
 * of Current RMS comes from a real account; the made-up data (ADR 0019) gives the job.
 */

const phoneSize = { width: 390, height: 844 }
const fresh = { data: { confirm: 'delete everything' } }

const opp = (id: number, number: string, subject: string, client: string, state: string, status: string, on: string, netCents: number) => ({
  id,
  number,
  subject,
  client,
  state,
  status,
  startsAt: `${on}T10:00:00.000Z`,
  endsAt: `${on}T10:00:00.000Z`,
  netCents,
})

test('the office matches past quotes to jobs and prices a line from what it was last charged', async ({ browser, request }) => {
  expect((await request.post('/api/data/start-fresh', fresh)).ok()).toBe(true)
  expect((await request.post('/api/data/made-up')).ok()).toBe(true)
  const office = await (await browser.newContext({ viewport: phoneSize })).newPage()

  let posted: unknown
  await office.route('**/api/rms/matches', (route) => {
    if (route.request().method() === 'POST') {
      posted = route.request().postDataJSON()
      return route.fulfill({ json: { linked: 1 } })
    }
    return route.fulfill({
      json: {
        rows: [
          { opportunity: opp(1, '1043', 'Liffey Brands launch', 'Liffey Brands', 'Order', 'Completed', '2026-03-01', 204000), linked: null, suggested: { opportunityId: 1, projectId: 'p1', sure: true, candidates: [{ projectId: 'p1', score: 7 }, { projectId: 'p2', score: 0 }] } },
          { opportunity: opp(2, '1001', 'Expo stand', 'Other Co', 'Quotation', 'Provisional', '2026-02-01', 50000), linked: null, suggested: { opportunityId: 2, projectId: null, sure: false, candidates: [] } },
        ],
        jobs: { p1: { name: 'Liffey Brands Launch', client: 'Liffey Brands', start: '2026-03-01', end: '2026-03-02' }, p2: { name: 'Gala', client: '', start: '2026-03-01', end: '2026-03-01' } },
      },
    })
  })
  await office.goto('/#jobs/money/current-rms/match')
  await expect(office.getByRole('heading', { name: 'Match past quotes to our jobs' })).toBeVisible()
  await expect(office.getByText('0 linked, 1 to check, 1 with no job of ours on those days.')).toBeVisible()
  await expect(office.getByLabel('Job for Liffey Brands launch')).toHaveValue('p1')
  await office.getByRole('button', { name: 'Link the 1 sure one' }).click()
  await expect(office.getByRole('status').filter({ hasText: 'Linked' })).toHaveText('Linked 1 sure one.')
  expect(posted).toEqual({ links: [{ opportunityId: 1, projectId: 'p1' }] })
  await office.getByRole('button', { name: /No job found/ }).click()
  await expect(office.getByText('No job of ours on those days.', { exact: true })).toBeVisible()

  // The job's quote: its past quote and how the client's went, and each line's last price.
  await office.route(/\/api\/rms\/jobs\//, (route) =>
    route.fulfill({
      json: {
        opportunities: [opp(1, '1043', 'Liffey Brands launch', 'Liffey Brands', 'Order', 'Completed', '2026-03-01', 204000)],
        client: { client: 'Liffey Brands', quotes: 4, ahead: 3, decided: 4, winPct: 75, discountPct: 5, aheadCents: 600000, lastOn: '2026-03-01' },
      },
    })
  )
  await office.route('**/api/rms/last-charged', (route) =>
    route.fulfill({
      json: {
        'robe spiider': {
          client: { priceCents: 5000, unitCents: 4500, discountPct: 10, rate: 'Weekly Rate', client: 'Liffey Brands', number: '1043', opportunityId: 1, on: '2026-03-01' },
          any: { priceCents: 6000, unitCents: 6000, discountPct: 0, rate: '', client: 'Other Co', number: '1050', opportunityId: 9, on: '2026-04-01' },
        },
      },
    })
  )
  await office.goto('/#jobs')
  await office.locator('.job-row', { hasText: 'Liffey Brands Launch' }).click()
  await office.getByRole('tab', { name: 'Quote' }).click()
  await office.getByRole('region', { name: 'Quote' }).getByRole('link', { name: 'Make a quote' }).click()
  await office.getByRole('button', { name: 'Build it from the job' }).click()
  const rms = office.getByRole('region', { name: 'In Current RMS' })
  await expect(rms).toContainText('Liffey Brands: Went ahead with 3 of 4 (75%) · usually 5% off')
  await expect(rms.getByRole('link', { name: /Liffey Brands launch/ })).toHaveAttribute('href', '#jobs/money/current-rms/1')

  const draft = office.getByRole('form', { name: 'Version 1, a draft' })
  await draft.getByRole('button', { name: 'Line 1: Robe Spiider, change it' }).click()
  const last = draft.getByLabel('Line 1: last charged in Current RMS')
  await expect(last).toContainText('Last charged to Liffey Brands: €50.00 on the weekly rate, 10% off')
  await expect(last).toContainText('Last to anyone: €60.00')
  await last.getByRole('button', { name: 'Use €50.00' }).click()
  await expect(draft.getByLabel('Line 1: price')).toHaveValue('50')
  await expect(last.getByRole('button', { name: /Use/ })).toHaveCount(0)

  expect((await request.post('/api/data/start-fresh', fresh)).ok()).toBe(true)
})

test('the quotes from Current RMS are kept under the app’s own on Quotes, found and narrowed the same way', async ({ browser, request }) => {
  expect((await request.post('/api/data/start-fresh', fresh)).ok()).toBe(true)
  expect((await request.post('/api/data/made-up')).ok()).toBe(true)
  const office = await (await browser.newContext({ viewport: phoneSize })).newPage()
  await office.goto('/#jobs')
  await office.locator('.job-row', { hasText: 'Liffey Brands Launch' }).click()
  const jobId = decodeURIComponent(/#jobs\/([^/]+)/.exec(office.url())![1]!)

  const asked: string[] = []
  await office.route(/\/api\/rms\/opportunities\?/, (route) => {
    const url = new URL(route.request().url())
    asked.push(url.search)
    const went = url.searchParams.get('went')
    const all = [
      { ...opp(1, '1043', 'Liffey Brands launch', 'Liffey Brands', 'Order', 'Completed', '2025-03-01', 204000), endsAt: '2025-03-02T10:00:00.000Z' },
      opp(2, '1001', 'Expo stand', 'Other Co', 'Quotation', 'Lost', '2025-02-01', 50000),
    ]
    const opportunities = went === 'ahead' ? all.slice(0, 1) : all
    return route.fulfill({ json: { opportunities, total: opportunities.length, links: { 1: jobId } } })
  })
  await office.goto('/#quotes')
  const all = office.getByRole('region', { name: 'All quotes' })
  const rms = all.getByRole('group', { name: 'From Current RMS' })
  await expect(rms.getByRole('heading', { name: 'Before this app, from Current RMS' })).toBeVisible()
  await expect(rms.getByRole('listitem')).toHaveCount(2)
  const launch = rms.getByRole('listitem').filter({ hasText: 'Liffey Brands launch' })
  await expect(launch).toContainText('1 Mar 2025 to 2 Mar 2025 · No. 1043')
  await expect(launch).toContainText('Went ahead')
  await expect(launch.getByRole('link', { name: 'Liffey Brands Launch', exact: true })).toHaveAttribute('href', `#jobs/${encodeURIComponent(jobId)}/quote`)
  await expect(rms.getByRole('listitem').filter({ hasText: 'Expo stand' })).toContainText("Didn't go ahead")

  // Accepted asks for those that went ahead; Not sent has none from Current RMS.
  await all.getByRole('group', { name: 'Show' }).getByRole('button', { name: /^Accepted/ }).click()
  await expect(rms.getByRole('listitem')).toHaveCount(1)
  expect(asked.at(-1)).toContain('went=ahead')
  await all.getByRole('group', { name: 'Show' }).getByRole('button', { name: /^Not sent/ }).click()
  await expect(rms).toHaveCount(0)

  // The search looks through them too.
  await all.getByRole('group', { name: 'Show' }).getByRole('button', { name: /^All/ }).click()
  await all.getByLabel('Find a quote').fill('expo')
  await expect.poll(() => asked.at(-1)).toContain('q=expo')

  expect((await request.post('/api/data/start-fresh', fresh)).ok()).toBe(true)
})

test('the office makes a job from a past quote, its lines matched to the stock list and charged as they were (ADR 0102)', async ({ browser, request }) => {
  expect((await request.post('/api/data/start-fresh', fresh)).ok()).toBe(true)
  expect((await request.post('/api/data/made-up')).ok()).toBe(true)
  const office = await (await browser.newContext({ viewport: phoneSize })).newPage()

  const expo = { ...opp(7, '1077', 'Expo stand', 'Other Co', 'Quotation', 'Provisional', '2027-02-01', 65000), endsAt: '2027-02-02T10:00:00.000Z' }
  const line = (id: number, path: string, more: Record<string, unknown>) => ({
    id, opportunityId: 7, path, kind: 'Principal', transaction: 'Rental', itemType: 'Product', itemId: null, name: '', description: '', quantity: 1, priceCents: 0,
    discountPct: 0, chargeableDays: 2, rateDefinition: '', period: '', unitCents: 0, totalCents: 0, taxCents: 0, subRent: false, startsAt: null, endsAt: null, ...more,
  })
  await office.route(/\/api\/rms\/opportunities\?/, (route) => route.fulfill({ json: { opportunities: [expo], total: 1, links: {} } }))
  await office.route('**/api/rms/opportunities/7', (route) =>
    route.fulfill({
      json: {
        opportunity: { ...expo, venue: '', grossCents: 0, rentalCents: 0, saleCents: 0, serviceCents: 0, surchargeCents: 0, taxCents: 0, undiscountedCents: 0, chargeableDays: 2, discountCategory: '', priceCategory: '', tags: [], createdAt: null, updatedAt: null },
        lines: [
          line(1, '0001', { kind: 'Group', name: 'Audio', transaction: '', itemType: '' }),
          line(2, '0001-0001', { name: 'Shure SM58', quantity: 4, priceCents: 1500, discountPct: 10, rateDefinition: '3 Day Week Rate', unitCents: 2700, totalCents: 10800 }),
          line(3, '0001-0002', { name: 'Mic stand', quantity: 4 }),
          line(4, '0002', { transaction: 'Service', itemType: 'Service', name: 'Sound engineer', priceCents: 27100, unitCents: 54200, totalCents: 54200 }),
        ],
        job: null,
      },
    })
  )
  let linked: unknown
  await office.route('**/api/rms/matches', (route) => {
    linked = route.request().postDataJSON()
    return route.fulfill({ json: { linked: 1 } })
  })

  await office.goto('/#quotes')
  await office.getByRole('group', { name: 'From Current RMS' }).getByRole('link', { name: 'Make a job from it' }).click()
  const form = office.getByRole('region', { name: 'Make a job from this' })
  await expect(form.getByLabel("What's the job?")).toHaveValue('Expo stand')
  await expect(form.getByLabel('From')).toHaveValue('2027-02-01')
  await expect(form.getByLabel('To')).toHaveValue('2027-02-02')
  await expect(form.getByLabel('Make it')).toHaveValue('enquiry')
  const lines = form.getByRole('region', { name: 'Lines for the quote' })
  await expect(lines).toContainText('1 of 1 kit line found in the stock list')
  await expect(lines).toContainText('1 charged nothing there is left unticked.')
  await expect(lines.getByRole('listitem').filter({ hasText: 'Shure SM58' })).toContainText('3 Day Week · €15.00 a day · 10% off')
  if (process.env.SHOT) await office.screenshot({ path: process.env.SHOT, fullPage: true })
  await form.getByRole('button', { name: 'Make the job, with 2 lines on the quote' }).click()

  // The job page, on its quote, with the steps saying what's next (ADR 0103); the draft is a press away.
  await expect(office).toHaveURL(/#jobs\/[^/]+\/money$/)
  const steps = office.getByRole('region', { name: 'Steps' })
  await expect(steps.getByText(/· at Quote sent$/)).toBeVisible()
  await steps.getByRole('link', { name: 'Open the quote' }).click()
  const draft = office.getByRole('form', { name: 'Version 1, a draft' })
  await expect(draft).toContainText('Shure SM58')
  await expect(draft).toContainText('Sound engineer')
  const jobId = decodeURIComponent(/#jobs\/([^/]+)/.exec(office.url())![1]!)
  await expect.poll(() => linked).toEqual({ links: [{ opportunityId: 7, projectId: jobId }] })

  // The kit quoted is on the job's kit list too, to change there; only the one found in the stock list.
  await office.goto(`/#jobs/${encodeURIComponent(jobId)}`)
  await office.getByRole('tab', { name: 'Kit and vans' }).click()
  const kit = office.getByRole('region', { name: 'Kit' })
  await expect(kit).toContainText('Shure SM58')
  await expect(kit.getByRole('group', { name: 'Kit on the quote' })).toHaveCount(0)

  expect((await request.post('/api/data/start-fresh', fresh)).ok()).toBe(true)
})
