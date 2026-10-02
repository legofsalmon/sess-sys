import { expect, test, type APIRequestContext } from '@playwright/test'

/**
 * The screens fit the device (audit findings 16, 25 and 26). On a phone a
 * crew call is one line that opens on a tap and says where it stands, the
 * Offer to… picker waits behind "Offer…" and narrows as you type, a form
 * waits behind its button, the people list finds people as the picker does
 * and shows its first ten, and a phase's details wait behind a tap. On a
 * laptop the Jobs list sits beside the open job and the Stock catalogue
 * beside the open product, the list keeping its search as things are opened
 * from it, while a phone still gets each on its own. And the page carries
 * the icons a phone installs with, in Irish English. The test server is
 * shared with the other browser tests, so every name here is this run's own.
 */

const phoneSize = { width: 390, height: 844 }
const laptopSize = { width: 1280, height: 800 }
const tag = () => Math.random().toString(36).slice(2, 8)

test('on a phone a call is one line that opens on a tap, the picker narrows as you type, and forms wait behind their buttons', async ({ browser }) => {
  const id = tag()
  const office = await (await browser.newContext({ viewport: phoneSize })).newPage()
  await office.goto('/#crew')
  await expect(office.getByRole('status')).toHaveText('Up to date')

  // Two people, from the form behind "Add person": not on the page until the button is tapped.
  await expect(office.getByRole('form', { name: 'Add person' })).toHaveCount(0)
  await office.getByRole('button', { name: 'Add person' }).click()
  const person = office.getByRole('form', { name: 'Add person' })
  await expect(person.getByLabel('Name')).toBeFocused()
  for (const [name, skills] of [
    [`Maeve Doyle ${id}`, 'audio, monitors'],
    [`Ronan Burke ${id}`, 'rigger'],
  ]) {
    await person.getByLabel('Name').fill(name!)
    await person.getByLabel('Skills').fill(skills!)
    await person.getByRole('button', { name: 'Add person' }).click()
    await expect(person.getByLabel('Name')).toHaveValue('')
  }
  await expect(office.getByRole('status')).toHaveText('Up to date')

  // A one-day call for one person, from the form behind "Ask for crew".
  await office.getByRole('button', { name: 'Ask for crew' }).click()
  const ask = office.locator('form').filter({ has: office.getByRole('button', { name: 'Ask for crew' }) })
  await ask.getByLabel('Project').fill(`Layout check ${id}`)
  await ask.getByLabel('Role').fill('Audio tech')
  await ask.getByLabel('Day rate €').fill('260')
  await ask.getByLabel('From').fill('2031-06-10')
  await ask.getByLabel('To', { exact: true }).fill('2031-06-10')
  await ask.getByRole('button', { name: 'Ask for crew' }).click()
  await expect(office.getByRole('status')).toHaveText('Up to date')

  // The call is one line under its job and its day, its state beside it and "Offer…" under that; nothing else of it is open.
  const group = office.locator('.call-group', { hasText: `Layout check ${id}` })
  await expect(group.getByRole('heading', { name: 'Tue 10 Jun' })).toBeVisible()
  const call = group.getByRole('article', { name: '1 × Audio tech' })
  const line = call.getByRole('button', { name: '1 × Audio tech' })
  await expect(line).toHaveAttribute('aria-expanded', 'false')
  await expect(call).toContainText('0/1')
  await expect(call).not.toContainText('€260')
  await expect(call.getByLabel('Offer to')).toHaveCount(0)

  // The picker is behind "Offer…", and narrows as you type: by a skill, then by a name.
  await call.getByRole('button', { name: 'Offer…' }).click()
  await expect(call.getByLabel('Find someone')).toBeFocused()
  const picker = call.getByLabel('Offer to')
  const maeve = picker.locator('option', { hasText: `Maeve Doyle ${id}` })
  const ronan = picker.locator('option', { hasText: `Ronan Burke ${id}` })
  await expect(maeve).toHaveCount(1)
  await expect(ronan).toHaveCount(1)
  await call.getByLabel('Find someone').fill('rigger')
  await expect(ronan).toHaveCount(1)
  await expect(maeve).toHaveCount(0)
  await call.getByLabel('Find someone').fill(`doyle ${id}`)
  await expect(maeve).toHaveCount(1)
  await expect(ronan).toHaveCount(0)

  // Offered to Maeve, who takes it on her link; confirmed, the call is filled.
  await picker.selectOption({ label: `Maeve Doyle ${id} · Level 1 (audio, monitors)` })
  await call.getByRole('button', { name: 'Offer', exact: true }).click()
  const share = office.getByRole('region', { name: `Send offer to Maeve Doyle ${id}` })
  const link = (await share.locator('textarea').inputValue()).match(/https?:\/\/\S+\/f\/\S+/)![0]
  const phone = await (await browser.newContext({ viewport: phoneSize, javaScriptEnabled: false })).newPage()
  await phone.goto(link)
  await phone.getByRole('button', { name: 'Accept', exact: true }).click()
  await expect(phone.getByText("Thanks, you're down for it.")).toBeVisible()
  const answers = office.locator('section').filter({ has: office.getByRole('heading', { name: 'Answers to check' }) })
  const answer = answers.locator('.row', { hasText: `Maeve Doyle ${id}` })
  await answer.getByRole('button', { name: 'Confirm' }).click()
  await expect(answer).toHaveCount(0)
  await expect(office.getByRole('status')).toHaveText('Up to date')

  // On a fresh look the filled call is one line saying who's on it, with nobody left to offer it to.
  await office.reload()
  await expect(office.getByRole('status')).toHaveText('Up to date')
  await expect(line).toHaveAttribute('aria-expanded', 'false')
  await expect(call).toContainText('Filled')
  await expect(line).toContainText(`Maeve Doyle ${id}`)
  await expect(call.locator('.offers')).toHaveCount(0)
  await expect(call.getByRole('button', { name: 'Offer…' })).toHaveCount(0)

  // A tap opens it: the rate, and her answer.
  await line.click()
  await expect(line).toHaveAttribute('aria-expanded', 'true')
  await expect(call).toContainText('€260')
  await expect(call.locator('.offers li', { hasText: `Maeve Doyle ${id}` })).toContainText('Confirmed')
})

