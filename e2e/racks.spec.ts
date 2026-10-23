import { expect, test, type APIRequestContext } from '@playwright/test'

/**
 * Racks (ADR 0074), as the warehouse meets them: a rack added on Stock ›
 * Racks with its stock code and size, its layout built up on its page and
 * drawn front and back, what won't fit said, and a built rack checked
 * against its layout. The test server is shared, so names carry this run's
 * own tag. SHOTS=1 refreshes the blueprint's pictures.
 */

const shot = (name: string) => (process.env.SHOTS ? { path: `docs/hub/img/${name}.png` } : undefined)
const deskSize = { width: 1280, height: 900 }
const phoneSize = { width: 390, height: 844 }

async function push(request: APIRequestContext, id: string, mutations: [string, Record<string, unknown>][]) {
  const res = await request.post('/api/sync/push', {
    data: { clientId: `racks-${id}`, mutations: mutations.map(([name, args], i) => ({ id: `racks-${id}-${i}`, name, args, createdAt: new Date().toISOString() })) },
  })
  const { results } = (await res.json()) as { results: { status: string; reason?: { message: string } }[] }
  expect(results.map((r) => r.reason?.message ?? r.status)).toEqual(mutations.map(() => 'applied'))
}

const AMP = { department: 'audio', category: 'Amps', tracking: 'serialised', isCase: false, valueCents: null, notes: '', rackMount: true }

test('a rack, laid out, drawn, and a built one checked against its layout', async ({ browser, request }) => {
  const id = Date.now().toString(36)
  const amp = `Lab Gruppen D80 ${id}`
  const mon = `Shure PSM1000 ${id}`
  const place = `Rack bay ${id}`
  await push(request, id, [
    ['place.upsert', { id: `wh-${id}`, name: place, notes: '' }],
    ['model.create', { id: `amp-${id}`, name: amp, ...AMP, units: 2, depthMm: 420, weightKg: 11.5, powerW: 1600 }],
    ['model.create', { id: `mon-${id}`, name: mon, ...AMP, units: 1, depthMm: 300, weightKg: 4.2, powerW: 60 }],
  ])

  const page = await (await browser.newContext({ viewport: deskSize })).newPage()
  await page.goto('/#stock/racks')
  await expect(page.locator('.conn')).toHaveText('Up to date')
  await page.getByRole('button', { name: 'Add rack' }).click()
  await page.getByLabel('Name').fill(`Monitor rack ${id}`)
  await page.getByLabel('Stock code').fill(`RK-${id}`)
  await page.getByLabel('Room in it, in rack units').fill('4')
  await page.getByLabel('Rail to rail depth, in mm').fill('800')
  await page.getByLabel('Weight empty, in kg').fill('14')
  await page.getByRole('button', { name: 'Add rack' }).click()
  // A new rack opens in the designer; this test lays it out on its page.
  await expect(page.getByRole('heading', { name: `Monitor rack ${id}`, level: 1 })).toBeVisible()
  await page.getByRole('link', { name: `Monitor rack ${id}` }).first().click()
  await expect(page.getByRole('region', { name: 'Layout' })).toBeVisible()

  const layout = page.getByRole('region', { name: 'Layout' })
  const add = async (product: string, top?: string, side?: 'Front' | 'Back') => {
    if (!(await layout.getByLabel('What goes in it').isVisible())) await layout.getByRole('button', { name: 'Add to the layout' }).click()
    await layout.getByLabel('What goes in it').fill(product)
    await layout.getByLabel('What goes in it').press('Enter')
    if (top) await layout.getByLabel('Top at rack unit').fill(top)
    if (side) await layout.getByLabel('Front or back').selectOption({ label: side })
    await layout.getByRole('button', { name: 'Add to the layout' }).click()
  }
  await add(amp)
  await add(mon)
  await add(mon, '4', 'Back')
  await expect(layout.getByText('Front 3 of 4U, back 1 of 4U · 33.9 kg · 1,720 W')).toBeVisible()
  // A second amp at the top of the back would meet the one on the front in the middle.
  await add(amp, '1', 'Back')
  await expect(layout.getByText(`${amp} on the front and ${amp} on the back meet in the middle: 840 mm in a 800 mm rack.`)).toBeVisible()
  await expect(page.locator('.conn')).toHaveText('Up to date')
  await layout.getByRole('button', { name: 'Close' }).click()
  // The top bar stays put as the page scrolls, so it's moved out of the way of the picture.
  if (process.env.SHOTS) await layout.screenshot({ ...shot('rack-layout'), style: '.top { position: static !important }' })
  await layout.getByRole('button', { name: `Take ${amp} out of the layout` }).last().click()
  await expect(layout.getByText('meet in the middle')).toHaveCount(0)

  // A rack built of it, with one amp in: short its monitor kit.
  await push(request, `${id}-b`, [
    ['asset.add', { id: `r-${id}`, modelId: (await rackId(page)) as string, number: null, serial: '', placeId: `wh-${id}`, caseId: null, notes: '', fromCount: false }],
    ['asset.add', { id: `a-${id}`, modelId: `amp-${id}`, number: null, serial: '', placeId: null, caseId: `r-${id}`, notes: '', fromCount: false }],
  ])
  await expect(layout.getByText('2 missing')).toBeVisible()
  await page.goto(`/#stock/item/r-${id}`)
  const check = page.getByRole('region', { name: 'Against its layout' })
  await expect(check.getByText(`2 × ${mon}`)).toBeVisible()

  // The amp in it goes with the rack.
  await page.goto(`/#stock/item/a-${id}`)
  await expect(page.getByText(/^Monitor rack .*, and goes out with it$/)).toBeVisible()

  // The list of racks says how they stand, found by the stock code too.
  const phone = await (await browser.newContext({ viewport: phoneSize })).newPage()
  await phone.goto('/#stock/racks')
  await expect(phone.locator('.conn')).toHaveText('Up to date')
  const row = phone.getByRole('link', { name: new RegExp(`^Monitor rack ${id}`) })
  await expect(row).toContainText(`RK-${id} · 4U, 800 mm deep · 3 things in its layout`)
  await expect(row).toContainText('Not all there')
  await phone.screenshot(shot('racks-phone'))
  await phone.goto('/#stock')
  await phone.getByLabel('Find', { exact: true }).fill(`rk-${id}`)
  await expect(phone.getByRole('link', { name: new RegExp(`^Monitor rack ${id}`) })).toBeVisible()
})

