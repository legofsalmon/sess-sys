import { readFileSync } from 'node:fs'
import { expect, test } from '@playwright/test'

/**
 * Quotes and money (ADR 0042): the office builds a quote from a job's kit
 * and crew at the price list, changes a line and adds one charged once at
 * the lower VAT rate, the draft saving itself, removes it and puts it back,
 * prints it to save as a PDF, marks it sent, makes a second version, and
 * records the client accepting it and the invoice. Money then
 * shows who owes what, a freelancer is marked paid, and the accountant's
 * file comes down. Uses the made-up data (ADR 0019), so it starts fresh
 * before and after: the other tests share this server.
 */

const phoneSize = { width: 390, height: 844 }
const fresh = { data: { confirm: 'delete everything' } }

test('the office quotes a job, records the answer and the invoice, and sees who owes', async ({ browser, request }) => {
  expect((await request.post('/api/data/start-fresh', fresh)).ok()).toBe(true)
  expect((await request.post('/api/data/made-up')).ok()).toBe(true)

  const office = await (await browser.newContext({ viewport: phoneSize })).newPage()
  // Printing opens the browser's own dialog; here it's counted instead.
  await office.addInitScript(() => {
    ;(window as unknown as { printed: number }).printed = 0
    window.print = () => void (window as unknown as { printed: number }).printed++
  })
  // The company's VAT number and address, from Admin's office details, go on the printed quote.
  await office.goto('/#admin')
  await office.getByLabel('VAT number').fill('IE 1234567T')
  await office.getByLabel('Address').fill('Unit 4, Docklands Business Park\nDublin 3')
  await office.getByRole('button', { name: 'Save office details' }).click()
  // Numbers carry on from the last system's, and the terms and bank details go under every quote (ADR 0084).
  const quoting = office.getByRole('region', { name: 'Printed quotes' })
  await quoting.getByLabel('Next quote number').fill('1115')
  await quoting.getByLabel('Terms').fill('Payment within 30 days of the invoice.')
  await quoting.getByLabel('Bank details').fill('Session Hire Ltd\nIBAN IE00 BANK 0000 0000 0000 00')
  await quoting.getByRole('button', { name: 'Save printed quotes' }).click()
  await expect(office.locator('.conn')).toHaveText('Up to date')
  await expect(quoting).toContainText('The next one sent will be 1115.')
  await office.goto('/#jobs')
  await office.locator('.job-row', { hasText: 'Liffey Brands Launch' }).click()
  await office.getByRole('tab', { name: 'Quote' }).click()
  await office.getByRole('region', { name: 'Quote' }).getByRole('link', { name: 'Make a quote' }).click()

  // Built from the job: its 12 Spiiders for the two days, and its LX op at the price list's €360 rather than the €280 they were booked at.
  await expect(office.getByRole('heading', { name: 'Liffey Brands Launch' })).toBeVisible()
  await office.getByRole('button', { name: 'Build it from the job' }).click()
  const draft = office.getByRole('form', { name: 'Version 1, a draft' })
  // On a phone the lines read as a list, each opened to change it, one at a time.
  await expect(draft.getByRole('button', { name: 'Line 1: Robe Spiider, change it' })).toContainText('12 × €55.00 a day × 2 days')
  await draft.getByRole('button', { name: 'Line 2: LX op (Show), change it' }).click()
  await expect(draft.getByLabel('Line 2: price')).toHaveValue('360')
  await expect(draft.getByRole('group', { name: 'What it comes to' })).toContainText('Before VAT €2,040.00')
  await expect(draft.locator('.save-state')).toHaveText('Saved')

  // The kit charged for one day, and delivery added, charged once, at 13.5%. It saves itself.
  await draft.getByRole('button', { name: 'Line 1: Robe Spiider, change it' }).click()
  await draft.getByLabel('Line 1: days charged').fill('1')
  await draft.getByRole('button', { name: 'Add something else' }).click()
  await draft.getByLabel('Line 3: what').fill('Delivery')
  await expect(draft.getByLabel('Line 3: days charged')).toHaveCount(0)
  await expect(draft.getByRole('group', { name: 'What it comes to' })).toContainText('1 line with no price')
  await draft.getByLabel('Line 3: price').fill('150')
  await draft.getByRole('button', { name: 'Line 3: VAT is 23%, change it' }).click()
  await draft.getByLabel('Line 3: VAT').selectOption('13.5')
  await expect(draft.locator('.quote-totals')).toContainText('VAT at 13.5% on €150.00€20.25')
  await expect(draft.locator('.quote-totals')).toContainText('Total€1,867.65')
  await expect(draft.locator('.save-state')).toHaveText('Saved')
  await expect(office.getByRole('status')).toHaveText('Up to date')

  // Removed by mistake, and put back.
  await draft.getByRole('button', { name: 'Remove line 3' }).click()
  await draft.getByRole('button', { name: 'Undo' }).click()
  await expect(draft.getByRole('button', { name: 'Line 3: Delivery, change it' })).toContainText('€150.00 once')
  await expect(draft.locator('.save-state')).toHaveText('Saved')

  // A deposit of half, and the prices held for 14 days.
  await draft.getByLabel('Prices hold for, days').fill('14')
  await draft.getByLabel('Deposit, %').fill('50')
  await expect(draft.locator('.quote-terms:not(.quote-discount)')).toContainText('€933.83 before the job')
  await expect(draft.locator('.save-state')).toHaveText('Saved')
  await expect(draft).toContainText('Marked sent, it becomes quote 1115')

  // Printed as an A4 page to save as a PDF: only the quote is on the page. Not sent yet, it says it's a draft.
  await draft.getByRole('button', { name: 'Print a draft' }).click()
  const printed = office.locator('.print-sheet.quote-sheet')
  await expect(printed.locator('.sheet-to')).toContainText('Liffey Brands')
  await expect(printed).toContainText('Delivery')
  await expect(printed).toContainText('€1,867.65')
  await expect(printed.locator('.sheet-facts')).toContainText('Draft quoteNot sent yet')
  await expect(printed.locator('.from')).toContainText('Unit 4, Docklands Business Park\nDublin 3')
  await expect(printed.locator('.from')).toContainText('VAT number IE 1234567T')
  await expect(printed).toContainText('A deposit of 50%, €933.83, confirms the booking.')
  await expect(printed.locator('.sheet-terms')).toHaveCount(2)
  await expect.poll(() => office.evaluate(() => (window as unknown as { printed: number }).printed)).toBe(1)
  await office.emulateMedia({ media: 'print' })
  await expect(printed).toBeVisible()
  await office.emulateMedia({ media: 'screen' })
  await office.evaluate(() => dispatchEvent(new Event('afterprint')))
  await expect(printed).toHaveCount(0)

  // Sent by the office itself, then a second version with Liffey's 10% off; the first is kept as it went.
  await draft.getByRole('button', { name: 'Mark as sent' }).click()
  const v1 = office.getByRole('region', { name: 'Version 1' })
  await expect(v1.getByText('Sent', { exact: true })).toBeVisible()
  await expect(v1.locator('.quote-facts')).toContainText('Quote 1115 · Valid until')
  await v1.getByRole('button', { name: 'Print or save as PDF' }).click()
  await expect(printed.locator('.sheet-facts')).toContainText('Quote1115')
  await expect(printed).toContainText('Please give quote 1115 as the reference.')
  await office.evaluate(() => dispatchEvent(new Event('afterprint')))
  await v1.getByRole('button', { name: 'Start a new version' }).click()
  const v2 = office.getByRole('form', { name: 'Version 2, a draft' })
  await v2.getByLabel('Discount, %').fill('10')
  await expect(v2.locator('.quote-totals')).toContainText('Total€1,680.89')
  await expect(v2.locator('.save-state')).toHaveText('Saved')
  // What changed, to tell the client in a sentence; the deposit and days carry over.
  const since = office.getByRole('region', { name: 'What changed since version 1' })
  await expect(since).toContainText('Discount 10%, was 0%')
  await expect(since).toContainText('€186.76 less than version 1')
  await expect(v2.getByLabel('Deposit, %')).toHaveValue('50')
  await v2.getByRole('button', { name: 'Mark as sent' }).click()
  await expect(office.getByRole('region', { name: 'Version 2' }).locator('.quote-facts')).toContainText('Quote 1115')

  // The client said yes; the office invoiced it outside the app and records that here.
  const records = office.getByRole('region', { name: 'What happened' })
  await records.getByRole('button', { name: 'Client accepted' }).click()
  await records.getByLabel('Invoice number').fill('SH-1050')
  await records.getByRole('button', { name: 'Mark invoiced' }).click()
  await expect(records).toContainText('Not yet: €1,680.89 owed')
  await expect(office.getByText("The quote is invoiced, so it's settled: no new version.")).toBeVisible()
  await office.getByRole('button', { name: 'Version 1 · Sent' }).click()
  await expect(office.getByText('An older version, kept as it went to the client. The newest is version 2.')).toBeVisible()
  await expect(office.getByRole('status')).toHaveText('Up to date')

  // Money: who owes, freelancers to pay, and the accountant's file.
  await office.goto('/#jobs/money')
  const owed = office.getByRole('region', { name: 'Owed by clients' })
  await expect(owed).toContainText('Shannonside Festivals€7,257.00')
  await expect(owed).toContainText('Brightwater Conferences€3,044.25')
  await expect(owed).toContainText('Liffey Brands€1,680.89')
  await expect(owed).toContainText('invoiced')
  await expect(office.getByRole('region', { name: 'Margin by job' })).toContainText('Liffey Brands Launch')

  const freelancers = office.getByRole('region', { name: 'Owed to freelancers' })
  await expect(freelancers).toContainText('Tadhg Brady')
  await freelancers.getByRole('button', { name: /^Mark Tadhg Brady paid/ }).click()
  await expect(freelancers.getByRole('group', { name: 'Paid lately' })).toContainText('Tadhg Brady')

  const accountant = office.getByRole('region', { name: 'For the accountant' })
  await accountant.getByLabel('Period').selectOption({ index: 0 })
  const downloading = office.waitForEvent('download')
  await accountant.getByRole('button', { name: 'Invoices' }).click()
  const download = await downloading
  expect(download.suggestedFilename()).toMatch(/^session-hire-invoices-\d{4}-\d{2}-01-to-\d{4}-\d{2}-\d{2}\.csv$/)
  const csv = readFileSync((await download.path())!, 'utf8')
  expect(csv).toContain('Invoice date,Invoice number,Client,Job,Quote version,VAT rate,Net (EUR),VAT (EUR),Gross (EUR),Paid on')
  expect(csv).toMatch(/\d{4}-\d{2}-\d{2},SH-1050,Liffey Brands,Liffey Brands Launch,2,23%,1242\.00,285\.66,1527\.66,\r\n/)
  expect(csv).toContain(',SH-1050,Liffey Brands,Liffey Brands Launch,2,13.5%,135.00,18.23,153.23,')

  // The price list it was built from.
  await office.getByRole('link', { name: 'Price list' }).click()
  const kit = office.getByRole('region', { name: 'Kit' })
  await kit.getByLabel('Robe Spiider: price a day').fill('60')
  await kit.getByRole('button', { name: 'Save' }).click()
  await expect(kit.getByRole('button', { name: 'Save' })).toHaveCount(0)
  await expect(office.getByRole('region', { name: 'Crew' })).toContainText('LX op')

  expect((await request.post('/api/data/start-fresh', fresh)).ok()).toBe(true)
})

