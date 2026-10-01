import { expect, test, type Page } from '@playwright/test'

/**
 * Faults and missing kit end to end (ADR 0018), at phone size: three
 * speakers and 20 cables go out to a job. With no signal, one speaker comes
 * back damaged and is reported from the scan, another is marked missing,
 * and of the cables 17 come back, 3 are missing and 2 of those back are
 * cut. Back in signal, the missing speaker turns up and is scanned: it's
 * marked found. The Stock tab lists what's left to sort out, the job's
 * kit is short by what can't go out, the speaker is fixed on its page, and
 * the missing cables are written off, which takes them off the count. The
 * test server is shared with the other browser tests, so names are this
 * run's own and numbers are read off the screen. To refresh the blueprint
 * screenshots, run this file on its own with SHOTS=1.
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

async function ready(page: Page, hash = '#stock') {
  await page.goto(`/${hash}`)
  await expect(page.locator('.conn')).toHaveText('Up to date')
}

async function newProduct(page: Page, name: string, counted?: number) {
  await page.goto('/#stock')
  const form = page.locator('form').filter({ has: page.getByRole('button', { name: 'Add product' }) })
  await form.getByLabel('Name').fill(name)
  if (counted) await form.getByRole('radio', { name: /^Counted/ }).check()
  await form.getByRole('button', { name: 'Add product' }).click()
  await expect(page.getByRole('heading', { level: 1, name })).toBeVisible()
  if (!counted) return
  const add = part(page, 'Add a count')
  await add.getByLabel('Counted at').fill('Warehouse')
  await add.getByLabel('How many').fill(String(counted))
  await add.getByRole('button', { name: 'Save count' }).click()
  await expect(page.locator('.count', { hasText: 'Warehouse' })).toContainText(String(counted))
}

/** Items of the product whose page is open, kept at `where`, with the numbers the server gives them. */
async function newItems(page: Page, where: string, count: number) {
  const add = part(page, 'Add an item')
  const numbers: string[] = []
  for (let i = 0; i < count; i++) {
    await add.getByLabel("Where it's kept").fill(where)
    await add.getByRole('button', { name: 'Add item' }).click()
    if (numbers.length) await expect(add.locator('.added')).not.toHaveText(`Added ${numbers.at(-1)}.`)
    await expect(add.locator('.added')).toHaveText(/^Added SH-\d{6}\.$/)
    const number = (await add.locator('.added').textContent())!.slice(6, -1)
    expect(numbers).not.toContain(number)
    numbers.push(number)
  }
  await expect(page.locator('.conn')).toHaveText('Up to date')
  return numbers
}

