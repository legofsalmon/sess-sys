import { expect, test, type Browser, type BrowserContext, type Locator, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
// zxing's writer, from the same package as the app's reader, draws a maker's barcode to hold up to the camera.
import { prepareZXingModule, writeBarcode } from 'zxing-wasm/writer'
import { qrCode } from '../shared/src/labels.ts'

/**
 * Scanning with the phone's camera end to end (ADR 0016), at phone size.
 * The app gets a camera the test holds things up to: a canvas the test
 * draws a label or a maker's barcode on, streamed as a real camera would
 * be, and read by the app's own reader. Labels are drawn by the same code
 * that prints them. A shelf of labels is put on items with the camera, each
 * label read once; a maker's barcode finds its item by serial, never as a
 * Session Hire number; a blocked camera says how to allow it; and scanning
 * works with no signal, from the reader kept on the phone. Nothing is ever
 * fetched from the reader's CDN. The test server is shared with the other
 * browser tests, so numbers are read off the screen. To refresh the
 * blueprint screenshots, run this file on its own with SHOTS=1.
 */

const shot = (name: string) => (process.env.SHOTS ? { path: `docs/hub/img/${name}.png` } : undefined)
const phoneSize = { width: 390, height: 844 }
const tag = () => Math.random().toString(36).slice(2, 8)
const named = (name: string, id: string) => (process.env.SHOTS ? name : `${name} ${id}`)
const sh = (n: number) => `SH-${String(n).padStart(6, '0')}`
const top = (page: Page) => page.evaluate(() => scrollTo(0, 0))

/** On the screen and not under the tabs, so a thumb can tap it where it is. */
const tappable = (el: Locator) =>
  expect
    .poll(() =>
      el.evaluate((e) => {
        const r = e.getBoundingClientRect()
        const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)
        return !!hit && e.contains(hit)
      })
    )
    .toBe(true)

/** A 50 × 25 mm label as a camera sees it at arm's length: its QR code as printed, and the number beside it. */
function label(number: string): string {
  const { size, path } = qrCode(number)
  return `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="150">
    <rect width="300" height="150" rx="10" fill="#fff"/>
    <g transform="translate(15 15) scale(${120 / size})"><path d="${path}" fill="#000"/></g>
    <text x="150" y="72" font-family="sans-serif" font-weight="800" font-size="25">${number}</text>
    <text x="150" y="100" font-family="sans-serif" font-size="15">Session Hire</text>
  </svg>`
}

