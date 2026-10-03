import { expect, test, type APIRequestContext, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'

/**
 * People's documents (ADR 0029), end to end on a phone: the office adds a
 * document with an expiry and a file on someone's card and opens it again;
 * a freelancer sends a renewed card from their private link, with no app
 * and no script; the office checks it in "Answers to check" and the
 * certificate's expiry follows; the list of what's running out holds
 * documents beside certificates, each with a message asking for the new
 * one; and a title typed as one long word wraps on a phone. The test
 * server keeps files in a folder (DOCUMENTS_DIR), as a bucket would. Uses
 * the made-up data (ADR 0019), so it starts fresh before and after: the
 * other tests share this server.
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

/** Someone as the server has them: their id, and their private link as the office would send it. */
async function personOf(request: APIRequestContext, name: string) {
  const { changes } = (await (await request.get('/api/sync/pull?after=0')).json()) as { changes: { entity: string; data: { id: string; name: string; linkToken: string } }[] }
  const { id, linkToken } = changes.findLast((c) => c.entity === 'person' && c.data.name === name)!.data
  return { id, link: `/f/${linkToken}` }
}
const linkOf = async (request: APIRequestContext, name: string) => (await personOf(request, name)).link

/** A day counted from today in Ireland, as a date field takes it. */
function inDays(n: number) {
  const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Dublin' })
  return new Date(Date.parse(`${today}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10)
}
/** "Fri 23 Oct 2026", as the app writes a document's day. */
function dayText(d: string) {
  const at = new Date(`${d}T12:00:00Z`)
  return `${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][at.getUTCDay()]} ${at.getUTCDate()} ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][at.getUTCMonth()]} ${d.slice(0, 4)}`
}

/** Made-up files, by their first bytes, as a scanner and a phone write them. */
const PDF = Buffer.from('%PDF-1.4\n% Made up for a test: not a real document.\n%%EOF\n')
const PHOTO = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from('A made-up photo of a renewed IPAF card.')])

test('the office adds a document with an expiry and a file on a card, and opens it again', async ({ browser }) => {
  // Proves: on a phone, Add document takes the kind, title, day and a PDF, says it was added, and lists it with its day and file; Open downloads it under the person's name and its title; a web page is refused in place, the form keeping what was typed.
  const office = await (await browser.newContext({ viewport: phoneSize })).newPage()
  await office.goto('/#crew')
  await expect(office.getByRole('status')).toHaveText('Up to date')
  await office.getByRole('button', { name: /^Dara Quinn/ }).click()
  const docs = office.getByRole('group', { name: 'Documents: Dara Quinn' })
  // The made-up insurance is there already, running out soon, in the warn tone.
  await expect(docs.locator('.row.doc', { hasText: 'Public liability insurance (Quinn Audio Ltd)' }).locator('.warn')).toHaveText(`Runs out ${dayText(inDays(18))}`)

  await docs.getByRole('button', { name: 'Add document' }).click()
  const form = docs.getByRole('form', { name: 'Add a document for Dara Quinn' })
  await expect(form.getByLabel('What is it')).toBeFocused()
  await form.getByLabel('Title').fill("Employer's liability insurance")
  await form.getByLabel('Runs out').fill(inDays(200))
  // A web page is refused before anything is sent, and what was typed stays.
  await form.getByLabel('The file').setInputFiles({ name: 'schedule.pdf', mimeType: 'application/pdf', buffer: Buffer.from('<!doctype html><script>alert(1)</script>') })
  await form.getByRole('button', { name: 'Add document' }).click()
  await expect(form.getByRole('alert')).toHaveText(/^That file is a web page or a drawing \(SVG\)/)
  await expect(form.getByLabel('Title')).toHaveValue("Employer's liability insurance")

  await form.getByLabel('The file').setInputFiles({ name: 'schedule.pdf', mimeType: 'application/pdf', buffer: PDF })
  await form.getByRole('button', { name: 'Add document' }).click()
  await expect(form.getByText("Added Employer's liability insurance.")).toBeVisible()
  const line = docs.locator('.row.doc', { hasText: "Employer's liability insurance" })
  await expect(line).toContainText(`Runs out ${dayText(inDays(200))} · PDF, 1 KB`)
  await expect(office.getByRole('status')).toHaveText('Up to date')

  const downloading = office.waitForEvent('download')
  await line.getByRole('button', { name: "Open Dara Quinn's Employer's liability insurance" }).click()
  const download = await downloading
  expect(download.suggestedFilename()).toBe("Dara Quinn - Employer's liability insurance.pdf")
  expect(readFileSync((await download.path())!).equals(PDF)).toBe(true)
})

test("a renewed card sent from the link is checked by the office, and the certificate's expiry follows", async ({ browser, request }) => {
  // Proves: the reminders list Dara's insurance beside Pádraig's IPAF, with a message pointing to his page; Pádraig sends a renewed IPAF card from his link with no script; it waits in "Answers to check" on the badge, saying what checking does; Checked moves his IPAF's day, takes the old card's place and his IPAF off the list.
  const office = await (await browser.newContext({ viewport: phoneSize })).newPage()
  await office.goto('/#crew')
  await expect(office.getByRole('status')).toHaveText('Up to date')
  const reminders = office.getByRole('region', { name: 'Certificates and documents running out' })
  await expect(reminders.getByRole('heading')).toHaveText('Running out (6)')
  await reminders.getByRole('button', { name: 'Show all 6 certificates and documents' }).click()
  await expect(reminders.locator('.reminder', { hasText: 'Gráinne Power' })).toContainText(/Public liability insurance ran out on \w{3} \d{1,2} \w{3}/)
  await reminders.getByRole('button', { name: "Ask for the new one: Dara Quinn's public liability insurance (Quinn Audio Ltd)" }).click()
  const panel = office.getByRole('region', { name: 'Send reminder about public liability insurance (Quinn Audio Ltd) to Dara Quinn' })
  await expect(panel.locator('textarea')).toHaveValue(
    /^Hi Dara, our records say your public liability insurance \(Quinn Audio Ltd\) runs out on \d{1,2} \w+( \d{4})?\.\nWhen you've renewed it, could you send us the new one\? We need it to offer you work\.\nYou can send it from your page, under Your documents: http:\/\/localhost:\d+\/f\/[\w-]+\nThanks\.$/
  )
  await panel.getByRole('button', { name: 'Done' }).click()
  const badge = office.getByRole('navigation', { name: 'Areas' }).getByRole('link', { name: /^Crew/ }).locator('.badge [aria-hidden="true"]')
  const before = Number(await badge.textContent())

  // Pádraig, on his phone, with no app and no script.
  const phone = await (await browser.newContext({ viewport: phoneSize, javaScriptEnabled: false })).newPage()
  await phone.goto(await linkOf(request, 'Pádraig Kenny'))
  const card = phone.locator('#documents article', { hasText: 'IPAF card' })
  await expect(card.locator('.tag')).toHaveText('Runs out soon')
  await expect(card).toContainText(`Runs out on ${dayText(inDays(20))} · PDF`)
  await card.getByText('Send a new one').click()
  await card.getByLabel('The new one runs out').fill(inDays(1095))
  await card.getByLabel('The file').setInputFiles({ name: 'IMG_2231.JPG', mimeType: 'image/jpeg', buffer: PHOTO })
  await card.getByRole('button', { name: 'Send to the office' }).click()
  await expect(phone.getByRole('status')).toHaveText("Thanks, it's gone to the office. They'll check it, and it's on your list meanwhile.")
  await expect(phone.locator('#documents article', { hasText: 'With the office to check' })).toContainText(`Runs out on ${dayText(inDays(1095))} · JPEG, 1 KB`)

  // The office's open Crew tab has it at once, on the badge, saying what checking it does.
  const answers = office.locator('section').filter({ has: office.getByRole('heading', { name: /^Answers to check/ }) })
  const row = answers.locator('.doc-check', { hasText: 'Pádraig Kenny sent a renewed IPAF card' })
  await expect(row).toContainText(`Runs out ${dayText(inDays(1095))}, they say · JPEG, 1 KB`)
  await expect(row).toContainText(`Checking it sets Pádraig's IPAF to run out on ${dayText(inDays(1095))}.`)
  await expect(badge).toHaveText(String(before + 1))

  await row.getByRole('button', { name: 'Checked: the IPAF card Pádraig Kenny sent' }).click()
  await expect(row).toHaveCount(0)
  await expect(badge).toHaveText(String(before))
  await expect(office.getByRole('status')).toHaveText('Up to date')
  // His IPAF is off the list, its new day on his card, and one IPAF card left: the one he sent.
  await expect(reminders.getByRole('heading')).toHaveText('Running out (5)')
  await expect(reminders.locator('.reminder', { hasText: 'Pádraig Kenny' })).toHaveCount(0)
  await office.getByRole('button', { name: /^Pádraig Kenny/ }).click()
  const person = office.locator('.row.person', { has: office.getByRole('button', { name: /^Pádraig Kenny/ }) })
  await expect(person).toContainText(`IPAF 3a, 3b (to ${dayText(inDays(1095))})`)
  const cards = person.getByRole('group', { name: 'Documents: Pádraig Kenny' }).locator('.row.doc', { hasText: 'IPAF card' })
  await expect(cards).toHaveCount(1)
  await expect(cards).toContainText(`Runs out ${dayText(inDays(1095))} · JPEG, 1 KB`)
})

