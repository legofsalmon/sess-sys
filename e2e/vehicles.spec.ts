import { expect, test, type Page } from '@playwright/test'

/**
 * Vans and drivers (ADR 0047), end to end on a phone: Stock › Vehicles
 * lists the vans with their checks running out; a vehicle's page takes it
 * off and back on the road; a van added with its CVRT run out is counted
 * on the row and can't be booked. On a job, a van whose motor tax runs out
 * before the job is refused by name before anything is sent; one off the
 * road asks first and is booked anyway; a driver whose licence isn't
 * recorded is warned about. The planner's Vans rows show the clash of one
 * van on two jobs, and the job's day says which van goes and who drives;
 * the call sheet names them for the crew. Uses the made-up data (ADR 0019),
 * so it starts fresh before and after: the other tests share this server.
 */

const phoneSize = { width: 390, height: 844 }
const fresh = { data: { confirm: 'delete everything' } }

test.beforeEach(async ({ request }) => {
  expect((await request.post('/api/data/start-fresh', fresh)).ok()).toBe(true)
  expect((await request.post('/api/data/made-up')).ok()).toBe(true)
})

test.afterEach(async ({ request }) => {
  expect((await request.post('/api/data/start-fresh', fresh)).ok()).toBe(true)
})

async function ready(page: Page, hash: string) {
  await page.goto(`/${hash}`)
  await expect(page.getByRole('status')).toHaveText('Up to date')
}

async function openJob(page: Page, name: string) {
  await ready(page, '#jobs')
  await page.locator('.job-row', { hasText: name }).click()
  await expect(page.getByRole('heading', { name, level: 1 })).toBeVisible()
}

