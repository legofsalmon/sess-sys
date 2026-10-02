import { expect, test, type Page } from '@playwright/test'
import { encode } from 'uqr'

/**
 * Scanning, round three of the audit (findings 17 and 18), at phone size,
 * with the phone's camera stood in for by a picture the test draws, as in
 * scan.spec.ts. Testing a batch holds each pass for five seconds with
 * Undo before it's recorded, a second read records the first at once, and
 * so do the phone locking and leaving the screen, once only; an item is
 * put at a place or in a case by camera, with the camera staying on for
 * the next; a page with no camera API says to open it in Safari or Chrome,
 * with the address to copy, which copies with no clipboard API too; a code
 * outside the frame is ignored by both readers, the one in the app and the
 * phone's own, whether that says where the code is by its corners or by
 * the box round it; and a camera that can zoom gets a slider, one that
 * can't gets none, and one that turns the zoom down still reads. The test
 * server is shared with the other browser tests, so names are this run's
 * own and numbers are read off the screen.
 */

const phoneSize = { width: 390, height: 844 }
const tag = () => Math.random().toString(36).slice(2, 8)
const part = (page: Page, heading: string) => page.locator('form').filter({ has: page.getByRole('heading', { name: heading, exact: true }) })

interface FakeCamera {
  show(code: { modules: boolean[][]; text: string; at: 'centre' | 'edge' } | null): void
  tracks: MediaStreamTrack[]
  /** What the app last asked the camera to zoom to. */
  zoom: number | undefined
}
interface Options {
  /** Stand in for the phone's own barcode reader, which sees the whole picture and says where the code is: by its corners, or by the box round it. */
  native?: 'corners' | 'box'
  /** A camera that can zoom, or says it can and then turns the zoom down. */
  zoom?: boolean | 'fails'
  /** No camera API at all, as inside another app's browser or over plain http, where there's no clipboard API or secure context either. */
  missing?: boolean
}

/** A camera that films whatever the test puts in front of it: in the middle, or at the edge of the square the screen shows. */
async function fakeCamera(page: Page, options: Options = {}) {
  await page.addInitScript((options: Options) => {
    if (options.missing) {
      // The test keeps the clipboard to read back what was copied.
      ;(window as unknown as { realClipboard: Clipboard }).realClipboard = navigator.clipboard
      Object.defineProperty(navigator, 'mediaDevices', { value: undefined })
      Object.defineProperty(navigator, 'clipboard', { value: undefined })
      Object.defineProperty(window, 'isSecureContext', { value: false })
      return
    }
    const canvas = document.createElement('canvas')
    canvas.width = 640
    canvas.height = 480
    const ctx = canvas.getContext('2d')!
    const unit = 9
    let shown: { modules: boolean[][]; text: string; x0: number; y0: number } | null = null
    const draw = () => {
      ctx.fillStyle = '#8a8f96'
      ctx.fillRect(0, 0, 640, 480)
      if (!shown) return
      const side = (shown.modules.length + 8) * unit
      ctx.fillStyle = '#fff'
      ctx.fillRect(shown.x0, shown.y0, side, side)
      ctx.fillStyle = '#000'
      shown.modules.forEach((row, y) => row.forEach((dark, x) => dark && ctx.fillRect(shown!.x0 + (x + 4) * unit, shown!.y0 + (y + 4) * unit, unit, unit)))
    }
    setInterval(draw, 50)
    draw()
    const camera: FakeCamera = {
      show: (code) => {
        if (!code) shown = null
        else {
          const side = (code.modules.length + 8) * unit
          // The square the screen shows is the middle 480 of the 640: its left edge is at 80.
          shown = { modules: code.modules, text: code.text, x0: code.at === 'centre' ? (640 - side) / 2 : 80, y0: (480 - side) / 2 }
        }
        draw()
      },
      tracks: [],
      zoom: undefined,
    }
    ;(window as unknown as { camera: FakeCamera }).camera = camera
    if (options.native) {
      class FakeDetector {
        static async getSupportedFormats() {
          return ['qr_code']
        }
        async detect() {
          if (!shown) return []
          const left = shown.x0 + 4 * unit
          const top = shown.y0 + 4 * unit
          const right = left + shown.modules.length * unit
          const bottom = top + shown.modules.length * unit
          if (options.native === 'box')
            return [{ rawValue: shown.text, format: 'qr_code', boundingBox: { left, top, right, bottom, x: left, y: top, width: right - left, height: bottom - top } }]
          return [
            {
              rawValue: shown.text,
              format: 'qr_code',
              cornerPoints: [
                { x: left, y: top },
                { x: right, y: top },
                { x: right, y: bottom },
                { x: left, y: bottom },
              ],
            },
          ]
        }
      }
      ;(window as unknown as { BarcodeDetector: unknown }).BarcodeDetector = FakeDetector
    }
    Object.defineProperty(navigator, 'mediaDevices', {
      value: {
        getUserMedia: async () => {
          const stream = canvas.captureStream(20)
          const track = stream.getVideoTracks()[0]!
          if (options.zoom) {
            track.getCapabilities = () => ({ zoom: { min: 1, max: 5, step: 0.5 } }) as MediaTrackCapabilities
            track.getSettings = () => ({ zoom: 1 }) as MediaTrackSettings
            track.applyConstraints = async (c?: MediaTrackConstraints) => {
              if (options.zoom === 'fails') throw new DOMException('Zoom is not supported.', 'OverconstrainedError')
              camera.zoom = (c?.advanced?.[0] as { zoom?: number } | undefined)?.zoom
            }
          }
          camera.tracks.push(track)
          return stream
        },
      },
    })
  }, options)
}