test('kit charged by the week, a line discounted, and a total agreed with the client (ADR 0085)', async ({ browser, request }) => {
  expect((await request.post('/api/data/start-fresh', fresh)).ok()).toBe(true)
  expect((await request.post('/api/data/made-up')).ok()).toBe(true)
  const office = await (await browser.newContext({ viewport: phoneSize })).newPage()

  // The Spiiders are hired by the week: the price list says so beside the price.
  await office.goto('/#jobs/money/prices')
  const kit = office.getByRole('region', { name: 'Kit' })
  await kit.getByLabel('Robe Spiider: charged').selectOption('weekly')
  await kit.getByLabel('Robe Spiider: price a week').fill('150')
  await kit.getByRole('button', { name: 'Save' }).click()
  await expect(kit.getByRole('button', { name: 'Save' })).toHaveCount(0)
  await expect(office.locator('.rate-rules')).toContainText('1 Weekly')

  await office.goto('/#jobs')
  await office.locator('.job-row', { hasText: 'Liffey Brands Launch' }).click()
  await office.getByRole('tab', { name: 'Quote' }).click()
  await office.getByRole('region', { name: 'Quote' }).getByRole('link', { name: 'Make a quote' }).click()
  await office.getByRole('button', { name: 'Build it from the job' }).click()
  const draft = office.getByRole('form', { name: 'Version 1, a draft' })
  // Two days out is one week charged.
  await expect(draft.getByRole('button', { name: 'Line 1: Robe Spiider, change it' })).toContainText('12 × €150.00 a week × 1 week')
  await expect(draft.getByRole('group', { name: 'What it comes to' })).toContainText('Before VAT €2,520.00')

  // Half off the Spiiders, then a 3 Day Week for ten days out: six days charged.
  await draft.getByRole('button', { name: 'Line 1: Robe Spiider, change it' }).click()
  await draft.getByLabel('Line 1: discount, %').fill('50')
  await expect(draft.getByRole('group', { name: 'What it comes to' })).toContainText('Before VAT €1,620.00')
  await draft.getByLabel('Line 1: charged').selectOption('week3')
  await draft.getByLabel('Line 1: days out').fill('10')
  await expect(draft).toContainText('Charged 6 days')
  await draft.getByLabel('Line 1: charged').selectOption('weekly')
  await draft.getByLabel('Line 1: days out').fill('2')

  // The client agreed €1,500 before VAT: the discount is whatever comes to it.
  await draft.getByLabel('Agreed price before VAT, €').fill('1500')
  await expect(draft.getByLabel('Discount, %', { exact: true })).toHaveCount(0)
  await expect(draft.locator('.quote-totals')).toContainText('Agreed discount, 7.4%−€120.00')
  await expect(draft.locator('.quote-totals')).toContainText('Before VAT€1,500.00')
  await expect(draft.locator('.save-state')).toHaveText('Saved')
  await draft.getByRole('button', { name: 'Print a draft' }).click()
  const printed = office.locator('.print-sheet.quote-sheet')
  await expect(printed).toContainText('less 50%')
  await expect(printed).toContainText('Agreed discount, 7.4%')
  await office.evaluate(() => dispatchEvent(new Event('afterprint')))

  expect((await request.post('/api/data/start-fresh', fresh)).ok()).toBe(true)
})

