import { expect, test, type Page } from '@playwright/test'

/**
 * Getting about the app and reading it, with a screen reader or in daylight
 * (audit finding 22): every field's border can be seen against its card, in
 * light and dark; each move lands on the screen's heading and names the tab
 * after it; there's one main landmark; the back link is tall enough to tap;
 * the current tab and the grey pill read at 4.5:1; the "not done" list is a
 * live region; and every field has a name. Uses the made-up data (ADR 0019),
 * so it starts fresh before and after: the other tests share this server.
 */

const phoneSize = { width: 390, height: 844 }
const fresh = { data: { confirm: 'delete everything' } }

/** WCAG's contrast between two colours as the browser gives them ("rgb(r, g, b)"). */
function contrast(a: string, b: string): number {
  const lum = (c: string) => {
    const [r, g, b] = c.match(/[\d.]+/g)!.slice(0, 3).map((v) => Number(v) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
    return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!
  }
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p)
  return (x! + 0.05) / (y! + 0.05)
}

/** Each field on screen with its border colour and the colour behind it: the first ancestor painted a colour, which is the card. */
async function fieldBorders(page: Page): Promise<{ field: string; border: string; behind: string }[]> {
  return page.evaluate(() => {
    const opaque = (c: string) => {
      const m = c.match(/[\d.]+/g)
      return !!m && (m.length < 4 || Number(m[3]) > 0)
    }
    const behind = (el: Element) => {
      for (let e = el.parentElement; e; e = e.parentElement) {
        const bg = getComputedStyle(e).backgroundColor
        if (opaque(bg)) return bg
      }
      return getComputedStyle(document.body).backgroundColor
    }
    const out: { field: string; border: string; behind: string }[] = []
    for (const el of document.querySelectorAll<HTMLInputElement>('input, select, textarea')) {
      const cs = getComputedStyle(el)
      if (el.getClientRects().length === 0 || ['checkbox', 'radio', 'file'].includes(el.type) || parseFloat(cs.borderTopWidth) === 0) continue
      out.push({ field: `${el.tagName.toLowerCase()} ${el.getAttribute('aria-label') ?? el.name ?? el.id}`.trim(), border: cs.borderTopColor, behind: behind(el) })
    }
    return out
  })
}

/** Fields on screen with nothing to call them: no label, aria-label, aria-labelledby or title. */
async function unnamedFields(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const text = (el: Element | null) => el?.textContent?.replace(/\s+/g, ' ').trim() ?? ''
    const name = (el: HTMLInputElement) => {
      const aria = el.getAttribute('aria-label')?.trim()
      if (aria) return aria
      const by = el.getAttribute('aria-labelledby')
      if (by) return by.split(/\s+/).map((id) => text(document.getElementById(id))).join(' ').trim()
      for (const label of el.labels ?? []) if (text(label)) return text(label)
      return el.getAttribute('title')?.trim() ?? ''
    }
    return [...document.querySelectorAll<HTMLInputElement>('input, select, textarea')].filter((el) => el.getClientRects().length > 0 && !name(el)).map((el) => el.outerHTML.slice(0, 120))
  })
}

/** The text colour against the background of the first element matching, as drawn. */
async function textContrast(page: Page, selector: string): Promise<number> {
  const [color, background] = await page.locator(selector).first().evaluate((el) => {
    const cs = getComputedStyle(el)
    return [cs.color, cs.backgroundColor]
  })
  return contrast(color!, background!)
}

test.beforeAll(async ({ request }) => {
  expect((await request.post('/api/data/start-fresh', fresh)).ok()).toBe(true)
  expect((await request.post('/api/data/made-up')).ok()).toBe(true)
})

test.afterAll(async ({ request }) => {
  expect((await request.post('/api/data/start-fresh', fresh)).ok()).toBe(true)
})