test('damaged and missing kit, reported on return, then fixed, found and written off', async ({ browser }) => {
  const id = tag()
  const speaker = named('d&b Y10P', id)
  const cable = named('XLR 10 m', id)
  const bay = named('Bay A3', id)
  const job = named('Nissan launch', id)
  const context = await browser.newContext({ viewport: phoneSize })
  const page = await context.newPage()
  await ready(page)

  await newProduct(page, speaker)
  const speakers = await newItems(page, bay, 3)
  await newProduct(page, cable, 20)

  // A confirmed job two days out, needing the three speakers and the 20 cables.
  await page.goto('/#jobs')
  const form = page.locator('form').filter({ has: page.getByRole('button', { name: 'Add job' }) })
  await form.getByLabel('Job').fill(job)
  await form.getByLabel('Status').selectOption({ label: 'Confirmed' })
  await form.getByLabel('Phase 1', { exact: true }).fill('Show')
  await form.getByLabel('Phase 1 from').fill(fromToday(2))
  await form.getByLabel('Phase 1 to').fill(fromToday(3))
  await form.getByRole('button', { name: 'Add job' }).click()
  await expect(page.getByRole('heading', { level: 1, name: job })).toBeVisible()
  for (const [product, qty] of [
    [speaker, 3],
    [cable, 20],
  ] as const) {
    const add = page.getByRole('form', { name: 'Add kit' })
    await add.getByLabel('Product').fill(product)
    await add.getByLabel('How many').fill(String(qty))
    await add.getByRole('button', { name: 'Add to kit' }).click()
  }
  const kit = page.getByRole('region', { name: 'Kit' })
  await expect(kit.locator('.pick-link')).toContainText('23 to go out')
  await kit.getByRole('link', { name: 'Pick list' }).click()

  // Out: the speakers by a scanner that types, the cables counted.
  const typeIn = async (number: string) => {
    await page.getByLabel('Number or serial').fill(number)
    await page.getByLabel('Number or serial').press('Enter')
  }
  const said = page.getByRole('status', { name: 'Last scan' })
  for (const [i, n] of speakers.entries()) {
    await typeIn(n)
    await expect(said).toHaveText(`${n} ${speaker}: ${i + 1} of 3 out.`)
  }
  const speakerRow = page.getByRole('article', { name: speaker })
  const cableRow = page.getByRole('article', { name: cable })
  const countOut = cableRow.getByRole('form', { name: `Count out ${cable}` })
  await countOut.getByLabel('How many').fill('20')
  await countOut.getByRole('button', { name: 'Out' }).click()
  await expect(page.locator('.pick-total')).toHaveText('23 of 23 out')
  await expect(page.locator('.conn')).toHaveText('Up to date')

  // Back, with no signal.
  await context.setOffline(true)
  await page.getByRole('button', { name: 'Coming back' }).click()
  await typeIn(speakers[0]!)
  await expect(said).toHaveText(`${speakers[0]} ${speaker} back: 1 of 3 back.`)
  // It came back with a blown driver.
  await page.getByRole('button', { name: `Report damage to ${speakers[0]}` }).click()
  const damage = page.getByRole('form', { name: `Report ${speakers[0]} damaged` })
  await damage.getByRole('button', { name: 'Report damage' }).click()
  await expect(damage.locator('.alert')).toHaveText("Say what's wrong, for whoever repairs it.")
  await damage.getByLabel("What's wrong").fill('Blown driver')
  await damage.getByRole('button', { name: 'Report damage' }).click()
  await expect(damage).toHaveCount(0)
  // The second speaker didn't come back.
  await speakerRow
    .getByRole('list', { name: 'Still out' })
    .locator('li', { hasText: speakers[1]! })
    .getByRole('button', { name: 'Missing' })
    .click()
  await expect(speakerRow.locator('.count')).toHaveText('1 still out, 1 missing')
  await expect(speakerRow.getByRole('list', { name: 'Missing' })).toHaveText(speakers[1]!)
  // 17 cables back, 3 missing, and 2 of those back are cut.
  const countBack = cableRow.getByRole('form', { name: `Count back ${cable}` })
  await countBack.getByLabel('How many').fill('17')
  await countBack.getByRole('button', { name: 'Back' }).click()
  await expect(cableRow.locator('.count')).toHaveText('3 still out')
  await countBack.getByLabel('How many').fill('3')
  await countBack.getByRole('button', { name: 'Missing' }).click()
  await expect(cableRow.locator('.count')).toHaveText('17 back, 3 missing')
  await cableRow.getByRole('button', { name: `Report damage to counted ${cable}` }).click()
  const cut = page.getByRole('form', { name: `Report ${cable} damaged` })
  await cut.getByLabel('How many').fill('2')
  await cut.getByLabel("What's wrong").fill('Cut near the plug')
  await cut.getByRole('button', { name: 'Report damage' }).click()
  await expect(cut).toHaveCount(0)
  await expect(page.locator('.pick-total')).toHaveText('18 back, 1 still out, 4 missing')
  await expect(page.locator('.conn')).toContainText('No signal')
  await page.screenshot(shot('faults-back'))

  // Signal back; the missing speaker turns up in the van and is scanned: found.
  await context.setOffline(false)
  await expect(page.locator('.conn')).toHaveText('Up to date')
  await typeIn(speakers[1]!)
  await expect(said).toHaveText(`${speakers[1]} ${speaker} isn't out, so there's nothing to bring back. It was reported missing, so it's marked found.`)
  await expect(speakerRow.locator('.count')).toHaveText('1 still out')
  await typeIn(speakers[2]!)
  await expect(speakerRow.locator('.count')).toHaveText('All 3 back')
  await expect(page.locator('.conn')).toHaveText('Up to date')

  // The job's kit is short by what can't go out.
  await page.goto('/#jobs')
  await page.getByRole('link', { name: job }).first().click()
  await expect(page.getByRole('region', { name: 'Kit' })).toContainText('Short 1')
  await expect(page.getByRole('region', { name: 'Kit' })).toContainText('2 owned and fit to go out (1 damaged, missing or due a test)')

  // The Stock tab's repair list.
  await page.goto('/#stock')
  const repairs = page.getByRole('region', { name: 'Faults and repairs' })
  await expect(repairs.getByRole('listitem', { name: `${speakers[0]} ${speaker}` })).toContainText("Damaged, can't go out")
  await expect(repairs.getByRole('listitem', { name: `2 × ${cable}` })).toContainText('Cut near the plug')
  await expect(repairs.getByRole('listitem', { name: `3 × ${cable}` })).toContainText(`Missing · From ${job}`)
  await expect(repairs.getByRole('listitem', { name: `${speakers[1]} ${speaker}` })).toHaveCount(0)

  // Fixed on the bench.
  await repairs.getByRole('link', { name: `${speakers[0]} ${speaker}` }).click()
  await expect(page.locator('.facts')).toContainText("FaultDamaged, can't go out: Blown driver")
  const faults = page.getByRole('region', { name: 'Faults' })
  await faults.getByRole('button', { name: 'Repair notes' }).click()
  await faults.getByLabel('Repair notes').fill('New driver fitted, €180')
  await faults.getByRole('button', { name: 'Save' }).click()
  await expect(faults.locator('.repair')).toHaveText('Repair notes: New driver fitted, €180')
  await expect(page.locator('.conn')).toHaveText('Up to date')
  await page.screenshot(shot('faults-item'))
  await faults.getByRole('button', { name: 'Fixed' }).click()
  await expect(page.locator('.facts')).not.toContainText('Fault')
  await expect(faults.locator('summary')).toHaveText('One before')

  // The missing cables written off: off the count.
  await page.goto('/#stock')
  await repairs.getByRole('link', { name: `3 × ${cable}` }).click()
  const cableFaults = page.getByRole('region', { name: 'Faults' })
  const cableFault = cableFaults.getByRole('listitem', { name: `3 × ${cable}` })
  await cableFault.getByRole('button', { name: 'Write off' }).click()
  // Asked in the card first, with what will happen.
  await expect(cableFault.getByRole('group', { name: `Write off 3 × ${cable}? They're taken off the count, and it's kept in the history.` })).toBeVisible()
  await cableFault.getByRole('button', { name: 'Write it off' }).click()
  await expect(page.locator('.facts')).toContainText("In all17 2 can't go out")
  await expect(page.locator('.conn')).toHaveText('Up to date')
})
