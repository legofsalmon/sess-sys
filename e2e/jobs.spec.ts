import { expect, test, type Page } from '@playwright/test'

/**
 * Jobs end to end (ADR 0007): the office adds a job with its client, venue
 * and phases, sees how each day will read on the calendar, and asks for crew
 * for a phase; renaming the job renames it for the crew too. A job added
 * with no signal waits on the phone, its phase can be changed meanwhile, and
 * both go through once the signal is back.
 * The test server is shared with the other browser tests, so every name here
 * is this run's own. To refresh the blueprint screenshots, run this file on
 * its own with SHOTS=1: the names are then plain, as the office would type them.
 */

const shot = (name: string) => (process.env.SHOTS ? { path: `docs/hub/img/${name}.png` } : undefined)
const phoneSize = { width: 390, height: 844 }
const tag = () => Math.random().toString(36).slice(2, 8)
const named = (name: string, id: string) => (process.env.SHOTS ? name : `${name} ${id}`)

async function ready(page: Page, hash = '#jobs') {
  await page.goto(`/${hash}`)
  await expect(page.getByRole('status')).toHaveText('Up to date')
}

function newJobForm(page: Page) {
  return page.locator('form').filter({ has: page.getByRole('button', { name: 'Add job' }) })
}

test('a job with its phases and crew, renamed for the crew too', async ({ browser }) => {
  const id = tag()
  const job = named('Nissan launch', id)
  const renamed = named('Nissan Qashqai launch', id)
  const office = await (await browser.newContext({ viewport: phoneSize })).newPage()
  await ready(office)

  const form = newJobForm(office)
  await form.getByLabel('Job').fill(job)
  await expect(form.getByLabel('Status')).toHaveValue('enquiry')
  await form.getByLabel('Status').selectOption({ label: 'Confirmed' })
  await expect(form.getByText('A confirmed job goes on the jobs calendar and holds its kit.')).toBeVisible()
  await form.getByLabel('Client').fill(named('Nissan Ireland', id))
  await form.getByLabel('Venue').fill(named('The Heritage', id))
  await form.getByLabel('Phase 1', { exact: true }).fill('Build')
  await form.getByLabel('Phase 1 from').fill('2030-10-07')
  await form.getByLabel('Phase 1 to').fill('2030-10-08')
  await form.getByRole('button', { name: 'Add a phase' }).click()
  await form.getByLabel('Phase 2', { exact: true }).fill('Show')
  await form.getByLabel('Phase 2 from').fill('2030-10-09')
  await form.getByLabel('Phase 2 to').fill('2030-10-09')
  await form.getByRole('button', { name: 'Add job' }).click()

  // The job opens on its own page, with each day as it will read on the calendar.
  await expect(office.getByRole('heading', { name: job })).toBeVisible()
  await expect(office.locator('.conn')).toHaveText('Up to date')
  await expect(office.locator('.title .pill')).toHaveText('Confirmed')
  await expect(office.locator('.facts')).toContainText(named('Nissan Ireland', id))
  await expect(office.locator('.facts')).toContainText('Mon 7 Oct to Wed 9 Oct')
  // A phase's call sheet and calendar line wait behind a tap on its details (audit finding 16).
  for (const phase of ['Build', 'Show']) await office.getByRole('article', { name: phase }).locator('summary').click()
  await expect(office.getByText(`Goes on the calendar as “${job} - Build 1/2” and “${job} - Build 2/2” once one is connected on the Account tab.`)).toBeVisible()
  await expect(office.getByText(`Goes on the calendar as “${job} - Show” once one is connected on the Account tab.`)).toBeVisible()

  // Crew for the build.
  await office.getByRole('button', { name: 'Ask for crew' }).click()
  const ask = office.getByRole('form', { name: 'Ask for crew' })
  await ask.getByLabel('For which phase').selectOption({ label: 'Build, Mon 7 Oct to Tue 8 Oct' })
  await ask.getByLabel('Role').fill('Audio tech')
  await ask.getByLabel('How many').fill('2')
  await ask.getByLabel('Day rate €').fill('250')
  await ask.getByRole('button', { name: 'Ask for crew' }).click()
  const build = office.getByRole('article', { name: 'Build' })
  await expect(build.locator('.job b')).toHaveText('2 × Audio tech')
  // The call is one line under its phase (audit finding 16); a tap opens its days and rate.
  await build.getByRole('button', { name: '2 × Audio tech' }).click()
  await expect(build.locator('.job p').first()).toHaveText('Mon 7 Oct to Tue 8 Oct · €250')
  await expect(office.locator('.conn')).toHaveText('Up to date')
  await expect(office.locator('.facts')).toContainText('0 of 2 booked')
  await office.evaluate(() => scrollTo(0, 0))
  await office.screenshot(shot('jobs-job'))

  // Renamed, and the crew screen says so too.
  await office.getByRole('button', { name: 'Change details' }).click()
  await office.getByLabel('Job', { exact: true }).fill(renamed)
  await office.getByRole('button', { name: 'Save job' }).click()
  await expect(office.getByRole('heading', { name: renamed })).toBeVisible()
  await expect(office.locator('.conn')).toHaveText('Up to date')
  await office.getByRole('navigation', { name: 'Areas' }).getByRole('link', { name: 'Crew' }).click()
  // Grouped by job (audit finding 16): the job's name and Open job on the group, the call as one line under it.
  const group = office.locator('.call-group', { hasText: renamed })
  await expect(group.locator('header b')).toHaveText(renamed)
  await expect(group.locator('.job', { hasText: '2 × Audio tech' })).toContainText('Build')
  await expect(group.getByRole('link', { name: 'Open job' })).toBeVisible()

  // Back on the list, the job shows its crew still to find.
  await office.getByRole('navigation', { name: 'Areas' }).getByRole('link', { name: 'Jobs' }).click()
  await office.getByLabel('Find').fill(renamed)
  const row = office.locator('.job-row', { hasText: renamed })
  await expect(row).toContainText('Mon 7 Oct to Wed 9 Oct · Build, Show')
  await expect(row).toContainText('Crew 0 of 2')
  await office.getByLabel('Find').fill('')
  await office.getByLabel('Find').blur()
  await office.screenshot(shot('jobs-list'))
})

