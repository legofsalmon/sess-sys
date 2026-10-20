import { expect, test } from '@playwright/test'

/**
 * Jobs › Tidy up › People named from their address (ADR 0068): a name typed
 * and saved for one person, then another, then another, each sticks and
 * leaves the list, including the ones whose address already spells their
 * name (sorcha.box@…, saved as Sorcha Box), which used to stay listed as if
 * nothing had been saved. The test server is shared with the other browser
 * tests, so every address here is this run's own.
 */

// Letters only: a name made from an address drops its digits.
const id = Array.from({ length: 6 }, () => 'abcdefghijklmnopqrstuvwxyz'[Math.floor(Math.random() * 26)]).join('')
const handles = [`soundbox${id}`, `liam.rig${id}`, `saoirse.hand${id}`]
// As a bring-in names them from the address.
const fromAddress = [`Soundbox${id}`, `Liam Rig${id}`, `Saoirse Hand${id}`]

test('names typed for several people named from their address are each saved', async ({ page, request }) => {
  const res = await request.post('/api/sync/push', {
    data: {
      clientId: `tidy-names-${id}`,
      mutations: handles.map((h, i) => ({
        id: `tidy-names-${id}-${i}`,
        name: 'person.upsert',
        args: { id: `tidy-${id}-${i}`, name: fromAddress[i]!, kind: 'freelancer', email: `${h}@gmail.com`, phone: null, skills: [], dayRateCents: null, notes: '' },
        createdAt: new Date().toISOString(),
      })),
    },
  })
  expect((await res.json()).results.filter((r: { status: string }) => r.status !== 'applied')).toEqual([])

  await page.goto('/#jobs/tidy')
  await expect(page.getByRole('status').first()).toHaveText('Up to date')
  const names = page.getByRole('region', { name: 'People named from their address' })
  const given = [
    ['Sorcha', 'Box'],
    // What their addresses already spell.
    ['Liam', `Rig${id}`],
    ['Saoirse', `Hand${id}`],
  ] as const
  for (const [i, h] of handles.entries()) {
    const row = names.getByRole('form', { name: `Name for ${h}@gmail.com` })
    await row.getByRole('textbox', { name: `First name for ${h}@gmail.com` }).fill(given[i]![0])
    await row.getByRole('textbox', { name: `Last name for ${h}@gmail.com` }).fill(given[i]![1])
    await row.getByRole('button', { name: 'Save' }).click()
    await expect(row).toHaveCount(0)
  }
  await expect(page.getByRole('status').first()).toHaveText('Up to date')
  await page.reload()
  await expect(page.getByRole('status').first()).toHaveText('Up to date')
  for (const h of handles) await expect(page.getByRole('form', { name: `Name for ${h}@gmail.com` })).toHaveCount(0)
  await page.goto('/#crew/people')
  for (const [first, last] of given) await expect(page.getByText(`${first} ${last}`).first()).toBeVisible()
})
