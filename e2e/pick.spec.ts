import { expect, test, type Page } from '@playwright/test'
import { encode } from 'uqr'

/**
 * Pick lists end to end (ADR 0017), at phone size: a job two days out needs
 * two speakers and 12 cables. Its pick list says where they are; the
 * speakers are scanned out with the camera (one held still is read once,
 * and one scanned again is already out), a microphone not on the kit goes
 * out with a warning and comes off with Not going, and the cables are
 * counted out. The item's page and the Stock tab say what's out. With no
 * signal, it all comes back: a speaker scanned in, the cables counted back,
 * the other speaker's label typed by a scanner. The phone's camera is
 * stood in for by a picture the test draws, as in scan.spec.ts. The test
 * server is shared with the other browser tests, so names are this run's
 * own and numbers are read off the screen. To refresh the blueprint
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

interface FakeCamera {
  show(modules: boolean[][] | null): void
}

/** A camera that films whatever the test puts in front of it. */
async function fakeCamera(page: Page) {
  await page.addInitScript(() => {
    const canvas = document.createElement('canvas')
    canvas.width = 640
    canvas.height = 480
    const ctx = canvas.getContext('2d')!
    let shown: boolean[][] | null = null
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
    }
    ;(window as unknown as { camera: FakeCamera }).camera = camera
    Object.defineProperty(navigator, 'mediaDevices', { value: { getUserMedia: async () => canvas.captureStream(20) } })
  })
}

/** Holds a QR code saying `text` in front of the camera; nothing for just the grey. */
const hold = (page: Page, text: string | null) =>
  page.evaluate((modules) => (window as unknown as { camera: FakeCamera }).camera.show(modules), text ? encode(text, { ecc: 'H', border: 0 }).data : null)

async function ready(page: Page, hash = '#stock') {
  await page.goto(`/${hash}`)
  await expect(page.locator('.conn')).toHaveText('Up to date')
}

async function newProduct(page: Page, name: string, counted?: number) {
  await page.goto('/#stock')
  await page.getByRole('button', { name: 'Add product' }).click()
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
  await makePlace(page)
  await expect(page.locator('.count', { hasText: 'Warehouse' })).toContainText(String(counted))
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
    const number = (await add.locator('.added').textContent())!.slice(6, -1)
    expect(numbers).not.toContain(number)
    numbers.push(number)
  }
  await expect(page.locator('.conn')).toHaveText('Up to date')
  return numbers
}