for (const colorScheme of ['light', 'dark'] as const) {
  test(`in ${colorScheme} mode, every field's border is 3:1 against its card and the current tab and grey pill read at 4.5:1`, async ({ browser, request }) => {
    // Proves: fields can be seen and the two known gaps are closed, in the app and on the freelancer's pages, as the browser draws them.
    const page = await (await browser.newContext({ viewport: phoneSize, colorScheme })).newPage()
    await page.goto('/#crew')
    await expect(page.getByRole('status')).toHaveText('Up to date')
    // Dara's card opens the days-off form and the level picker, which the list alone doesn't show. Her name heads her row; a call's line names her after its role.
    await page.getByRole('button', { name: /^Dara Quinn/ }).click()
    await expect(page.getByLabel('Off from')).toBeVisible()

    for (const hash of ['#crew', '#jobs', '#stock', '#account']) {
      if (hash !== '#crew') await page.goto(`/${hash}`)
      const fields = await fieldBorders(page)
      expect(fields.length, `${hash} has fields`).toBeGreaterThan(0)
      for (const f of fields) expect(contrast(f.border, f.behind), `${hash}: ${f.field} border ${f.border} on ${f.behind}`).toBeGreaterThanOrEqual(3)
    }
    // A job's page, with Ask for crew and its reply-by day, behind its button (audit finding 16).
    await page.getByRole('navigation', { name: 'Areas' }).getByRole('link', { name: 'Jobs' }).click()
    await page.getByRole('link', { name: /Harbour Lights Festival/ }).first().click()
    await page.getByRole('button', { name: 'Ask for crew' }).click()
    await expect(page.getByRole('form', { name: 'Ask for crew' }).getByLabel('Reply by')).toBeVisible()
    for (const f of await fieldBorders(page)) expect(contrast(f.border, f.behind), `a job: ${f.field} border ${f.border} on ${f.behind}`).toBeGreaterThanOrEqual(3)
    expect(await textContrast(page, '.tabs a[aria-current="page"]')).toBeGreaterThanOrEqual(4.5)
    // A call shows its answers once its line is opened (audit finding 16): the load-in stagehands, which Laoise declined.
    await page.goto('/#crew')
    await page.locator('.call-group', { hasText: 'Harbour Lights Festival' }).getByRole('button', { name: /× Stagehand · Load in/ }).click()
    await expect(page.locator('.pill.cancelled').first()).toBeVisible()
    expect(await textContrast(page, '.pill.cancelled')).toBeGreaterThanOrEqual(4.5)

    // The freelancer's pages, which crew use most, in the same light: each says what it is in the tab, has one main landmark, and its fields can be seen and are named.
    const { changes } = (await (await request.get('/api/sync/pull?after=0')).json()) as { changes: { entity: string; data: { name: string; linkToken: string } }[] }
    const dara = changes.find((c) => c.entity === 'person' && c.data.name === 'Dara Quinn')!
    await page.goto(`/f/${dara.data.linkToken}`)
    await expect(page).toHaveTitle('Session Hire: your work')
    await expect(page.getByRole('main')).toHaveCount(1)
    await page.getByText('Your details').click()
    const fields = await fieldBorders(page)
    expect(fields.length).toBeGreaterThan(3)
    for (const f of fields) expect(contrast(f.border, f.behind), `link page: ${f.field} border ${f.border} on ${f.behind}`).toBeGreaterThanOrEqual(3)
    expect(await unnamedFields(page)).toEqual([])

    await page.getByRole('link', { name: /^Call sheet/ }).first().click()
    await expect(page).toHaveTitle('Call sheet: Harbour Lights Festival, Show')
    await expect(page.getByRole('main')).toHaveCount(1)
    expect((await page.getByRole('link', { name: '‹ Your work' }).boundingBox())!.height).toBeGreaterThanOrEqual(44)

    await page.goto(`/f/${dara.data.linkToken}`)
    await page.locator('.ts-list a').filter({ hasText: 'Autumn Gala' }).click()
    await expect(page).toHaveTitle('Timesheet: Autumn Gala, Show')
    await expect(page.getByRole('main')).toHaveCount(1)
    const sheetFields = await fieldBorders(page)
    expect(sheetFields.length).toBeGreaterThan(3)
    for (const f of sheetFields) expect(contrast(f.border, f.behind), `timesheet: ${f.field} border ${f.border} on ${f.behind}`).toBeGreaterThanOrEqual(3)
    expect(await unnamedFields(page)).toEqual([])
  })
}

