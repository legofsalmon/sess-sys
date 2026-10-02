import { expect, test, type Locator, type Page } from '@playwright/test'
import { createRequire } from 'node:module'

/**
 * Labels end to end (ADR 0015), at phone size: numbers set aside for a run
 * of labels, the run printed here in each layout (one label to a page on a
 * label printer, 65 to an A4 sheet) and downloaded as a spreadsheet for a
 * label maker, and its labels put on items by scanning them in the Stock
 * search, where the product and place stay for the next label. The next
 * free number skips the run, and an item's own label prints from its page
 * with its product's name. Every QR code is read back by a decoder. Numbers
 * set aside with no signal come once the signal is back. The test server is
 * shared with the other browser tests, so the numbers are read off the
 * screen rather than assumed. Setting numbers aside asks first with the
 * count, and a run none of whose labels is on an item yet can be cancelled,
 * its numbers never given out again (audit finding 19). To refresh the
 * blueprint screenshots, run this file on its own with SHOTS=1: the names
 * are then plain.
 */

const shot = (name: string) => (process.env.SHOTS ? { path: `docs/hub/img/${name}.png` } : undefined)
const phoneSize = { width: 390, height: 844 }
const tag = () => Math.random().toString(36).slice(2, 8)
const named = (name: string, id: string) => (process.env.SHOTS ? name : `${name} ${id}`)
const sh = (n: number) => `SH-${String(n).padStart(6, '0')}`
const decoder = createRequire(import.meta.url).resolve('jsqr/dist/jsQR.js')

/** From the top of the page, for a screenshot. */
const top = (page: Page) => page.evaluate(() => scrollTo(0, 0))
/** Scrolled so that an element sits right under the sticky header, for a screenshot. */
const startAt = (el: Locator) =>
  el.evaluate((e) => scrollBy(0, e.getBoundingClientRect().top - document.querySelector('.top')!.getBoundingClientRect().bottom + 12))

async function ready(page: Page, hash = '#stock') {
  await page.goto(`/${hash}`)
  await expect(page.locator('.conn')).toHaveText('Up to date')
}

/** A numbered product with some counted at a place, not labelled yet. */
async function newProduct(page: Page, name: string, at: string, count: number) {
  await page.goto('/#stock')
  await page.getByRole('button', { name: 'Add product' }).click()
  const form = page.locator('form').filter({ has: page.getByRole('button', { name: 'Add product' }) })
  await form.getByLabel('Name').fill(name)
  await form.getByRole('button', { name: 'Add product' }).click()
  await expect(page.getByRole('heading', { level: 1, name })).toBeVisible()
  const add = page.locator('form').filter({ has: page.getByRole('heading', { name: 'Add a count', exact: true }) })
  await add.getByLabel('Counted at').fill(at)
  await add.getByLabel('How many').fill(String(count))
  await add.getByRole('button', { name: 'Save count' }).click()
  await add.getByRole('button', { name: 'Make the place' }).click()
  await expect(page.locator('.count', { hasText: at })).toContainText(String(count))
}

