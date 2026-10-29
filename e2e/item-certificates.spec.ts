import { expect, test, type Page } from '@playwright/test'

/**
 * Certificates on items end to end (ADR 0094), at phone size: chain motors
 * need a thorough examination every six months. Two are examined as a
 * round on the Testing page, and the rigging company's report for the
 * round goes on both as one link. Each motor's page shows the report
 * beside its examination and on its Certificates card. A declaration of
 * conformity that has run out goes on one as a file, and the Testing page
 * lists it as running out. The test server is shared with the other
 * browser tests, so names are this run's own and numbers are read off the
 * screen. To refresh the blueprint screenshots, run this file on its own
 * with SHOTS=1.
 */

const shot = (name: string) => (process.env.SHOTS ? { path: `docs/hub/img/${name}.png` } : undefined)
const phoneSize = { width: 390, height: 844 }
const tag = () => Math.random().toString(36).slice(2, 8)
const named = (name: string, id: string) => (process.env.SHOTS ? name : `${name} ${id}`)
const part = (page: Page, heading: string) => page.locator('form').filter({ has: page.getByRole('heading', { name: heading, exact: true }) })

/** A day from today, in Dublin, as YYYY-MM-DD. */
const fromToday = (days: number) => {
  const d = new Date(`${new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Dublin' })}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

const PDF = Buffer.from('%PDF-1.4\n% Made up for a test: not a real declaration of conformity.\n')

test('a round’s report of thorough examination on every motor in it, and another certificate that ran out', async ({ browser }) => {
  const id = tag()
  const motor = named('CM Lodestar 1 t', id)
  const bay = named('Rigging cage', id)
  const context = await browser.newContext({ viewport: phoneSize })
  const page = await context.newPage()
  await page.goto('/#stock')
  await expect(page.locator('.conn')).toHaveText('Up to date')

  // The product, with two motors, examined every six months.
  await page.getByRole('button', { name: 'Add product' }).click()
  const form = page.locator('form').filter({ has: page.getByRole('button', { name: 'Add product' }) })
  await form.getByLabel('Name').fill(motor)
  await form.getByRole('button', { name: 'Add product' }).click()
  await expect(page.getByRole('heading', { level: 1, name: motor })).toBeVisible()
  const add = part(page, 'Add an item')
  const motors: string[] = []
  for (let i = 0; i < 2; i++) {
    await add.getByLabel("Where it's kept").fill(bay)
    await add.getByRole('button', { name: 'Add item' }).click()
    if (i === 0) await page.getByRole('button', { name: 'Make the place' }).click()
    if (motors.length) await expect(add.locator('.added')).not.toHaveText(`Added ${motors.at(-1)}.`)
    // The number comes back with a sync round trip, slower when the machine is busy (audit, 20 October 2026, finding 109).
    await expect(add.locator('.added')).toHaveText(/^Added SH-\d{6}\.$/, { timeout: 20_000 })
    motors.push((await add.locator('.added').textContent())!.slice(6, -1))
  }
  await page.getByRole('tab', { name: /^Details/ }).click()
  await page.getByRole('button', { name: 'Change details' }).click()
  await page.getByLabel('Thorough examination every, in months').fill('6')
  await page.getByRole('button', { name: 'Save product' }).click()
  await expect(page.locator('.facts')).toContainText('Thorough examination every 6 months')

  // Both examined as a round on the Testing page.
  await page.goto('/#stock/testing')
  await page.getByRole('group', { name: 'Which test' }).getByRole('button', { name: 'Thorough examination' }).click()
  await page.getByLabel('By', { exact: true }).fill('Rig Safe Ltd')
  const said = page.getByRole('status', { name: 'Last scan' })
  for (const m of motors) {
    await page.getByLabel('Number or serial').fill(m)
    await page.getByLabel('Number or serial').press('Enter')
  }
  await expect(said).toContainText(`${motors[1]} ${motor}: passed, next due`, { timeout: 8000 })

  // Their report goes on both as one link.
  const tested = page.getByRole('region', { name: 'Tested' })
  await tested.getByRole('button', { name: 'Add the report of thorough examination for these 2 passed' }).click()
  const round = page.getByRole('form', { name: 'Add the report of thorough examination for the round' })
  await expect(round).toContainText('It goes on all 2 items it covers.')
  await round.getByLabel('Title').fill('Rig Safe report 4471')
  await round.getByLabel('Link').fill('https://www.dropbox.com/s/made-up/rig-safe-4471.pdf')
  await round.getByRole('button', { name: 'Add certificate' }).click()
  await expect(tested).toContainText('Each one that passed here has its report of thorough examination.')
  await page.screenshot(shot('certificates-round'))

  // Each motor's page shows it beside the examination, and on its Certificates card.
  await tested.getByRole('link', { name: motors[0] }).click()
  const inspections = page.getByRole('region', { name: 'Inspections' })
  await expect(inspections.locator('.due')).toContainText('certificate kept')
  await expect(inspections.locator('.inspection')).toContainText('Rig Safe Ltd · Rig Safe report 4471')
  await expect(inspections.getByRole('link', { name: /^Open the link to the certificate for the Thorough examination on / })).toHaveAttribute(
    'href',
    'https://www.dropbox.com/s/made-up/rig-safe-4471.pdf'
  )
  const certs = page.getByRole('region', { name: 'Certificates' })
  await expect(certs.locator('.row.doc')).toContainText('Rig Safe report 4471')
  await expect(certs.locator('.row.doc')).toContainText('covers this and 1 more')

  // A declaration of conformity that ran out, as a file.
  await certs.getByRole('button', { name: 'Add certificate' }).click()
  const other = page.getByRole('form', { name: `Add a certificate for ${motors[0]}` })
  await other.getByLabel('What is it').selectOption({ label: 'Another certificate' })
  await other.getByLabel('Title').fill('Declaration of conformity')
  await other.getByLabel('Issued').fill(fromToday(-400))
  await other.getByLabel('Runs out').fill(fromToday(-3))
  await other.getByLabel('Or the file').setInputFiles({ name: 'conformity.pdf', mimeType: 'application/pdf', buffer: PDF })
  await other.getByRole('button', { name: 'Add certificate' }).click()
  await expect(other.locator('.added')).toHaveText('Added Declaration of conformity.')
  const declaration = certs.locator('.row.doc', { hasText: 'Declaration of conformity' })
  await expect(declaration).toContainText('PDF')
  await expect(declaration.locator('.bad')).toContainText('Ran out on')
  const download = page.waitForEvent('download')
  await declaration.getByRole('button', { name: /^Open .*Declaration of conformity$/ }).click()
  expect((await download).suggestedFilename()).toBe(`${motors[0]} ${motor} - Declaration of conformity.pdf`)
  await certs.scrollIntoViewIfNeeded()
  await page.screenshot(shot('certificates-item'))

  // The Testing page lists it as running out.
  await page.goto('/#stock/testing')
  const due = page.getByRole('region', { name: 'Inspections due' })
  await expect(due.locator('li', { hasText: motors[0]! })).toContainText('Declaration of conformity ran out on')
  await context.close()
})