test('a pick list: kit found, scanned and counted out, then back with no signal', async ({ browser }) => {
  const id = tag()
  const speaker = named('d&b Y10P', id)
  const cable = named('XLR 10 m', id)
  const mic = named('Shure SM58', id)
  const bay = named('Bay A3', id)
  const job = named('Nissan launch', id)
  const context = await browser.newContext({ viewport: phoneSize })
  const page = await context.newPage()
  await fakeCamera(page)
  await ready(page)

  await newProduct(page, speaker)
  const speakers = await newItems(page, bay, 3)
  await newProduct(page, cable, 40)
  await newProduct(page, mic)
  const [micNumber] = await newItems(page, bay, 1)

  // A confirmed job two days out, needing two speakers and 12 cables.
  await page.goto('/#jobs')
  const form = page.locator('form').filter({ has: page.getByRole('button', { name: 'Add job' }) })
  await form.getByLabel('Job').fill(job)
  await form.getByLabel('Status').selectOption({ label: 'Confirmed' })
  await form.getByLabel('Phase 1', { exact: true }).fill('Show')
  await form.getByLabel('Phase 1 from').fill(fromToday(2))
  await form.getByLabel('Phase 1 to').fill(fromToday(3))
  await form.getByRole('button', { name: 'Add job' }).click()
  await expect(page.getByRole('heading', { level: 1, name: job })).toBeVisible()
  await page.getByRole('button', { name: 'Add kit' }).click()
  for (const [product, qty] of [
    [speaker, 2],
    [cable, 12],
  ] as const) {
    const add = page.getByRole('form', { name: 'Add kit' })
    await add.getByLabel('Product').fill(product)
    await add.getByLabel('How many').fill(String(qty))
    await add.getByRole('button', { name: 'Add to kit' }).click()
  }
  const kit = page.getByRole('region', { name: 'Kit' })
  await expect(kit.locator('.pick-link')).toContainText('14 to go out')
  await kit.getByRole('link', { name: 'Pick list' }).click()

  // What's needed, and where to find it.
  await expect(page.getByRole('heading', { level: 1, name: 'Pick list' })).toBeVisible()
  await expect(page.locator('.pick-total')).toHaveText('0 of 14 out')
  const speakerRow = page.getByRole('article', { name: speaker })
  const cableRow = page.getByRole('article', { name: cable })
  await expect(speakerRow.locator('.count')).toHaveText('0 of 2 out')
  await expect(speakerRow.getByRole('list', { name: 'Where to find them' })).toHaveText(`${bay}: ${speakers.join(', ')}`)
  await expect(cableRow.getByRole('list', { name: 'Where to find them' })).toHaveText('Warehouse: 40 counted')

  // The first speaker, with the camera; held still, it's read once.
  await page.getByRole('button', { name: 'Scan' }).click()
  const said = page.getByRole('status', { name: 'Last scan' })
  await hold(page, speakers[0]!)
  await expect(said).toHaveText(`${speakers[0]} ${speaker}: 1 of 2 out.`)
  await expect(said).toHaveClass(/ok/)
  await page.waitForTimeout(1500)
  await expect(page.locator('.pick-total')).toHaveText('1 of 14 out')
  // Out of sight and back again: it's already out.
  await hold(page, null)
  await page.waitForTimeout(1500)
  await hold(page, speakers[0]!)
  await expect(said).toHaveText(`${speakers[0]} ${speaker} is already out with ${job}.`)

  // A mic that isn't on the kit, from a scanner that types: out, with a warning.
  await hold(page, null)
  await page.getByLabel('Number or serial').fill(micNumber!.toLowerCase())
  await page.getByLabel('Number or serial').press('Enter')
  await expect(said).toHaveText(`${micNumber} ${mic} out. It isn't on the kit for ${job}. Add it to the kit, or scan it back in if it isn't going.`)
  await expect(said).toHaveClass(/warn/)
  const micRow = page.getByRole('article', { name: mic })
  await expect(micRow.locator('.kit-state')).toHaveText(`Not on the kit for ${job}.`)

  // The cables, counted out.
  const countOut = cableRow.getByRole('form', { name: `Count out ${cable}` })
  await countOut.getByLabel('How many').fill('12')
  await countOut.getByRole('button', { name: 'Out' }).click()
  await expect(cableRow.locator('.count')).toHaveText('12 of 12 out')
  await expect(page.locator('.pick-total')).toHaveText('13 of 14 out')
  await expect(page.locator('.conn')).toHaveText('Up to date')
  await page.getByRole('region', { name: 'Kit' }).evaluate((el) => scrollTo(0, el.getBoundingClientRect().top + scrollY - 64))
  await page.screenshot(shot('pick-out'))

  // The mic isn't going after all; the second speaker is.
  await micRow.getByRole('button', { name: 'Not going' }).click()
  await expect(micRow).toHaveCount(0)
  await hold(page, speakers[1]!)
  await expect(said).toHaveText(`${speakers[1]} ${speaker}: 2 of 2 out.`)
  await expect(page.locator('.pick-total')).toHaveText('14 of 14 out')
  await expect(speakerRow.getByRole('list', { name: 'Out' })).toContainText(speakers[1]!)
  await hold(page, null)
  await page.getByRole('button', { name: 'Stop camera' }).click()
  await expect(page.locator('.conn')).toHaveText('Up to date')

  // The speaker's page says where it is, and the Stock tab lists the job as all out.
  await speakerRow.getByRole('link', { name: speakers[0]! }).click()
  await expect(page.locator('.facts')).toContainText(`OutWith ${job} since today at`)
  await page.goto('/#stock')
  await expect(page.getByRole('region', { name: 'Pick lists' }).locator('.job-row', { hasText: job })).toContainText('14 of 14 out')

  // Coming back, with no signal.
  await page.getByRole('region', { name: 'Pick lists' }).locator('.job-row', { hasText: job }).click()
  await context.setOffline(true)
  await page.getByRole('button', { name: 'Coming back' }).click()
  // The mic that wasn't going counts as back.
  await expect(page.locator('.pick-total')).toHaveText('1 back, 14 still out')
  await page.getByRole('button', { name: 'Scan' }).click()
  await hold(page, speakers[0]!)
  await expect(said).toHaveText(`${speakers[0]} ${speaker} back: 1 of 2 back.`)
  await hold(page, null)
  // One that never went out: nothing to bring back.
  await page.getByLabel('Number or serial').fill(speakers[2]!)
  await page.getByLabel('Number or serial').press('Enter')
  await expect(said).toHaveText(`${speakers[2]} ${speaker} isn't out, so there's nothing to bring back.`)
  const countBack = cableRow.getByRole('form', { name: `Count back ${cable}` })
  await countBack.getByLabel('How many').fill('10')
  await countBack.getByRole('button', { name: 'Back' }).click()
  await expect(cableRow.locator('.count')).toHaveText('2 still out')
  await expect(page.locator('.pick-total')).toHaveText('12 back, 3 still out')
  await expect(page.locator('.conn')).toContainText('No signal')
  await page.getByRole('button', { name: 'Stop camera' }).click()
  await page.screenshot(shot('pick-back'))

  // Signal back: it all goes through.
  await context.setOffline(false)
  await page.getByLabel('Number or serial').fill(speakers[1]!)
  await page.getByLabel('Number or serial').press('Enter')
  await expect(said).toHaveText(`${speakers[1]} ${speaker} back: 2 of 2 back.`)
  await expect(speakerRow.locator('.count')).toHaveText('All 2 back')
  await expect(page.locator('.conn')).toHaveText('Up to date')
  await page.reload()
  await page.getByRole('button', { name: 'Coming back' }).click()
  await expect(page.locator('.pick-total')).toHaveText('13 back, 2 still out')
})