/** Changes as a phone sends them, straight to the server; each must be taken. */
async function push(request: APIRequestContext, from: string, mutations: (readonly [string, Record<string, unknown>])[]) {
  const res = await request.post('/api/sync/push', {
    data: { clientId: from, mutations: mutations.map(([name, args], i) => ({ id: `${from}-${i}`, name, args, createdAt: new Date().toISOString() })) },
  })
  const { results } = (await res.json()) as { results: { status: string; reason?: { message: string } }[] }
  expect(results.map((r) => r.reason?.message ?? r.status)).toEqual(mutations.map(() => 'applied'))
}

test('the people list finds someone as the picker does, shows its first ten, and keeps whoever was just added in view', async ({ browser }) => {
  const id = tag()
  // Twelve of this run's own in a department of their own: one who goes by another name, one with a skill nobody else has, names with fadas; and one who has left.
  const name = (first: string) => `${first} Layout ${id}`
  const dept = `Dept${id}`
  const firsts = ['Aoife', 'Brian', 'Ciara', 'Declan', 'Eimear', 'Fiachra', 'Gearóid', 'Hannah', 'Íde', 'Jack', 'Kevin', 'Pádraig']
  const person = (key: string, first: string, more: Record<string, unknown> = {}) =>
    ['person.upsert', { id: `p-${id}-${key}`, name: name(first), kind: 'freelancer', email: null, phone: null, skills: ['Stagehand'], dayRateCents: null, notes: '', department: dept, ...more }] as const
  const context = await browser.newContext({ viewport: phoneSize })
  await push(context.request, `people-${id}`, [
    ...firsts.map((first, i) => person(String(i), first, first === 'Fiachra' ? { knownAs: 'Fitz' } : first === 'Declan' ? { skills: [`Pyro ${id}`] } : {})),
    person('gone', 'Lorcan'),
    ['person.archive', { id: `p-${id}-gone`, archived: true }],
  ])
  const office = await context.newPage()
  await office.goto('/#crew')
  await expect(office.getByRole('status')).toHaveText('Up to date')
  const list = office.getByRole('region', { name: 'People' })
  const find = list.getByLabel('Find a person')
  const rows = list.locator(':scope > .row.person')
  const row = (first: string) => list.getByRole('button', { name: new RegExp(`^${name(first)}`) })

  // Found by department: the first ten of the twelve, and the rest a tap away.
  await find.fill(dept.toLowerCase())
  await expect(rows).toHaveCount(10)
  await expect(row('Kevin')).toHaveCount(0)
  await list.getByRole('button', { name: 'Show all 12 people' }).click()
  await expect(rows).toHaveCount(12)
  await expect(row('Kevin')).toBeVisible()

  // By the name they go by, a skill, and a name typed without its fada; nobody, and nobody who has left.
  for (const [typed, first] of [
    [`fitz ${id}`, 'Fiachra'],
    [`pyro ${id}`, 'Declan'],
    [`padraig ${id}`, 'Pádraig'],
    [`gearoid layout ${id}`, 'Gearóid'],
  ] as const) {
    await find.fill(typed)
    await expect(rows).toHaveCount(1)
    await expect(row(first)).toBeVisible()
  }
  for (const typed of [`nobody ${id}`, `lorcan ${id}`]) {
    await find.fill(typed)
    await expect(rows).toHaveCount(0)
    await expect(list.getByText('Nobody matches.')).toBeVisible()
  }
  await list.getByText('Archived').click()
  await expect(list.locator('details.archived')).toContainText(name('Lorcan'))

  // The department filter still narrows the list, with the search empty.
  await find.fill('')
  await list.getByLabel('Department').selectOption(dept)
  await expect(rows).toHaveCount(12)
  await list.getByLabel('Department').selectOption('')

  // Someone just added stays in view, whatever the search and the fold, until the tab is next opened.
  await office.reload()
  await expect(office.getByRole('status')).toHaveText('Up to date')
  await find.fill(dept.toLowerCase())
  await expect(rows).toHaveCount(10)
  await list.getByRole('button', { name: 'Add person' }).click()
  const form = list.getByRole('form', { name: 'Add person' })
  await form.getByLabel('Name').fill(name('Zoë'))
  await form.getByRole('button', { name: 'Add person' }).click()
  await expect(form.getByLabel('Name')).toHaveValue('')
  await expect(list.locator('.added')).toHaveText(`Added ${name('Zoë')}.`)
  await expect(row('Zoë')).toBeVisible()
  await expect(rows).toHaveCount(11)
  await expect(office.getByRole('status')).toHaveText('Up to date')
  await office.reload()
  await expect(office.getByRole('status')).toHaveText('Up to date')
  await expect(row('Zoë')).toHaveCount(0)
  await find.fill(`zoe ${id}`)
  await expect(row('Zoë')).toBeVisible()
})

