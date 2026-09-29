import { expect, test } from '@playwright/test'

/**
 * Crew booking end to end: the office adds a freelancer and a job and makes
 * an offer; the freelancer opens their private link on a phone (no app, no
 * login), takes two of the three days; the office sees it live and confirms.
 * To refresh the blueprint screenshots, run this file on its own with SHOTS=1.
 */

const shot = (name: string) => (process.env.SHOTS ? { path: `docs/hub/img/${name}.png` } : undefined)
const phoneSize = { width: 390, height: 844 }

test('office offers a job, freelancer answers from their link', async ({ browser }) => {
  const office = await (await browser.newContext({ viewport: phoneSize })).newPage()
  await office.goto('/#crew')
  await expect(office.getByRole('status')).toHaveText('Up to date')

  const person = office.locator('form').filter({ has: office.getByRole('button', { name: 'Add person' }) })
  await person.getByLabel('Name').fill('Aoife Byrne')
  await person.getByLabel('Mobile').fill('+353 87 123 4567')
  await person.getByLabel('Skills').fill('audio, monitors')
  await person.getByRole('button', { name: 'Add person' }).click()
  await expect(office.getByText('Aoife Byrne')).toBeVisible()

  // A one-off, not in Jobs: the crew screen still takes the job's details as typed.
  const job = office.locator('form').filter({ has: office.getByRole('button', { name: 'Ask for crew' }) })
  await job.getByLabel('Project').fill('Electric Picnic')
  await job.getByLabel('Phase').fill('Build')
  await job.getByLabel('Role').fill('Audio tech')
  await job.getByLabel('From').fill('2030-08-29')
  await job.getByLabel('To', { exact: true }).fill('2030-08-31')
  await job.getByLabel('Call time').fill('08:00')
  await job.getByLabel('Day rate €').fill('250')
  await job.getByLabel('Venue').fill('Stradbally Hall, Co. Laois')
  await job.getByLabel('Details for crew').fill('Food on site. Parking at gate C.')
  await job.getByRole('button', { name: 'Ask for crew' }).click()
  await expect(office.getByText('Electric Picnic').first()).toBeVisible()
  await expect(office.getByRole('status')).toHaveText('Up to date')

  await office.getByLabel('Offer to').selectOption({ label: 'Aoife Byrne (audio, monitors)' })
  await office.getByRole('button', { name: 'Offer', exact: true }).click()
  const share = office.getByRole('region', { name: 'Send offer to Aoife Byrne' })
  await expect(share.getByRole('link', { name: 'WhatsApp' })).toHaveAttribute('href', /^https:\/\/wa\.me\/353871234567\?text=/)
  await expect(office.getByRole('status')).toHaveText('Up to date')
  await office.screenshot(shot('crew-office-offer'))
  const message = await share.locator('textarea').inputValue()
  const link = message.match(/https?:\/\/\S+\/f\/\S+/)![0]
  expect(message).toContain('Hi Aoife, are you free for Electric Picnic (Build)?')

  // The freelancer taps the link in WhatsApp: a plain page, no sign-in.
  const phone = await (await browser.newContext({ viewport: phoneSize, javaScriptEnabled: false })).newPage()
  await phone.goto(link)
  await expect(phone.getByRole('heading', { name: 'Electric Picnic Build' })).toBeVisible()
  await phone.screenshot(shot('crew-freelancer-offer'))
  await phone.getByLabel('Sat 31 Aug').uncheck()
  await phone.getByRole('button', { name: 'Accept these days' }).click()
  await expect(phone.getByText("Thanks, you're down for it.")).toBeVisible()

  // The office sees the answer arrive and confirms it.
  const answers = office.locator('section').filter({ has: office.getByRole('heading', { name: 'Answers to check' }) })
  await expect(answers.getByText('Aoife Byrne accepted')).toBeVisible()
  await expect(answers.getByText('Thu 29 Aug to Fri 30 Aug', { exact: false })).toBeVisible()
  await answers.getByRole('button', { name: 'Confirm' }).click()
  await expect(office.getByText('Confirmed')).toBeVisible()
  await office.getByRole('link', { name: 'Done' }).or(office.getByRole('button', { name: 'Done' })).click()
  await office.evaluate(() => scrollTo(0, 0))
  await office.screenshot(shot('crew-office-confirmed'))

  await phone.reload()
  await expect(phone.locator('.tag.confirmed')).toHaveText('Confirmed')
  const ics = await phone.request.get(`${link}/calendar.ics`)
  expect(await ics.text()).toContain('SUMMARY:Electric Picnic - Build')
})
