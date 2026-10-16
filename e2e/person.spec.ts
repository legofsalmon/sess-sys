import { expect, test } from '@playwright/test'

/**
 * A person's page (#crew/person/<id>): the People list on Crew is one line
 * each, and the name opens a page of their own with how to reach them, what
 * they're booked on and offered, their days off, what they hold, what
 * they've worked and their link. A booking's job opens from it, the call
 * card's name and the planner's lane open it, and archiving from it goes
 * back to the list, which says so with the way back. The test server is
 * shared with the other browser tests, so every name here is this run's own.
 */

const phoneSize = { width: 390, height: 844 }
const id = Math.random().toString(36).slice(2, 8)
const k = (key: string) => `${key}-${id}`
type M = [string, Record<string, unknown>]

test("a person's name opens their page, with what's ahead for them and the way back", async ({ browser }) => {
  const name = `Ciara Page ${id}`
  const job = `Page check ${id}`
  const on = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10)
  const mutations: M[] = [
    ['project.create', { id: k('job'), name: job, clientId: null, venueId: null, status: 'confirmed', notes: '' }],
    ['phase.add', { id: k('show'), projectId: k('job'), name: 'Show', start: on(70), end: on(70), venueId: null, notes: '' }],
    [
      'call.create',
      { id: k('call'), projectId: k('job'), phaseId: k('show'), project: job, phase: 'Show', venue: '', role: 'Audio tech', start: on(70), end: on(70), callTime: null, needed: 1, dayRateCents: 25000, details: '', replyBy: null },
    ],
    ['person.upsert', { id: k('ciara'), name, kind: 'freelancer', email: `ciara.${id}@example.com`, phone: '087 123 4567', skills: ['Audio'], dayRateCents: 25000, notes: 'Has her own van' }],
    ['offer.send', { id: k('offer'), callId: k('call'), personId: k('ciara'), override: false }],
    ['unavailability.add', { id: k('away'), personId: k('ciara'), start: on(80), end: on(81), note: 'On tour' }],
  ]
  const context = await browser.newContext({ viewport: phoneSize })
  const res = await context.request.post('/api/sync/push', {
    data: { clientId: `person-${id}`, mutations: mutations.map(([n, args], i) => ({ id: `${k('m')}-${i}`, name: n, args, createdAt: new Date().toISOString() })) },
  })
  expect(res.ok()).toBe(true)
  expect((await res.json()).results.filter((r: { status: string }) => r.status !== 'applied')).toEqual([])

  const office = await context.newPage()
  await office.goto('/#crew')
  await expect(office.getByRole('status')).toHaveText('Up to date')
  const people = office.getByRole('region', { name: 'People' })
  await people.getByLabel('Find a person').fill(`ciara page ${id}`)
  await people.getByRole('link', { name: new RegExp(`^${name}`) }).click()

  // Her page: who she is and how to reach her, in the heading and the buttons, with nothing folded away.
  await expect(office).toHaveURL(new RegExp(`#crew/person/${k('ciara')}$`))
  await expect(office.getByRole('heading', { level: 1 })).toHaveText(name)
  await expect(office.getByRole('link', { name: 'Call 087 123 4567' })).toHaveAttribute('href', 'tel:0871234567')
  await expect(office.getByRole('link', { name: 'WhatsApp' })).toHaveAttribute('href', 'https://wa.me/353871234567')
  await expect(office.getByRole('link', { name: 'Email' })).toHaveAttribute('href', `mailto:ciara.${id}@example.com`)
  await expect(office.locator('.person-page .notes')).toHaveText('Has her own van')

  // What's ahead: the offer waiting on her, opening its job, and her days off.
  const ahead = office.getByRole('region', { name: 'Coming up' })
  await expect(ahead.getByRole('link', { name: new RegExp(`^${job}`) })).toContainText('Offered')
  await expect(ahead).toContainText('Off ')
  await expect(ahead).toContainText('(On tour)')
  await expect(office.getByRole('region', { name: `Worked: ${name}` })).toContainText('No jobs worked yet.')
  await expect(office.getByRole('region', { name: 'Their link' }).getByRole('link', { name: 'Open their page' })).toHaveAttribute('href', /\/f\/[\w-]{24}$/)
  // Nothing on it is wider than a phone.
  expect(await office.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(phoneSize.width)

  await ahead.getByRole('link', { name: new RegExp(`^${job}`) }).click()
  await expect(office).toHaveURL(new RegExp(`#jobs/${k('job')}$`))
  await office.goBack()
  await expect(office.getByRole('heading', { level: 1 })).toHaveText(name)

  // While an offer waits on her she can't be archived, and it says why, here.
  await office.getByRole('button', { name: 'Archive', exact: true }).click()
  await expect(ahead.getByText(`${name} has an open offer for ${job} (Show); withdraw it first.`)).toBeVisible()

  // The way back is the list, as it was left.
  await office.getByRole('link', { name: '‹ Crew' }).click()
  await expect(office).toHaveURL(/#crew$/)
  await expect(people.getByRole('link', { name: new RegExp(`^${name}`) })).toBeVisible()
})

test('archiving from the page goes back to the list, which says so with the way back', async ({ browser }) => {
  const name = `Tadhg Page ${id}`
  const context = await browser.newContext({ viewport: phoneSize })
  const res = await context.request.post('/api/sync/push', {
    data: {
      clientId: `person-archive-${id}`,
      mutations: [
        {
          id: `${k('a')}-0`,
          name: 'person.upsert',
          args: { id: k('tadhg'), name, kind: 'freelancer', email: null, phone: null, skills: [], dayRateCents: null, notes: '' },
          createdAt: new Date().toISOString(),
        },
      ],
    },
  })
  expect(res.ok()).toBe(true)
  const office = await context.newPage()
  await office.goto(`/#crew/person/${k('tadhg')}`)
  await expect(office.getByRole('status')).toHaveText('Up to date')
  await expect(office.getByRole('heading', { level: 1 })).toHaveText(name)
  await office.getByRole('button', { name: 'Archive', exact: true }).click()

  await expect(office).toHaveURL(/#crew$/)
  const people = office.getByRole('region', { name: 'People' })
  await expect(people.locator('.added')).toHaveText(`Archived ${name}. Bring ${name} back`)
  await people.getByRole('button', { name: `Bring ${name} back` }).click()
  await people.getByLabel('Find a person').fill(`tadhg page ${id}`)
  await expect(people.getByRole('link', { name: new RegExp(`^${name}`) })).toBeVisible()
})