let writer: Promise<unknown> | undefined
/** A maker's sticker: the serial number as a Code 128 barcode, with the number printed under it. */
async function sticker(serial: string): Promise<string> {
  const require = createRequire(import.meta.url)
  writer ??= prepareZXingModule({ overrides: { wasmBinary: readFileSync(require.resolve('zxing-wasm/writer/zxing_writer.wasm')) }, fireImmediately: true })
  await writer
  const { svg, error } = await writeBarcode(serial, { format: 'Code128', scale: 3 })
  expect(error).toBeFalsy()
  const [width, height] = [/width="(\d+)"/, /height="(\d+)"/].map((re) => Number(re.exec(svg)![1]))
  const bars = svg.replace(/<\?xml[^>]*>|<!DOCTYPE[^>]*>/g, '').replace('<svg ', '<svg x="16" y="12" ')
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width! + 32}" height="${height! + 44}">
    <rect width="${width! + 32}" height="${height! + 44}" rx="6" fill="#fff"/>${bars}
    <text x="${(width! + 32) / 2}" y="${height! + 36}" text-anchor="middle" font-family="sans-serif" font-size="15">S/N ${serial}</text>
  </svg>`
}

interface Camera {
  /** Times the app has asked for the camera, and how many of its streams are still running. */
  opened: number
  live: number
  /** Refuse the camera, as a person does at the browser's prompt. */
  block: boolean
  show(svg: string): Promise<void>
  clear(): void
}

// Each test's phone is put away after it, so its camera isn't still drawing while the tests after it run.
const phones: BrowserContext[] = []
test.afterEach(async () => {
  await Promise.all(phones.splice(0).map((c) => c.close()))
})

/** A phone whose camera the test holds things up to, and a list of anything fetched from the reader's CDN. */
async function phone(browser: Browser) {
  const context = await browser.newContext({ viewport: phoneSize })
  phones.push(context)
  const page = await context.newPage()
  const cdn: string[] = []
  page.on('request', (r) => /jsdelivr|unpkg|cdnjs/.test(r.url()) && cdn.push(r.url()))
  await page.addInitScript(() => {
    const canvas = document.createElement('canvas')
    canvas.width = 640
    canvas.height = 480
    const ctx = canvas.getContext('2d')!
    let picture: HTMLImageElement | null = null
    // A dark road case, and whatever is held up to the camera in the middle of it.
    const paint = () => {
      ctx.fillStyle = '#353b42'
      ctx.fillRect(0, 0, canvas.width, canvas.height)
      if (picture) ctx.drawImage(picture, (canvas.width - picture.width) / 2, (canvas.height - picture.height) / 2)
    }
    paint()
    setInterval(paint, 50)
    const camera: Camera = {
      opened: 0,
      live: 0,
      block: false,
      async show(svg) {
        const img = new Image()
        img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
        await img.decode()
        picture = img
        paint()
      },
      clear() {
        picture = null
        paint()
      },
    }
    ;(window as unknown as { camera: Camera }).camera = camera
    navigator.mediaDevices.getUserMedia = async () => {
      if (camera.block) throw new DOMException('Permission denied', 'NotAllowedError')
      camera.opened++
      const stream = canvas.captureStream(20)
      for (const track of stream.getTracks()) {
        const stop = track.stop.bind(track)
        camera.live++
        track.stop = () => {
          camera.live--
          stop()
        }
      }
      return stream
    }
  })
  return { context, page, cdn }
}

const camera = (page: Page) => ({
  show: (svg: string) => page.evaluate((s) => (window as unknown as { camera: Camera }).camera.show(s), svg),
  clear: () => page.evaluate(() => (window as unknown as { camera: Camera }).camera.clear()),
  live: () => page.evaluate(() => (window as unknown as { camera: Camera }).camera.live),
  block: () => page.evaluate(() => void ((window as unknown as { camera: Camera }).camera.block = true)),
})

async function ready(page: Page, hash = '#stock') {
  await page.goto(`/${hash}`)
  await expect(page.locator('.conn')).toHaveText('Up to date')
}

/** A numbered product, with some counted at a place if asked. */
async function newProduct(page: Page, name: string, counted?: { at: string; count: number }) {
  await page.goto('/#stock')
  const form = page.locator('form').filter({ has: page.getByRole('button', { name: 'Add product' }) })
  await form.getByLabel('Name').fill(name)
  await form.getByRole('button', { name: 'Add product' }).click()
  await expect(page.getByRole('heading', { level: 1, name })).toBeVisible()
  if (!counted) return
  const add = page.locator('form').filter({ has: page.getByRole('heading', { name: 'Add a count', exact: true }) })
  await add.getByLabel('Counted at').fill(counted.at)
  await add.getByLabel('How many').fill(String(counted.count))
  await add.getByRole('button', { name: 'Save count' }).click()
  await expect(page.locator('.count', { hasText: counted.at })).toContainText(String(counted.count))
}

/** An item of the product whose page is open, with the next free number; its number. */
async function addItem(page: Page, where: string, serial = ''): Promise<string> {
  const add = page.locator('form').filter({ has: page.getByRole('heading', { name: 'Add an item', exact: true }) })
  const said = add.locator('.added')
  const before = (await said.count()) ? await said.textContent() : null
  await add.getByLabel('Serial').fill(serial)
  await add.getByLabel("Where it's kept").fill(where)
  await add.getByRole('button', { name: 'Add item' }).click()
  // The line saying what was added last time stays until this one replaces it.
  await expect.poll(() => said.textContent()).not.toBe(before)
  await expect(said).toHaveText(/^Added SH-\d{6}\.$/)
  return (await said.textContent())!.slice(6, 15)
}

/** Numbers set aside for a run of labels; the first of them. */
async function setAside(page: Page, count: number, what: string): Promise<number> {
  await page.goto('/#stock/labels')
  const form = page.getByRole('form', { name: 'Set numbers aside' })
  await form.getByLabel('How many labels').fill(String(count))
  await form.getByLabel('What for').fill(what)
  await form.getByRole('button', { name: 'Set numbers aside' }).click()
  await expect(form.locator('.added')).toHaveText(/^Set aside SH-\d{6} to SH-\d{6}\.$/)
  return Number((await form.locator('.added a').textContent())!.slice(3, 9))
}

test('labels put on items with the camera, one after another, each read once', async ({ browser }) => {
  const id = tag()
  const speaker = named('d&b Y10P', id)
  const bay = named('Bay A3', id)
  const { page, cdn } = await phone(browser)
  const cam = camera(page)
  await ready(page)
  await newProduct(page, speaker, { at: bay, count: 3 })
  const first = await setAside(page, 3, named('Roll from Label World', id))

  // The camera opens under the search, looking at a road case with nothing on it yet.
  await page.goto('/#stock')
  await page.getByRole('button', { name: 'Scan' }).click()
  const scanner = page.getByRole('group', { name: 'Camera' })
  await expect(scanner.getByRole('status')).toHaveText("Point the camera at a label, or a maker's barcode with the serial number.")
  await expect.poll(() => page.locator('.scanner video').evaluate((v: HTMLVideoElement) => v.videoWidth)).toBe(640)
  await top(page)
  await page.screenshot(shot('scan-camera'))

  // The first label: it isn't on anything yet, so the camera waits while it's put on an item.
  await cam.show(label(sh(first)))
  const claim = page.getByRole('form', { name: `Put ${sh(first)} on an item` })
  await expect(claim.getByRole('heading')).toHaveText(`${sh(first)} isn't on anything yet`)
  await expect(scanner.getByRole('status')).toHaveText(`Read ${sh(first)}.`)
  await expect(page.locator('.scanner')).toHaveClass(/paused/)
  await expect(page.getByLabel('Find')).toHaveValue(sh(first))
  await expect(claim.getByLabel('Product')).toBeFocused()
  await claim.getByLabel('Product').fill(speaker)
  await claim.getByLabel("Where it's kept").fill(bay)
  await claim.getByRole('button', { name: `Put ${sh(first)} on it` }).click()
  const added = page.locator('p.added')
  await expect(added).toHaveText(`Added ${sh(first)} (${speaker}) at ${bay}. Scan the next label.`)
  await expect(scanner.getByRole('status')).toHaveText(`Read ${sh(first)}. Point it at the next one.`)
  await expect(page.getByLabel('Find')).toHaveValue('')

  // Still in view, the same label isn't read again.
  await page.waitForTimeout(1000)
  await expect(page.getByLabel('Find')).toHaveValue('')
  await expect(page.getByRole('form', { name: /^Put / })).toHaveCount(0)

  // The next label: the product and place are still there, so it's a tap, with no keyboard in the way.
  await cam.show(label(sh(first + 1)))
  const next = page.getByRole('form', { name: `Put ${sh(first + 1)} on an item` })
  await expect(next.getByLabel('Product')).toHaveValue(speaker)
  await expect(next.getByLabel("Where it's kept")).toHaveValue(bay)
  await expect(next.getByLabel('Product')).not.toBeFocused()
  await tappable(next.getByRole('button', { name: `Put ${sh(first + 1)} on it` }))
  await page.screenshot(shot('scan-claim'))
  await next.getByRole('button', { name: `Put ${sh(first + 1)} on it` }).click()
  await expect(added).toHaveText(`Added ${sh(first + 1)} (${speaker}) at ${bay}. Scan the next label.`)

  // On a small phone too, the button is scrolled to. A label read by mistake is put aside, and the camera carries on.
  await page.setViewportSize({ width: 375, height: 667 })
  await cam.show(label(sh(first + 2)))
  const third = page.getByRole('form', { name: `Put ${sh(first + 2)} on an item` })
  await tappable(third.getByRole('button', { name: `Put ${sh(first + 2)} on it` }))
  await scanner.getByRole('button', { name: 'Scan another' }).click()
  await page.setViewportSize(phoneSize)
  await expect(page.getByRole('form', { name: /^Put / })).toHaveCount(0)
  await expect(page.locator('.scanner')).not.toHaveClass(/paused/)

  // A label already on an item opens it, and the camera stops.
  await cam.show(label(sh(first)))
  await expect(page.getByRole('heading', { level: 1, name: sh(first) })).toBeVisible()
  await expect(page.locator('.facts')).toContainText(`Where${bay}`)
  await expect.poll(cam.live).toBe(0)
  await expect(page.locator('.conn')).toHaveText('Up to date')
  expect(cdn).toEqual([])
})

