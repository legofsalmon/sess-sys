import { expect, test } from '@playwright/test'

/**
 * A person's photo (ADR 0065): put up from their page in place of their
 * initials, shown in the People list too, and taken down again after a
 * question. The test server keeps files in a folder (DOCUMENTS_DIR), as a
 * bucket would. Every name here is this run's own.
 */

const phoneSize = { width: 390, height: 844 }
const id = Math.random().toString(36).slice(2, 8)
/** A small square PNG, as a phone's photo picker would hand one over. */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAIAAACQkWg2AAAAFklEQVR4nGM4YWRDEmIY1TCqYfhqAABa5TYQf4CqjAAAAABJRU5ErkJggg==',
  'base64'
)

test("a photo goes on a person's page in place of their initials, and comes off again", async ({ browser }) => {
  const name = `Orla Photo ${id}`
  const context = await browser.newContext({ viewport: phoneSize })
  const res = await context.request.post('/api/sync/push', {
    data: {
      clientId: `photo-${id}`,
      mutations: [{ id: `m-${id}`, name: 'person.upsert', args: { id: `orla-${id}`, name, kind: 'freelancer', email: null, phone: null, skills: [], dayRateCents: null, notes: '' }, createdAt: new Date().toISOString() }],
    },
  })
  expect((await res.json()).results[0].status).toBe('applied')

  const page = await context.newPage()
  await page.goto(`/#crew/person/orla-${id}`)
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(name)
  await page.getByRole('tab', { name: /^Details/ }).click()
  const face = page.locator('.page-head .avatar-large')
  await expect(face).toHaveAttribute('data-initials', /^O/)
  await expect(face.locator('img')).toHaveCount(0)

  await page.getByText('Add a photo').locator('input[type=file]').setInputFiles({ name: 'IMG_2041.png', mimeType: 'image/png', buffer: PNG })
  await expect(face.locator('img')).toHaveAttribute('src', new RegExp(`/api/people/orla-${id}/photo\\?v=`))
  await expect(page.getByText('Change photo')).toBeVisible()
  // Made a JPEG on the device before it went.
  const src = (await face.locator('img').getAttribute('src'))!
  expect((await context.request.get(src)).headers()['content-type']).toBe('image/jpeg')
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(phoneSize.width)

  // In the People list too.
  await page.goto('/#crew/people')
  const people = page.getByRole('region', { name: 'People' })
  await people.getByLabel('Find a person').fill(`orla photo ${id}`)
  await expect(people.getByRole('link', { name: new RegExp(`^${name}`) }).locator('.avatar img')).toHaveCount(1)

  await page.goto(`/#crew/person/orla-${id}`)
  await page.getByRole('button', { name: 'Remove photo' }).click()
  await page.getByRole('button', { name: 'Take it off' }).click()
  await expect(face.locator('img')).toHaveCount(0)
  await expect(page.getByText('Add a photo')).toBeVisible()
  await context.close()
})