/** What a label's QR code says, read from a picture of it as a camera would. */
async function readQr(label: Locator): Promise<string | undefined> {
  await label.page().addScriptTag({ path: decoder })
  return label.locator('svg.qr').evaluate(async (svg) => {
    const img = new Image()
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(new XMLSerializer().serializeToString(svg))}`
    await img.decode()
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = 264
    const ctx = canvas.getContext('2d')!
    ctx.fillStyle = '#fff'
    ctx.fillRect(0, 0, 264, 264)
    ctx.drawImage(img, 32, 32, 200, 200)
    const { data, width, height } = ctx.getImageData(0, 0, 264, 264)
    const jsQR = (window as unknown as { jsQR: (d: Uint8ClampedArray, w: number, h: number) => { data: string } | null }).jsQR
    return jsQR(data, width, height)?.data
  })
}

/** The number fits on the label, whichever layout. */
async function fits(label: Locator) {
  const [scroll, client] = await label.locator('b').evaluate((b) => [b.scrollWidth, b.clientWidth])
  expect(scroll).toBeLessThanOrEqual(client!)
}

/** The printed pages, from the page as it prints: how many, and each one's size in millimetres. */
async function printed(page: Page) {
  await page.emulateMedia({ media: 'print' })
  const pdf = (await page.pdf({ preferCSSPageSize: true })).toString('latin1')
  await page.emulateMedia({ media: 'screen' })
  const boxes = [...pdf.matchAll(/\/MediaBox\s*\[\s*0 0 ([\d.]+) ([\d.]+)\s*\]/g)].map((m) => [m[1], m[2]].map((pt) => Math.round((Number(pt) / 72) * 25.4)))
  return boxes
}

test('set aside, printed, sent to a label maker, and put on items by scanning', async ({ browser }) => {
  const id = tag()
  const speaker = named('d&b Y10P', id)
  const bay = named('Bay A3', id)
  const roll = named('Roll from Label World', id)
  const page = await (await browser.newContext({ viewport: phoneSize, acceptDownloads: true })).newPage()
  await page.addInitScript(() => {
    // The print dialog can't open here: count the times it's asked for instead.
    const w = window as unknown as { printed: number }
    w.printed = 0
    window.print = () => void w.printed++
  })
  await ready(page)
  await newProduct(page, speaker, bay, 3)

  // From the Stock tab to setting twelve numbers aside.
  await page.goto('/#stock')
  const card = page.getByRole('region', { name: 'Labels' })
  await card.getByRole('link', { name: 'Print labels' }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Labels' })).toBeVisible()
  const form = page.getByRole('form', { name: 'Set numbers aside' })
  await form.getByLabel('How many labels').fill('12')
  await form.getByLabel('What for').fill(roll)
  await form.getByRole('button', { name: 'Set numbers aside' }).click()
  // Asked first, with the count, so a slip of a zero isn't 120 labels.
  await expect(form.getByRole('group', { name: /^Reserve 12 numbers\?/ })).toBeVisible()
  await expect(form.getByLabel('How many labels')).toBeDisabled()
  await form.getByRole('button', { name: 'Not yet' }).click()
  await expect(form.getByLabel('How many labels')).toHaveValue('12')
  await form.getByRole('button', { name: 'Set numbers aside' }).click()
  await form.getByRole('button', { name: 'Reserve them' }).click()
  await expect(form.locator('.added')).toHaveText(/^Set aside SH-\d{6} to SH-\d{6}\.$/)
  const [firstText, lastText] = (await form.locator('.added a').textContent())!.split(' to ')
  const first = Number(firstText!.slice(3))
  expect(lastText).toBe(sh(first + 11))
  const list = page.getByRole('region', { name: 'Set aside' })
  await expect(list.locator('.job-row').first()).toContainText(`${sh(first)} to ${sh(first + 11)}${roll} · set aside today at`)
  await expect(list.locator('.job-row').first()).toContainText('0 of 12 on items')
  await expect(page.locator('.conn')).toHaveText('Up to date')
  await page.screenshot(shot('labels-list'))

  // The run: printed here, in each layout, every label reading back as its number.
  await form.locator('.added a').click()
  await expect(page.getByRole('heading', { level: 1, name: `${sh(first)} to ${sh(first + 11)}` })).toBeVisible()
  await expect(page.locator('.facts')).toContainText('On itemsNone yet')
  const print = page.getByRole('region', { name: 'Print here' })
  const preview = print.getByLabel('Preview').locator('.label')
  await expect(preview).toHaveCount(3)
  await expect(preview.locator('b')).toHaveText([sh(first), sh(first + 1), sh(first + 2)])
  for (const layout of ['Label printer, 25 × 25 mm', 'A4 sheets of 65, 38 × 21 mm', 'Label printer, 50 × 25 mm']) {
    await print.getByRole('radio', { name: layout }).check()
    await fits(preview.first())
    expect(await readQr(preview.nth(1))).toBe(sh(first + 1))
  }
  await startAt(print.locator('fieldset'))
  await page.screenshot(shot('labels-run'))

  // One label to a page on a label printer, in its size.
  await print.getByRole('button', { name: 'Print 12 labels' }).click()
  await expect.poll(() => page.evaluate(() => (window as unknown as { printed: number }).printed)).toBe(1)
  await expect(page.locator('.print-sheet .label')).toHaveCount(12)
  await expect(page.locator('.print-sheet .label b').last()).toHaveText(sh(first + 11))
  expect(await printed(page)).toEqual(Array(12).fill([50, 25]))
  await page.evaluate(() => dispatchEvent(new Event('afterprint')))
  await expect(page.locator('.print-sheet')).toHaveCount(0)

  // Part of the run, on one A4 sheet; the layout is kept for next time.
  await print.getByLabel('From').fill(`sh ${first + 2}`)
  await print.getByLabel('How many').fill('20')
  await expect(print.locator('.alert')).toHaveText(`Only 10 from ${sh(first + 2)} to ${sh(first + 11)}.`)
  await print.getByLabel('How many').fill('10')
  await print.getByRole('radio', { name: 'A4 sheets of 65, 38 × 21 mm' }).check()
  await print.getByRole('button', { name: 'Print 10 labels' }).click()
  await expect(page.locator('.print-sheet .label')).toHaveCount(10)
  await expect(page.locator('.print-sheet .label b').first()).toHaveText(sh(first + 2))
  expect(await printed(page)).toEqual([[210, 297]])
  await page.evaluate(() => dispatchEvent(new Event('afterprint')))
  await page.reload()
  await expect(page.getByRole('radio', { name: 'A4 sheets of 65, 38 × 21 mm' })).toBeChecked()

  // The whole run for a label maker, a row a label.
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('region', { name: 'For a label maker' }).getByRole('button', { name: 'Download the spreadsheet' }).click(),
  ])
  expect(download.suggestedFilename()).toBe(`session-hire-labels-${sh(first)}-to-${sh(first + 11)}.csv`)
  const csv = (await (await download.createReadStream()).toArray()).join('')
  const rows = csv.trim().split('\r\n')
  expect(rows).toHaveLength(13)
  expect(rows[0]).toBe('Number,QR code')
  expect(rows[1]).toBe(`${sh(first)},${sh(first)}`)
  expect(rows[12]).toBe(`${sh(first + 11)},${sh(first + 11)}`)

  // Stuck on and scanned: the scanner types the number and Enter, then which product it's on, and where.
  await page.goto('/#stock')
  const find = page.getByLabel('Find')
  await find.fill(`sh${first + 4}`)
  await find.press('Enter')
  const claim = page.getByRole('form', { name: `Put ${sh(first + 4)} on an item` })
  await expect(claim.getByRole('heading')).toHaveText(`${sh(first + 4)} isn't on anything yet`)
  await expect(claim).toContainText(`It's one of the labels set aside today at`)
  await expect(claim).toContainText(`for ${roll}. Which product is it on?`)
  await expect(claim.getByLabel('Product')).toBeFocused()
  await claim.getByLabel('Product').fill(speaker)
  await claim.getByLabel("Where it's kept").fill(bay)
  await expect(claim.getByRole('checkbox', { name: `One of the 3 counted at ${bay}, not labelled until now` })).toBeChecked()
  await top(page)
  await page.screenshot(shot('labels-claim'))
  await claim.getByRole('button', { name: `Put ${sh(first + 4)} on it` }).click()
  const added = page.locator('p.added')
  await expect(added).toHaveText(`Added ${sh(first + 4)} (${speaker}) at ${bay}. Scan the next label.`)
  await expect(find).toBeFocused()
  await expect(find).toHaveValue('')

  // The next label: the product and place are still there, so Enter twice does it.
  await find.fill(sh(first + 5))
  await find.press('Enter')
  const next = page.getByRole('form', { name: `Put ${sh(first + 5)} on an item` })
  await expect(next.getByLabel('Product')).toHaveValue(speaker)
  await expect(next.getByLabel("Where it's kept")).toHaveValue(bay)
  await next.getByLabel('Product').press('Enter')
  await expect(added).toHaveText(`Added ${sh(first + 5)} (${speaker}) at ${bay}. Scan the next label.`)
  await expect(page.locator('.conn')).toHaveText('Up to date')

  // A number already on an item opens it, as before; one it had before says so.
  await find.fill(sh(first + 4))
  await expect(page.getByRole('form', { name: /^Put / })).toHaveCount(0)
  await find.press('Enter')
  await expect(page.getByRole('heading', { level: 1, name: sh(first + 4) })).toBeVisible()

  // Its own label, with its product's name, printed from its page.
  await page.getByRole('button', { name: 'Print label' }).click()
  await page.getByRole('radio', { name: 'Label printer, 50 × 25 mm' }).check()
  const own = page.getByLabel('Preview').locator('.label')
  await expect(own).toHaveCount(1)
  await expect(own).toContainText(speaker)
  expect(await readQr(own)).toBe(sh(first + 4))
  await page.getByRole('button', { name: 'Print the label' }).click()
  await expect(page.locator('.print-sheet .label')).toHaveCount(1)
  await page.evaluate(() => dispatchEvent(new Event('afterprint')))
  await page.screenshot(shot('labels-item'))

  // Two of the three counted are labelled now, and the next free number is past the run.
  await page.getByRole('link', { name: speaker }).first().click()
  await expect(page.locator('.facts')).toContainText('3: 2 labelled, 1 not yet')
  const add = page.locator('form').filter({ has: page.getByRole('heading', { name: 'Add an item', exact: true }) })
  await add.getByRole('button', { name: 'Add item' }).click()
  await expect(add.locator('.added')).toHaveText(`Added ${sh(first + 12)}.`)
  await page.goto('/#stock/labels')
  await expect(page.getByRole('region', { name: 'Set aside' }).locator('.job-row', { hasText: roll })).toContainText('2 of 12 on items')

  // A run with labels on items can't be cancelled; one set aside by mistake can, and its numbers are never given out again.
  await page.getByRole('region', { name: 'Set aside' }).locator('.job-row', { hasText: roll }).click()
  await expect(page.getByRole('button', { name: 'Cancel the run' })).toHaveCount(0)
  await page.goto('/#stock/labels')
  await form.getByLabel('How many labels').fill('40')
  await form.getByLabel('What for').fill(`Typed by mistake ${id}`)
  await form.getByRole('button', { name: 'Set numbers aside' }).click()
  await form.getByRole('button', { name: 'Reserve them' }).click()
  await expect(form.locator('.added')).toHaveText(`Set aside ${sh(first + 13)} to ${sh(first + 52)}.`)
  await form.locator('.added a').click()
  await expect(page.getByRole('heading', { level: 1, name: `${sh(first + 13)} to ${sh(first + 52)}` })).toBeVisible()
  await page.getByRole('button', { name: 'Cancel the run' }).click()
  await expect(
    page.getByRole('group', { name: `Cancel the run ${sh(first + 13)} to ${sh(first + 52)}? It comes off the list, and its 40 numbers are never given out again.` })
  ).toBeVisible()
  await page.getByRole('button', { name: 'Cancel the run' }).click()
  await expect(page).toHaveURL(/#stock\/labels$/)
  await expect(page.getByRole('region', { name: 'Set aside' }).locator('.job-row', { hasText: `Typed by mistake ${id}` })).toHaveCount(0)
  await expect(page.locator('.conn')).toHaveText('Up to date')
  await form.getByLabel('How many labels').fill('1')
  await form.getByRole('button', { name: 'Set numbers aside' }).click()
  await form.getByRole('button', { name: 'Reserve them' }).click()
  await expect(form.locator('.added')).toHaveText(`Set aside ${sh(first + 53)}.`)
})

test('numbers set aside with no signal come once the signal is back', async ({ browser }) => {
  const id = tag()
  const context = await browser.newContext({ viewport: phoneSize })
  const phone = await context.newPage()
  await ready(phone, '#stock/labels')

  await context.setOffline(true)
  const form = phone.getByRole('form', { name: 'Set numbers aside' })
  await form.getByLabel('How many labels').fill('5')
  await form.getByLabel('What for').fill(`Metal tags ${id}`)
  await form.getByRole('button', { name: 'Set numbers aside' }).click()
  await form.getByRole('button', { name: 'Reserve them' }).click()
  await expect(form.locator('.added')).toHaveText('Set aside. The numbers come from the server when it syncs.')
  const row = phone.getByRole('region', { name: 'Set aside' }).locator('.job-row', { hasText: `Metal tags ${id}` })
  await expect(row).toContainText('Numbers when synced')
  await expect(row).toContainText('Waiting to sync')
  await row.click()
  await expect(phone.getByText("The numbers come from the server, so these print once they've synced.")).toBeVisible()
  await expect(phone.locator('.conn')).toContainText('No signal')

  await context.setOffline(false)
  await phone.evaluate(() => dispatchEvent(new Event('online')))
  await expect(phone.locator('.conn')).toHaveText('Up to date', { timeout: 20_000 })
  await expect(phone.getByRole('heading', { level: 1 })).toHaveText(/^SH-\d{6} to SH-\d{6}$/)
  await expect(phone.getByRole('region', { name: 'Print here' }).getByLabel('Preview').locator('.label')).toHaveCount(3)
})
