import { expect, test } from '@playwright/test'

/**
 * Erasing a person's details on request (ADR 0027) end to end: the office
 * adds someone, archives them, and erases them through the question in
 * place, which says what goes, what stays and that backups keep copies for
 * a while; the card then reads "Erased person", and the private link they
 * were sent no longer works. For a member of staff with leave records,
 * the question and the card say their leave and their name are kept, for
 * how long and why. Each person has this run's own name, since the test
 * server is shared.
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
  await expect(question).toContainText('days off, staff leave and what they said about running late')
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

  // The history says it happened, with no name. It's grouped (ADR 0006): this laptop's changes one after another are one line, the newest, opened on a tap.
  await office.goto('/#history')
  const run = office.locator('section.day').first().locator('.entries > li').first()
  await run.getByRole('button').click()
  await expect(run.locator('.entries .entry .what').first()).toHaveText("Erased a person's details on request")
})

test('for a member of staff with leave records, the question keeps their leave, saying for how long and why, and so does the card', async ({ browser }) => {
  // Proves: Colly's decision (2 October 2026), at a phone's width: staff leave moves from what goes to what is kept, until
  // three whole years after the end of this year, under the Working Time Act, while their days off still go; once erased,
  // the card keeps the name and says why, and the day the app erases it, with nothing for anyone to press. Made through
  // the sync API with this run's own names.
  const year = Number(new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Dublin' }).slice(0, 4))
  const staffName = `Nóra Leave ${id}`
  const k = (key: string) => `${key}-${id}`
  const context = await browser.newContext({ viewport: phoneSize })
  const person = (key: string, name: string, approvesLeave: boolean) => ({
    id: k(key),
    name,
    kind: 'staff',
    email: null,
    phone: approvesLeave ? null : '+353 87 555 0303',
    skills: [],
    dayRateCents: null,
    notes: '',
    approvesLeave,
  })
  const mutations: [string, Record<string, unknown>][] = [
    ['person.upsert', person('eoin', `Eoin Approver ${id}`, true)],
    ['person.upsert', person('nora', staffName, false)],
    ['leave.allowance', { personId: k('nora'), year, days: 22, carriedOver: 2, note: 'Agreed at interview', by: k('eoin') }],
    ['leave.request', { id: k('week'), personId: k('nora'), type: 'annual', start: `${year}-02-09`, end: `${year}-02-13`, note: 'Family wedding in Kerry' }],
    ['leave.decide', { id: k('week'), approved: true, reason: '', by: k('eoin') }],
    ['person.archive', { id: k('nora'), archived: true }],
  ]
  const res = await context.request.post('/api/sync/push', {
    data: { clientId: `erasure-${id}`, mutations: mutations.map(([name, args], i) => ({ id: `${k('m')}-${i}`, name, args, createdAt: new Date().toISOString() })) },
  })
  const { results } = await res.json()
  expect(results.map((r: { status: string; reason?: { message: string } }) => r.reason?.message ?? r.status)).toEqual(mutations.map(() => 'applied'))

  const office = await context.newPage()
  await office.goto('/#crew')
  await expect(office.getByRole('status')).toHaveText('Up to date')
  const people = office.getByRole('region', { name: 'People' })
  await people.getByText(/^Archived \(\d+\)$/).click()
  const row = people.locator('details.archived .row', { hasText: staffName })
  await row.getByRole('button', { name: 'Erase details…' }).click()
  const question = row.getByRole('group', { name: `Erase ${staffName}'s details? This can't be undone.` })
  const until = new RegExp(`until \\w{3} 1 Jan ${year + 4}`)
  const goes = question.locator('p', { hasText: 'Goes:' })
  await expect(goes).toContainText('day rate, days off and what they said about running late.')
  await expect(goes).not.toContainText('staff leave')
  await expect(goes).toContainText('If they sign in to the app, they are signed out and their account is switched off.')
  const kept = question.locator('p', { hasText: 'Kept:' })
  await expect(kept).toContainText('their name and their staff leave records, without notes or reasons,')
  await expect(kept).toContainText(until)
  await expect(kept).toContainText('the Working Time Act asks for records of leave to be kept for three years.')
  await expect(kept).toContainText('Their bookings, offers and timesheets stay too, as records of work.')
  // Nothing wider than the phone, however long the words.
  expect(await office.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(phoneSize.width)
  await question.getByRole('button', { name: 'Erase their details' }).click()

  const erased = people.locator('details.archived .row.erased', { hasText: staffName })
  await expect(erased).toContainText('Details erased on request')
  await expect(erased).toContainText('Their name is kept with their staff leave records: the Working Time Act asks for records of leave to be kept for three years.')
  await expect(erased).toContainText(new RegExp(`The app erases it on \\w{3} 1 Jan ${year + 4}\\.`))
  await expect(office.getByRole('status')).toHaveText('Up to date')
  await expect(erased.getByRole('button', { name: 'Erase the name now' })).toHaveCount(0)
  await context.close()
})