test('a call says where it stands at rest, the picker only searches on Enter, and a phase keeps its details behind a tap', async ({ browser }) => {
  const id = tag()
  const job = `Venue check ${id}`
  const on = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10)
  const [hall, yard] = [`Main Hall ${id}`, `Yard ${id}`]
  const call = (key: string, phase: string, start: string, end: string, venue: string, role: string) =>
    ['call.create', { id: `c-${id}-${key}`, projectId: `j-${id}`, phaseId: `ph-${id}-${phase}`, project: job, phase, venue, role, start, end, callTime: null, needed: 1, dayRateCents: 20000, details: '', replyBy: null }] as const
  const context = await browser.newContext({ viewport: phoneSize })
  // A job at the Main Hall whose load in is at the Yard, with a running order on the show, and a call cancelled but kept for the record.
  await push(context.request, `calls-${id}`, [
    ['venue.upsert', { id: `v-${id}-hall`, name: hall, address: '', notes: '' }],
    ['venue.upsert', { id: `v-${id}-yard`, name: yard, address: '', notes: '' }],
    ['project.create', { id: `j-${id}`, name: job, clientId: null, venueId: `v-${id}-hall`, status: 'confirmed', notes: '' }],
    ['phase.add', { id: `ph-${id}-Load in`, projectId: `j-${id}`, name: 'Load in', start: on(60), end: on(60), venueId: `v-${id}-yard`, notes: '' }],
    ['phase.add', { id: `ph-${id}-Show`, projectId: `j-${id}`, name: 'Show', start: on(61), end: on(61), venueId: null, notes: '18:00 Doors' }],
    call('load', 'Load in', on(60), on(60), yard, 'Loader'),
    call('sound', 'Show', on(61), on(61), hall, 'Sound No.1'),
    call('runner', 'Show', on(61), on(61), hall, 'Runner'),
    ['call.cancel', { id: `c-${id}-runner` }],
    ['person.upsert', { id: `p-${id}`, name: `Úna Layout ${id}`, kind: 'freelancer', email: null, phone: null, skills: ['Audio'], dayRateCents: null, notes: '' }],
  ])
  const office = await context.newPage()
  await office.goto('/#crew')
  await expect(office.getByRole('status')).toHaveText('Up to date')

  // On the Crew tab the job's own venue heads its calls; the load in says it's at the Yard.
  const group = office.locator('.call-group', { hasText: job })
  await expect(group.locator('header')).toContainText(hall)
  await expect(group.locator('header')).not.toContainText(yard)
  await expect(group.getByRole('heading', { name: yard })).toBeVisible()

  // Enter in the picker's search only searches, even with someone picked.
  const sound = group.getByRole('article', { name: '1 × Sound No.1' })
  await sound.getByRole('button', { name: 'Offer…' }).click()
  await sound.getByLabel('Offer to').selectOption({ label: `Úna Layout ${id} · Level 1 (Audio)` })
  await sound.getByLabel('Find someone').fill(`una ${id}`)
  await sound.getByLabel('Find someone').press('Enter')
  await expect(sound.getByLabel('Offer to').locator('option', { hasText: `Úna Layout ${id}` })).toHaveCount(1)
  await expect(office.getByRole('region', { name: /^Send offer to/ })).toHaveCount(0)
  await expect(sound.locator('.who-line')).toHaveCount(0)

  // Offered with no signal, the call's line says it's waiting to sync until the server has it.
  await context.setOffline(true)
  await sound.getByRole('button', { name: 'Offer', exact: true }).click()
  await expect(sound.locator('.who-line')).toHaveText(`Úna Layout ${id} (offered)`)
  await expect(sound.locator('.pill')).toHaveText('Waiting to sync')
  await expect(office.getByRole('status')).toContainText('No signal')
  await context.setOffline(false)
  await office.evaluate(() => dispatchEvent(new Event('online')))
  await expect(office.getByRole('status')).toHaveText('Up to date', { timeout: 20_000 })
  await expect(sound.locator('.pill')).toHaveText('0/1')

  // On the job's page the cancelled call says so, and each phase's details open on a tap.
  await office.goto(`/#jobs/j-${id}`)
  await expect(office.getByRole('status')).toHaveText('Up to date')
  await expect(office.getByRole('article', { name: '1 × Runner' }).locator('.pill')).toHaveText('Cancelled')
  const show = office.getByRole('article', { name: 'Show' })
  await expect(show.getByRole('link', { name: 'Call sheet' })).toBeHidden()
  await expect(show.getByText('18:00 Doors')).toBeHidden()
  await show.getByText('Running order, call sheet, calendar').click()
  await expect(show.getByText('18:00 Doors')).toBeVisible()
  await expect(show.getByRole('link', { name: 'Call sheet' })).toBeVisible()
  await expect(show.locator('.cal')).toContainText('Goes on the calendar as')
})

