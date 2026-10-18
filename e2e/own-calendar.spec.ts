import { expect, test } from '@playwright/test'
import { createServer, type Server } from 'node:http'

/**
 * Freelancers' own calendars, read only (ADR 0044), end to end: a
 * freelancer pastes their calendar's private address on their link, on a
 * phone with no script, and sees what we read back, with the promise of
 * what's kept said first; the office sees the busy day on their page, in
 * the planner as "Busy (own calendar)" and as a warning, never a refusal,
 * when offering them work; and one tap on the link stops it. The calendar
 * comes from a stand-in on this machine (the server is told of it by
 * OWN_CALENDAR_TEST_HOSTS, in playwright.config.ts), never the network.
 * The days are a few weeks ahead of today, since calendars are read four
 * months ahead; the people and the call have names of their own, since
 * the test server is shared.
 */

const phoneSize = { width: 390, height: 844 }
const id = Math.random().toString(36).slice(2, 8)
const standInPort = Number(process.env.E2E_PORT ?? '3099') + 1000

/** A day in Ireland, n days from today. */
function day(n: number): string {
  const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Dublin' })
  const d = new Date(`${today}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}
const compact = (d: string) => d.replace(/-/g, '')
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const label = (d: string) => {
  const date = new Date(`${d}T12:00:00Z`)
  return `${WEEKDAYS[date.getUTCDay()]} ${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]}`
}

/** Three weeks ahead, a Wednesday, so the call's two days sit in one planner week. */
const busyDay = (() => {
  for (let n = 21; ; n++) if (new Date(`${day(n)}T12:00:00Z`).getUTCDay() === 3) return day(n)
})()
const nextDay = (() => {
  const d = new Date(`${busyDay}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + 1)
  return d.toISOString().slice(0, 10)
})()

const calendar = [
  'BEGIN:VCALENDAR',
  'PRODID:-//Google Inc//Google Calendar 70.9054//EN',
  'VERSION:2.0',
  'BEGIN:VEVENT',
  `DTSTART;VALUE=DATE:${compact(busyDay)}`,
  `DTEND;VALUE=DATE:${compact(nextDay)}`,
  `UID:wedding-${id}@google.com`,
  'SUMMARY:Sister’s wedding in Galway',
  'LOCATION:The Twelve, Barna',
  'END:VEVENT',
  'END:VCALENDAR',
  '',
].join('\r\n')

const secretPath = `/calendar/ical/orla-${id}%40example.com/private-${id}0123/basic.ics`
let standIn: Server
let asked = 0

test.beforeAll(async () => {
  standIn = createServer((req, res) => {
    if (req.url !== secretPath) return res.writeHead(404).end()
    asked++
    res.writeHead(200, { 'content-type': 'text/calendar; charset=utf-8' }).end(calendar)
  })
  await new Promise<void>((resolve) => standIn.listen(standInPort, '127.0.0.1', resolve))
})
test.afterAll(async () => {
  await new Promise((resolve) => standIn.close(resolve))
})

