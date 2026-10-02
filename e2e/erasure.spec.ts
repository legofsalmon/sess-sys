import { expect, test } from '@playwright/test'

/**
 * Erasing a person's details on request (ADR 0027) end to end: the office
 * adds someone, archives them, and erases them through the question in
 * place, which says what goes, what stays and that backups keep copies for
 * a while; the card then reads "Erased person", and the private link they
 * were sent no longer works. The person has this run's own name, since
 * the test server is shared.
 */

const phoneSize = { width: 390, height: 844 }
const id = Math.random().toString(36).slice(2, 8)
const name = `Saoirse Erasure ${id}`

test('archived, then erased through the question in place: the card says so and the old link stops', async ({ browser }) => {
  const office = await (await browser.newContext({ viewport: phoneSize })).newPage()
  await office.goto('/#crew')
  await expect(office.getByRole('status')).toHaveText('Up to date')
  const people = office.getByRole('region', { name: 'People' })

  await people.getByRole('button', { name: 'Add person' }).click()
  const form = people.getByRole('form', { name: 'Add person' })
  await form.getByLabel('Name').fill(name)
  await form.getByLabel('Mobile').fill('+353 85 555 0199')
  await form.getByLabel('Skills').fill('stage management')
  await form.getByRole('button', { name: 'Add person' }).click()
  await expect(office.getByRole('status')).toHaveText('Up to date')

  // Their private link, as it would have gone to them by WhatsApp.
  await people.getByRole('button', { name }).click()
  const link = await people.getByRole('link', { name: 'Open their page' }).getAttribute('href')
  expect(link).toMatch(/\/f\/[\w-]{24}$/)
  await people.getByRole('button', { name: 'Archive', exact: true }).click()
  await expect(office.getByRole('status')).toHaveText('Up to date')

  // Archived first, then erased: the question says what goes, what stays, and about the backups, before anything is sent.
  await people.getByText(/^Archived \(\d+\)$/).click()
  const row = people.locator('details.archived .row', { hasText: name })
  await row.getByRole('button', { name: 'Erase details…' }).click()
  const question = row.getByRole('group', { name: `Erase ${name}'s details? This can't be undone.` })
  await expect(question).toContainText('Their name becomes “Erased person”.')
  await expect(question).toContainText('their bookings, offers and timesheets, as records of work')
  await expect(question).toContainText("they can't be edited, so any made before now keep copies of their details until they age out")
  // The safe way out has the focus, as for every question in place, and what goes and stays is read out with the question.
  await expect(question.getByRole('button', { name: 'Keep them' })).toBeFocused()
  await expect(question).toHaveAccessibleDescription(/^Goes: their phone, email, notes/)
  await question.getByRole('button', { name: 'Erase their details' }).click()

  const erased = people.locator('details.archived .row.erased')
  await expect(erased).toHaveCount(1)
  await expect(erased.locator('b')).toHaveText('Erased person')
  await expect(erased).toContainText('Details erased on request')
  await expect(office.getByRole('status')).toHaveText('Up to date')
  await expect(people.locator('details.archived')).not.toContainText(name)

  // The link they were sent says it doesn't work any more.
  const phone = await (await browser.newContext({ viewport: phoneSize, javaScriptEnabled: false })).newPage()
  const gone = await phone.goto(link!)
  expect(gone?.status()).toBe(404)
  await expect(phone.getByText("This link doesn't work any more. Ask the office to send you a new one.")).toBeVisible()

  // The history says it happened, with no name.
  await office.goto('/#history')
  await expect(office.getByText("Erased a person's details on request").first()).toBeVisible()
})
