import { expect, test, type Page } from '@playwright/test'

/**
 * Stock end to end (ADR 0013), at phone size: a product counted at a new
 * place and then labelled one by one, with a typed number and with the next
 * free one; a case found by its number, an item put in it and cables
 * counted in it; the place showing it all; a new label and a retirement.
 * An item labelled with no signal gets its number once the signal is back.
 * The test server is shared with the other browser tests, so every name and
 * number here is this run's own. To refresh the blueprint screenshots, run
 * this file on its own with SHOTS=1: the names are then plain.
 */

const shot = (name: string) => (process.env.SHOTS ? { path: `docs/hub/img/${name}.png` } : undefined)
const phoneSize = { width: 390, height: 844 }
const tag = () => Math.random().toString(36).slice(2, 8)
const named = (name: string, id: string) => (process.env.SHOTS ? name : `${name} ${id}`)
const sh = (n: number) => `SH-${String(n).padStart(6, '0')}`
/** From the top of the page, for a screenshot. */
const top = (page: Page) => page.evaluate(() => scrollTo(0, 0))

async function ready(page: Page, hash = '#stock') {
  await page.goto(`/${hash}`)
  await expect(page.locator('.conn')).toHaveText('Up to date')
}

const part = (page: Page, heading: string) => page.locator('form').filter({ has: page.getByRole('heading', { name: heading, exact: true }) })

async function newProduct(page: Page, name: string, how: 'numbered' | 'counted' | 'case') {
  await page.goto('/#stock')
  const form = page.locator('form').filter({ has: page.getByRole('button', { name: 'Add product' }) })
  await form.getByLabel('Name').fill(name)
  if (how === 'counted') await form.getByRole('radio', { name: /^Counted/ }).check()
  if (how === 'case') await form.getByRole('checkbox', { name: /^Holds other kit/ }).check()
  await form.getByRole('button', { name: 'Add product' }).click()
  await expect(page.getByRole('heading', { level: 1, name })).toBeVisible()
}

