import { expect, test, type Page } from '@playwright/test'

/**
 * Stock end to end (ADR 0013), at phone size: a product counted at a new
 * place and then labelled one by one, with a typed number and with the next
 * free one; a case found by its number, an item put in it and cables
 * counted in it; the place showing it all; a new label and a retirement.
 * An item labelled with no signal gets its number once the signal is back.
 * A where that matches no place asks before making one, and a product
 * added by mistake is hidden with its items (audit finding 19). The test
 * server is shared with the other browser tests, so every name and number
 * here is this run's own. To refresh the blueprint screenshots, run this
 * file on its own with SHOTS=1: the names are then plain.
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

/** Every product and place on the Stock tab, past the first five of each it shows (audit finding 16), so one missing from either is missing. */
async function showAll(page: Page) {
  await expect(page.getByRole('region', { name: 'Stock', exact: true })).toBeVisible()
  for (const what of ['products', 'places']) {
    const all = page.getByRole('button', { name: new RegExp(`^Show all \\d+ ${what}$`) })
    if (await all.count()) await all.click()
  }
}

async function newProduct(page: Page, name: string, how: 'numbered' | 'counted' | 'case') {
  await page.goto('/#stock')
  await page.getByRole('button', { name: 'Add product' }).click()
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

  // Six speakers counted at a new place before they have labels: a slip of the thumb is asked about first.
  const count = part(page, 'Add a count')
  await count.getByLabel('Counted at').fill(`${bay}3`)
  await count.getByLabel('How many').fill('6')
  await count.getByRole('button', { name: 'Save count' }).click()
  await expect(count.getByRole('group', { name: `Make a new place called “${bay}3”? It joins the places on the Stock tab.` })).toBeVisible()
  await expect(count.getByLabel('Counted at')).toBeDisabled()
  await count.getByRole('button', { name: 'Go back' }).click()
  await expect(count.getByLabel('Counted at')).toHaveValue(`${bay}3`)
  await count.getByLabel('Counted at').fill(bay)
  await count.getByRole('button', { name: 'Save count' }).click()
  await count.getByRole('button', { name: 'Make the place' }).click()
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
  await expect(add.locator('.added')).toHaveText(`Added ${sh(first + 1)}.`)
  await expect(notLabelled.locator('.count', { hasText: bay })).toContainText('4')
  const items = page.getByRole('region', { name: 'Items' })
  await expect(items.locator('.item-row')).toHaveText([new RegExp(`^${sh(first)}${bay}`), new RegExp(`^${sh(first + 1)}${bay}`)])
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
  await expect(inIt).toContainText('Nothing here yet.')
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
  await expect(here.locator('.group', { hasText: speaker }).getByRole('link', { name: sh(first + 1) })).toBeVisible()
  await expect(here.locator('.count', { hasText: speaker })).toContainText('4')
  await top(page)
  await page.screenshot(shot('stock-place'))

  // A worn label replaced: the old number stays with it, and finds it.
  await here.getByRole('link', { name: sh(first + 1) }).click()
  await page.getByRole('button', { name: 'New label' }).click()
  await page.getByLabel('New number').fill(sh(first))
  await page.getByRole('button', { name: 'Save new label' }).click()
  await expect(page.locator('.alert')).toHaveText(`${sh(first)} is already in use (${speaker}).`)
  await page.getByLabel('New number').fill('')
  await page.getByRole('button', { name: 'Give it the next free number' }).click()
  await page.getByRole('group').getByRole('button', { name: 'Give it the next free number' }).click()
  await expect(page.getByRole('heading', { level: 1, name: sh(first + 51) })).toBeVisible()
  await expect(page.locator('.facts')).toContainText(`Labels before${sh(first + 1)}`)
  await page.goto('/#stock')
  await page.getByLabel('Find').fill(sh(first + 1))
  await expect(page.getByRole('list', { name: 'Items found' })).toContainText(`${sh(first + 51)} ${speaker}`)
  await expect(page.getByRole('list', { name: 'Items found' })).toContainText(`Had ${sh(first + 1)} before`)

  // Retired as lost, then found again.
  await page.getByLabel('Find').press('Enter')
  await page.getByRole('button', { name: 'Retire' }).click()
  await page.getByRole('radio', { name: 'Lost' }).check()
  await page.getByLabel('Note').fill('Not back from the Point')
  await page.getByRole('button', { name: `Retire ${sh(first + 51)}` }).click()
  await expect(page.locator('.title .pill')).toHaveText('Retired')
  await expect(page.locator('.facts')).toContainText('RetiredLost: Not back from the Point')
  await page.getByRole('button', { name: 'Bring back' }).click()
  await expect(page.locator('.title .pill')).toHaveCount(0)
  await expect(page.locator('.facts')).toContainText('WhereNot placed yet')
  await expect(page.locator('.conn')).toHaveText('Up to date')

  await ready(page)
  // The catalogue shows its first five, with the rest behind "Show all" (audit finding 16).
  const all = page.getByRole('button', { name: /^Show all \d+ products$/ })
  if (await all.count()) await all.click()
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
  await add.getByRole('button', { name: 'Make the place' }).click()
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

test('a product added by mistake is hidden with its items and counts, and its labels say so', async ({ browser }) => {
  // Something made by mistake can be taken back, asked about first, with nothing of it left in a list or a count.
  const id = tag()
  const light = named('Martin MAC Aura', id)
  const bay = named('Bay L1', id)
  const page = await (await browser.newContext({ viewport: phoneSize })).newPage()
  await ready(page)
  await newProduct(page, light, 'numbered')

  // One labelled, two counted, so it can't simply be removed.
  const add = part(page, 'Add an item')
  await add.getByLabel("Where it's kept").fill(bay)
  await add.getByRole('button', { name: 'Add item' }).click()
  await add.getByRole('button', { name: 'Make the place' }).click()
  await expect(add.locator('.added')).toHaveText(/^Added SH-\d{6}\.$/)
  // The question answered, the number field is ready for the next label.
  await expect(add.getByLabel('Number', { exact: true })).toBeFocused()
  const number = (await add.locator('.added').textContent())!.slice(6, -1)
  const count = part(page, 'Add a count')
  await count.getByLabel('Counted at').fill(bay)
  await count.getByLabel('How many').fill('2')
  await count.getByRole('button', { name: 'Save count' }).click()
  await expect(page.locator('.facts')).toContainText('3: 1 labelled, 2 not yet')
  await expect(page.getByRole('button', { name: 'Remove product' })).toHaveCount(0)

  // Asked first, with what goes; then it's gone from the list, the place and the search, but its label still answers.
  await page.getByRole('button', { name: 'Added by mistake' }).click()
  await expect(
    page.getByRole('group', {
      name: `Mark ${light} as added by mistake? It leaves every list and count, with its 1 item and 2 counted, and is kept only in the history. This can't be undone.`,
    })
  ).toBeVisible()
  await page.getByRole('button', { name: 'It was a mistake' }).click()
  await expect(page).toHaveURL(/#stock$/)
  await showAll(page)
  await expect(page.locator('.job-row', { hasText: light })).toHaveCount(0)
  await expect(page.locator('.conn')).toHaveText('Up to date')
  await expect(page.locator('.job-row', { hasText: light })).toHaveCount(0)
  await expect(page.locator('.job-row', { hasText: bay })).toContainText('Nothing here yet')
  await page.getByLabel('Find').fill(number)
  await expect(page.getByRole('list', { name: 'Items found' }).locator('.item-row')).toHaveText(new RegExp(`^${number} ${light}Added by mistake`))
  await page.locator('.job-row', { hasText: bay }).click()
  const put = part(page, 'Put an item here')
  await put.getByLabel('Its number').fill(number)
  await put.getByRole('button', { name: 'Put it here' }).click()
  await expect(put.locator('.alert')).toHaveText(`${number} (${light}) was added by mistake.`)

  // A product whose only item was retired as added by mistake still has that item kept, so it's marked rather than removed, as the server has it.
  const spot = named('Martin MAC Viper', id)
  await newProduct(page, spot, 'numbered')
  await add.getByLabel("Where it's kept").fill(bay)
  await add.getByRole('button', { name: 'Add item' }).click()
  await expect(add.locator('.added')).toHaveText(/^Added SH-\d{6}\.$/)
  await add.locator('.added a').click()
  await page.getByRole('button', { name: 'Retire' }).click()
  await page.getByRole('radio', { name: 'Added by mistake' }).check()
  await page.getByRole('button', { name: /^Retire SH-/ }).click()
  await expect(page.locator('.facts')).toContainText('RetiredAdded by mistake')
  await page.getByRole('link', { name: `‹ ${spot}` }).click()
  await expect(page.getByRole('button', { name: 'Remove product' })).toHaveCount(0)
  await page.getByRole('button', { name: 'Added by mistake' }).click()
  await page.getByRole('button', { name: 'It was a mistake' }).click()
  await expect(page).toHaveURL(/#stock$/)
  await expect(page.locator('.conn')).toHaveText('Up to date')
  await showAll(page)
  await expect(page.locator('.job-row', { hasText: spot })).toHaveCount(0)
  await expect(page.getByRole('button', { name: '1 not done' })).toHaveCount(0)
})