test('a job added with no signal waits on the phone, then goes through', async ({ browser }) => {
  const job = named('Fuel conference', tag())
  const context = await browser.newContext({ viewport: phoneSize })
  const phone = await context.newPage()
  await ready(phone)
  await context.setOffline(true)

  const form = newJobForm(phone)
  await form.getByLabel('Job').fill(job)
  await form.getByLabel('Client').fill('Fuel Events')
  await form.getByLabel('Phase 1 from').fill('2030-11-02')
  await form.getByLabel('Phase 1 to').fill('2030-11-02')
  await form.getByRole('button', { name: 'Add job' }).click()

  await expect(phone.getByRole('heading', { name: job })).toBeVisible()
  await expect(phone.locator('.title .pill')).toHaveText('Waiting to sync')
  await expect(phone.getByRole('status')).toContainText('No signal')

  // Its phase can be changed while it waits too; the change goes up after it (audit finding 23).
  const phase = phone.getByRole('article', { name: 'Show', exact: true })
  await expect(phase.locator('.pill')).toHaveText('Waiting to sync')
  await phase.getByRole('button', { name: 'Change', exact: true }).click()
  await phase.getByLabel('To', { exact: true }).fill('2030-11-03')
  await phase.getByRole('button', { name: 'Save phase' }).click()
  await expect(phase.locator('header')).toContainText('Sat 2 Nov to Sun 3 Nov')

  await context.setOffline(false)
  await phone.evaluate(() => dispatchEvent(new Event('online')))
  await expect(phone.getByRole('status')).toHaveText('Up to date', { timeout: 20_000 })
  // Nobody chose a status, so it came in as an enquiry: nothing on the jobs calendar, no kit held.
  await expect(phone.locator('.title .pill')).toHaveText('Enquiry')

  // And another device has it.
  const laptop = await (await browser.newContext()).newPage()
  await ready(laptop)
  await laptop.getByLabel('Find').fill(job)
  await expect(laptop.locator('.job-row', { hasText: job })).toContainText('Sat 2 Nov to Sun 3 Nov · Show')
})
