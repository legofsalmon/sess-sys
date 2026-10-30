import { expect, test, type APIRequestContext } from '@playwright/test'

/**
 * Screens across the app (audit, 20 October 2026, findings 13, 58, 60, 61, 74 to 78): what scrolls sideways says there's more
 * that way, Cmd-P prints the screen as it is, the skills box's offers stay clear of the tabs and out of the Tab order, Venues
 * can be searched, a job's kind is said once and a bad email is said in a line that stays. The test server is shared with the
 * other browser tests, so every name here is this run's own.
 */

const phoneSize = { width: 390, height: 844 }
const laptopSize = { width: 1280, height: 800 }
const tag = () => Math.random().toString(36).slice(2, 8)

async function push(request: APIRequestContext, mutations: { name: string; args: unknown }[]) {
  const id = tag()
  const res = await request.post('/api/sync/push', {
    data: { clientId: `edges-${id}`, mutations: mutations.map((m, i) => ({ id: `edges-${id}-${i}`, ...m, createdAt: new Date().toISOString() })) },
  })
  expect((await res.json()).results.every((r: { status: string }) => r.status === 'applied')).toBe(true)
}

test("a job's parts on a phone fade where there are more, the next part shows, and the kind is said once", async ({ browser, request }) => {
  // Proves (findings 13 and 77a): the row of a job's parts is wider than a phone, so its right edge fades and the part after the
  // open one is wholly in view; scrolled to the end, the fade moves to the left. A meeting whose one phase is called Meeting says
  // so once on its row in Jobs.
  const id = tag()
  await push(request, [
    { name: 'project.create', args: { id: `edges-${id}`, name: `Edges ${id}`, clientId: null, venueId: null, status: 'confirmed', kind: 'meeting', notes: '' } },
    { name: 'phase.add', args: { id: `edges-${id}-m`, projectId: `edges-${id}`, name: 'Meeting', start: '2031-03-04', end: '2031-03-04', venueId: null, notes: '' } },
  ])
  const page = await (await browser.newContext({ viewport: phoneSize })).newPage()
  await page.goto('/#jobs')
  await expect(page.getByRole('status')).toHaveText('Up to date')
  await page.getByRole('searchbox', { name: 'Find' }).fill(`Edges ${id}`)
  const row = page.getByRole('link', { name: new RegExp(`Edges ${id}`) })
  await expect(row).toContainText('Tue 4 Mar')
  await expect(row).not.toContainText('Meeting · ')
  await expect(row).toContainText(' · Meeting')

  await row.click()
  const tabs = page.getByRole('tablist', { name: 'Parts of the job' })
  await expect(tabs).toHaveAttribute('data-more', 'right')
  const open = tabs.getByRole('tab', { selected: true })
  const next = open.locator('xpath=following-sibling::*[1]')
  const [box, after] = await Promise.all([tabs.boundingBox(), next.boundingBox()])
  expect(after!.x + after!.width).toBeLessThanOrEqual(box!.x + box!.width + 1)
  await tabs.evaluate((el) => (el.scrollLeft = el.scrollWidth))
  await expect(tabs).toHaveAttribute('data-more', 'left')
  // Quote, the last part, is there to be reached.
  await expect(tabs.getByRole('tab', { name: /^Quote/ })).toBeInViewport()
})

test('Cmd-P prints the screen as it is, light and without the tabs, and a print sheet still prints alone', async ({ browser }) => {
  // Proves (findings 60e and 61): with no print sheet drawn, printing a screen hides nothing but the tab bar, in the light colour
  // scheme whatever the theme; the hide-everything rule is for a page holding a print sheet.
  const page = await (await browser.newContext({ viewport: laptopSize })).newPage()
  await page.goto('/#crew/people')
  await expect(page.getByRole('status')).toHaveText('Up to date')
  await page.emulateMedia({ media: 'print' })
  await expect(page.getByRole('heading', { name: 'People', level: 1 })).toBeVisible()
  await expect(page.getByRole('navigation', { name: 'Areas' })).toBeHidden()
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).colorScheme)).toBe('light')
  // A print sheet in the page: everything else goes.
  await page.evaluate(() => {
    const sheet = document.createElement('div')
    sheet.className = 'print-sheet'
    sheet.textContent = 'Only this'
    document.body.append(sheet)
  })
  await expect(page.getByText('Only this')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'People', level: 1 })).toBeHidden()
})