test('counted, labelled, put in a case, found by number, and kept at a place', async ({ browser }) => {
  const id = tag()
  const speaker = named('d&b Y10P', id)
  const rack = named('Amp rack', id)
  const cable = named('XLR 10 m', id)
  const bay = named('Bay A3', id)
  // Numbers are never used twice, so this run has its own.
  const first = process.env.SHOTS ? 101 : 100_000 + Math.floor(Math.random() * 800_000)
  const rackNumber = sh(first + 50)
  const page = await (await browser.newContext({ viewport: phoneSize })).newPage()
  await ready(page)

  await newProduct(page, cable, 'counted')
  await newProduct(page, rack, 'case')
  await newProduct(page, speaker, 'numbered')

  // Six speakers counted at a new place before they have labels.
  const count = part(page, 'Add a count')
  await count.getByLabel('Counted at').fill(bay)
  await count.getByLabel('How many').fill('6')
  await count.getByRole('button', { name: 'Save count' }).click()
  const notLabelled = page.getByRole('region', { name: 'Not labelled yet' })
  await expect(notLabelled.locator('.count', { hasText: bay })).toContainText('6')

  // Labelled one by one: the number from the label, then the next free one. Each comes off the count.
  const add = part(page, 'Add an item')
  await add.getByLabel("Where it's kept").fill(bay)
  await expect(add.getByRole('checkbox', { name: /One of the 6 counted at/ })).toBeChecked()
  await add.getByLabel('Number', { exact: true }).fill(`sh ${first}`)
  await add.getByRole('button', { name: 'Add item' }).click()
  await expect(add.locator('.added')).toHaveText(`Added ${sh(first)}.`)
  await expect(notLabelled.locator('.count', { hasText: bay })).toContainText('5')
  await expect(add.getByLabel('Number', { exact: true })).toBeFocused()
  await add.getByRole('button', { name: 'Add item' }).click()
  // The next free number: past the one typed, and past any another test takes meanwhile on the shared server.
  await expect(add.locator('.added')).not.toHaveText(`Added ${sh(first)}.`)
  await expect(add.locator('.added')).toHaveText(/^Added SH-\d{6}\.$/)
  const second = (await add.locator('.added').textContent())!.slice(6, 15)
  expect(Number(second.slice(3))).toBeGreaterThan(first)
  await expect(notLabelled.locator('.count', { hasText: bay })).toContainText('4')
  const items = page.getByRole('region', { name: 'Items' })
  await expect(items.locator('.item-row')).toHaveText([new RegExp(`^${sh(first)}${bay}`), new RegExp(`^${second}${bay}`)])
  await expect(page.locator('.facts')).toContainText('6: 2 labelled, 4 not yet')
  await expect(page.locator('.conn')).toHaveText('Up to date')
  await top(page)
  await page.screenshot(shot('stock-product'))

  // The rack gets its label and a place.
  await page.goto('/#stock')
  await page.locator('.job-row', { hasText: rack }).click()
  const addRack = part(page, 'Add an item')
  await addRack.getByLabel('Number', { exact: true }).fill(rackNumber)
  await addRack.getByLabel("Where it's kept").fill(bay)
  await addRack.getByRole('button', { name: 'Add item' }).click()
  await expect(addRack.locator('.added')).toHaveText(`Added ${rackNumber}.`)

  // Scanned or typed: the number and Enter opens the item.
  await page.goto('/#stock')
  await page.getByLabel('Find').fill(rackNumber.toLowerCase())
  await page.getByLabel('Find').press('Enter')
  await expect(page.getByRole('heading', { level: 1, name: rackNumber })).toBeVisible()
  await expect(page.locator('.facts')).toContainText(`Where${bay}`)

  // A speaker goes in the rack, and eight cables are counted in it.
  const inIt = page.getByRole('region', { name: 'In it' })
  await expect(inIt).toContainText('Nothing yet.')
  const put = part(page, 'Put an item in')
  await put.getByLabel('Its number').fill(sh(first))
  await put.getByRole('button', { name: `Put it in ${rackNumber}` }).click()
  await expect(inIt.locator('.item-row')).toHaveText(new RegExp(`^${sh(first)} ${speaker}`))
  const countIn = part(page, "Count what's in it")
  await countIn.getByLabel('Product').fill(cable)
  await countIn.getByLabel('How many').fill('8')
  await countIn.getByRole('button', { name: 'Save count' }).click()
  await expect(inIt.locator('.count', { hasText: cable })).toContainText('8')
  await expect(page.locator('.conn')).toHaveText('Up to date')
  await top(page)
  await page.screenshot(shot('stock-item'))
  // Nothing goes inside itself.
  await put.getByLabel('Its number').fill(rackNumber)
  await put.getByRole('button', { name: `Put it in ${rackNumber}` }).click()
  await expect(put.locator('.alert')).toHaveText(`${rackNumber} is that case itself, and nothing can go inside itself.`)

  // The speaker in the rack is at the bay too.
  await inIt.locator('.item-row', { hasText: sh(first) }).click()
  await expect(page.locator('.facts')).toContainText(`WhereIn ${rackNumber} (${rack}), ${bay}`)

  // The place: the rack and what's in it, the other speaker, and the four not labelled yet.
  await page.locator('.facts').getByRole('link', { name: bay }).click()
  await expect(page.getByRole('heading', { level: 1, name: bay })).toBeVisible()
  await expect(page.locator('.facts')).toHaveText('Items3Counted12')
  const here = page.getByRole('region', { name: 'Here' })
  await expect(here.locator('.item-row', { hasText: rackNumber })).toContainText('1 item and 8 counted in it')
  await expect(here.locator('.group', { hasText: speaker }).getByRole('link', { name: second })).toBeVisible()
  await expect(here.locator('.count', { hasText: speaker })).toContainText('4')
  await top(page)
  await page.screenshot(shot('stock-place'))

  // A worn label replaced: the old number stays with it, and finds it.
  await here.getByRole('link', { name: second }).click()
  await page.getByRole('button', { name: 'New label' }).click()
  await page.getByLabel('New number').fill(sh(first))
  await page.getByRole('button', { name: 'Save new label' }).click()
  await expect(page.locator('.alert')).toHaveText(`${sh(first)} is already in use (${speaker}).`)
  await page.getByLabel('New number').fill('')
  await page.getByRole('button', { name: 'Save new label' }).click()
  // The next free number: past every number this test used, and past any another test takes meanwhile on the shared server.
  const heading = page.getByRole('heading', { level: 1 })
  await expect(heading).not.toHaveText(second)
  await expect(heading).toHaveText(/^SH-\d{6}$/)
  const relabelled = (await heading.textContent())!
  expect(Number(relabelled.slice(3))).toBeGreaterThan(Math.max(first + 50, Number(second.slice(3))))
  await expect(page.locator('.facts')).toContainText(`Labels before${second}`)
  await page.goto('/#stock')
  await page.getByLabel('Find').fill(second)
  await expect(page.getByRole('list', { name: 'Items found' })).toContainText(`${relabelled} ${speaker}`)
  await expect(page.getByRole('list', { name: 'Items found' })).toContainText(`Had ${second} before`)

  // Retired as lost, then found again.
  await page.getByLabel('Find').press('Enter')
  await page.getByRole('button', { name: 'Retire' }).click()
  await page.getByRole('radio', { name: 'Lost' }).check()
  await page.getByLabel('Note').fill('Not back from the Point')
  await page.getByRole('button', { name: `Retire ${relabelled}` }).click()
  await expect(page.locator('.title .pill')).toHaveText('Retired')
  await expect(page.locator('.facts')).toContainText('RetiredLost: Not back from the Point')
  await page.getByRole('button', { name: 'Bring back' }).click()
  await expect(page.locator('.title .pill')).toHaveCount(0)
  await expect(page.locator('.facts')).toContainText('WhereNot placed yet')
  await expect(page.locator('.conn')).toHaveText('Up to date')

  await page.goto('/#stock')
  await expect(page.locator('.job-row', { hasText: speaker })).toContainText('2 items · 4 not labelled yet')
  await expect(page.locator('.job-row', { hasText: cable })).toContainText('8 counted')
  await page.screenshot(shot('stock-list'))
})

