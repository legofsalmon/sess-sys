import { expect, test, type Page } from '@playwright/test'
import { encode } from 'uqr'

/** A row of the pick list, whether it's still to do or folded under the done ones (audit, 20 October 2026, finding 5). */
const pickRow = (page: Page, name: string) => page.locator('article.pick-row').filter({ has: page.locator('header b').getByText(name, { exact: true }) })

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

async function newProduct(page: Page, name: string, counted?: number, department?: string) {
  await page.goto('/#stock')
  await page.getByRole('button', { name: 'Add product' }).click()
  const form = page.locator('form').filter({ has: page.getByRole('button', { name: 'Add product' }) })
  await form.getByLabel('Name').fill(name)
  if (department) await form.getByLabel('Department').selectOption({ label: department })
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
  // New job waits behind its button at the top of the list on a phone (audit finding 22).
  await page.getByRole('button', { name: 'New job', exact: true }).click()
  const form = page.locator('form').filter({ has: page.getByRole('button', { name: 'Add job' }) })
  await form.getByLabel('Job').fill(job)
  await form.getByLabel('Status').selectOption({ label: 'Confirmed' })
  await form.getByLabel('Phase 1', { exact: true }).fill('Show')
  await form.getByLabel('Phase 1 from').fill(fromToday(2))
  await form.getByLabel('Phase 1 to').fill(fromToday(3))
  await form.getByRole('button', { name: 'Add job' }).click()
  await expect(page.getByRole('heading', { level: 1, name: job })).toBeVisible()
  await page.getByRole('tab', { name: 'Kit and vans' }).click()
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
  const speakerRow = pickRow(page, speaker)
  const cableRow = pickRow(page, cable)
  await expect(speakerRow.locator('.count')).toHaveText('0 of 2 out')
  // A line a place with how many are there, the numbers folded under it (audit, 20 October 2026, finding 5).
  const speakersAt = speakerRow.getByRole('list', { name: 'Where to find them' })
  await expect(speakersAt.getByRole('listitem')).toHaveCount(1)
  await expect(speakersAt).toContainText(`${bay}: ${speakers.length} here`)
  await speakersAt.getByText(`The ${speakers.length} numbers`).click()
  await expect(speakersAt.locator('details p')).toHaveText(speakers.join(', '))
  await expect(cableRow.getByRole('list', { name: 'Where to find them' })).toHaveText('Warehouse: 40 here')

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

  // A mic that isn't on the kit, from a scanner that types: out, with a warning. Its keys go to the scan field from wherever focus
  // is, here the Scan button (audit, 20 October 2026, finding 98).
  await hold(page, null)
  await expect(page.getByLabel('Number or serial')).not.toBeFocused()
  await page.keyboard.type(micNumber!.toLowerCase())
  await expect(page.getByLabel('Number or serial')).toBeFocused()
  await expect(page.getByLabel('Number or serial')).toHaveValue(micNumber!.toLowerCase())
  await page.keyboard.press('Enter')
  await expect(said).toHaveText(`${micNumber} ${mic} out. It isn't on the kit for ${job}. Add it to the kit, or scan it back in if it isn't going.`)
  await expect(said).toHaveClass(/warn/)
  const micRow = pickRow(page, mic)
  await expect(micRow.locator('.kit-state')).toHaveText(`Not on the kit for ${job}.`)

  // The cables, counted out.
  const countOut = cableRow.getByRole('form', { name: `Count out ${cable}` })
  await countOut.getByLabel('How many').fill('12')
  await countOut.getByRole('button', { name: 'Count out', exact: true }).click()
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
  await expect(page.locator('.pick-total')).toHaveText('All 14 out: ready to load.')
  await expect(speakerRow.locator('.out-items')).toContainText(speakers[1]!)
  await hold(page, null)
  await page.getByRole('button', { name: 'Stop camera' }).click()
  await expect(page.locator('.conn')).toHaveText('Up to date')
  // The scan box stays under the top bar at the foot of the list.
  await page.evaluate(() => scrollTo(0, document.documentElement.scrollHeight))
  await expect(page.getByLabel('Number or serial')).toBeInViewport()

  // All out, the speakers are folded under what's done; the speaker's page says where it is, and the Stock tab lists the job as all out.
  await page.locator('.pick-done', { has: speakerRow }).locator('summary').click()
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
  await countBack.getByRole('button', { name: 'Count back', exact: true }).click()
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

/**
 * Picking on the phone (ADR 0072): someone who didn't plan the job picks
 * their own department's kit, walking the warehouse place by place, with
 * the planner's note on the row, a scan undone, and counted kit counted out
 * in one tap. Which department and which order are kept on the phone.
 */
test('picking on the phone: whose kit, a walk round the warehouse, notes, Undo and the rest in one tap', async ({ browser }) => {
  const id = tag()
  const speaker = named('L-Acoustics X12', id)
  const light = named('Robe Spiider', id)
  const cable = named('Socapex 20 m', id)
  const front = named('Bay A1', id)
  const back = named('Bay C4', id)
  const job = named('Harbour Lights', id)
  const context = await browser.newContext({ viewport: phoneSize })
  const page = await context.newPage()
  await ready(page)

  await newProduct(page, speaker, undefined, 'Audio')
  const speakers = await newItems(page, back, 2)
  await newProduct(page, light, undefined, 'Lighting')
  await newItems(page, front, 2)
  await newProduct(page, cable, 30, 'Power')

  await page.goto('/#jobs')
  await page.getByRole('button', { name: 'New job', exact: true }).click()
  const form = page.locator('form').filter({ has: page.getByRole('button', { name: 'Add job' }) })
  await form.getByLabel('Job').fill(job)
  await form.getByLabel('Status').selectOption({ label: 'Confirmed' })
  await form.getByLabel('Phase 1', { exact: true }).fill('Load in')
  await form.getByLabel('Phase 1 from').fill(fromToday(2))
  await form.getByLabel('Phase 1 to').fill(fromToday(3))
  await form.getByRole('button', { name: 'Add job' }).click()
  await expect(page.getByRole('heading', { level: 1, name: job })).toBeVisible()
  await page.getByRole('tab', { name: 'Kit and vans' }).click()
  await page.getByRole('button', { name: 'Add kit' }).click()
  for (const [product, qty] of [
    [speaker, 2],
    [light, 2],
    [cable, 20],
  ] as const) {
    const add = page.getByRole('form', { name: 'Add kit' })
    await add.getByLabel('Product').fill(product)
    await add.getByLabel('How many').fill(String(qty))
    await add.getByRole('button', { name: 'Add to kit' }).click()
  }
  // The planner's note, for whoever picks it.
  const kit = page.getByRole('region', { name: 'Kit' })
  await kit.getByRole('article', { name: `2 × ${speaker}` }).getByRole('button', { name: 'Change' }).click()
  await page.getByRole('form', { name: `Change ${speaker}` }).getByLabel('Note').fill('The pair with the new grilles')
  await page.getByRole('form', { name: `Change ${speaker}` }).getByRole('button', { name: /^Save/ }).click()
  await expect(kit.locator('.pick-link')).toContainText('24 to go out')
  await expect(page.locator('.conn')).toHaveText('Up to date')
  await kit.getByRole('link', { name: 'Pick list' }).click()

  // When it's needed, before starting.
  await expect(page.getByRole('list', { name: 'Before you start' })).toContainText('In 2 days: Load in,')

  // Their own department's kit: only audio, with the note.
  const whose = page.getByRole('group', { name: 'Whose kit' })
  await whose.getByRole('button', { name: /^Audio/ }).click()
  await expect(page.locator('.pick-total')).toHaveText('Audio: 0 of 2 out · 0 of 24 in all')
  await expect(page.locator('article.pick-row')).toHaveCount(1)
  await expect(pickRow(page, speaker).locator('.pick-note')).toHaveText('Note The pair with the new grilles')
  // Kept on the phone.
  await page.reload()
  await expect(page.getByRole('group', { name: 'Whose kit' }).getByRole('button', { name: /^Audio/ })).toHaveAttribute('aria-pressed', 'true')

  // A scan, undone.
  const said = page.getByRole('status', { name: 'Last scan' })
  await page.getByLabel('Number or serial').fill(speakers[0]!)
  await page.getByLabel('Number or serial').press('Enter')
  await expect(said).toHaveText(`${speakers[0]} ${speaker}: 1 of 2 out.`)
  await page.getByRole('button', { name: 'Undo' }).click()
  await expect(said).toHaveText(`Undone: ${speakers[0]} ${speaker} isn't out: it's back in stock.`)
  await expect(page.locator('.pick-total')).toHaveText('Audio: 0 of 2 out · 0 of 24 in all')
  await expect(page.getByRole('button', { name: 'Undo' })).toHaveCount(0)

  // Everything, as a walk round the warehouse: place by place, in the stock list's order.
  await page.getByRole('group', { name: 'Whose kit' }).getByRole('button', { name: 'All' }).click()
  await page.getByRole('group', { name: 'In what order' }).getByRole('button', { name: "By where it's kept" }).click()
  const list = page.getByRole('region', { name: 'Kit' })
  await expect(list.locator('.kit-group h3')).toHaveText([front, back, 'Warehouse'])
  await expect(list.locator('.kit-group', { has: page.getByRole('heading', { name: front }) }).locator('article.pick-row header b')).toHaveText([light])

  // The cables in one tap, and undone.
  const cableRow = pickRow(page, cable)
  await cableRow.getByRole('button', { name: 'Count out the 20' }).click()
  await expect(said).toHaveText(`20 × ${cable} counted out.`)
  await expect(page.locator('.pick-total')).toHaveText('20 of 24 out')
  await page.screenshot(shot('pick-walk'))
  await page.getByRole('button', { name: 'Undo' }).click()
  await expect(said).toHaveText(`Undone: 20 × ${cable} not counted out.`)
  await expect(page.locator('.pick-total')).toHaveText('0 of 24 out')
  await expect(page.locator('.conn')).toHaveText('Up to date')
  await context.close()
})

// An item scanned out of a rack reported missing says the rack is what was marked found, and "It's not in … any more"
// takes it out of the rack and reports the rack missing again (audit, 20 October 2026, finding 102).
test('a speaker scanned from a rack reported missing, then said to be out of the rack', async ({ browser, request }) => {
  const id = tag()
  const at = new Date().toISOString()
  const setUp = [
    { name: 'model.create', args: { id: `rk${id}`, name: `Speaker rack ${id}`, department: 'audio', category: 'Cases', tracking: 'serialised', isCase: true, valueCents: null, notes: '' } },
    { name: 'model.create', args: { id: `sp${id}`, name: `d&b E8 ${id}`, department: 'audio', category: 'Speakers', tracking: 'serialised', isCase: false, valueCents: null, notes: '' } },
    { name: 'place.upsert', args: { id: `b${id}`, name: `Bay C1 ${id}`, notes: '' } },
    { name: 'asset.add', args: { id: `r${id}`, modelId: `rk${id}`, number: null, serial: '', placeId: `b${id}`, caseId: null, notes: '', fromCount: false } },
    ...[1, 2, 3].map((n) => ({
      name: 'asset.add',
      args: { id: `s${n}${id}`, modelId: `sp${id}`, number: null, serial: `E8-${n}-${id}`, placeId: null, caseId: `r${id}`, notes: '', fromCount: false },
    })),
    { name: 'project.create', args: { id: `lost${id}`, name: `Lost rack job ${id}`, clientId: null, venueId: null, status: 'confirmed', notes: '' } },
    { name: 'project.create', args: { id: `next${id}`, name: `Next job ${id}`, clientId: null, venueId: null, status: 'confirmed', notes: '' } },
    { name: 'move.record', args: { id: `mv${id}`, projectId: `lost${id}`, direction: 'out', assetId: `r${id}`, modelId: `rk${id}`, qty: 1, at } },
    { name: 'fault.report', args: { id: `f${id}`, kind: 'missing', assetId: `r${id}`, modelId: `rk${id}`, qty: 1, projectId: `lost${id}`, usable: false, note: 'Not back from the venue', at } },
  ].map((m, i) => ({ ...m, id: `setup${id}${i}`, createdAt: at }))
  const pushed = await request.post('/api/sync/push', { data: { clientId: `office${id}`, mutations: setUp } })
  expect((await pushed.json()).results.map((r: { status: string }) => r.status)).toEqual(setUp.map(() => 'applied'))

  const page = await (await browser.newContext({ viewport: phoneSize })).newPage()
  await ready(page, `#stock/item/r${id}`)
  const rack = (await page.getByRole('heading', { level: 1 }).textContent())!.match(/SH-\d{6}/)![0]
  await ready(page, `#jobs/next${id}/pick`)
  await page.getByLabel('Number or serial').fill(`E8-1-${id}`)
  await page.getByLabel('Number or serial').press('Enter')
  const said = page.getByRole('status', { name: 'Last scan' })
  await expect(said).toContainText(`It was out with Lost rack job ${id}; now it's out with Next job ${id}.`)
  await expect(said).toContainText(`${rack}, the case it's kept in, was reported missing; it's marked found since this was in it.`)
  await page.getByRole('button', { name: `It's not in ${rack} any more` }).click()
  await expect(said).toHaveText(/^SH-\d{6} is out of SH-\d{6}, and SH-\d{6} is reported missing again\.$/)
  await expect(page.locator('.conn')).toHaveText('Up to date')
  // The rack is missing again, with its note; the speaker isn't in it.
  await ready(page, `#stock/item/r${id}`)
  await expect(page.locator('.facts')).toContainText('Missing: Not back from the venue')
  await ready(page, `#stock/item/s1${id}`)
  await expect(page.locator('.facts')).not.toContainText(rack)
})