test("a maker's barcode finds its item by serial, never as a Session Hire number", async ({ browser }) => {
  const id = tag()
  const desk = named('DiGiCo SD12', id)
  const bay = named('Bay C1', id)
  const { page, cdn } = await phone(browser)
  const cam = camera(page)
  await ready(page)
  // A serial of only digits that is also a number set aside for labels, as a scanner would type it.
  const first = await setAside(page, 2, named('Metal tags', id))
  const digits = String(first + 1).padStart(6, '0')
  const serial = `SD12-${id.toUpperCase()}`
  await newProduct(page, desk)
  const one = await addItem(page, bay, serial)
  const two = await addItem(page, bay, digits)
  expect(two).not.toBe(one)

  await page.goto('/#stock')
  await page.getByRole('button', { name: 'Scan' }).click()
  await cam.show(await sticker(serial))
  await expect(page.getByRole('heading', { level: 1, name: one })).toBeVisible()
  await expect(page.locator('.facts')).toContainText(serial)

  // The digits find the desk with that serial, not the label with that number.
  await page.goto('/#stock')
  await page.getByRole('button', { name: 'Scan' }).click()
  await cam.show(await sticker(digits))
  await expect(page.getByRole('heading', { level: 1, name: two })).toBeVisible()
  await expect(page.getByRole('form', { name: /^Put / })).toHaveCount(0)
  expect(cdn).toEqual([])
})

