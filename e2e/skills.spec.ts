import { expect, test } from '@playwright/test'

/**
 * Skills as picks (ADR 0063): the Skills field offers what the crew list
 * already calls people, the most used first and in the spelling most have,
 * and takes a new one as typed. Chosen ones sit in the field as chips that
 * come off with their own button or Backspace. The test server is shared
 * with the other browser tests, so every name here is this run's own.
 */

const id = Math.random().toString(36).slice(2, 8)
const k = (key: string) => `${key}-${id}`
const person = (key: string, name: string, skills: string[]) => ['person.upsert', { id: k(key), name, kind: 'freelancer', email: null, phone: null, skills, dayRateCents: null, notes: '' }] as const

test('the Skills field offers the skills in use and takes new ones as chips', async ({ page }) => {
  const pyro = `Pyro${id}`
  const mutations = [person('a', `Aoife Spark ${id}`, [pyro, 'Rigger']), person('b', `Brian Spark ${id}`, [pyro.toLowerCase()]), person('c', `Cian Spark ${id}`, [pyro])]
  const res = await page.request.post('/api/sync/push', {
    data: { clientId: `skills-${id}`, mutations: mutations.map(([n, args], i) => ({ id: `${k('m')}-${i}`, name: n, args, createdAt: new Date().toISOString() })) },
  })
  expect(res.ok()).toBe(true)

  await page.goto('/#crew/people')
  await expect(page.getByRole('status')).toHaveText('Up to date')
  await page.getByRole('button', { name: 'Add person' }).click()
  const form = page.getByRole('form', { name: 'Add person' })
  const name = `Dara Spark ${id}`
  await form.getByLabel('Name').fill(name)

  // Typing part of it offers the one in use, once, in the spelling most people have; Down and Enter choose it.
  const skills = form.getByRole('combobox', { name: 'Skills' })
  await skills.fill(`pyro${id.slice(0, 3)}`)
  const list = form.getByRole('listbox', { name: 'In use' })
  await expect(list.getByRole('option', { name: pyro, exact: true })).toHaveCount(1)
  await skills.press('ArrowDown')
  await skills.press('Enter')
  const chosen = form.getByRole('list', { name: 'Chosen' })
  await expect(chosen.getByRole('listitem')).toHaveText([pyro])
  await expect(skills).toHaveValue('')

  // A new one goes in as typed with a comma, Backspace takes it off again, and its own button takes one off too.
  await skills.pressSequentially(`Forklift ${id},`)
  await expect(chosen.getByRole('listitem')).toHaveText([pyro, `Forklift ${id}`])
  await skills.press('Backspace')
  await expect(chosen.getByRole('listitem')).toHaveText([pyro])
  await skills.fill(`Forklift ${id}`)
  await expect(list.getByRole('option', { name: `Add “Forklift ${id}” as a new skill` })).toBeVisible()
  await skills.press('Enter')
  await form.getByRole('button', { name: `Remove ${pyro}` }).click()
  await expect(chosen.getByRole('listitem')).toHaveText([`Forklift ${id}`])
  await expect(skills).toBeFocused()

  // What's still typed when the form goes is kept, not lost.
  await skills.fill('rigger')
  await form.getByRole('button', { name: 'Add person' }).click()
  await expect(form.getByLabel('Name')).toHaveValue('')

  const people = page.getByRole('region', { name: 'People' })
  await people.getByLabel('Find a person').fill(`dara spark ${id}`)
  await people.getByRole('link', { name: new RegExp(`^${name}`) }).click()
  await expect(page.locator('dd').filter({ hasText: 'Forklift' })).toHaveText(`Forklift ${id}, Rigger`)
})