test('on a laptop the Jobs list sits beside the open job and the catalogue beside the open product; a phone gets each on its own', async ({ browser }) => {
  const id = tag()
  const laptop = await (await browser.newContext({ viewport: laptopSize })).newPage()
  await laptop.goto('/#jobs')
  await expect(laptop.getByRole('status')).toHaveText('Up to date')
  const job = `Laptop check ${id}`
  const form = laptop.locator('form').filter({ has: laptop.getByRole('button', { name: 'Add job' }) })
  await form.getByLabel('Job').fill(job)
  await form.getByLabel('Phase 1 from').fill('2031-06-12')
  await form.getByLabel('Phase 1 to').fill('2031-06-12')
  await form.getByRole('button', { name: 'Add job' }).click()

  // The job opens beside the list, under one top bar: the list on the left with the job's row marked, the job on the right.
  const title = laptop.getByRole('heading', { level: 1, name: job })
  await expect(title).toBeVisible()
  const list = laptop.getByRole('region', { name: 'Jobs' })
  await expect(list.locator('.job-row', { hasText: job })).toHaveAttribute('aria-current', 'page')
  const [listBox, titleBox] = [(await list.boundingBox())!, (await title.boundingBox())!]
  expect(listBox.x + listBox.width).toBeLessThanOrEqual(titleBox.x)
  await expect(laptop.locator('.top')).toHaveCount(1)
  await expect(laptop.getByRole('link', { name: '‹ All jobs' })).toHaveCount(0)

  // Found in the list and opened from it, the job opens beside a list that still holds what was typed.
  await laptop.getByRole('navigation', { name: 'Areas' }).getByRole('link', { name: 'Jobs' }).click()
  await expect(title).toHaveCount(0)
  await list.getByLabel('Find').fill(job)
  await list.locator('.job-row', { hasText: job }).click()
  await expect(title).toBeVisible()
  await expect(list.getByLabel('Find')).toHaveValue(job)

  // Another job opened from the list starts at its top, however far down the last one the window was.
  await list.getByLabel('Find').fill('')
  await laptop.setViewportSize({ width: laptopSize.width, height: 500 })
  await laptop.evaluate(() => scrollTo(0, document.body.scrollHeight))
  expect(await laptop.evaluate(() => scrollY)).toBeGreaterThan(0)
  await list.locator('.job-row', { hasNotText: job }).first().click()
  await expect(title).toHaveCount(0)
  await expect.poll(() => laptop.evaluate(() => scrollY)).toBe(0)
  await laptop.setViewportSize(laptopSize)

  // Stock the same: a new product opens beside the catalogue, and searching the catalogue finds it there.
  await laptop.goto('/#stock')
  await expect(laptop.getByRole('status')).toHaveText('Up to date')
  const speaker = `Laptop speaker ${id}`
  await laptop.getByRole('button', { name: 'Add product' }).click()
  const product = laptop.locator('form').filter({ has: laptop.getByRole('button', { name: 'Add product' }) })
  await product.getByLabel('Name').fill(speaker)
  await product.getByRole('button', { name: 'Add product' }).click()
  const name = laptop.getByRole('heading', { level: 1, name: speaker })
  await expect(name).toBeVisible()
  const catalogue = laptop.getByRole('region', { name: 'Stock' })
  await catalogue.getByLabel('Find').fill(speaker)
  await expect(catalogue.locator('.job-row', { hasText: speaker })).toHaveAttribute('aria-current', 'page')
  const [catalogueBox, nameBox] = [(await catalogue.boundingBox())!, (await name.boundingBox())!]
  expect(catalogueBox.x + catalogueBox.width).toBeLessThanOrEqual(nameBox.x)

  // On a phone the same address is the product on its own, with the way back to the catalogue.
  const phone = await (await browser.newContext({ viewport: phoneSize })).newPage()
  await phone.goto(laptop.url())
  await expect(phone.getByRole('heading', { level: 1, name: speaker })).toBeVisible()
  await expect(phone.getByRole('region', { name: 'Stock' })).toHaveCount(0)
  await expect(phone.getByRole('link', { name: '‹ All stock' })).toBeVisible()
})

