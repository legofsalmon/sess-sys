import { expect, test } from '@playwright/test'
import { readFileSync } from 'node:fs'

/**
 * Venues' pages (ADR 0032), end to end on a phone: a venue in the Jobs
 * tab's list opens a page of its own, with its address and notes, its
 * documents and the jobs there; the office adds a link and a file, opens
 * the file, and removes one; a link that isn't a web address is refused
 * in place. The test server keeps files in a folder (DOCUMENTS_DIR), as a
 * bucket would. Uses the made-up data (ADR 0019), so it starts fresh
 * before and after: the other tests share this server.
 * To refresh the blueprint screenshot, run this file on its own with SHOTS=1.
 */

const phoneSize = { width: 390, height: 844 }
const fresh = { data: { confirm: 'delete everything' } }
const shot = (name: string) => (process.env.SHOTS ? { path: `docs/hub/img/${name}.png` } : undefined)

test.beforeEach(async ({ request }) => {
  expect((await request.post('/api/data/start-fresh', fresh)).ok()).toBe(true)
  expect((await request.post('/api/data/made-up')).ok()).toBe(true)
})

test.afterEach(async ({ request }) => {
  expect((await request.post('/api/data/start-fresh', fresh)).ok()).toBe(true)
})

const PDF = Buffer.from('%PDF-1.4\n% Made up for a test: not a real floor plan.\n%%EOF\n')

test("a venue opens on its own page, with its documents and its jobs, and keeps a link and a file", async ({ browser }) => {
  // Proves: the venue list links to the page; the page shows the address, the made-up links and the jobs there; a link is added with no file, a bad one refused in place; a file is added and opens as a download named for the venue; Remove asks first.
  const office = await (await browser.newContext({ viewport: phoneSize })).newPage()
  await office.goto('/#jobs')
  await expect(office.getByRole('status')).toHaveText('Up to date')
  await office.getByRole('link', { name: /^Northbank Conference Centre/ }).click()
  await expect(office).toHaveURL(/#venues\//)
  await expect(office.getByRole('heading', { level: 1 })).toHaveText('Northbank Conference Centre')
  await expect(office.getByText('Loading bay 2, booked by the half hour.')).toBeVisible()

  const docs = office.getByRole('region', { name: 'Documents' })
  await expect(docs.locator('.row.doc')).toHaveCount(3)
  const spec = docs.locator('.row.doc', { hasText: 'Tech spec' })
  await expect(spec).toContainText('link to example.com')
  await expect(spec.getByRole('link', { name: "Open the link to Northbank Conference Centre's tech spec" })).toHaveAttribute('href', 'https://example.com/made-up/northbank-tech-spec.pdf')
  await expect(office.getByRole('region', { name: 'Jobs here' }).locator('.job-row').first()).toBeVisible()

  // A link that isn't a web address is refused before anything is sent.
  await docs.getByRole('button', { name: 'Add document' }).click()
  const form = docs.getByRole('form', { name: 'Add a document for Northbank Conference Centre' })
  await form.getByLabel('What is it').selectOption('rigging')
  await expect(form.getByLabel('Title')).toHaveValue('Rigging plot')
  await form.getByLabel('Link').fill('javascript:alert(1)')
  await form.getByRole('button', { name: 'Add document' }).click()
  await expect(form.getByRole('alert')).toHaveText(/^That link doesn't look right/)
  await form.getByLabel('Link').fill('https://example.com/made-up/northbank-rigging.pdf')
  await form.getByRole('button', { name: 'Add document' }).click()
  await expect(form.getByText('Added Rigging plot.')).toBeVisible()
  await expect(docs.locator('.row.doc', { hasText: 'Rigging plot' })).toContainText('Rigging · link to example.com')

  // A file, as a phone picks it.
  await form.getByLabel('What is it').selectOption('health-safety')
  await form.getByLabel('Or the file').setInputFiles({ name: 'H&S.pdf', mimeType: 'application/pdf', buffer: PDF })
  await form.getByRole('button', { name: 'Add document' }).click()
  await expect(form.getByText('Added Health and safety pack.')).toBeVisible()
  const pack = docs.locator('.row.doc', { hasText: 'Health and safety pack' })
  await expect(pack).toContainText('Health and safety · PDF, 1 KB')
  await expect(office.getByRole('status')).toHaveText('Up to date')
  await docs.getByRole('button', { name: 'Close' }).click()
  await office.evaluate(() => scrollTo(0, 0))
  await office.screenshot(shot('venue-page'))

  const downloading = office.waitForEvent('download')
  await pack.getByRole('button', { name: "Open Northbank Conference Centre's health and safety pack" }).click()
  const download = await downloading
  expect(download.suggestedFilename()).toBe('Northbank Conference Centre - Health and safety pack.pdf')
  expect(readFileSync(await download.path()).equals(PDF)).toBe(true)

  await spec.getByRole('button', { name: "Remove Northbank Conference Centre's tech spec" }).click()
  await spec.getByRole('button', { name: 'Remove it' }).click()
  await expect(docs.locator('.row.doc', { hasText: 'Tech spec' })).toHaveCount(0)

  // Up goes back to the jobs, where the venue's row counts its documents.
  await office.getByRole('link', { name: '‹ All jobs' }).click()
  await expect(office.getByRole('link', { name: /^Northbank Conference Centre/ })).toContainText('4 documents')
})
