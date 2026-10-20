import type { Locator } from '@playwright/test'

/** Types a whole name into a person's form, which asks for it in two (ADR 0066): the first word, and the rest as the last name. */
export async function fillName(form: Locator, name: string) {
  const [first = '', ...rest] = name.trim().split(' ')
  await form.getByLabel('First name').fill(first)
  await form.getByLabel('Last name').fill(rest.join(' '))
}
