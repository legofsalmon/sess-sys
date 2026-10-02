import { expect, test, type APIRequestContext } from '@playwright/test'

/**
 * The certificates a call needs, and running late (ADR 0028), end to end
 * on a phone: the riggers' call needs IPAF, so the picker marks someone
 * without it and Offer says why, in place; the Crew tab lists the
 * certificates running out, each with a message asking for the new card;
 * and a running late sent from a freelancer's link, with no app and no
 * script, shows on the Crew tab at once and on the badge. Uses the made-up
 * data (ADR 0019), so it starts fresh before and after: the other tests
 * share this server.
 */

const phoneSize = { width: 390, height: 844 }
const fresh = { data: { confirm: 'delete everything' } }

test.beforeEach(async ({ request }) => {
  expect((await request.post('/api/data/start-fresh', fresh)).ok()).toBe(true)
  expect((await request.post('/api/data/made-up')).ok()).toBe(true)
})

test.afterEach(async ({ request }) => {
  expect((await request.post('/api/data/start-fresh', fresh)).ok()).toBe(true)
})

/** Someone's private link, as the office would send it. */
async function linkOf(request: APIRequestContext, name: string) {
  const { changes } = (await (await request.get('/api/sync/pull?after=0')).json()) as { changes: { entity: string; data: { name: string; linkToken: string } }[] }
  return `/f/${changes.findLast((c) => c.entity === 'person' && c.data.name === name)!.data.linkToken}`
}

test('a call needing IPAF marks who lacks it in the picker, and Offer says why in place', async ({ browser }) => {
  // Proves: the picker puts Laoise, with no IPAF, under "Missing a certificate" with a mark; Offer refuses in the server's words without sending; someone not known gets a warning instead.
  const office = await (await browser.newContext({ viewport: phoneSize })).newPage()
  await office.goto('/#crew')
  await expect(office.getByRole('status')).toHaveText('Up to date')
  const call = office.locator('.call-group', { hasText: 'Harbour Lights Festival' }).getByRole('article', { name: '2 × Rigger' })
  await call.getByRole('button', { name: /^2 × Rigger/ }).click()
  await expect(call).toContainText('needs working at height and IPAF')
  await call.getByRole('button', { name: 'Offer…' }).click()

  const picker = call.getByLabel('Offer to')
  const missing = picker.locator('optgroup[label="Missing a certificate"] option', { hasText: 'Laoise Keane' })
  await expect(missing).toHaveCount(1)
  await expect(missing).toContainText('no IPAF')
  // Those not known come before those missing one.
  await expect(picker.locator('optgroup').first()).toHaveAttribute('label', 'Not known: check first')

  await picker.selectOption({ label: (await missing.textContent())!.trim() })
  await call.getByRole('button', { name: 'Offer', exact: true }).click()
  await expect(call.getByRole('alert')).toHaveText("Laoise Keane has no IPAF, which this call needs. Update their card if that's changed.")
  // Nothing was sent: the call still lists only Pádraig and Róisín, and nothing waits to sync.
  await expect(call.locator('.call-line')).toContainText('Pádraig Kenny, Róisín Farrell (offered)')
  await expect(office.getByRole('status')).toHaveText('Up to date')

  // Someone whose certificates aren't known can be offered it, with a warning first.
  const dara = picker.locator('option', { hasText: 'Dara Quinn' })
  await picker.selectOption({ label: (await dara.textContent())!.trim() })
  await expect(call.getByRole('alert')).toHaveCount(0)
  await expect(call.locator('.offer-form .warn-line')).toHaveText('Working at height and IPAF not known for Dara Quinn: check before the job.')
})