test('an item labelled with no signal gets its number when the signal is back', async ({ browser }) => {
  const id = tag()
  const mic = named('Shure SM58', id)
  const cabinet = named('Mic cabinet', id)
  const context = await browser.newContext({ viewport: phoneSize })
  const phone = await context.newPage()
  await ready(phone)
  await newProduct(phone, mic, 'numbered')
  await expect(phone.locator('.conn')).toHaveText('Up to date')

  await context.setOffline(true)
  const add = part(phone, 'Add an item')
  await add.getByLabel("Where it's kept").fill(cabinet)
  await add.getByRole('button', { name: 'Add item' }).click()
  await expect(add.locator('.added')).toHaveText('Added. It gets the next free number when it syncs.')
  const row = phone.getByRole('region', { name: 'Items' }).locator('.item-row')
  await expect(row).toContainText('Number when synced')
  await expect(row).toContainText('Waiting to sync')
  await expect(phone.locator('.conn')).toContainText('No signal')

  await context.setOffline(false)
  await phone.evaluate(() => dispatchEvent(new Event('online')))
  await expect(phone.locator('.conn')).toHaveText('Up to date', { timeout: 20_000 })
  await expect(row).toHaveText(new RegExp(`^SH-\\d{6}${cabinet}$`))
  const number = (await row.locator('b').textContent()) ?? ''
  await expect(add.locator('.added')).toHaveText(`Added ${number}.`)
})
