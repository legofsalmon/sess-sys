import { expect, test, type Page } from '@playwright/test'

/**
 * Counting a place end to end (ADR 0030), at phone size: Bay Q has three
 * speakers and 20 cables on the record. The count starts from the week's
 * list on the Stock tab, finds two speakers and one kept at another bay,
 * survives a reload part way through, and finishes with no signal, with
 * 17 cables counted. Its page says one speaker not found, one in the wrong
 * place and the cables three short, and each is put right with a tap:
 * reported missing, moved here, set to 17. The week's list moves on, the
 * place says when it was last counted, and the item's log says what the
 * count said of it. A case is found by what's in it and counted on its
 * own; an older count never undoes a newer one; and two tabs share the one
 * count. The test server is shared with the other browser tests, so names
 * are this run's own and numbers are read off the screen.
 */

const phoneSize = { width: 390, height: 844 }
const tag = () => Math.random().toString(36).slice(2, 8)
const part = (page: Page, heading: string) => page.locator('form').filter({ has: page.getByRole('heading', { name: heading, exact: true }) })

/** The question a place nobody has used yet brings up (audit finding 19), answered yes when it's asked. */
async function makePlace(page: Page) {
  const yes = page.getByRole('button', { name: 'Make the place' })
  if (await yes.isVisible()) await yes.click()
}

async function newProduct(page: Page, name: string, counted?: { qty: number; at: string } | 'case') {
  await page.goto('/#stock')
  await page.getByRole('button', { name: 'Add product' }).click()
  const form = page.locator('form').filter({ has: page.getByRole('button', { name: 'Add product' }) })
  await form.getByLabel('Name').fill(name)
  if (counted === 'case') await form.getByRole('checkbox', { name: /^Holds other kit/ }).check()
  else if (counted) await form.getByRole('radio', { name: /^Counted/ }).check()
  await form.getByRole('button', { name: 'Add product' }).click()
  await expect(page.getByRole('heading', { level: 1, name })).toBeVisible()
  if (!counted || counted === 'case') return
  const add = part(page, 'Add a count')
  await add.getByLabel('Counted at').fill(counted.at)
  await add.getByLabel('How many').fill(String(counted.qty))
  await add.getByRole('button', { name: 'Save count' }).click()
  await makePlace(page)
  await expect(page.locator('.count', { hasText: counted.at })).toContainText(String(counted.qty))
}

/** Items of the product whose page is open, kept at `where`, with the numbers the server gives them. */
async function newItems(page: Page, where: string, count: number) {
  const add = part(page, 'Add an item')
  const numbers: string[] = []
  // The line from the last item added, here or before, until the next replaces it.
  let previous = (await add.locator('.added').count()) ? await add.locator('.added').textContent() : null
  for (let i = 0; i < count; i++) {
    await add.getByLabel("Where it's kept").fill(where)
    await add.getByRole('button', { name: 'Add item' }).click()
    await makePlace(page)
    if (previous) await expect(add.locator('.added')).not.toHaveText(previous)
    await expect(add.locator('.added')).toHaveText(/^Added SH-\d{6}\.$/)
    previous = await add.locator('.added').textContent()
    numbers.push(previous!.slice(6, -1))
  }
  await expect(page.locator('.conn')).toHaveText('Up to date')
  return numbers
}

/** An item's page, found by its number as a scanner would type it. */
async function openItem(page: Page, number: string) {
  await page.goto('/#stock')
  await page.getByRole('searchbox', { name: 'Find' }).fill(number)
  await page.getByRole('searchbox', { name: 'Find' }).press('Enter')
  await expect(page.getByRole('heading', { level: 1, name: number })).toBeVisible()
}

/** A place's page, from the Stock tab's list of places. */
async function openPlace(page: Page, name: string) {
  await page.goto('/#stock')
  const all = page.getByRole('button', { name: /^Show all \d+ places$/ })
  if (await all.isVisible()) await all.click()
  await page.locator('.job-row', { hasText: name }).click()
  await expect(page.getByRole('heading', { level: 1, name })).toBeVisible()
}

/** A number typed into the count, as a scanner types it. */
async function typeIn(page: Page, number: string) {
  await page.getByLabel('Number or serial').fill(number)
  await page.getByLabel('Number or serial').press('Enter')
}

/** "28 of 40 places counted in the last 13 weeks", as a number. */
async function countedThisQuarter(page: Page) {
  const line = await page.getByRole('region', { name: 'Counts' }).locator('.hint').first().textContent()
  return Number(/^([\d,]+) of/.exec(line ?? '')![1]!.replace(/,/g, ''))
}

