import { expect, test, type Page } from '@playwright/test'
import { encode } from 'uqr'

/**
 * Scanning with the camera end to end (ADR 0016), at phone size. The phone's
 * camera is stood in for by a picture the test draws: grey, or a label's QR
 * code in the middle, as a camera held over a label would see it. An item's
 * label opens it; a label on nothing yet asks what it's on while the camera
 * stays on for the next one; a label held still is read once; a maker's
 * serial in a QR code finds its item; and a blocked camera says what to do.
 * Numbers are never used twice, so each run has its own. To refresh the
 * blueprint screenshots, run this file on its own with SHOTS=1.
 */

const shot = (name: string) => (process.env.SHOTS ? { path: `docs/hub/img/${name}.png` } : undefined)
const phoneSize = { width: 390, height: 844 }
const tag = () => Math.random().toString(36).slice(2, 8)
const named = (name: string, id: string) => (process.env.SHOTS ? name : `${name} ${id}`)
const sh = (n: number) => `SH-${String(n).padStart(6, '0')}`
const part = (page: Page, heading: string) => page.locator('form').filter({ has: page.getByRole('heading', { name: heading, exact: true }) })

interface FakeCamera {
  show(modules: boolean[][] | null): void
  blocked: boolean
  tracks: MediaStreamTrack[]
}

/** A camera that films whatever the test puts in front of it. */
async function fakeCamera(page: Page) {
  await page.addInitScript(() => {
    const canvas = document.createElement('canvas')
    canvas.width = 640
    canvas.height = 480
    const ctx = canvas.getContext('2d')!
    let shown: boolean[][] | null = null
    // Redrawn all the time, like a camera's picture, so there's always a new frame.
    const draw = () => {
      ctx.fillStyle = '#8a8f96'
      ctx.fillRect(0, 0, 640, 480)
      if (shown) {
        const unit = 9
        const side = (shown.length + 8) * unit
        const x0 = (640 - side) / 2
        const y0 = (480 - side) / 2
        ctx.fillStyle = '#fff'
        ctx.fillRect(x0, y0, side, side)
        ctx.fillStyle = '#000'
        shown.forEach((row, y) => row.forEach((dark, x) => dark && ctx.fillRect(x0 + (x + 4) * unit, y0 + (y + 4) * unit, unit, unit)))
      }
    }
    setInterval(draw, 50)
    draw()
    const camera: FakeCamera = {
      show: (modules) => {
        shown = modules
        draw()
      },
      blocked: false,
      tracks: [],
    }
    ;(window as unknown as { camera: FakeCamera }).camera = camera
    Object.defineProperty(navigator, 'mediaDevices', {
      value: {
        getUserMedia: async () => {
          if (camera.blocked) throw new DOMException('Permission denied', 'NotAllowedError')
          const stream = canvas.captureStream(20)
          camera.tracks.push(...stream.getVideoTracks())
          return stream
        },
      },
    })
  })
}

/** Holds a QR code saying `text` in front of the camera; nothing for just the grey. */
const hold = (page: Page, text: string | null) =>
  page.evaluate((modules) => (window as unknown as { camera: FakeCamera }).camera.show(modules), text ? encode(text, { ecc: 'H', border: 0 }).data : null)

async function ready(page: Page, hash = '#stock') {
  await page.goto(`/${hash}`)
  await expect(page.locator('.conn')).toHaveText('Up to date')
}

async function newProduct(page: Page, name: string) {
  await page.goto('/#stock')
  const form = page.locator('form').filter({ has: page.getByRole('button', { name: 'Add product' }) })
  await form.getByLabel('Name').fill(name)
  await form.getByRole('button', { name: 'Add product' }).click()
  await expect(page.getByRole('heading', { level: 1, name })).toBeVisible()
}

