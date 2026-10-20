import { expect, test, type Download } from '@playwright/test'
import { unzipSync, strFromU8 } from 'fflate'
import { readFile } from 'node:fs/promises'

/**
 * The Crewbox show pack (ADR 0045): the office scans a speaker out for a
 * job, downloads the Show phase's pack from its call sheet with the box's
 * address and PIN for the join QR, and then, with no signal, the whole
 * job's from its page. Each is one .zip, made on the phone and sent
 * nowhere. Uses the made-up data (ADR 0019), so it starts fresh before and
 * after: the other tests share this server.
 */

const phoneSize = { width: 390, height: 844 }
const fresh = { data: { confirm: 'delete everything' } }

async function unzip(download: Download): Promise<Record<string, string>> {
  const files = unzipSync(new Uint8Array(await readFile((await download.path())!)))
  return Object.fromEntries(Object.entries(files).map(([path, data]) => [path, strFromU8(data)]))
}

test('the crew chief’s show pack, for a phase and, with no signal, for the whole job', async ({ browser, request }) => {
  expect((await request.post('/api/data/start-fresh', fresh)).ok()).toBe(true)
  expect((await request.post('/api/data/made-up')).ok()).toBe(true)

  const context = await browser.newContext({ viewport: phoneSize, acceptDownloads: true })
  const page = await context.newPage()
  await page.goto('/#jobs')
  await expect(page.locator('.conn')).toHaveText('Up to date')
  await page.locator('.job-row', { hasText: 'Harbour Lights Festival' }).click()

  // One of the speakers goes out with the job, so its number is on the pack's kit.
  await page.getByRole('tab', { name: 'Kit and vans' }).click()
  await page.getByRole('link', { name: 'Pick list' }).click()
  const where = await page.getByRole('article', { name: 'd&b Y10P' }).getByRole('list', { name: 'Where to find them' }).textContent()
  const number = /SH-\d{6}/.exec(where ?? '')![0]
  await page.getByLabel('Number or serial').fill(number)
  await page.getByLabel('Number or serial').press('Enter')
  await expect(page.getByRole('status', { name: 'Last scan' })).toContainText(`${number} d&b Y10P`)
  await page.goBack()

  await page.getByRole('tab', { name: /^Phases/ }).click()
  const show = page.getByRole('article', { name: 'Show' })
  await show.locator('summary').click()
  await show.getByRole('link', { name: 'Call sheet' }).click()
  const card = page.getByRole('region', { name: 'Show pack' })
  await expect(card).toContainText('It has the numbers of crew who have said yes')

  // The box's address, typed wrong first: said where, and kept.
  await card.getByText('Join QR on the crew list').click()
  await card.getByLabel("The box's address on the site's Wi-Fi").fill('crew box')
  await card.getByRole('button', { name: 'Download show pack' }).click()
  await expect(card.getByRole('alert')).toContainText("That isn't an address the box could have")
  await expect(card.getByLabel("The box's address on the site's Wi-Fi")).toHaveValue('crew box')
  await card.getByLabel("The box's address on the site's Wi-Fi").fill('crewbox.local')
  await card.getByLabel('Event PIN').fill('4821')
  await expect(card.getByRole('alert')).toHaveCount(0)

  const [phaseDownload] = await Promise.all([page.waitForEvent('download'), card.getByRole('button', { name: 'Download show pack' }).click()])
  expect(phaseDownload.suggestedFilename()).toBe('show-pack-harbour-lights-festival-show.zip')
  await expect(card).toContainText('Downloaded show-pack-harbour-lights-festival-show.zip')
  const pack = await unzip(phaseDownload)
  expect(Object.keys(pack).sort()).toEqual(
    ['README.txt', 'contacts.csv', 'crew-list.html', 'crew.csv', 'event.json', 'kit.csv', 'lighting.csv', 'manifest.json', 'patch.csv', 'running-order.csv', 'running-order.txt'].sort()
  )
  const manifest = JSON.parse(pack['manifest.json']!)
  expect(manifest).toMatchObject({ format: 'session-hire/show-pack', formatVersion: 1, scope: 'phase', joinQr: true, job: { name: 'Harbour Lights Festival' } })
  expect(manifest.files.find((f: { path: string }) => f.path === 'patch.csv')).toMatchObject({ template: true, rows: 0 })
  // Who's on, with numbers, and nobody only offered.
  expect(pack['crew.csv']).toContain('Dara Quinn')
  expect(pack['crew.csv']).toMatch(/Sound No\.1,[^,]*,12:00,[\d -]+,booked,\+44 7700 900\d{3}/)
  expect(pack['crew.csv']).not.toContain('Fionn Gallagher')
  // The running order as acts, the kit with the number out, and who to ring.
  expect(pack['running-order.csv']).toContain(',Doors,,')
  // Seven lines, one order for each of the phase's two days.
  expect(pack['running-order.csv']!.trim().split('\r\n')).toHaveLength(15)
  expect(pack['kit.csv']).toMatch(new RegExp(`audio,Speakers,d&b Y10P,12,0,,1,${number}`))
  expect(pack['contacts.csv']).toContain('Contact on the day,Aoife Brennan')
  expect(pack['crew-list.html']).toContain('<svg')
  expect(pack['crew-list.html']).toContain('http://crewbox.local/connect')
  expect(pack['crew-list.html']).toContain('4821')
  expect(JSON.parse(pack['event.json']!).phases[0].venue.name).toBe('Riverside Park')
  // Nothing about money: the quote's prices and the crew's rates stay out.
  const everything = Object.values(pack).join('\n').replace('No rates or prices are in it.', '')
  expect(everything).not.toMatch(/€|rate|price/i)
  expect(everything).not.toContain('Niamh Walsh')

  // No signal: the whole job's, from its page, from what the phone holds.
  await page.goBack()
  await context.setOffline(true)
  await page.getByRole('tab', { name: 'Show pack' }).click()
  const job = page.getByRole('region', { name: 'Show pack' })
  await expect(job).toContainText('for the whole job')
  const [jobDownload] = await Promise.all([page.waitForEvent('download'), job.getByRole('button', { name: 'Download show pack' }).click()])
  expect(jobDownload.suggestedFilename()).toBe('show-pack-harbour-lights-festival.zip')
  const whole = await unzip(jobDownload)
  expect(JSON.parse(whole['manifest.json']!).phases.map((p: { name: string }) => p.name)).toEqual(['Load in', 'Show', 'Load out'])
  expect(JSON.parse(whole['manifest.json']!).joinQr).toBe(false)
  expect(whole['running-order.csv']).toContain('Trucks leave')
  expect(whole['crew.csv']).toContain('Load in')
  await context.setOffline(false)

  expect((await request.post('/api/data/start-fresh', fresh)).ok()).toBe(true)
})