test('a place counted with no signal, its differences put right, and the week moving on', async ({ browser }) => {
  const id = tag()
  const speaker = `d&b Y10P ${id}`
  const cable = `XLR 10 m ${id}`
  const bay = `Bay Q ${id}`
  const other = `Bay R ${id}`
  const context = await browser.newContext({ viewport: phoneSize })
  const page = await context.newPage()
  await page.goto('/#stock')
  await expect(page.locator('.conn')).toHaveText('Up to date')

  await newProduct(page, speaker)
  const speakers = await newItems(page, bay, 3)
  const [stray] = await newItems(page, other, 1)
  await newProduct(page, cable, { qty: 20, at: bay })
  await expect(page.locator('.conn')).toHaveText('Up to date')

  // The Stock tab's Counts card lists the bay, never counted, for this week.
  await page.goto('/#stock')
  const card = page.getByRole('region', { name: 'Counts' })
  const before = await countedThisQuarter(page)
  const showAll = card.getByRole('button', { name: /^Show all \d+ places to count$/ })
  if (await showAll.isVisible()) await showAll.click()
  const row = card.locator('.count-due', { hasText: bay })
  await expect(row).toContainText('Never counted')
  await row.getByRole('button', { name: 'Count' }).click()

  // Counting: two speakers found, and the one kept at the other bay found here.
  await expect(page.getByRole('heading', { level: 1, name: `Counting ${bay}` })).toBeVisible()
  const tally = page.locator('.count-tally')
  await expect(tally).toHaveText('0 of 3 found')
  const said = page.getByRole('status', { name: 'Last scan' })
  await typeIn(page, speakers[0]!)
  await expect(said).toHaveText(`${speakers[0]} ${speaker}: found. 1 of 3 found.`)
  await typeIn(page, stray!)
  await expect(said).toHaveText(`${stray} ${speaker}: kept at ${other}. Move it here once you finish, or leave it.`)
  await typeIn(page, speakers[0]!)
  await expect(said).toHaveText(`${speakers[0]} ${speaker} is counted already.`)

  // A reload part way through loses nothing.
  await page.reload()
  await expect(page.getByRole('heading', { level: 1, name: `Counting ${bay}` })).toBeVisible()
  await expect(tally).toHaveText('1 of 3 found')
  await expect(page.locator('.said-list')).toContainText(`${stray} ${speaker} Found here, kept at ${other}.`)

  // The rest with no signal: the second speaker, and 17 cables, typed without the record shown beside them.
  await context.setOffline(true)
  await typeIn(page, speakers[1]!)
  await expect(tally).toHaveText('2 of 3 found')
  const kit = page.getByRole('region', { name: 'Counted kit' })
  await expect(kit).not.toContainText('20')
  await kit.getByLabel(cable).fill('17')
  await page.getByRole('button', { name: 'Finish the count' }).click()

  // Its page: what it found, each with its fix.
  await expect(page.getByRole('heading', { level: 1, name: `Count of ${bay}` })).toBeVisible()
  await expect(page.locator('.facts')).toContainText('2 of 3 found, 1 not found, 1 in the wrong place, 1 count short')
  const notFound = page.getByRole('region', { name: 'Not found' })
  const wrongPlace = page.getByRole('region', { name: 'In the wrong place' })
  const counted = page.getByRole('region', { name: 'Counted kit' })
  await expect(notFound.locator('.count-line')).toHaveText(`${speakers[2]} ${speaker}Not scanned.Report missing`)
  await expect(wrongPlace.locator('.count-line')).toHaveText(`${stray} ${speaker}Was kept at ${other}.Move here`)
  await expect(counted.locator('.count-line')).toHaveText(`${cable}17 counted, 20 recorded: 3 short.Set to 17`)
  await expect(page.locator('.conn')).toContainText('No signal')

  // Back in signal, each put right with a tap.
  await context.setOffline(false)
  await expect(page.locator('.conn')).toHaveText('Up to date')
  await notFound.getByRole('button', { name: 'Report missing' }).click()
  await expect(notFound.locator('.count-line p')).toHaveText('Reported missing.')
  await wrongPlace.getByRole('button', { name: 'Move here' }).click()
  await expect(wrongPlace.locator('.count-line p')).toHaveText('Moved here.')
  await counted.getByRole('button', { name: 'Set to 17' }).click()
  await expect(counted.locator('.count-line .done')).toHaveText('Set to 17')
  await expect(page.locator('.conn')).toHaveText('Up to date')

  // The week's list moves on: the bay is counted this week, and the quarter's count is one up.
  await page.goto('/#stock')
  await expect(card.locator('.count-due', { hasText: bay })).toHaveCount(0)
  await expect(card.getByRole('link', { name: new RegExp(bay) })).toContainText('2 of 3 found, 1 not found, 1 in the wrong place, 1 count short')
  expect(await countedThisQuarter(page)).toBe(before + 1)

  // The bay says when it was last counted, and has the stray speaker and 17 cables now.
  await card.getByRole('link', { name: new RegExp(bay) }).click()
  await expect(page.getByRole('heading', { level: 1, name: `Count of ${bay}` })).toBeVisible()
  await page.getByRole('link', { name: `‹ ${bay}` }).click()
  const counts = page.getByRole('region', { name: 'Counts' })
  await expect(counts.locator('.last-counted')).toHaveText(/^Last counted \w{3} \d{1,2} \w{3,4} \d{4}: 2 of 3 found, 1 not found, 1 in the wrong place, 1 count short\.$/)
  await expect(page.getByRole('region', { name: 'Here' })).toContainText(stray!)
  await expect(page.locator('.count', { hasText: cable })).toContainText('17')

  // The speaker not found: its log says so, and that it was reported missing.
  await page.goto('/#stock')
  await page.getByRole('searchbox', { name: 'Find' }).fill(speakers[2]!)
  await page.getByRole('searchbox', { name: 'Find' }).press('Enter')
  const log = page.getByRole('region', { name: 'Log' })
  await expect(log).toContainText(`Not found in the count at ${bay}`)
  await expect(log).toContainText(`Reported missing: Not found in the count of ${bay}.`)
  await context.close()
})