test("the crew's travel to a venue far from Dublin, and their subsistence unless meals are provided (ADR 0086)", async ({ browser, request }) => {
  expect((await request.post('/api/data/start-fresh', fresh)).ok()).toBe(true)
  expect((await request.post('/api/data/made-up')).ok()).toBe(true)
  const office = await (await browser.newContext({ viewport: phoneSize })).newPage()

  // Admin says how they're charged: past 50 km, diesel at €1.749, a car using 10 litres for 100 km, €39.08 a day each.
  await office.goto('/#admin')
  const travel = office.getByRole('region', { name: 'Travel and subsistence' })
  await travel.getByLabel('Travel after').fill('50')
  await travel.getByLabel('Fuel price, € a litre').fill('1.749')
  await travel.getByLabel('A car uses, litres for 100 km').fill('10')
  await travel.getByLabel('Per diem, € a day').fill('39.08')
  await travel.getByRole('button', { name: 'Save travel and subsistence' }).click()
  await expect(office.locator('.conn')).toHaveText('Up to date')
  await expect(travel).toContainText('Set today.')
  await expect(travel).toContainText('So 100 km each way comes to €34.98 of fuel for one car.')
  // The price keeps up with the AA's survey unless turned off, to keep one typed in.
  const auto = travel.getByRole('switch', { name: /Update the fuel price from the AA each month/ })
  await expect(auto).toBeChecked()
  await auto.click()
  await expect(auto).not.toBeChecked()
  await expect(travel).toContainText('Off: the fuel price stays as saved here')
  await expect(travel.getByLabel('Fuel price, € a litre')).toHaveValue('1.749')

  await office.goto('/#jobs')
  await office.locator('.job-row', { hasText: 'Liffey Brands Launch' }).click()
  await office.getByRole('tab', { name: 'Quote' }).click()
  await office.getByRole('region', { name: 'Quote' }).getByRole('link', { name: 'Make a quote' }).click()
  await office.getByRole('button', { name: 'Build it from the job' }).click()
  const draft = office.getByRole('form', { name: 'Version 1, a draft' })
  const extras = draft.getByRole('group', { name: 'Travel and subsistence' })

  // The crew's subsistence comes in by itself; the venue is in Dublin, so there's no travel until it's said to be 200 km.
  await expect(extras).toContainText(/Crew subsistence, \d+ crew days?/)
  await expect(extras).toContainText('No travel')
  await extras.getByLabel('Distance each way from Dublin city centre, km').fill('200')
  await expect(extras).toContainText(/Crew travel, 200 km each way from Dublin, \d+ car trips?/)
  await expect(extras).toContainText('€69.96')
  await expect(draft.locator('.save-state')).toHaveText('Saved')

  // The job feeds the crew: no subsistence.
  await extras.getByRole('switch', { name: /Meals provided/ }).check()
  await expect(extras).toContainText('No subsistence')
  await expect(draft.locator('.save-state')).toHaveText('Saved')
  await draft.getByRole('button', { name: 'Print a draft' }).click()
  const printed = office.locator('.print-sheet.quote-sheet')
  await expect(printed).toContainText('Crew travel, 200 km each way from Dublin')
  await expect(printed).not.toContainText('Crew subsistence')
  await office.evaluate(() => dispatchEvent(new Event('afterprint')))

  expect((await request.post('/api/data/start-fresh', fresh)).ok()).toBe(true)
})
