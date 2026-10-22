import { expect, test, type APIRequestContext } from '@playwright/test'

/**
 * A job's steps (ADR 0073), as the office and a member of staff meet them:
 * the job page shows the way the job goes from the quote to the kit put
 * away, with the step it's at; the office gives a step to someone, and it's
 * on their list on Home; they tick their own. The test server is shared, so
 * names carry this run's own tag. SHOTS=1 refreshes the blueprint's pictures.
 */

const shot = (name: string) => (process.env.SHOTS ? { path: `docs/hub/img/${name}.png` } : undefined)
const phoneSize = { width: 390, height: 844 }
const deskSize = { width: 1280, height: 900 }

async function push(request: APIRequestContext, id: string, mutations: [string, Record<string, unknown>][]) {
  const res = await request.post('/api/sync/push', {
    data: { clientId: `steps-${id}`, mutations: mutations.map(([name, args], i) => ({ id: `steps-${id}-${i}`, name, args, createdAt: new Date().toISOString() })) },
  })
  const { results } = (await res.json()) as { results: { status: string; reason?: { message: string } }[] }
  expect(results.map((r) => r.reason?.message ?? r.status)).toEqual(mutations.map(() => 'applied'))
}

test("a job's steps, given out on its page and ticked from the list on Home", async ({ browser, request }) => {
  const id = Date.now().toString(36)
  const job = `Harbour Lights ${id}`
  const roisin = `Róisín Steps${id}`
  await push(request, id, [
    ['person.upsert', { id: `r-${id}`, name: roisin, kind: 'staff', email: null, phone: null, skills: [], dayRateCents: null, notes: '' }],
    ['project.create', { id: `j-${id}`, name: job, clientId: null, venueId: null, status: 'confirmed', notes: '' }],
    ['phase.add', { id: `p-${id}`, projectId: `j-${id}`, name: 'Show', start: '2030-06-14', end: '2030-06-15', venueId: null, notes: '' }],
    [
      'call.create',
      { id: `c-${id}`, projectId: `j-${id}`, phaseId: `p-${id}`, project: job, phase: 'Show', venue: '', role: 'Audio tech', start: '2030-06-14', end: '2030-06-15', callTime: '08:00', needed: 2, dayRateCents: null, details: '', replyBy: null },
    ],
  ])

  const page = await (await browser.newContext({ viewport: phoneSize })).newPage()
  // With sign-in off, the device takes the person's word for who they are, as Leave does.
  await page.goto('/#crew/leave')
  await expect(page.getByRole('status')).toHaveText('Up to date')
  await page.getByLabel('Your name').selectOption({ label: roisin })
  await page.getByRole('button', { name: "That's me" }).click()

  await page.goto(`/#jobs/j-${id}`)
  const steps = page.getByRole('region', { name: 'Steps' })
  // Confirmed, so the quote and the yes are done; it's at the crew, which the app ticks once every call is booked.
  await expect(steps.getByText('2 of 8 done · at Crew booked')).toBeVisible()
  await expect(steps.locator('li[aria-current="step"] button')).toHaveAccessibleName('3. Crew booked, the step the job is at')
  await expect(steps.getByRole('heading', { name: '3. Crew booked' })).toBeVisible()
  await expect(steps.getByText('0 of 2 booked. This is the step the job is at.')).toBeVisible()
  // The app ticks this one itself once every call is booked; until then it can be ticked by hand, and given to someone.
  await expect(steps.getByRole('button', { name: 'Mark crew booked done' })).toBeVisible()
  await steps.getByLabel('Down to').selectOption({ label: `${roisin} (you)` })
  await expect(steps.getByText('2 of 8 done · at Crew booked, Róisín')).toBeVisible()

  // The last step, given to herself and ticked by hand.
  await steps.getByRole('button', { name: /^8\. Deprepped, to do/ }).click()
  await expect(steps.getByRole('heading', { name: '8. Deprepped' })).toBeVisible()
  await steps.getByRole('button', { name: 'Give it to me' }).click()
  await steps.getByRole('button', { name: 'Mark deprepped done' }).click()
  await expect(steps.getByText(new RegExp(`^Ticked done by ${roisin}, `))).toBeVisible()
  await expect(steps.getByRole('button', { name: /^8\. Deprepped, done, / })).toBeVisible()
  await expect(page.locator('.conn')).toHaveText('Up to date')
  await page.screenshot(shot('job-steps-phone'))

  // On Home, the step she's to do now is on top, whichever view; the ticked one isn't.
  await page.goto('/#home')
  const mine = page.getByRole('region', { name: /^Your steps/ })
  await expect(mine.getByRole('link', { name: new RegExp(`^Crew booked ${job}`) })).toBeVisible()
  await expect(mine.getByText('Deprepped')).toHaveCount(0)
  await mine.getByRole('link', { name: new RegExp(`^Crew booked ${job}`) }).click()
  await expect(page.getByRole('heading', { name: job })).toBeVisible()

  if (process.env.SHOTS) {
    const desk = await (await browser.newContext({ viewport: deskSize })).newPage()
    await desk.goto(`/#jobs/j-${id}`)
    await expect(desk.getByRole('status')).toHaveText('Up to date')
    await desk.getByRole('region', { name: 'Steps' }).screenshot(shot('job-steps'))
  }
})