test("a title typed as one long word wraps on a phone, on the person's card and on their link", async ({ browser, request }) => {
  // Proves: a title with no spaces, such as a file's name, never makes the Crew tab or the link page with no script wider than a phone, so nothing on either has to be scrolled sideways.
  const title = 'Public_liability_insurance_schedule_QuinnAudio_scan_final_v2.pdf'
  const dara = await personOf(request, 'Dara Quinn')
  const added = await request.post(`/api/documents/long-title/file?${new URLSearchParams({ personId: dara.id, kind: 'other', title, expires: '' })}`, {
    headers: { 'content-type': 'application/octet-stream' },
    data: PDF,
  })
  expect(added.ok()).toBe(true)
  const wide = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth)

  const office = await (await browser.newContext({ viewport: phoneSize })).newPage()
  await office.goto('/#crew')
  await expect(office.getByRole('status')).toHaveText('Up to date')
  await office.getByRole('button', { name: /^Dara Quinn/ }).click()
  await expect(office.getByRole('group', { name: 'Documents: Dara Quinn' })).toContainText(title)
  expect(await wide(office)).toBeLessThanOrEqual(phoneSize.width)

  const phone = await (await browser.newContext({ viewport: phoneSize, javaScriptEnabled: false })).newPage()
  await phone.goto(dara.link)
  await expect(phone.locator('#documents article', { hasText: title })).toBeVisible()
  expect(await wide(phone)).toBeLessThanOrEqual(phoneSize.width)
})
