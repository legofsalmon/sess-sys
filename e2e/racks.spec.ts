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

const AMP = { department: 'audio', category: 'Amps', tracking: 'serialised', isCase: false, valueCents: null, notes: '' }

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
  await page.getByLabel('Depth it takes, in mm').fill('800')
  await page.getByLabel('Weight empty, in kg').fill('14')
  await page.getByRole('button', { name: 'Add rack' }).click()
  await expect(page.getByRole('heading', { name: `Monitor rack ${id}`, level: 1 })).toBeVisible()

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