/** The open product's id, from the address. */
async function rackId(page: import('@playwright/test').Page) {
  return decodeURIComponent(/#stock\/product\/(.+)$/.exec(page.url())![1]!)
}

test('the rack designer: kit dragged in from ours and dry hire, moved, taken out, and what it costs to hire in', async ({ browser, request }) => {
  const id = Date.now().toString(36)
  const amp = `Powersoft X8 ${id}`
  const haze = `MDG ATMe ${id}`
  await push(request, id, [
    ['place.upsert', { id: `wh-${id}`, name: `Designer bay ${id}`, notes: '' }],
    ['model.create', { id: `amp-${id}`, name: amp, ...AMP, units: 2, depthMm: 480, weightKg: 12, powerW: 2000 }],
    ['asset.add', { id: `a1-${id}`, modelId: `amp-${id}`, number: null, serial: '', placeId: `wh-${id}`, caseId: null, notes: '', fromCount: false }],
    ['model.create', { id: `haze-${id}`, name: haze, ...AMP, category: 'Haze', units: 3, depthMm: 400, dryHire: true, supplier: 'PRG', hireDayCents: 4500, valueCents: 350000 }],
    ['model.create', { id: `rack-${id}`, name: `Amp rack ${id}`, department: 'audio', category: 'Racks', tracking: 'serialised', isCase: true, isRack: true, valueCents: null, notes: '', units: 6, depthMm: 600 }],
  ])

  const page = await (await browser.newContext({ viewport: deskSize })).newPage()
  await page.goto(`/#stock/racks/rack-${id}`)
  await expect(page.locator('.conn')).toHaveText('Up to date')
  const palette = page.getByRole('region', { name: 'Kit to build with' })
  const rack = page.getByRole('region', { name: 'The rack' })
  // A desk opens it in 3D (below); this part works on it drawn flat.
  await rack.getByRole('button', { name: 'Front and back' }).click()
  await palette.getByLabel('Find kit').fill(id)
  await expect(palette.getByRole('button', { name: `Pick up ${amp}` })).toContainText('2U, 480 mm · 1 free today')
  await expect(palette.getByRole('button', { name: `Pick up ${haze}` })).toContainText('Dry hire from PRG')

  // Dragged in from the list.
  await palette.getByRole('button', { name: `Pick up ${amp}` }).dragTo(rack.getByRole('button', { name: 'U1 front' }))
  await expect(rack.getByRole('button', { name: `${amp}, U1–2 on the front` })).toBeVisible()
  // Picked up and put down by pressing, as on a phone.
  await palette.getByRole('button', { name: `Pick up ${haze}` }).click()
  await expect(page.getByText(`Holding ${haze}. Press where it goes.`)).toBeVisible()
  await rack.getByRole('button', { name: 'U3 front' }).click()
  await expect(rack.getByRole('button', { name: `${haze}, U3–5 on the front` })).toBeVisible()
  await expect(page.getByText('1 thing dry hired: €45 a day to hire in, €3,500 to buy')).toBeVisible()
  await expect(page.locator('.conn')).toHaveText('Up to date')
  if (process.env.SHOTS) await page.screenshot({ path: 'docs/hub/img/rack-designer.png' })

  // Moved to the back, then dragged back to the list to take it out.
  await rack.getByRole('button', { name: `${amp}, U1–2 on the front` }).dragTo(rack.getByRole('button', { name: 'U4 back' }))
  await expect(rack.getByRole('button', { name: `${amp}, U4–5 on the back` })).toBeVisible()
  await rack.getByRole('button', { name: `${haze}, U3–5 on the front` }).dragTo(palette)
  await expect(rack.getByRole('button', { name: new RegExp(`^${haze}`) })).toHaveCount(0)
  await expect(page.getByText('dry hired:')).toHaveCount(0)

  // In 3D (ADR 0076): picked up, and put down on the face towards you, square to the front.
  await rack.getByRole('button', { name: 'In 3D' }).click()
  const scene = rack.getByRole('img', { name: new RegExp(`^Amp rack ${id} in 3D`) })
  await expect(scene).toHaveAccessibleName(new RegExp(`1 thing on the rails: ${amp} at U4 on the back`))
  await expect(scene.locator('canvas')).toBeVisible()
  await rack.getByRole('button', { name: 'Front', exact: true }).click()
  await palette.getByRole('button', { name: `Pick up ${haze}` }).click()
  await scene.click()
  await expect(scene).toHaveAccessibleName(new RegExp(`2 things on the rails: .*${haze} at U3 on the front`))
  if (process.env.SHOTS) {
    await rack.getByRole('button', { name: 'At an angle' }).click()
    await page.screenshot({ path: 'docs/hub/img/rack-3d.png' })
  }
  // From the side, the hazer and the amp behind it meet in the middle.
  await rack.getByRole('button', { name: 'From the side' }).click()
  await expect(rack.getByRole('img', { name: `Amp rack ${id} from the side, 600 mm rail to rail` })).toBeVisible()
  await expect(page.getByText(`${haze} on the front and ${amp} on the back meet in the middle: 880 mm in a 600 mm rack.`)).toBeVisible()

  // A product ticked as rack-mount shows its size in a rack; one that isn't, doesn't.
  await page.goto(`/#stock/product/haze-${id}`)
  await page.getByRole('button', { name: 'Change details' }).click()
  await expect(page.getByLabel('Height, in rack units')).toHaveValue('3')
  await page.getByRole('checkbox', { name: /^Rack-mount/ }).uncheck()
  await expect(page.getByLabel('Height, in rack units')).toHaveCount(0)
  await page.getByRole('checkbox', { name: /^Rack-mount/ }).check()
  await page.getByLabel('Width').selectOption({ label: 'Half width' })
  await page.getByRole('button', { name: 'Save product' }).click()
  await expect(page.getByText('rack-mount, 3U, half width, 400 mm deep')).toBeVisible()

  // The catalogue tells ours from dry hire.
  await page.goto('/#stock')
  const whose = page.getByRole('group', { name: 'Whose' })
  await whose.getByRole('button', { name: /^Dry hire/ }).click()
  await page.getByLabel('Find', { exact: true }).fill(id)
  await expect(page.getByRole('link', { name: new RegExp(`^${haze}`) })).toContainText('Dry hire from PRG')
  await expect(page.getByRole('link', { name: new RegExp(`^${amp}`) })).toHaveCount(0)
})

test('building a rack up: half-width kit side by side, labels, groups and tape, a drawer, blanks, undo, and a copy', async ({ browser, request }) => {
  const id = Date.now().toString(36)
  const rx = `Shure AD4D ${id}`
  const drawer = `2U drawer ${id}`
  const xlr = `XLR loom ${id}`
  const PART = { ...AMP, category: 'Rack parts', tracking: 'bulk' }
  await push(request, id, [
    ['model.create', { id: `rx-${id}`, name: rx, ...AMP, category: 'RF', units: 1, rackWidth: 'half', depthMm: 300 }],
    ['model.create', { id: `drawer-${id}`, name: drawer, ...PART, units: 2, depthMm: 350, rackPart: 'drawer' }],
    ['model.create', { id: `blank-${id}`, name: `1U blank ${id}`, ...PART, units: 1, rackPart: 'blank' }],
    ['model.create', { id: `xlr-${id}`, name: xlr, ...AMP, rackMount: false, tracking: 'bulk', category: 'Cable' }],
    ['model.create', { id: `rack-${id}`, name: `RF rack ${id}`, department: 'audio', category: 'Racks', tracking: 'serialised', isCase: true, isRack: true, valueCents: null, notes: '', units: 4, depthMm: 450 }],
  ])

  const page = await (await browser.newContext({ viewport: deskSize })).newPage()
  await page.goto(`/#stock/racks/rack-${id}`)
  await expect(page.locator('.conn')).toHaveText('Up to date')
  const palette = page.getByRole('region', { name: 'Kit to build with' })
  const rack = page.getByRole('region', { name: 'The rack' })
  await rack.getByRole('button', { name: 'Front and back' }).click()
  await palette.getByLabel('Find kit').fill(id)

  // Two half-width receivers side by side on one unit, placed by where they're pressed.
  const u1 = rack.getByRole('button', { name: 'U1 front' })
  const box = (await u1.boundingBox())!
  await palette.getByRole('button', { name: `Pick up ${rx}` }).click()
  await u1.click({ position: { x: box.width * 0.3, y: box.height / 2 } })
  await palette.getByRole('button', { name: `Pick up ${rx}` }).click()
  await u1.click({ position: { x: box.width * 0.95, y: box.height / 2 } })
  await expect(rack.getByRole('button', { name: `${rx}, U1 on the left on the front` })).toBeVisible()
  await expect(rack.getByRole('button', { name: `${rx}, U1 on the right on the front` })).toBeVisible()
  await expect(page.getByRole('list', { name: "What won't work" })).toHaveCount(0)

  // Picked up, it's labelled, grouped and taped.
  await rack.getByRole('button', { name: `${rx}, U1 on the left on the front` }).click()
  const details = page.getByRole('form', { name: `${rx} in this rack` })
  await details.getByLabel('Label').fill('IEM 1–2')
  await details.getByLabel('Group').fill('RF')
  await details.getByLabel('Tape colour').selectOption({ label: 'Blue' })
  await details.getByRole('button', { name: `Save ${rx}` }).click()
  const labelled = rack.getByRole('button', { name: `IEM 1–2 (${rx}), U1 on the left on the front, RF, blue tape` })
  await expect(labelled).toBeVisible()
  await expect(rack.getByText('RF · 1 thing, blue tape')).toBeVisible()

  // Undo takes it back, Redo puts it again.
  await page.getByRole('button', { name: 'Undo' }).click()
  await expect(rack.getByRole('button', { name: `${rx}, U1 on the left on the front` })).toBeVisible()
  await page.keyboard.press('Control+Shift+Z')
  await expect(labelled).toBeVisible()

  // A drawer, and the loom in it.
  await palette.getByRole('button', { name: `Pick up ${drawer}` }).click()
  await rack.getByRole('button', { name: 'U3 front' }).click()
  await palette.getByRole('button', { name: 'Everything, to go loose' }).click()
  await palette.getByRole('button', { name: `Pick up ${xlr}` }).click()
  await rack.getByRole('button', { name: 'Put it loose in the rack' }).click()
  await rack.getByRole('button', { name: xlr }).click()
  await page.getByRole('form', { name: `${xlr} in this rack` }).getByRole('combobox', { name: 'In', exact: true }).selectOption({ label: `${drawer} at U3` })
  await page.getByRole('button', { name: `Save ${xlr}` }).click()
  await expect(rack.getByRole('heading', { name: `In the ${drawer} at U3` })).toBeVisible()

  // The gap left on the front is filled with a blank.
  await page.getByRole('button', { name: 'Fill the gaps with blanks' }).click()
  await expect(rack.getByRole('button', { name: /, U2 on the front$/ })).toHaveCount(1)
  await expect(page.getByRole('button', { name: 'Fill the gaps with blanks' })).toHaveCount(0)
  await expect(page.locator('.conn')).toHaveText('Up to date')
  if (process.env.SHOTS) {
    await rack.getByRole('button', { name: 'In 3D' }).click()
    await rack.getByRole('button', { name: 'Front', exact: true }).click()
    await page.screenshot({ path: 'docs/hub/img/rack-built-up.png' })
    await rack.getByRole('button', { name: 'Front and back' }).click()
  }

  // Copied, the new rack has the same layout, labels and all.
  await page.getByRole('button', { name: 'Copy this rack' }).click()
  await page.getByLabel('Name of the copy').fill(`RF rack B ${id}`)
  await page.getByRole('button', { name: 'Copy it' }).click()
  await expect(page.getByRole('heading', { name: `RF rack B ${id}`, level: 1 })).toBeVisible()
  await expect(rack.getByRole('button', { name: `IEM 1–2 (${rx}), U1 on the left on the front, RF, blue tape` })).toBeVisible()
  await expect(rack.getByRole('heading', { name: `In the ${drawer} at U3` })).toBeVisible()
})