/** Holds a QR code saying `text` in front of the camera, in the middle or at the edge; nothing for just the grey. */
const hold = (page: Page, text: string | null, at: 'centre' | 'edge' = 'centre') =>
  page.evaluate(
    (code) => (window as unknown as { camera: FakeCamera }).camera.show(code),
    text ? { modules: encode(text, { ecc: 'H', border: 0 }).data, text, at } : null
  )

async function ready(page: Page, hash = '#stock') {
  await page.goto(`/${hash}`)
  await expect(page.locator('.conn')).toHaveText('Up to date')
}

/** A numbered product, opened on its own page. */
async function newProduct(page: Page, name: string, how: 'numbered' | 'case' = 'numbered') {
  await page.goto('/#stock')
  const form = page.locator('form').filter({ has: page.getByRole('button', { name: 'Add product' }) })
  await form.getByLabel('Name').fill(name)
  if (how === 'case') await form.getByRole('checkbox', { name: /^Holds other kit/ }).check()
  await form.getByRole('button', { name: 'Add product' }).click()
  await expect(page.getByRole('heading', { level: 1, name })).toBeVisible()
}

/** The question a place nobody has used yet brings up (audit finding 19), answered yes when it's asked. */
async function makePlace(page: Page) {
  const yes = page.getByRole('button', { name: 'Make the place' })
  if (await yes.isVisible()) await yes.click()
}

/** Items of the product whose page is open, kept at `where`, with the numbers the server gives them. */
async function newItems(page: Page, where: string, count: number) {
  const add = part(page, 'Add an item')
  const numbers: string[] = []
  for (let i = 0; i < count; i++) {
    await add.getByLabel("Where it's kept").fill(where)
    await add.getByRole('button', { name: 'Add item' }).click()
    await makePlace(page)
    if (numbers.length) await expect(add.locator('.added')).not.toHaveText(`Added ${numbers.at(-1)}.`)
    await expect(add.locator('.added')).toHaveText(/^Added SH-\d{6}\.$/)
    numbers.push((await add.locator('.added').textContent())!.slice(6, -1))
  }
  await expect(page.locator('.conn')).toHaveText('Up to date')
  return numbers
}