test('a case is found by what is in it, an item in it is marked found where it is, and the case is counted on its own', async ({ browser }) => {
  // Proves: counting a bay, an amp scanned in the rack kept there finds the rack too, label or not; an amp in it
  // reported missing is marked found and stays in its case, never moved out of it. Counting what's in the rack, its
  // own label read as it's opened is the case being counted, not something in the wrong place; and a maker's QR code
  // read by mistake is kept cut short, the count still finishes, and neither page scrolls sideways at phone size.
  const id = tag()
  const rack = `Amp rack ${id}`
  const amp = `d&b D20 ${id}`
  const bay = `Bay S ${id}`
  const context = await browser.newContext({ viewport: phoneSize })
  const page = await context.newPage()
  await page.goto('/#stock')
  await expect(page.locator('.conn')).toHaveText('Up to date')
  await newProduct(page, rack, 'case')
  const [rackNumber] = await newItems(page, bay, 1)
  await newProduct(page, amp)
  const amps = await newItems(page, rackNumber!, 2)

  // The second amp reported missing.
  await openItem(page, amps[1]!)
  await page.getByRole('button', { name: 'Report missing' }).click()
  await page.getByRole('form', { name: `Report ${amps[1]} missing` }).getByRole('button', { name: 'Report missing' }).click()
  await expect(page.locator('.conn')).toHaveText('Up to date')

  // The bay's count: the rack is all that's kept there directly, and scanning an amp in it finds it.
  await openPlace(page, bay)
  await page.getByRole('button', { name: 'Count this place' }).click()
  const tally = page.locator('.count-tally')
  const said = page.getByRole('status', { name: 'Last scan' })
  await expect(tally).toHaveText('0 of 1 found')
  await typeIn(page, amps[0]!)
  await expect(said).toHaveText(`${amps[0]} ${amp}: kept in ${rackNumber} (${rack}), which is kept here. 1 of 1 found.`)
  await expect(tally).toHaveText('1 of 1 found')
  await typeIn(page, amps[1]!)
  await expect(said).toHaveText(`${amps[1]} ${amp}: reported missing. Mark it found once you finish.`)
  await page.getByRole('button', { name: 'Finish the count' }).click()

  await expect(page.locator('.facts')).toContainText('All 1 found, 1 not expected')
  await expect(page.getByRole('region', { name: 'Not found' })).toHaveCount(0)
  const notExpected = page.getByRole('region', { name: 'Not expected' })
  await expect(notExpected.locator('.count-line')).toHaveText(`${amps[1]} ${amp}Reported missing, but it's here.Mark found`)
  await notExpected.getByRole('button', { name: 'Mark found' }).click()
  await expect(notExpected.locator('.count-line p')).toHaveText('Marked found.')
  await expect(page.locator('.conn')).toHaveText('Up to date')
  await openItem(page, amps[1]!)
  await expect(page.locator('.facts')).toContainText(`WhereIn ${rackNumber} (${rack}), ${bay}`)

  // What's in the rack, counted as it's opened: its own label first.
  await openItem(page, rackNumber!)
  await page.getByRole('button', { name: "Count what's in it" }).click()
  await expect(page.getByRole('heading', { level: 1, name: `Counting ${rackNumber} (${rack})` })).toBeVisible()
  await typeIn(page, rackNumber!)
  await expect(said).toHaveText(`${rackNumber} ${rack} is the case being counted.`)
  await expect(page.getByRole('heading', { name: /^Not as recorded/ })).toHaveCount(0)
  for (const n of amps) await typeIn(page, n)
  await expect(tally).toHaveText('2 of 2 found')
  // A maker's QR code on the rack, a long web address: noted cut short, and it never widens the page on a phone.
  const qr = `https://www.example.com/products/racks/${'d20-amp-rack-'.repeat(8)}`
  await typeIn(page, qr)
  await expect(said).toHaveText(`No item has ${qr.slice(0, 99)}…. It's noted on the count; put the label on its item from the Stock search afterwards.`)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.getByRole('button', { name: 'Finish the count' }).click()
  await expect(page.locator('.facts')).toContainText('All 2 found, 1 not expected')
  await expect(page.getByRole('region', { name: 'In the wrong place' })).toHaveCount(0)
  await expect(page.getByRole('region', { name: 'Not expected' }).locator('.count-line b')).toHaveText(`${qr.slice(0, 99)}…`)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await context.close()
})

