import { expect, test } from '@playwright/test'
import { fillName } from './names.ts'

/**
 * Skills as picks (ADR 0063): the Skills field offers what the crew list
 * already calls people, the most used first and in the spelling most have,
 * and takes a new one as typed. Chosen ones sit in the field as chips that
 * come off with their own button or Backspace, and each one added or taken
 * off is said in the field's live line. The test server is shared
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
  await fillName(form, name)

  // Typing part of it offers the one in use, once, in the spelling most people have, highlighted as the one Enter takes
  // before the new one; Down moves to the new one and Up back.
  const skills = form.getByRole('combobox', { name: 'Skills' })
  const part = `pyro${id.slice(0, 3)}`
  await skills.fill(part)
  const list = form.getByRole('listbox', { name: 'In use' })
  const inUse = list.getByRole('option', { name: pyro, exact: true })
  await expect(inUse).toHaveCount(1)
  await expect(inUse).toHaveAttribute('aria-selected', 'true')
  await skills.press('ArrowDown')
  await expect(list.getByRole('option', { name: `Add “${part}” as a new skill` })).toHaveAttribute('aria-selected', 'true')
  await skills.press('ArrowUp')
  await skills.press('Enter')
  const chosen = form.getByRole('list', { name: 'Chosen' })
  await expect(chosen.getByRole('listitem')).toHaveText([pyro])
  await expect(skills).toHaveValue('')
  const said = form.locator('[aria-live="polite"]')
  await expect(said).toHaveText(`Added ${pyro}. 1 skill.`)

  // A comma after part of one takes the highlighted offer too, and Backspace takes it off again, said aloud.
  await skills.pressSequentially('rigg,')
  await expect(chosen.getByRole('listitem')).toHaveText([pyro, 'Rigger'])
  await skills.press('Backspace')
  await expect(chosen.getByRole('listitem')).toHaveText([pyro])
  await expect(said).toHaveText('Removed Rigger. 1 skill.')

  // Backspace held down to clear what's typed stops at the empty field rather than running on into the chips.
  await skills.fill('ab')
  await page.keyboard.down('Backspace')
  await page.keyboard.down('Backspace')
  await page.keyboard.down('Backspace')
  await page.keyboard.up('Backspace')
  await expect(skills).toHaveValue('')
  await expect(chosen.getByRole('listitem')).toHaveText([pyro])

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
  await expect(form.getByLabel('First name')).toHaveValue('')

  const people = page.getByRole('region', { name: 'People' })
  await people.getByLabel('Find a person').fill(`dara spark ${id}`)
  await people.getByRole('link', { name: new RegExp(`^${name}`) }).click()
  await expect(page.locator('dd').filter({ hasText: 'Forklift' })).toHaveText(`Forklift ${id}, Rigger`)
})