test('testing a batch holds each pass for five seconds with Undo; a second read, the phone locking or leaving records the one held', async ({ browser }) => {
  // The wrong label read can be taken back before anything is recorded, and nothing read is ever lost but by Undo.
  const id = tag()
  const speaker = `d&b Y10P ${id}`
  const page = await (await browser.newContext({ viewport: phoneSize })).newPage()
  await fakeCamera(page)
  await ready(page)
  await newProduct(page, speaker)
  const [a, b, c] = await newItems(page, `Bay A3 ${id}`, 3)

  await page.goto('/#stock/testing')
  await expect(page.locator('.hint').first()).toContainText('Each pass waits five seconds with Undo')
  await page.getByLabel('By', { exact: true }).fill('Volt Testing Ltd')
  const held = page.getByRole('status', { name: 'Held' })
  const said = page.getByRole('status', { name: 'Last scan' })
  const tested = page.getByRole('region', { name: 'Tested' })
  const typeIn = async (number: string) => {
    await page.getByLabel('Number or serial').fill(number)
    await page.getByLabel('Number or serial').press('Enter')
  }

  // Read by the camera and held at the top, counting down; Undo drops it before anything is recorded.
  await page.getByRole('button', { name: 'Scan' }).click()
  await hold(page, a!)
  await expect(held).toContainText(`Passed: ${a} · recorded in`)
  await expect(held).toContainText(/recorded in [45] s/)
  await held.getByRole('button', { name: 'Undo' }).click()
  await expect(held).toHaveCount(0)
  await expect(said).toHaveText(`${a} ${speaker}: dropped, nothing recorded.`)
  await expect(tested).toHaveCount(0)
  await hold(page, null)

  // A second read while one is held records the first at once and holds the second; the same label again is still the one held.
  await typeIn(b!)
  await expect(held).toContainText(`Passed: ${b}`)
  await typeIn(b!)
  await expect(held).toContainText(`Passed: ${b}`)
  await typeIn(c!)
  await expect(said).toContainText(`${b} ${speaker}: passed`)
  await expect(held).toContainText(`Passed: ${c}`)
  await expect(tested).toContainText('Tested here: 1')
  // Left alone, the held one is recorded when its five seconds are up.
  await expect(said).toContainText(`${c} ${speaker}: passed`, { timeout: 8000 })
  await expect(held).toHaveCount(0)
  await expect(tested).toContainText('Tested here: 2')

  // It failed, while held: the fail is recorded instead of the pass, by whoever was testing when it was read.
  await typeIn(a!)
  await expect(held).toContainText(`Passed: ${a}`)
  await page.getByLabel('By', { exact: true }).fill('Someone else')
  await held.getByRole('button', { name: 'It failed' }).click()
  await expect(said).toHaveText(`${a} ${speaker}: failed. It can't go out until it passes. Report what's wrong on its page.`)
  await expect(tested).toContainText('Tested here: 3')
  await expect(tested.getByRole('link', { name: `${a} failed` })).toBeVisible()
  await expect(page.locator('.conn')).toHaveText('Up to date')

  // The phone locking while one is held records it at once, and once only: its five seconds running out later add nothing.
  await typeIn(c!)
  await expect(held).toContainText(`Passed: ${c}`)
  await page.evaluate(() => {
    for (const state of ['hidden', 'visible']) {
      Object.defineProperty(document, 'visibilityState', { value: state, configurable: true })
      document.dispatchEvent(new Event('visibilitychange'))
    }
  })
  await expect(held).toHaveCount(0)
  await expect(said).toContainText(`${c} ${speaker}: passed`)
  await expect(tested).toContainText('Tested here: 4')
  const lockedAt = Date.now()

  // Leaving the screen while one is held records it at once: only Undo drops a pass.
  await typeIn(b!)
  await expect(held).toContainText(`Passed: ${b}`)
  await page.getByRole('link', { name: '‹ All stock' }).click()
  await page.getByLabel('Find').fill(b!)
  await page.getByLabel('Find').press('Enter')
  await expect(page.getByRole('heading', { level: 1, name: b })).toBeVisible()
  await expect(page.getByRole('region', { name: 'Inspections' }).locator('summary')).toHaveText('2 recorded')
  await page.waitForTimeout(Math.max(0, lockedAt + 5500 - Date.now()))
  await page.goto('/#stock')
  await page.getByLabel('Find').fill(c!)
  await page.getByLabel('Find').press('Enter')
  await expect(page.getByRole('heading', { level: 1, name: c })).toBeVisible()
  await expect(page.getByRole('region', { name: 'Inspections' }).locator('summary')).toHaveText('2 recorded')
  // The one failed while held has the fail alone, by the tester of the read.
  await page.goto('/#stock')
  await page.getByLabel('Find').fill(a!)
  await page.getByLabel('Find').press('Enter')
  await expect(page.getByRole('heading', { level: 1, name: a })).toBeVisible()
  await expect(page.getByRole('region', { name: 'Inspections' }).locator('.inspection')).toHaveText([/^Electrical test \(PAT\): failed.* · Volt Testing Ltd$/])
})