test("an older count's fixes never undo what was changed since", async ({ browser }) => {
  // Proves: once a newer count has set the cables and moved the speaker here, and the speaker has gone on to another
  // bay, the older count's page says each has changed since and offers neither fix, so a tap can't undo them.
  const id = tag()
  const speaker = `d&b Y10P ${id}`
  const cable = `XLR 10 m ${id}`
  const bay = `Bay U ${id}`
  const other = `Bay V ${id}`
  const third = `Bay W ${id}`
  const context = await browser.newContext({ viewport: phoneSize })
  const page = await context.newPage()
  await page.goto('/#stock')
  await expect(page.locator('.conn')).toHaveText('Up to date')
  await newProduct(page, speaker)
  const [stray] = await newItems(page, other, 1)
  await newProduct(page, cable, { qty: 20, at: bay })

  // Two counts of the bay, each finding the speaker and short of cables; the newer one put right.
  const countBay = async (cables: number) => {
    await openPlace(page, bay)
    await page.getByRole('button', { name: 'Count this place' }).click()
    await typeIn(page, stray!)
    await page.getByRole('region', { name: 'Counted kit' }).getByLabel(cable).fill(String(cables))
    await page.getByRole('button', { name: 'Finish the count' }).click()
    await expect(page.getByRole('heading', { level: 1, name: `Count of ${bay}` })).toBeVisible()
    return page.url()
  }
  const older = await countBay(17)
  await countBay(16)
  await page.getByRole('region', { name: 'In the wrong place' }).getByRole('button', { name: 'Move here' }).click()
  await page.getByRole('region', { name: 'Counted kit' }).getByRole('button', { name: 'Set to 16' }).click()
  await expect(page.locator('.conn')).toHaveText('Up to date')

  // The speaker goes on to a third bay.
  await openItem(page, stray!)
  await page.getByRole('button', { name: 'Move', exact: true }).click()
  await page.getByLabel('Where to').fill(third)
  await page.getByRole('button', { name: `Move ${stray}` }).click()
  await makePlace(page)
  await expect(page.locator('.facts')).toContainText(`Where${third}`)

  await page.goto(older)
  await expect(page.getByRole('region', { name: 'In the wrong place' }).locator('.count-line')).toHaveText(`${stray} ${speaker}Now kept at ${third}.`)
  await expect(page.getByRole('region', { name: 'Counted kit' }).locator('.count-line')).toHaveText(
    `${cable}17 counted, 20 recorded: 3 short. The record has changed since: 16 now.`
  )
  await context.close()
})

test('two tabs of the app on one phone count the same count', async ({ browser }) => {
  // Proves: a scan in one tab shows in the other at once, and a scan there doesn't write over it; once one tab
  // finishes, the other has no count under way.
  const id = tag()
  const speaker = `d&b Y10P ${id}`
  const bay = `Bay X ${id}`
  const context = await browser.newContext({ viewport: phoneSize })
  const one = await context.newPage()
  await one.goto('/#stock')
  await expect(one.locator('.conn')).toHaveText('Up to date')
  await newProduct(one, speaker)
  const speakers = await newItems(one, bay, 2)
  await openPlace(one, bay)
  await one.getByRole('button', { name: 'Count this place' }).click()
  await expect(one.locator('.count-tally')).toHaveText('0 of 2 found')

  const two = await context.newPage()
  await two.goto('/#stock/count')
  await expect(two.locator('.count-tally')).toHaveText('0 of 2 found')
  await typeIn(one, speakers[0]!)
  await expect(two.locator('.count-tally')).toHaveText('1 of 2 found')
  await typeIn(two, speakers[1]!)
  await expect(one.locator('.count-tally')).toHaveText('2 of 2 found')
  await one.getByRole('button', { name: 'Finish the count' }).click()
  await expect(one.locator('.facts')).toContainText('All 2 found, as recorded')
  await expect(two.locator('.empty')).toHaveText("No count is under way on this phone. Start one from a place's page, a case's page, or the Counts card on the Stock tab.")
  await context.close()
})