test('the Crew tab lists certificates running out, soonest first, each with a message asking for the new card', async ({ browser }) => {
  // Proves: the reminders card counts them all, shows the longest run out first, and opens a message to send by WhatsApp, text or email.
  const office = await (await browser.newContext({ viewport: phoneSize })).newPage()
  await office.goto('/#crew')
  await expect(office.getByRole('status')).toHaveText('Up to date')
  const reminders = office.getByRole('region', { name: 'Certificates running out' })
  await expect(reminders.getByRole('heading')).toHaveText('Certificates running out (4)')
  const rows = reminders.locator('.reminder')
  await expect(rows).toHaveCount(3)
  await expect(rows.first()).toContainText(/^Tadhg BradyManual handling ran out on \w{3} \d{1,2} \w{3}/)
  await reminders.getByRole('button', { name: 'Show all 4 certificates' }).click()
  await expect(rows.last()).toContainText(/^Pádraig KennyIPAF runs out on/)

  await rows.last().getByRole('button', { name: "Ask for the new card: Pádraig Kenny's IPAF" }).click()
  const panel = office.getByRole('region', { name: 'Send reminder about IPAF to Pádraig Kenny' })
  await expect(panel.locator('textarea')).toHaveValue(/^Hi Pádraig, our records say your IPAF runs out on \d{1,2} \w+( \d{4})?\.\nWhen you've renewed it, could you send us a photo of the new card\?/)
  await expect(panel.getByRole('link', { name: 'WhatsApp' })).toHaveAttribute('href', /^https:\/\/wa\.me\/447700900\d{3}\?text=Hi%20P%C3%A1draig/)
  await expect(panel.getByRole('link', { name: 'Email' })).toHaveAttribute('href', /^mailto:padraig@example\.com\?subject=Your%20IPAF/)

  // His card says it too, in the warn tone, with his card's categories.
  await office.getByRole('button', { name: /^Pádraig Kenny/ }).click()
  const card = office.locator('.row.person', { has: office.getByRole('button', { name: /^Pádraig Kenny/ }) })
  await expect(card).toContainText('IPAF 3a, 3b (to')
  await expect(card.locator('.warn-line')).toHaveText(/^IPAF runs out on/)
})

test('a running late sent from the link shows on the Crew tab at once, and on its badge', async ({ browser, request }) => {
  // Proves: Aoife, booked today, says from her link with no script that she's about 15 minutes late; the office's open Crew tab shows it in the queue and on the call's line, counts it on the badge, and Noted takes it off.
  const office = await (await browser.newContext({ viewport: phoneSize })).newPage()
  await office.goto('/#crew')
  await expect(office.getByRole('status')).toHaveText('Up to date')
  const badge = office.getByRole('navigation', { name: 'Areas' }).getByRole('link', { name: /^Crew/ }).locator('.badge [aria-hidden="true"]')
  const before = Number(await badge.textContent())
  const answers = office.locator('section').filter({ has: office.getByRole('heading', { name: /^Answers to check/ }) })
  // Gráinne's, from the made-up data, is there already.
  await expect(answers.locator('.late-row', { hasText: 'Gráinne Power' })).toContainText('about 30 minutes late, “Traffic on the M50”')

  const phone = await (await browser.newContext({ viewport: phoneSize, javaScriptEnabled: false })).newPage()
  await phone.goto(await linkOf(request, 'Aoife Brennan'))
  const today = phone.locator('section.today')
  await expect(today.getByRole('heading', { name: 'Today' })).toBeVisible()
  await today.getByText('Running late?').click()
  await expect(today.getByText('Sending this needs signal.')).toBeVisible()
  await today.getByLabel('About 15 minutes').check()
  await today.getByLabel('Note, if you like').fill('Parking')
  await today.getByRole('button', { name: 'Send' }).click()
  await expect(phone.getByRole('status')).toHaveText("Thanks. The office, and whoever's running the day, can see it now.")
  await expect(phone.locator('.late-said')).toHaveText('You\'ve told us: about 15 minutes late, “Parking”.')

  const row = answers.locator('.late-row', { hasText: 'Aoife Brennan' })
  await expect(row).toContainText('about 15 minutes late, “Parking”')
  await expect(row).toContainText('Liffey Brands Shoot · Crew chief · today, call 07:30')
  await expect(badge).toHaveText(String(before + 1))
  const shoot = office.locator('.call-group', { hasText: 'Liffey Brands Shoot' })
  await expect(shoot.getByRole('article', { name: '1 × Crew chief' }).locator('.late-line')).toHaveText('Aoife: about 15 minutes late, “Parking”')

  await row.getByRole('button', { name: 'Noted: Aoife Brennan is running late' }).click()
  await expect(row).toHaveCount(0)
  await expect(badge).toHaveText(String(before))
  // Noted, it stays on the call's line until the day is over.
  await expect(shoot.getByRole('article', { name: '1 × Crew chief' }).locator('.late-line')).toHaveText('Aoife: about 15 minutes late, “Parking”')

  // "I'm here now" from the link: the line says so.
  await phone.getByRole('button', { name: "I'm here now" }).click()
  await expect(phone.getByRole('status')).toHaveText("Thanks. The office can see you're there.")
  await expect(shoot.getByRole('article', { name: '1 × Crew chief' }).locator('.late-line')).toHaveText('Aoife: there now')
})