test('scanning labels with the camera: looking one up, and labelling a shelf', async ({ browser }) => {
  const id = tag()
  const speaker = named('d&b Y10P', id)
  const bay = named('Bay A3', id)
  const first = process.env.SHOTS ? 201 : 100_000 + Math.floor(Math.random() * 800_000)
  const serial = `Y10P-${id}-0042`
  const page = await (await browser.newContext({ viewport: phoneSize })).newPage()
  await fakeCamera(page)
  await ready(page)

  // A speaker with its label on, and its maker's serial.
  await newProduct(page, speaker)
  const add = part(page, 'Add an item')
  await add.getByLabel("Where it's kept").fill(bay)
  await add.getByLabel('Number', { exact: true }).fill(sh(first))
  await add.getByLabel('Serial').fill(serial)
  await add.getByRole('button', { name: 'Add item' }).click()
  await expect(add.locator('.added')).toHaveText(`Added ${sh(first)}.`)
  await expect(page.locator('.conn')).toHaveText('Up to date')

  // Scan, then hold the camera over its label: its page opens.
  await page.goto('/#stock')
  await page.getByRole('button', { name: 'Scan' }).click()
  const camera = page.getByLabel('Camera')
  await expect(camera.getByRole('status')).toHaveText('Point the camera at a label.')
  await expect(camera.getByRole('button', { name: 'Sound', pressed: true })).toBeVisible()
  await hold(page, sh(first))
  await expect(page.getByRole('heading', { level: 1, name: sh(first) })).toBeVisible()
  await expect(page).toHaveURL(/#stock\/item\//)
  // Leaving the Stock search turns the camera off.
  await expect.poll(() => page.evaluate(() => (window as unknown as { camera: FakeCamera }).camera.tracks.map((t) => t.readyState))).toEqual(['ended'])

  // A maker's serial finds its item too.
  await hold(page, null)
  await page.goto('/#stock')
  await page.getByRole('button', { name: 'Scan' }).click()
  await hold(page, serial)
  await expect(page.getByRole('heading', { level: 1, name: sh(first) })).toBeVisible()

  // Labelling a shelf: a label on nothing yet asks what it's on, and the camera stays on for the next.
  await hold(page, null)
  await page.goto('/#stock')
  await page.getByRole('button', { name: 'Scan' }).click()
  await hold(page, sh(first + 1))
  const claim = page.getByRole('form', { name: `Put ${sh(first + 1)} on an item` })
  await expect(claim.getByRole('heading')).toHaveText(`${sh(first + 1)} isn't on anything yet`)
  await expect(camera.getByRole('status')).toHaveText(`Read ${sh(first + 1)}`)
  await claim.getByLabel('Product').fill(speaker)
  await claim.getByLabel("Where it's kept").fill(bay)
  await expect(page.getByRole('button', { name: 'Scan', pressed: true })).toBeVisible()
  await expect(claim.getByRole('button', { name: `Put ${sh(first + 1)} on it` })).toBeInViewport()
  await page.screenshot(shot('scan-claim'))
  await claim.getByRole('button', { name: `Put ${sh(first + 1)} on it` }).click()
  const added = page.locator('p.added')
  await expect(added).toHaveText(`Added ${sh(first + 1)} (${speaker}) at ${bay}. Scan the next label.`)
  await expect(camera).toBeVisible()

  // Still in front of the camera, the same label isn't read again.
  await page.waitForTimeout(1500)
  await expect(page).toHaveURL(/#stock$/)
  await expect(added).toBeVisible()

  // The next label: the product and place are still there, so it's one tap.
  await hold(page, null)
  await page.waitForTimeout(1500)
  await hold(page, sh(first + 2))
  const next = page.getByRole('form', { name: `Put ${sh(first + 2)} on an item` })
  await expect(next.getByLabel('Product')).toHaveValue(speaker)
  await expect(next.getByLabel("Where it's kept")).toHaveValue(bay)
  await next.getByRole('button', { name: `Put ${sh(first + 2)} on it` }).click()
  await expect(added).toHaveText(`Added ${sh(first + 2)} (${speaker}) at ${bay}. Scan the next label.`)
  await expect(page.locator('.conn')).toHaveText('Up to date')

  // Back to a label already on: out of sight a moment, then read again, and it opens.
  await hold(page, null)
  await page.waitForTimeout(1500)
  await hold(page, sh(first + 1))
  await expect(page.getByRole('heading', { level: 1, name: sh(first + 1) })).toBeVisible()
  await expect(page.locator('.facts')).toContainText(bay)

  // Stop camera turns it off.
  await hold(page, null)
  await page.goto('/#stock')
  await page.getByRole('button', { name: 'Scan' }).click()
  await expect(camera.getByRole('status')).toHaveText('Point the camera at a label.')
  await expect(camera.getByText('Turning the camera on…')).toHaveCount(0)
  await page.screenshot(shot('scan-camera'))
  await camera.getByRole('button', { name: 'Stop camera' }).click()
  await expect(camera).toHaveCount(0)
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { camera: FakeCamera }).camera.tracks.every((t) => t.readyState === 'ended')))
    .toBe(true)
})

test('a blocked camera says what to do, and works once allowed', async ({ browser }) => {
  const page = await (await browser.newContext({ viewport: phoneSize })).newPage()
  await fakeCamera(page)
  await ready(page)
  await page.evaluate(() => ((window as unknown as { camera: FakeCamera }).camera.blocked = true))
  await page.getByRole('button', { name: 'Scan' }).click()
  const camera = page.getByLabel('Camera')
  await expect(camera.getByRole('alert')).toContainText("The camera is blocked for this app. Allow the camera for this site in the browser's settings")
  await page.evaluate(() => ((window as unknown as { camera: FakeCamera }).camera.blocked = false))
  await camera.getByRole('button', { name: 'Try again' }).click()
  await expect(camera.getByRole('status')).toHaveText('Point the camera at a label.')
  await expect(camera.getByRole('alert')).toHaveCount(0)
})
