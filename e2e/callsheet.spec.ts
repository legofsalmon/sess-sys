import { expect, test } from '@playwright/test'

/**
 * Call sheets (ADR 0021): the office opens a phase's sheet, picks who crew
 * ring on the day, sends a freelancer theirs, prints it and copies it for a
 * WhatsApp group; the freelancer opens theirs from the link, with no app.
 * Uses the made-up data (ADR 0019), so it starts fresh before and after:
 * the other tests share this server.
 * To refresh the blueprint screenshots, run this file on its own with SHOTS=1.
 */

const shot = (name: string) => (process.env.SHOTS ? { path: `docs/hub/img/${name}.png` } : undefined)
const phoneSize = { width: 390, height: 844 }
const fresh = { data: { confirm: 'delete everything' } }

test('the office sends a call sheet, and the freelancer reads it on their link', async ({ browser, request }) => {
  expect((await request.post('/api/data/start-fresh', fresh)).ok()).toBe(true)
  expect((await request.post('/api/data/made-up')).ok()).toBe(true)

  const context = await browser.newContext({ viewport: phoneSize, permissions: ['clipboard-read', 'clipboard-write'] })
  const office = await context.newPage()
  // Printing opens the browser's own dialog; here it's counted instead.
  await office.addInitScript(() => {
    ;(window as unknown as { printed: number }).printed = 0
    window.print = () => void (window as unknown as { printed: number }).printed++
  })
  await office.goto('/#jobs')
  await office.locator('.job-row', { hasText: 'Harbour Lights Festival' }).click()
  const show = office.getByRole('article', { name: 'Show' })
  await expect(show.getByText('Contact on the day: Aoife Brennan')).toBeVisible()
  await show.getByRole('link', { name: 'Call sheet' }).click()

  await expect(office.getByRole('heading', { name: 'Harbour Lights Festival Show' })).toBeVisible()
  await expect(office.getByLabel('Contact on the day')).toHaveValue(/.+/)
  const crew = office.getByRole('region', { name: 'Crew' })
  const dara = crew.locator('li', { hasText: 'Dara Quinn' })
  await expect(dara.getByText('Booked')).toBeVisible()
  await expect(dara.getByRole('link', { name: /^\+44 7700 900\d{3}$/ })).toBeVisible()
  await expect(crew.locator('li', { hasText: 'Fionn Gallagher' }).getByText('Offered')).toBeVisible()
  await expect(crew.getByText('11:00 · Crew chief')).toBeVisible()
  await expect(office.getByRole('region', { name: 'Running order' })).toContainText('17:30 Doors')
  await expect(office.getByRole('region', { name: 'Kit' })).toContainText('12 × d&b Y10P')
  await expect(office.getByRole('region', { name: 'Client' })).toContainText('Niamh Walsh')
  await office.evaluate(() => scrollTo(0, 0))
  await office.screenshot(shot('sheet-office'))

  // Who crew ring can be anyone; it shows on the job's page too.
  await office.getByLabel('Contact on the day').selectOption({ label: 'Cian Murphy (staff)' })
  await expect(office.getByLabel('Contact on the day')).toHaveValue(/.+/)
  await office.getByLabel('Contact on the day').selectOption({ label: 'Aoife Brennan' })

  // Copied for the crew's group: nobody's number but the contact's.
  await office.getByRole('button', { name: 'Copy for a WhatsApp group' }).click()
  const text = await office.evaluate(() => navigator.clipboard.readText())
  expect(text).toMatch(/^Harbour Lights Festival: Show\n/)
  expect(text).toContain('On the day, ring Aoife Brennan on +44 7700 900')
  expect(text).toContain('Sound No.1: Dara Quinn')
  expect(text.match(/\+44 7700 900\d{3}/g)).toHaveLength(1)

  // Printed: only the sheet is on the page.
  await office.getByRole('button', { name: 'Print' }).click()
  const printed = office.locator('.print-sheet.call-sheet')
  await expect(printed).toContainText('Ring Aoife Brennan on +44 7700 900')
  // Asked for on the next frame, once the sheet is on the page.
  await expect.poll(() => office.evaluate(() => (window as unknown as { printed: number }).printed)).toBe(1)
  await office.emulateMedia({ media: 'print' })
  await expect(office.locator('.tabs')).toBeHidden()
  await expect(printed).toBeVisible()
  await office.emulateMedia({ media: 'screen' })
  await office.evaluate(() => dispatchEvent(new Event('afterprint')))
  await expect(printed).toHaveCount(0)

  // Sent to Dara, as a link to their own.
  await dara.getByRole('button', { name: 'Send Dara Quinn their call sheet' }).click()
  const panel = office.getByRole('region', { name: 'Send call sheet to Dara Quinn' })
  const message = await panel.locator('textarea').inputValue()
  expect(message).toMatch(/^Hi Dara, here's the call sheet for Harbour Lights Festival \(Show\), /)
  const link = /(http\S+\/f\/\S+\/sheet\/\S+)$/.exec(message)![1]!

  // Dara's phone, no app: who to ring, where, the running order, who else is on, and no other numbers.
  const phone = await (await browser.newContext({ viewport: phoneSize })).newPage()
  await phone.goto(link)
  await expect(phone.getByRole('heading', { name: /Harbour Lights Festival/ })).toBeVisible()
  await expect(phone.getByText(/Ring Aoife Brennan on \+44 7700 900\d{3}/)).toBeVisible()
  await expect(phone.getByText('Riverside Park', { exact: true })).toBeVisible()
  await expect(phone.getByText('17:30 Doors', { exact: false })).toBeVisible()
  await expect(phone.getByText('Dara Quinn (you)')).toBeVisible()
  await expect(phone.getByText('Eimear Nolan')).toBeVisible()
  await expect(phone.getByText('Fionn Gallagher')).toHaveCount(0)
  expect((await phone.content()).match(/\+44 7700 900\d{3}/g)?.length).toBe(1)
  await phone.screenshot(shot('sheet-crew'))
  // And back to the rest of their work.
  await phone.getByRole('link', { name: '‹ Your work' }).click()
  await expect(phone.getByRole('link', { name: /Call sheet: who's on/ }).first()).toBeVisible()

  expect((await request.post('/api/data/start-fresh', fresh)).ok()).toBe(true)
})