test('each move lands on the heading and names the tab, inside one main landmark, with a back link a thumb can hit', async ({ browser }) => {
  // Proves: the Shell moves focus to the new screen's heading and renames the tab on every move, for a tab, a record, the leave screen and the planner's next week, but not for a toggle, however the browser presses it.
  const page = await (await browser.newContext({ viewport: phoneSize })).newPage()
  await page.goto('/#jobs')
  await expect(page.getByRole('status')).toHaveText('Up to date')
  await expect(page).toHaveTitle('Jobs · Session Hire')
  await expect(page.getByRole('main')).toHaveCount(1)

  // A tab: the screen's name in the top bar takes focus and names the tab.
  await page.getByRole('navigation', { name: 'Areas' }).getByRole('link', { name: 'Crew' }).click()
  await expect(page).toHaveTitle('Crew · Session Hire')
  expect(await page.evaluate(() => document.activeElement?.textContent?.trim())).toMatch(/^Crew/)
  await expect(page.getByRole('main')).toHaveCount(1)

  // A record: its heading takes focus and names the tab after the job.
  await page.getByRole('navigation', { name: 'Areas' }).getByRole('link', { name: 'Jobs' }).click()
  await page.getByRole('link', { name: /Harbour Lights Festival/ }).first().click()
  await expect(page).toHaveTitle('Harbour Lights Festival · Session Hire')
  expect(await page.evaluate(() => [document.activeElement?.tagName, document.activeElement?.textContent?.trim()])).toEqual(['H1', 'Harbour Lights Festival'])
  const back = await page.getByRole('link', { name: '‹ All jobs' }).boundingBox()
  expect(back!.height).toBeGreaterThanOrEqual(44)

  // The leave screen, before anyone has said who they are, is named for what it is, not for the Crew tab it's under.
  await page.goto('/#crew')
  await page.getByRole('link', { name: 'Open leave' }).click()
  await expect(page).toHaveTitle('Leave · Session Hire')
  expect(await page.evaluate(() => [document.activeElement?.tagName, document.activeElement?.textContent?.trim()])).toEqual(['H1', 'Leave'])

  // The planner's jobs or people is a toggle that keeps focus, though it changes the address; another week is a move.
  await page.goto('/#plan')
  const heading = page.getByRole('heading', { level: 1 })
  await expect(heading).toBeFocused()
  const people = page.getByRole('group', { name: 'Rows' }).getByRole('button', { name: 'People' })
  await people.focus()
  await page.keyboard.press('Enter')
  await expect(people).toHaveAttribute('aria-pressed', 'true')
  await page.evaluate(() => new Promise((drawn) => requestAnimationFrame(() => requestAnimationFrame(drawn))))
  await expect(people).toBeFocused()
  // Safari, and Firefox on a Mac, press a button without focusing it, as a click from script does here: still a toggle.
  const jobs = page.getByRole('group', { name: 'Rows' }).getByRole('button', { name: 'Jobs' })
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
  await jobs.evaluate((b: HTMLElement) => b.click())
  await expect(jobs).toHaveAttribute('aria-pressed', 'true')
  await page.evaluate(() => new Promise((drawn) => requestAnimationFrame(() => requestAnimationFrame(drawn))))
  await expect(jobs).toBeFocused()
  await page.getByRole('link', { name: 'Next week' }).click()
  await expect(heading).toBeFocused()
})

test('every field on every screen has a name, and the not-done list is a live region', async ({ browser }) => {
  // Proves: no field is named by its placeholder alone, and a refusal from the server is read out where it's counted and listed, from a live region that takes no room in the top bar while it's empty, even at 320px.
  const id = Math.random().toString(36).slice(2, 8)
  const page = await (await browser.newContext({ viewport: phoneSize })).newPage()
  await page.goto('/#crew')
  await expect(page.getByRole('status')).toHaveText('Up to date')
  await page.getByRole('button', { name: /^Dara Quinn/ }).click()
  await expect(page.getByLabel('Off from')).toBeVisible()
  expect(await unnamedFields(page), '#crew').toEqual([])
  for (const hash of ['#jobs', '#stock', '#account', '#history', '#crew/leave']) {
    await page.goto(`/${hash}`)
    await expect(page.locator('.app')).toBeVisible()
    expect(await unnamedFields(page), hash).toEqual([])
  }
  await page.goto('/#jobs')
  await page.getByRole('link', { name: /Harbour Lights Festival/ }).first().click()
  await expect(page.getByRole('heading', { name: 'Harbour Lights Festival' })).toBeVisible()
  expect(await unnamedFields(page), 'a job').toEqual([])

  // On a 320px phone the empty live region leaves the sync pill on the top bar's one line.
  const narrow = await (await browser.newContext({ viewport: { width: 320, height: 640 } })).newPage()
  await narrow.goto('/#crew')
  await expect(narrow.getByRole('status')).toHaveText('Up to date')
  const [row, pill] = await narrow.locator('.top .state').evaluate((el) => [el.getBoundingClientRect().height, el.querySelector('.conn')!.getBoundingClientRect().height])
  expect(row).toBe(pill)

  // A refusal from the server is counted and listed where a screen reader is told of it.
  await page.goto('/#crew')
  await expect(page.getByRole('status')).toHaveText('Up to date')
  await page.route(/\/api\/sync\/push/, async (route) => {
    const { mutations } = route.request().postDataJSON() as { mutations: { id: string }[] }
    await route.fulfill({ json: { results: mutations.map((m) => ({ id: m.id, status: 'rejected', reason: { code: 'conflict', message: 'Pretend the server said no.' } })) } })
  })
  await page.getByRole('button', { name: 'Add person' }).click()
  const person = page.locator('form').filter({ has: page.getByRole('button', { name: 'Add person' }) })
  await person.getByLabel('Name').fill(`Nora Walsh ${id}`)
  await person.getByRole('button', { name: 'Add person' }).click()
  const count = page.getByRole('button', { name: /not done$/ })
  await expect(count).toHaveText('1 not done')
  expect(await count.evaluate((el) => el.parentElement?.getAttribute('aria-live'))).toBe('polite')
  await count.click()
  await expect(page.getByRole('region', { name: 'Not done' })).toHaveAttribute('aria-live', 'polite')
  await page.unroute(/\/api\/sync\/push/)
})
