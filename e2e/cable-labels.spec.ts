import { expect, test, type Locator, type Page } from '@playwright/test'
import { createRequire } from 'node:module'
import { barcode } from '../shared/src/labels.ts'

/**
 * Cable labels end to end (ADR 0095), at phone size: a product's Cable
 * labels tab prints its words in big type, two to a cable by default, on a
 * wrap-round, flag or bag label, with its stock code as a barcode (the same
 * bars the shared encoder draws, which a real decoder read back when it
 * was written) or a QR code a decoder reads here. With no stock code a
 * barcode says why it can't, and a stock code typed or scanned in the
 * Stock search opens the product.
 */

const phoneSize = { width: 390, height: 844 }
const tag = () => Math.random().toString(36).slice(2, 8).toUpperCase()
const decoder = createRequire(import.meta.url).resolve('jsqr/dist/jsQR.js')

async function readQr(label: Locator): Promise<string | undefined> {
  const page = label.page()
  await page.route('**/e2e/jsQR.js', (route) => route.fulfill({ contentType: 'text/javascript', path: decoder }))
  await page.addScriptTag({ url: '/e2e/jsQR.js' })
  return label.locator('svg.qr').first().evaluate(async (svg) => {
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

/** The printed pages, each one's size in millimetres. */
async function printed(page: Page) {
  await page.emulateMedia({ media: 'print' })
  const pdf = (await page.pdf({ preferCSSPageSize: true })).toString('latin1')
  await page.emulateMedia({ media: 'screen' })
  return [...pdf.matchAll(/\/MediaBox\s*\[\s*0 0 ([\d.]+) ([\d.]+)\s*\]/g)].map((m) => [m[1], m[2]].map((pt) => Math.round((Number(pt) / 72) * 25.4)))
}

test('cable labels print with a barcode or QR code of the stock code, which opens the product', async ({ browser }) => {
  const id = tag()
  const name = `XLR cable 10 m ${id}`
  const code = `XLR-10M-${id}`
  const page = await (await browser.newContext({ viewport: phoneSize })).newPage()
  await page.addInitScript(() => {
    const w = window as unknown as { printed: number }
    w.printed = 0
    window.print = () => void w.printed++
  })
  await page.goto('/#stock')
  await expect(page.locator('.conn')).toHaveText('Up to date')
  await page.getByRole('button', { name: 'Add product' }).click()
  const form = page.locator('form').filter({ has: page.getByRole('button', { name: 'Add product' }) })
  await form.getByLabel('Name').fill(name)
  await form.getByRole('button', { name: 'Add product' }).click()
  await expect(page.getByRole('heading', { level: 1, name })).toBeVisible()

  // No stock code yet: a barcode says what it needs.
  await page.getByRole('tab', { name: 'Cable labels' }).click()
  const card = page.getByRole('region', { name: 'Cable labels' })
  await card.getByRole('radio', { name: 'Barcode' }).check()
  await expect(card.getByRole('note')).toContainText('it has none yet')
  await expect(card.getByLabel('What they say')).toHaveValue(name)

  // Given one under Details, it goes on the label as the bars the encoder draws.
  await page.getByRole('tab', { name: 'Details' }).click()
  await page.getByRole('button', { name: 'Change details' }).click()
  await page.getByLabel('Stock code').fill(code)
  await page.getByRole('button', { name: 'Save product' }).click()
  await expect(page.getByText(code)).toBeVisible()
  await page.getByRole('tab', { name: 'Cable labels' }).click()
  await card.getByLabel('What they say').fill('10 m XLR')
  const label = card.locator('.preview .label.cable')
  await expect(label.locator('b')).toHaveText('10 m XLR')
  const bars = label.getByRole('img', { name: `Barcode for ${code}` })
  await expect(bars).toBeVisible()
  expect(await bars.locator('path').getAttribute('d')).toBe(barcode(code)!.path)
  const [scroll, client] = await label.locator('b').evaluate((b) => [b.scrollWidth, b.clientWidth])
  expect(scroll).toBeLessThanOrEqual(client!)

  // Two by default, a 50 × 25 mm page each.
  await card.getByRole('button', { name: 'Print 2 labels' }).click()
  await expect.poll(() => page.evaluate(() => (window as unknown as { printed: number }).printed)).toBe(1)
  expect(await printed(page)).toEqual([
    [50, 25],
    [50, 25],
  ])
  await page.evaluate(() => dispatchEvent(new Event('afterprint')))

  // A flag says it at both ends, here with a QR code a decoder reads as the stock code.
  await card.getByRole('radio', { name: /^Flag, 100 × 25 mm/ }).check()
  await card.getByRole('radio', { name: 'QR code' }).check()
  await card.getByLabel('How many').fill('1')
  await expect(label.locator('.face')).toHaveCount(2)
  expect(await readQr(label)).toBe(code)
  await card.getByRole('button', { name: 'Print the label' }).click()
  await expect.poll(() => page.evaluate(() => (window as unknown as { printed: number }).printed)).toBe(2)
  expect(await printed(page)).toEqual([[100, 25]])
  await page.evaluate(() => dispatchEvent(new Event('afterprint')))

  // Remembered on this device: the flag and the QR code come back.
  await page.reload()
  await page.getByRole('tab', { name: 'Cable labels' }).click()
  await expect(card.getByRole('radio', { name: /^Flag, 100 × 25 mm/ })).toBeChecked()
  await expect(card.getByRole('radio', { name: 'QR code' })).toBeChecked()

  // A scanner types the code and Enter in the Stock search: the product opens.
  await page.goto('/#stock')
  const search = page.getByRole('searchbox', { name: 'Find' })
  await search.fill(code)
  await search.press('Enter')
  await expect(page.getByRole('heading', { level: 1, name })).toBeVisible()
})