test('the page installs with PNG icons and is in Irish English', async ({ page, request }) => {
  await page.goto('/')
  expect(await page.locator('html').getAttribute('lang')).toBe('en-IE')
  /** A PNG's width and height, from its header. */
  const size = async (href: string) => {
    const res = await request.get(href)
    expect(res.ok()).toBe(true)
    expect(res.headers()['content-type']).toContain('image/png')
    const png = await res.body()
    return [png.readUInt32BE(16), png.readUInt32BE(20)]
  }
  const touch = await page.locator('link[rel="apple-touch-icon"]').getAttribute('href')
  expect(touch).toBe('/apple-touch-icon.png')
  expect(await size(touch!)).toEqual([180, 180])
  const manifest = (await (await request.get((await page.locator('link[rel="manifest"]').getAttribute('href'))!)).json()) as {
    icons: { src: string; sizes: string; type: string; purpose: string }[]
  }
  // Each size as it is, and to be cropped to an Android launcher's own shape.
  for (const px of [192, 512]) {
    const icons = manifest.icons.filter((i) => i.sizes === `${px}x${px}`)
    expect(icons.map((i) => i.purpose).sort()).toEqual(['any', 'maskable'])
    for (const icon of icons) {
      expect(icon.type).toBe('image/png')
      expect(await size(icon.src)).toEqual([px, px])
    }
  }
})