test('Venues has a find box at the top of its list, by name or address without the fadas', async ({ browser, request }) => {
  // Proves (finding 76): a long list of venues narrows as you type, by name or by a word of the address, "nas" finding Nás.
  const id = tag()
  await push(request, [
    { name: 'venue.upsert', args: { id: `edges-v1-${id}`, name: `Kilkenny Castle ${id}`, address: 'The Parade, Kilkenny', notes: '' } },
    { name: 'venue.upsert', args: { id: `edges-v2-${id}`, name: `Punchestown ${id}`, address: 'Nás, Co. Kildare', notes: '' } },
  ])
  const page = await (await browser.newContext({ viewport: phoneSize })).newPage()
  await page.goto('/#jobs/venues')
  await expect(page.getByRole('status')).toHaveText('Up to date')
  const list = page.getByRole('region', { name: 'Every venue' })
  const find = list.getByRole('searchbox', { name: 'Find a venue' })
  await find.fill(`nas ${id}`)
  await expect(list.getByRole('link', { name: new RegExp(`Punchestown ${id}`) })).toBeVisible()
  await expect(list.getByRole('link', { name: new RegExp(`Kilkenny Castle ${id}`) })).toHaveCount(0)
  await find.fill(`nowhere ${id}`)
  await expect(list.getByText('No venue matches.')).toBeVisible()
})

test("Add person says a bad email in a line that stays, and Tab out of Skills lands on the next field", async ({ browser }) => {
  // Proves (findings 60a and 75): an email without an @ is refused in a line in the form, the field marked, not in the browser's
  // bubble; with the skills on offer open, one Tab goes from the Skills field to the day rate, not to the list.
  const id = tag()
  const page = await (await browser.newContext({ viewport: laptopSize })).newPage()
  await page.goto('/#crew/people')
  await expect(page.getByRole('status')).toHaveText('Up to date')
  const form = page.getByRole('form', { name: 'Add person' })
  if (!(await form.count())) await page.getByRole('button', { name: 'Add person' }).click()
  await form.getByLabel('First name').fill(`Edges ${id}`)
  await form.getByLabel('Email').fill('edges.example.com')
  await form.getByRole('button', { name: 'Add person' }).click()
  await expect(form.getByRole('alert')).toHaveText(/That email address doesn't look right/)
  await expect(form.getByLabel('Email')).toHaveAttribute('aria-invalid', 'true')
  await form.getByLabel('Email').fill('edges@example.com')
  await expect(form.getByRole('alert')).toHaveCount(0)

  const skills = form.getByRole('combobox', { name: 'Skills' })
  await skills.fill('a')
  await expect(form.getByRole('listbox', { name: 'In use' })).toBeVisible()
  await expect(form.getByRole('listbox', { name: 'In use' })).toHaveAttribute('tabindex', '-1')
  await page.keyboard.press('Tab')
  await expect(form.getByLabel('Usual day rate €')).toBeFocused()
})

test("the skills on offer open above the box when it's low on a phone, clear of the tabs", async ({ browser }) => {
  // Proves (finding 74): with the Skills box near the foot of a phone's screen, the offers open above it, wholly above the tab bar.
  const page = await (await browser.newContext({ viewport: phoneSize })).newPage()
  await page.goto('/#crew/people')
  await expect(page.getByRole('status')).toHaveText('Up to date')
  await page.getByRole('button', { name: 'Add person' }).click()
  const form = page.getByRole('form', { name: 'Add person' })
  const skills = form.getByRole('combobox', { name: 'Skills' })
  // The box put just above the tabs, as when the form is scrolled to there: the form moved down the screen until it is.
  const tabsTop = (await page.getByRole('navigation', { name: 'Areas' }).boundingBox())!.y
  const at = (await skills.boundingBox())!
  await form.evaluate((el, by) => (el.style.marginTop = `${by}px`), Math.max(0, tabsTop - 12 - (at.y + at.height)))
  await skills.focus()
  await skills.pressSequentially('a')
  const list = form.getByRole('listbox', { name: 'In use' })
  await expect(list).toBeVisible()
  const [menu, box] = await Promise.all([list.boundingBox(), skills.boundingBox()])
  expect(menu!.y + menu!.height).toBeLessThanOrEqual(tabsTop)
  expect(menu!.y + menu!.height).toBeLessThanOrEqual(box!.y + 1)
})
