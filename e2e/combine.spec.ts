import { expect, test } from '@playwright/test'

/**
 * Combining people brought in twice (ADR 0055): the same freelancer under
 * two addresses is two people, each with a booking. Her page says she looks
 * brought in twice, and combining her there, after a question, leaves one
 * person with both bookings and both addresses. Jobs › Tidy up offers
 * another pair and combines them the same way. The test server is shared
 * with the other browser tests, so every name here is this run's own.
 */

const phoneSize = { width: 390, height: 844 }
// Letters only: a name made from an address drops its digits.
const id = Array.from({ length: 6 }, () => 'abcdefghijklmnopqrstuvwxyz'[Math.floor(Math.random() * 26)]).join('')
const k = (key: string) => `${key}-${id}`
type M = [string, Record<string, unknown>]

const on = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10)
const person = (key: string, name: string, email: string): M => ['person.upsert', { id: k(key), name, kind: 'freelancer', email, phone: null, skills: [], dayRateCents: null, notes: '' }]
const offered = (key: string, call: string, who: string): M => ['offer.send', { id: k(key), callId: k(call), personId: k(who), override: false }]
const call = (key: string, job: string, day: number): M => [
  'call.create',
  { id: k(key), project: job, phase: 'Show', venue: '', role: 'Audio tech', start: on(day), end: on(day), callTime: null, needed: 2, dayRateCents: 25000, details: '', replyBy: null },
]

test('the same person under two addresses is combined from her page, and another pair from Tidy up', async ({ browser }) => {
  const name = `Aoife Twice ${id}`
  const pair = `Brian Twice ${id}`
  const mutations: M[] = [
    call('picnic', `Picnic ${id}`, 60),
    call('arena', `Arena ${id}`, 61),
    person('work', name, `aoife.${id}@example.com`),
    person('home', name, `aoife.${id}@example.net`),
    offered('o1', 'picnic', 'work'),
    offered('o2', 'arena', 'home'),
    person('b1', pair, `brian.${id}@example.com`),
    person('b2', pair, `brian.${id}@example.net`),
  ]
  const context = await browser.newContext({ viewport: phoneSize })
  const res = await context.request.post('/api/sync/push', {
    data: { clientId: `combine-${id}`, mutations: mutations.map(([n, args], i) => ({ id: `${k('m')}-${i}`, name: n, args, createdAt: new Date().toISOString() })) },
  })
  expect((await res.json()).results.filter((r: { status: string }) => r.status !== 'applied')).toEqual([])

  const office = await context.newPage()
  await office.goto(`/#crew/person/${k('work')}`)
  await expect(office.getByRole('status')).toHaveText('Up to date')
  await expect(office.getByText(`${name} looks like the same person, brought in twice.`)).toBeVisible()

  // The other her is ticked to start with; combining asks first, and says what happens.
  await office.getByRole('button', { name: 'Combine with…' }).click()
  await expect(office.getByRole('checkbox', { name: new RegExp(`aoife\\.${id}@example\\.net`) })).toBeChecked()
  await office.getByRole('button', { name: 'Combine 2 people' }).click()
  await expect(office.getByText(`Combine 2 people called ${name} into one?`)).toBeVisible()
  await expect(office.getByText("It can't be split again in one go.", { exact: false })).toBeVisible()
  await office.getByRole('button', { name: 'Combine them' }).click()
  await expect(office.getByRole('status').filter({ hasText: `${name} is one person now.` })).toBeVisible()
  await expect(office.getByRole('status').first()).toHaveText('Up to date')

  // One person, with both her offers and both her addresses.
  await expect(office.locator('.facts')).toContainText(`aoife.${id}@example.net`)
  const ahead = office.getByRole('region', { name: 'Coming up' })
  await expect(ahead.getByText(`Picnic ${id}`)).toBeVisible()
  await expect(ahead.getByText(`Arena ${id}`)).toBeVisible()
  await expect(office.getByText('looks like the same person')).toHaveCount(0)
  expect(await office.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(phoneSize.width)

  // Tidy up has the other pair, ticked, and combines them the same way.
  await office.goto('/#jobs/tidy')
  const twice = office.getByRole('region', { name: 'The same person, brought in twice' })
  const group = twice.locator('li.is-on').filter({ hasText: `brian.${id}@example.com` })
  await expect(group.getByRole('checkbox')).toHaveCount(2)
  await group.getByRole('button', { name: 'Combine 2 people' }).click()
  await group.getByRole('button', { name: 'Combine them' }).click()
  await expect(twice.getByText(`${pair} is one person now.`)).toBeVisible()
  await twice.getByRole('link', { name: 'Open their page' }).click()
  await expect(office.locator('.facts')).toContainText(/brian\..*@example\.(com|net)/)
})
