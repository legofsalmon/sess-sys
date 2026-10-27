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
  await expect(office.locator('.conn')).toHaveText('Up to date')
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

  // Printed as an A4 page to save as a PDF: only the quote is on the page.
  await draft.getByRole('button', { name: 'Print or save as PDF' }).click()
  const printed = office.locator('.print-sheet.quote-sheet')
  await expect(printed).toContainText('For Liffey Brands')
  await expect(printed).toContainText('Delivery')
  await expect(printed).toContainText('€1,867.65')
  await expect(printed.locator('.from')).toHaveText('Unit 4, Docklands Business Park\nDublin 3VAT number IE 1234567T')
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
  await v1.getByRole('button', { name: 'Start a new version' }).click()
  const v2 = office.getByRole('form', { name: 'Version 2, a draft' })
  await v2.getByLabel('Discount, %').fill('10')
  await expect(v2.locator('.quote-totals')).toContainText('Total€1,680.89')
  await expect(v2.locator('.save-state')).toHaveText('Saved')
  await v2.getByRole('button', { name: 'Mark as sent' }).click()

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
