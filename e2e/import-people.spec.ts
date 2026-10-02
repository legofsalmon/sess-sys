import { expect, test } from '@playwright/test'

/**
 * Bringing in the crew list (ADR 0025) end to end, with sign-in off: from
 * the Account tab, choose a small made-up spreadsheet with one
 * company-domain email, one phone the app can't read and one applicant;
 * fix the phone in place, a key at a time, with the field staying put as
 * the problem clears; bring them in past the question; and see them on the
 * Crew tab with their department and level, the applicant kept out of the
 * Offer to… picker until "Show applicants" is ticked; then bring the same
 * file in again and see 0 added and nothing sent for the two unchanged.
 * The office email and a crew call are set through the sync API with this
 * run's own names, since the test server is shared.
 */

const phoneSize = { width: 390, height: 844 }
const id = Math.random().toString(36).slice(2, 8)
const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Dublin' })
const addDays = (day: string, n: number) => {
  const d = new Date(`${day}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

const HEADER = 'First Name,Last Name,Department,Phone,Email,Preferred,Onboarded,First Aider,Manual Handling Cert,Driving Licence,Day Rate (EUR),Company Name,VAT Number,CRO Number,Events Worked,Notes,Skillsets / Tags'
const csv = [
  HEADER,
  `Nuala,Breen ${id},Production,+353 87 700 0101,nuala.${id}@sessionhire.com,Yes,Yes,Yes,,,,,,,,,Production: Crew chief`,
  `Oisín,Clarke ${id},Audio,ext 4512,oisin.${id}@example.com,No,Yes,,,,,,,,,,"Audio: Monitors; Audio: FOH"`,
  `Ruth,Devane ${id},LX,353877000103,,,,,,,,,,,,"new applicant, CV received, not yet vetted",LX`,
  '',
].join('\r\n')
const file = { name: 'crew.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) }

test.beforeAll(async ({ browser }) => {
  const context = await browser.newContext()
  const mutations: [string, Record<string, unknown>][] = [
    // The office's own domain, which makes Nuala staff.
    ['office.update', { name: 'Session Hire office', phone: null, email: 'office@sessionhire.com' }],
    // A crew call to pick from, so the picker can be checked.
    [
      'call.create',
      {
        id: `call-${id}`,
        project: `Import check ${id}`,
        phase: '',
        venue: '',
        role: 'Stagehand',
        start: addDays(today, 40),
        end: addDays(today, 40),
        callTime: '08:00',
        needed: 1,
        dayRateCents: null,
        details: '',
        replyBy: null,
      },
    ],
  ]
  const res = await context.request.post('/api/sync/push', {
    data: { clientId: `import-${id}`, mutations: mutations.map(([name, args], i) => ({ id: `m-${id}-${i}`, name, args, createdAt: new Date().toISOString() })) },
  })
  const { results } = await res.json()
  expect(results.map((r: { status: string; reason?: { message: string } }) => r.reason?.message ?? r.status)).toEqual(mutations.map(() => 'applied'))
  await context.close()
})

test('brings the crew list in from a file, fixing a phone in place, and shows them on the Crew tab', async ({ browser }) => {
  const office = await (await browser.newContext({ viewport: phoneSize })).newPage()
  await office.goto('/#account')
  const card = office.getByRole('region', { name: 'Bring in a list' })
  await expect(card).toContainText('Sign-in is off, so anyone who can reach the app can read whatever you bring in.')
  await card.getByRole('link', { name: 'Bring in a list' }).click()
  await expect(office).toHaveURL(/#account\/import-people$/)
  await expect(office.getByRole('heading', { name: 'Bring in a list' })).toBeVisible()
  await expect(office.getByRole('navigation', { name: 'Areas' }).getByRole('link', { name: 'Account' })).toHaveAttribute('aria-current', 'page')

  // The file, read on the phone and sent to the server for the preview.
  await office.getByLabel('Crew list file').setInputFiles(file)
  const read = office.getByRole('region', { name: 'What was read' })
  await expect(read).toContainText('3 rows read: 3 new people, 1 with a problem.')
  await expect(read).toContainText('Emails at sessionhire.com come in as staff')
  const rows = office.getByRole('region', { name: 'Rows' })
  const nuala = rows.getByRole('listitem', { name: 'Row 2' })
  await expect(nuala).toContainText(`Nuala Breen ${id}`)
  await expect(nuala).toContainText('Staff · Production · Level 3 · 1 skill')
  await expect(nuala).toContainText(`nuala.${id}@sessionhire.com · +353877000101`)
  const oisin = rows.getByRole('listitem', { name: 'Row 3' })
  await expect(oisin).toContainText('Freelancer · Audio · Level 2 · 2 skills')
  await expect(oisin).toContainText("Couldn't read this phone number.")
  const ruth = rows.getByRole('listitem', { name: 'Row 4' })
  await expect(ruth).toContainText('Freelancer · LX · Level 0 (applicant) · 1 skill')
  await expect(ruth).toContainText('+353877000103')
  // Nothing goes in while a row still has a problem.
  const bring = office.getByRole('button', { name: /^Bring in/ })
  await expect(bring).toHaveText('Bring in 3 people')
  await expect(bring).toBeDisabled()
  expect(await office.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)

  // The phone fixed in place, a key at a time: the problem clears as it's typed, the row is read again by the
  // same rules, and the field stays put for the rest of the number rather than vanishing as the problem goes.
  const phone = oisin.getByLabel('Phone for row 3')
  await phone.fill('0')
  await phone.pressSequentially('877000102')
  await expect(phone).toHaveValue('0877000102')
  await expect(oisin).not.toContainText("Couldn't read this phone number.")
  await expect(read).toContainText('3 rows read: 3 new people.')
  // Cleared to start again, the field is still there too.
  await phone.fill('')
  await expect(phone).toBeVisible()
  await expect(oisin.getByLabel('Email for row 3')).toHaveValue(`oisin.${id}@example.com`)
  await phone.fill('087 700 0102')
  await expect(bring).toBeEnabled()
  // A question first, since there's no undo for the lot.
  await bring.click()
  await expect(office.getByText('3 new people added. Each can be edited afterwards')).toBeVisible()
  await office.getByRole('button', { name: 'Bring them in' }).click()
  await expect(office.getByRole('heading', { name: 'Brought in' })).toBeVisible()
  await expect(office.getByRole('status').filter({ hasText: 'Added' })).toHaveText('Added 3, updated 0, skipped 0.')

  // On the Crew tab, with their department and level.
  await office.getByRole('link', { name: 'Crew tab' }).click()
  await expect(office).toHaveURL(/#crew$/)
  await expect(office.locator('.top').getByRole('status')).toHaveText('Up to date')
  await expect(office.getByRole('button', { name: `Nuala Breen ${id}` })).toContainText('Staff · Production · Level 3 · Production: Crew chief')
  await expect(office.getByRole('button', { name: `Oisín Clarke ${id}` })).toContainText('Audio · Level 2 · Audio: Monitors, Audio: FOH')
  await expect(office.getByRole('button', { name: `Ruth Devane ${id}` })).toContainText('LX · Level 0')
  // Oisín's card holds the phone as it was fixed.
  await office.getByRole('button', { name: `Oisín Clarke ${id}` }).click()
  await expect(office.getByText(`+353877000102 · oisin.${id}@example.com`)).toBeVisible()

  // The applicant is out of the Offer to… picker until asked for.
  const call = office.locator('.call-group', { hasText: `Import check ${id}` }).getByRole('article', { name: 'Stagehand' })
  await call.getByRole('button', { name: 'Offer…' }).click()
  const picker = call.getByLabel('Offer to')
  await expect(picker.locator('option', { hasText: `Nuala Breen ${id}` })).toHaveText(`Nuala Breen ${id} · Production · Level 3 (Production: Crew chief)`)
  await expect(picker.locator('option', { hasText: `Ruth Devane ${id}` })).toHaveCount(0)
  await call.getByLabel(/^Show applicants/).check()
  await expect(picker.locator('option', { hasText: `Ruth Devane ${id}` })).toHaveText(`Ruth Devane ${id} · LX · Level 0 (LX)`)

  // The same file again: everyone matches, so nobody is added.
  await office.goto('/#account/import-people')
  await office.getByLabel('Crew list file').setInputFiles(file)
  await expect(read).toContainText('3 rows read: 0 new people, 3 updates, 1 with a problem.')
  await expect(rows.getByRole('listitem', { name: 'Row 2' })).toContainText(`Updates Nuala Breen ${id} (matched by email)`)
  await expect(rows.getByRole('listitem', { name: 'Row 4' })).toContainText(`Updates Ruth Devane ${id} (matched by phone)`)
  // Oisín's phone is still unreadable in the file; skipping the row is the other way past a problem.
  await rows.getByRole('listitem', { name: 'Row 3' }).getByLabel('Skip row 3').check()
  await expect(bring).toHaveText('Bring in 2 people')
  await bring.click()
  await office.getByRole('button', { name: 'Bring them in' }).click()
  // Nothing about the two has changed, so nothing was sent for them.
  await expect(office.getByRole('status').filter({ hasText: 'Added' })).toHaveText('Added 0, updated 0, skipped 1. 2 were already up to date.')
})