test('Stock › Vehicles lists the vans and their checks, and a van off the road comes back', async ({ browser }) => {
  // Proves: Vehicles sits along Stock's row; checks running out are listed soonest first; off the road is said and undone; a van added with its CVRT run out is counted on the row.
  const phone = await (await browser.newContext({ viewport: phoneSize })).newPage()
  await ready(phone, '#stock')
  const row = phone.getByRole('navigation', { name: 'Stock pages' })
  await row.getByRole('link', { name: 'Vehicles' }).click()
  await expect(phone).toHaveURL(/#stock\/vehicles$/)
  await expect(phone.getByRole('heading', { name: 'Vehicles', level: 1 })).toBeVisible()

  const reminders = phone.getByRole('region', { name: 'Vehicle checks running out' })
  await expect(reminders.getByRole('heading')).toHaveText('Running out (3)')
  const due = reminders.locator('.reminder')
  await expect(due.nth(0)).toHaveClass(/ran-out/)
  await expect(due.nth(0)).toContainText('Big Van (241-XX-101)')
  await expect(due.nth(0)).toContainText(/Service was due on/)
  await expect(due.nth(1)).toContainText(/Motor tax runs out on/)
  await expect(due.nth(2)).toContainText('The Luton (232-XX-202)')
  await expect(due.nth(2)).toContainText(/CVRT runs out on/)

  const list = phone.getByRole('region', { name: 'Vehicles' })
  await expect(list.locator('.vehicle-row')).toHaveCount(2)
  const luton = list.locator('.vehicle-row', { hasText: 'The Luton' })
  await expect(luton).toContainText('Luton · 3 seats · 1,000 kg')
  await expect(luton).toContainText('In for a new clutch')

  // Its own page, under Stock › Vehicles.
  await luton.click()
  await expect(phone.getByRole('heading', { name: 'The Luton', level: 1 })).toBeVisible()
  await expect(phone.locator('.title').getByText('Off the road')).toBeVisible()
  await expect(phone.getByRole('region', { name: 'Booked on' })).toContainText('Liffey Brands Launch')
  await phone.getByRole('button', { name: 'Back on the road' }).click()
  await expect(phone.getByRole('status')).toHaveText('Up to date')
  await expect(phone.locator('.title').getByText('Off the road')).toHaveCount(0)
  await expect(phone.getByRole('button', { name: 'Off the road…' })).toBeVisible()

  // A van added with its CVRT already run out: counted on Stock's row, and marked in the list.
  await ready(phone, '#stock/vehicles')
  await phone.getByRole('button', { name: 'Add vehicle' }).click()
  const form = phone.getByRole('form', { name: 'Add a vehicle' })
  await form.getByLabel('Name').fill('Old Van')
  await form.getByLabel('Registration').fill('06-d-1234')
  await form.getByLabel('CVRT runs out').fill('2020-01-31')
  await form.getByRole('button', { name: 'Add vehicle' }).click()
  await expect(phone).toHaveURL(/#stock\/vehicles\/.+/)
  await expect(phone.getByRole('heading', { name: 'Old Van', level: 1 })).toBeVisible()
  await expect(phone.getByRole('status')).toHaveText('Up to date')
  // The server keeps registrations in capitals.
  await expect(phone.locator('.facts')).toContainText('06-D-1234')
  await expect(phone.getByRole('region', { name: 'Checks' }).locator('.due.overdue')).toContainText('CVRT')
  await ready(phone, '#stock/vehicles')
  await expect(row.getByRole('link', { name: 'Vehicles' })).toHaveText('Vehicles 1')
  await expect(phone.locator('.vehicle-row', { hasText: 'Old Van' })).toContainText("CVRT run out: it can't be booked until updated.")
})

test('on a job, a van whose tax runs out is refused by name, and one off the road is booked anyway', async ({ browser }) => {
  // Proves: the refusal names the van and the fix, and sends nothing; off the road asks first, then books with the problem said; an unrecorded licence warns; Remove takes it off.
  const phone = await (await browser.newContext({ viewport: phoneSize })).newPage()
  await openJob(phone, 'Liffey Brands Launch')
  const vans = phone.getByRole('region', { name: 'Vehicles' })
  const luton = vans.locator('.van-line', { hasText: 'The Luton' })
  await expect(luton).toContainText('Dara Quinn driving')
  await expect(luton.locator('.van-state.warn')).toContainText(/[Dd]riving licence/)

  await vans.getByRole('button', { name: 'Book a vehicle' }).click()
  const form = vans.getByRole('form', { name: 'Book a vehicle' })
  await form.getByLabel('Vehicle').selectOption({ label: "Big Van (241-XX-101): can't be booked then" })
  await form.getByLabel('Driver').selectOption({ label: 'Cian Murphy' })
  await form.getByRole('button', { name: 'Book vehicle' }).click()
  await expect(form.getByRole('alert')).toContainText("Big Van (241-XX-101)'s motor tax runs out on")
  await expect(form.getByRole('alert')).toContainText("Update its checks on the Vehicles page if that's changed.")
  // Nothing was sent.
  await expect(vans.locator('.van-line')).toHaveCount(1)
  await expect(phone.getByRole('status')).toHaveText('Up to date')

  // The Luton is off the road for the festival's load in: asked first, then booked anyway.
  await openJob(phone, 'Harbour Lights Festival')
  const harbour = phone.getByRole('region', { name: 'Vehicles' })
  await expect(harbour.locator('.van-line', { hasText: 'Big Van' })).toHaveCount(2)
  await harbour.getByRole('button', { name: 'Book a vehicle' }).click()
  const book = harbour.getByRole('form', { name: 'Book a vehicle' })
  const phase = book.getByLabel('For')
  await phase.selectOption({ label: (await phase.locator('option', { hasText: 'Load in' }).textContent())!.trim() })
  await book.getByLabel('Vehicle').selectOption({ label: 'The Luton (232-XX-202): off the road then' })
  await book.getByLabel('Driver').selectOption({ label: 'Dara Quinn' })
  await expect(book.locator('.van-state.warn')).toHaveText("Dara's driving licence isn't recorded: check it before the job.")
  await book.getByRole('button', { name: 'Book vehicle' }).click()
  await expect(book.getByText('The Luton is off the road then. Book it anyway, if it will be back in time?')).toBeVisible()
  await book.getByRole('button', { name: 'Book anyway' }).click()
  await expect(phone.getByRole('status')).toHaveText('Up to date')
  const booked = harbour.locator('.van-line', { hasText: 'The Luton' })
  await expect(booked).toContainText('Load in')
  await expect(booked).toContainText('Dara Quinn driving')
  await expect(booked.locator('.van-state.bad')).toContainText('In for a new clutch')

  // Taken off again.
  await booked.getByRole('button', { name: 'Remove' }).click()
  await harbour.getByRole('button', { name: 'Take it off' }).click()
  await expect(phone.getByRole('status')).toHaveText('Up to date')
  await expect(harbour.locator('.van-line', { hasText: 'The Luton' })).toHaveCount(0)
})

test("the planner's Vans rows show one van on two jobs, and the call sheet says who's driving", async ({ browser }) => {
  // Proves: Vans is a third set of rows; a van on two confirmed jobs on one day is a clash to sort out; the job's day names the van and its driver; the call sheet lists it.
  const phone = await (await browser.newContext({ viewport: phoneSize })).newPage()
  await ready(phone, '#jobs')
  await phone.getByRole('navigation', { name: 'Jobs pages' }).getByRole('link', { name: 'Week' }).click()
  // A week on from today is always next week: the festival's load out and the summit's last day.
  await phone.getByRole('link', { name: 'Next week' }).click()
  await phone.getByRole('group', { name: 'Rows' }).getByRole('button', { name: 'Vans' }).click()
  await expect(phone).toHaveURL(/\/vans$/)
  await expect(phone.getByRole('rowheader', { name: /Big Van/ })).toBeVisible()
  await expect(phone.getByRole('rowheader', { name: /The Luton/ })).toBeVisible()
  const sort = phone.locator('.card', { has: phone.getByRole('heading', { name: 'To sort out' }) })
  const clash = sort.locator('.problem', { hasText: 'Big Van' })
  await expect(clash).toContainText('Clash')
  await expect(clash).toContainText(/On Brightwater Tech Summit and Harbour Lights Festival/)
  await expect(phone.locator('tr', { has: phone.getByRole('rowheader', { name: /Big Van/ }) }).locator('td.clash')).toHaveCount(1)

  // By job, the festival's day says which van goes and who drives it.
  await phone.getByRole('group', { name: 'Rows' }).getByRole('button', { name: 'Jobs' }).click()
  await expect(phone.locator('tr', { has: phone.getByRole('rowheader', { name: /Harbour Lights Festival/ }) })).toContainText('Vehicles: Big Van (Cian)')

  // The load in's call sheet names the van and its driver for everyone on it.
  await openJob(phone, 'Harbour Lights Festival')
  const loadIn = phone.getByRole('article', { name: 'Load in' })
  await loadIn.locator('summary').click()
  await loadIn.getByRole('link', { name: 'Call sheet' }).click()
  const sheetVans = phone.getByRole('region', { name: 'Vehicles' })
  await expect(sheetVans).toContainText('Big Van')
  await expect(sheetVans).toContainText('Cian Murphy driving')
})