test('an item is put at a place or in a case by camera, and the camera stays on for the next', async ({ browser }) => {
  // Putting kit away is one scan a label, with no Scan to press again between items.
  const id = tag()
  const speaker = `d&b Y10P ${id}`
  const rack = `Amp rack ${id}`
  const bay = `Bay A3 ${id}`
  const shelf = `Shelf B2 ${id}`
  const page = await (await browser.newContext({ viewport: phoneSize })).newPage()
  await fakeCamera(page)
  await ready(page)
  await newProduct(page, speaker)
  const [a, b] = await newItems(page, bay, 2)
  await newProduct(page, rack, 'case')
  const [box] = await newItems(page, bay, 1)

  // A new shelf, and two speakers put on it one after the other without touching the screen between.
  await page.goto('/#stock')
  await page.getByLabel('New place').fill(shelf)
  await page.getByRole('button', { name: 'Add place' }).click()
  await page.getByRole('link', { name: shelf }).click()
  await expect(page.getByRole('heading', { level: 1, name: shelf })).toBeVisible()
  const put = part(page, 'Put an item here')
  await put.getByRole('button', { name: 'Scan' }).click()
  const camera = put.getByLabel('Camera')
  await expect(camera.getByRole('status')).toHaveText('Point the camera at a label.')
  await hold(page, a!)
  const result = put.getByRole('status', { name: 'Put here' })
  await expect(result).toHaveText(`${a} (${speaker}) is here now. Scan the next label.`)
  await expect(camera).toBeVisible()
  await hold(page, null)
  await page.waitForTimeout(1500)
  await hold(page, b!)
  await expect(result).toHaveText(`${b} (${speaker}) is here now. Scan the next label.`)
  await expect(page.getByRole('region', { name: 'Here' }).locator('.group', { hasText: speaker }).locator('.numbers a')).toHaveText([a!, b!])
  // Close ends the session.
  await put.getByRole('button', { name: 'Close' }).click()
  await expect(camera).toHaveCount(0)
  await expect(result).toHaveCount(0)
  // A refusal shows where the scan was, and the camera stays on; Stop camera clears it with the session.
  await hold(page, null)
  await put.getByRole('button', { name: 'Scan' }).click()
  await hold(page, a!)
  await expect(put.locator('.alert')).toHaveText(`${a} is here already.`)
  await expect(camera).toBeVisible()
  await camera.getByRole('button', { name: 'Stop camera' }).click()
  await expect(camera).toHaveCount(0)
  await expect(put.locator('.alert')).toHaveCount(0)
  await hold(page, null)

  // Into a case the same way.
  await page.goto('/#stock')
  await page.getByLabel('Find').fill(box!)
  await page.getByLabel('Find').press('Enter')
  await expect(page.getByRole('heading', { level: 1, name: box })).toBeVisible()
  const putIn = part(page, 'Put an item in')
  await putIn.getByRole('button', { name: 'Scan' }).click()
  await hold(page, a!)
  const inResult = putIn.getByRole('status', { name: 'Put in' })
  await expect(inResult).toHaveText(`${a} (${speaker}) is in ${box} now. Scan the next label.`)
  await expect(page.getByRole('region', { name: 'In it' }).locator('.item-row')).toHaveText(new RegExp(`^${a} ${speaker}`))
  await putIn.getByRole('button', { name: 'Close' }).click()
  await expect(putIn.getByLabel('Camera')).toHaveCount(0)
  await expect(inResult).toHaveCount(0)
  await expect(page.locator('.conn')).toHaveText('Up to date')
})