test('a freelancer shares when they are busy from their link, the office sees it and is warned, and one tap stops it', async ({ browser, request }) => {
  // Proves: sharing works with no script and keeps no title; busy shows on the person's page, in the planner and as a warning on an offer that can still go; stopping clears it everywhere.
  const name = `Orla Brennan ${id}`
  const mutations: [string, Record<string, unknown>][] = [
    ['person.upsert', { id: `orla-${id}`, name, kind: 'freelancer', email: null, phone: null, skills: ['audio'], dayRateCents: 25000, notes: '' }],
    [
      'call.create',
      { id: `call-${id}`, phaseId: null, project: `Convention ${id}`, phase: 'Show', venue: '', role: 'Audio tech', start: busyDay, end: nextDay, callTime: '08:00', needed: 1, dayRateCents: 25000, details: '', replyBy: null },
    ],
  ]
  const pushed = await request.post('/api/sync/push', {
    data: { clientId: `own-calendar-${id}`, mutations: mutations.map(([n, args], i) => ({ id: `m-${id}-${i}`, name: n, args, createdAt: new Date().toISOString() })) },
  })
  expect((await pushed.json()).results.map((r: { status: string }) => r.status)).toEqual(['applied', 'applied'])
  const { changes } = (await (await request.get('/api/sync/pull?after=0')).json()) as { changes: { entity: string; id: string; data: { linkToken?: string } }[] }
  const token = changes.find((c) => c.entity === 'person' && c.id === `orla-${id}`)!.data.linkToken!

  // On her phone with no script: what's kept is said before anything is pasted.
  const phone = await (await browser.newContext({ viewport: phoneSize, javaScriptEnabled: false })).newPage()
  await phone.goto(`/f/${token}`)
  const section = phone.locator('section#calendar')
  await expect(section.getByRole('heading', { name: 'Your own calendar' })).toBeVisible()
  await expect(section).toContainText("We keep only the times you're busy: never what, where or who with. Nothing is ever added to your calendar")
  await section.getByLabel("Your calendar's private address").fill(`http://127.0.0.1:${standInPort}${secretPath}`)
  await section.getByRole('button', { name: "Share when I'm busy" }).click()
  await expect(section.getByRole('status')).toHaveText("Thanks. We've read your calendar, and the office can see when you're busy.")
  await expect(section.locator('ul.busy li')).toHaveText([`${label(busyDay)} Busy all day`])
  expect(asked).toBe(1)
  // What it is and where never comes back; neither does the address.
  await expect(phone.locator('body')).not.toContainText('wedding')
  await expect(phone.locator('body')).not.toContainText('Galway')
  expect(await phone.content()).not.toContain(`private-${id}0123`)

  // The office, on her page.
  const office = await (await browser.newContext()).newPage()
  await office.goto(`/#crew/person/orla-${id}`)
  await expect(office.getByRole('status')).toHaveText('Up to date')
  const card = office.getByRole('region', { name: 'Their own calendar' })
  await expect(card).toContainText('Shared by them, from their link, last read today')
  await expect(card.locator('ul.busy-days li')).toHaveText([`${label(busyDay)} busy all day`])
  await expect(card).not.toContainText('wedding')

  // In the planner, by person: busy on the day, said as such, not a clash.
  await office.goto(`/#jobs/plan/week/${busyDay}/people`)
  await expect(office.getByRole('status')).toHaveText('Up to date')
  const cells = office.locator('tbody tr', { has: office.getByRole('rowheader', { name: new RegExp(`^${name}`) }) }).getByRole('cell')
  const wednesday = cells.nth(2)
  await expect(wednesday.locator('.item.busy')).toContainText('Busy (own calendar)')
  await expect(wednesday.locator('.item.busy')).toContainText('all day')
  await expect(cells.nth(3).locator('.item.busy')).toHaveCount(0)

  // Offering her the call: warned, and the offer still goes.
  await office.goto('/#crew/calls')
  await expect(office.getByRole('status')).toHaveText('Up to date')
  const call = office.locator('.call-group', { hasText: `Convention ${id}` }).getByRole('article', { name: '1 × Audio tech' })
  await call.getByRole('button', { name: '1 × Audio tech' }).click()
  await call.getByRole('button', { name: 'Offer…' }).click()
  const picker = call.getByLabel('Offer to')
  const option = picker.locator('option', { hasText: name })
  await expect(option).toContainText('busy in own calendar')
  await picker.selectOption({ value: `orla-${id}` })
  await expect(call.locator('.warn-line', { hasText: 'Busy in their own calendar' })).toHaveText(
    `Busy in their own calendar on ${label(busyDay)} (all day). The offer can still go: it may be something they can move, and they can still say yes.`
  )
  await call.getByRole('button', { name: 'Offer', exact: true }).click()
  await expect(office.getByRole('region', { name: `Send offer to ${name}` })).toBeVisible()

  // One tap on her link stops it, and it's gone from her page in the app.
  await phone.goto(`/f/${token}`)
  await section.getByRole('button', { name: 'Stop sharing my calendar' }).click()
  await expect(section.getByRole('button', { name: "Share when I'm busy" })).toBeVisible()
  await office.goto(`/#crew/person/orla-${id}`)
  await expect(office.getByRole('status')).toHaveText('Up to date')
  await expect(office.getByRole('region', { name: 'Their own calendar' })).toContainText("hasn't shared when they're busy")
})