test('a blocked camera says how to allow it, and the camera stops when closed or left', async ({ browser }) => {
  const { page } = await phone(browser)
  const cam = camera(page)
  await ready(page)

  await page.getByRole('button', { name: 'Scan' }).click()
  const scanner = page.getByRole('group', { name: 'Camera' })
  await expect(scanner.getByRole('status')).toHaveText(/^Point the camera/)
  await expect.poll(cam.live).toBe(1)
  await scanner.getByRole('button', { name: 'Close camera' }).click()
  await expect(scanner).toHaveCount(0)
  await expect.poll(cam.live).toBe(0)

  // Pressed again, the Scan button closes it too; so does going to another tab.
  await page.getByRole('button', { name: 'Scan' }).click()
  await expect.poll(cam.live).toBe(1)
  await expect(page.getByRole('button', { name: 'Scan' })).toHaveAttribute('aria-pressed', 'true')
  await page.getByRole('button', { name: 'Scan' }).click()
  await expect.poll(cam.live).toBe(0)
  await page.getByRole('button', { name: 'Scan' }).click()
  await expect.poll(cam.live).toBe(1)
  await page.getByRole('navigation', { name: 'Areas' }).getByRole('link', { name: 'Jobs' }).click()
  await expect.poll(cam.live).toBe(0)

  // Refused at the browser's prompt: it says what to do.
  await cam.block()
  await page.goto('/#stock')
  await page.getByRole('button', { name: 'Scan' }).click()
  await expect(scanner.getByRole('alert')).toHaveText(
    "The camera is blocked for this app. Allow it in the browser's settings for this site, then try again."
  )
  await expect(scanner.locator('video')).toHaveCount(0)
})

test('scans with no signal, from the reader kept on the phone', async ({ browser }) => {
  const id = tag()
  const light = named('Robe Spiider', id)
  const van = named('Van 1', id)
  const { context, page, cdn } = await phone(browser)
  const cam = camera(page)
  await ready(page)
  await newProduct(page, light)
  const number = await addItem(page, van)
  await expect(page.locator('.conn')).toHaveText('Up to date')
  // Let the service worker take control, so the app and its reader load with no network.
  await page.waitForFunction(() => navigator.serviceWorker?.controller != null, null, { timeout: 15_000 }).catch(() => page.reload())
  await page.waitForFunction(() => navigator.serviceWorker?.controller != null)

  // Flight mode, and the app opened again: it, its data and its reader come from the phone.
  await context.setOffline(true)
  await page.goto('/#stock')
  await page.reload()
  await expect(page.getByRole('heading', { level: 2, name: 'Stock', exact: true })).toBeVisible()
  await expect(page.locator('.conn')).toHaveText(/^No signal/)
  await page.getByRole('button', { name: 'Scan' }).click()
  await cam.show(label(number))
  await expect(page.getByRole('heading', { level: 1, name: number })).toBeVisible()
  await expect(page.locator('.facts')).toContainText(`Where${van}`)
  expect(cdn).toEqual([])
})