test('a page with no camera API says to open it in Safari or Chrome, with the address to copy', async ({ browser }) => {
  // Inside another app's browser, or over plain http, the way on is said, not "no camera".
  const page = await (await browser.newContext({ viewport: phoneSize, permissions: ['clipboard-read', 'clipboard-write'] })).newPage()
  await fakeCamera(page, { missing: true })
  await ready(page)
  await page.getByRole('button', { name: 'Scan' }).click()
  const camera = page.getByLabel('Camera')
  await expect(camera.getByRole('alert')).toContainText('Open this page in Safari or Chrome to use the camera.')
  await expect(camera.getByRole('alert')).not.toContainText('no camera on this device')
  await expect(camera.getByLabel("This page's address")).toHaveValue(page.url())
  await expect(camera.getByRole('button', { name: 'Try again' })).toHaveCount(0)
  // Copied with no clipboard API, as on plain http.
  await camera.getByRole('button', { name: 'Copy address' }).click()
  await expect(camera.getByRole('button', { name: 'Copied' })).toBeVisible()
  expect(await page.evaluate(() => (window as unknown as { realClipboard: Clipboard }).realClipboard.readText())).toBe(page.url())
})

const readers = { 'the reader in the app': undefined, "the phone's own reader": 'corners', "the phone's own reader going by the box round the code": 'box' } as const
for (const [reader, native] of Object.entries(readers)) {
  test(`a code outside the frame is ignored by ${reader} until it is inside`, async ({ browser }) => {
    // A neighbouring label is never read early, however the reader says where a code is.
    const id = tag()
    const speaker = `d&b Y10P ${id}`
    const page = await (await browser.newContext({ viewport: phoneSize })).newPage()
    await fakeCamera(page, { native })
    await ready(page)
    await newProduct(page, speaker)
    const [a] = await newItems(page, `Bay A3 ${id}`, 1)

    await page.goto('/#stock')
    await page.getByRole('button', { name: 'Scan' }).click()
    const camera = page.getByLabel('Camera')
    await expect(camera.getByRole('status')).toHaveText('Point the camera at a label.')
    // A neighbouring label, half in view at the edge of the picture: not read.
    await hold(page, a!, 'edge')
    await page.waitForTimeout(1200)
    await expect(camera.getByRole('status')).toHaveText('Point the camera at a label.')
    await expect(page.getByRole('status', { name: 'Last scan' })).toHaveCount(0)
    // Moved into the frame: read.
    await hold(page, a!, 'centre')
    await expect(camera.getByRole('status')).toHaveText(`Read ${a}`)
    await expect(page.getByRole('status', { name: 'Last scan' })).toContainText(`${a} ${speaker}`)
  })
}

test('a camera that can zoom gets a slider, which zooms it; one that can’t gets none, and a zoom turned down leaves scanning as it was', async ({
  browser,
}) => {
  // Zoom is offered only where the camera says it can, and a camera that then refuses it still reads labels.
  const page = await (await browser.newContext({ viewport: phoneSize })).newPage()
  await fakeCamera(page, { zoom: true })
  await ready(page)
  await page.getByRole('button', { name: 'Scan' }).click()
  const camera = page.getByLabel('Camera')
  await expect(camera.getByRole('status')).toHaveText('Point the camera at a label.')
  const zoom = camera.getByLabel('Zoom')
  await expect(zoom).toHaveValue('1')
  await zoom.fill('3')
  await expect(zoom).toHaveValue('3')
  await expect.poll(() => page.evaluate(() => (window as unknown as { camera: FakeCamera }).camera.zoom)).toBe(3)

  const plain = await (await browser.newContext({ viewport: phoneSize })).newPage()
  await fakeCamera(plain)
  await ready(plain)
  await plain.getByRole('button', { name: 'Scan' }).click()
  await expect(plain.getByLabel('Camera').getByRole('status')).toHaveText('Point the camera at a label.')
  await expect(plain.getByLabel('Camera').getByLabel('Zoom')).toHaveCount(0)

  const refusing = await (await browser.newContext({ viewport: phoneSize })).newPage()
  await fakeCamera(refusing, { zoom: 'fails' })
  await ready(refusing)
  await refusing.getByRole('button', { name: 'Scan' }).click()
  const its = refusing.getByLabel('Camera')
  await its.getByLabel('Zoom').fill('3')
  await expect(its.getByLabel('Zoom')).toHaveCount(0)
  await hold(refusing, 'SH-999999')
  await expect(its.getByRole('status')).toHaveText('Read SH-999999')
})
