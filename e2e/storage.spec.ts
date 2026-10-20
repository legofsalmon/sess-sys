import { expect, test, type Page } from '@playwright/test'

/**
 * The device's copy is kept a table at a time (web/src/storage.ts, audit
 * finding 11). A phone updated from a build that kept it as one record
 * opens that copy as it was, changes waiting and all, and writes it out
 * table by table the next time it saves.
 */

/** The keys IndexedDB holds for the app's copy. */
const keys = (page: Page) =>
  page.evaluate(
    () =>
      new Promise<string[]>((resolve) => {
        const req = indexedDB.open('session-hire', 1)
        req.onsuccess = () => {
          const all = req.result.transaction('sync').objectStore('sync').getAllKeys()
          all.onsuccess = () => {
            req.result.close()
            resolve((all.result as string[]).sort())
          }
        }
      })
  )

test('a copy kept the old way, as one record, opens with its change waiting, and is kept table by table after', async ({ page }) => {
  await page.goto('/#stock/places')
  await expect(page.locator('.conn')).toHaveText('Up to date')
  await expect.poll(() => keys(page)).toContain('copy')
  expect(await keys(page)).toContain('table:place')

  // As an older build left it: one record holding everything, with a place added while there was no signal.
  const bay = `Bay ${Math.random().toString(36).slice(2, 8)}`
  await page.evaluate(
    (bay) =>
      new Promise<void>((resolve) => {
        const req = indexedDB.open('session-hire', 1)
        req.onsuccess = () => {
          const tx = req.result.transaction('sync', 'readwrite')
          const store = tx.objectStore('sync')
          const rest = store.get('copy')
          const names = store.getAllKeys(IDBKeyRange.bound('table:', 'table:￿'))
          const tables = store.getAll(IDBKeyRange.bound('table:', 'table:￿'))
          tables.onsuccess = () => {
            const entities = Object.fromEntries((names.result as string[]).map((k, i) => [k.slice('table:'.length), tables.result[i]]))
            const outbox = [...rest.result.outbox, { id: `old${bay}`, name: 'place.upsert', args: { id: `old${bay}`, name: bay, notes: '' }, createdAt: new Date().toISOString() }]
            store.clear()
            store.put({ ...rest.result, outbox, entities }, 'snapshot')
          }
          tx.oncomplete = () => {
            req.result.close()
            resolve()
          }
        }
      }),
    bay
  )
  expect(await keys(page)).toEqual(['snapshot'])

  await page.reload()
  await expect(page.getByText(bay)).toBeVisible()
  await expect(page.locator('.conn')).toHaveText('Up to date')
  await expect.poll(() => keys(page)).not.toContain('snapshot')
  const now = await keys(page)
  expect(now).toContain('copy')
  expect(now).toContain('table:place')

  // And it opens again from the tables.
  await page.reload()
  await expect(page.getByText(bay)).toBeVisible()
})

test('asks the browser to keep the copy once in, and says on You whether it does (audit finding 16)', async ({ page }) => {
  // Proves: the app asks to keep its storage without being told to, says plainly on You when the browser won't promise,
  // and asking again from there, when the browser agrees, says it's kept.
  await page.addInitScript(() => {
    const w = window as unknown as { persistAsked: number; persistAnswer: boolean }
    w.persistAsked = 0
    w.persistAnswer = false
    let kept = false
    Object.defineProperty(navigator.storage, 'persisted', { value: async () => kept })
    Object.defineProperty(navigator.storage, 'persist', {
      value: async () => {
        w.persistAsked++
        kept = w.persistAnswer
        return kept
      },
    })
  })
  await page.goto('/#me')
  await expect(page.locator('.conn')).toHaveText('Up to date')
  await expect.poll(() => page.evaluate(() => (window as unknown as { persistAsked: number }).persistAsked)).toBe(1)
  const card = page.locator('.card', { has: page.getByRole('heading', { name: 'This device' }) })
  await expect(card).toContainText("This browser may clear the app's copy of the data to make room")
  await page.evaluate(() => ((window as unknown as { persistAnswer: boolean }).persistAnswer = true))
  await card.getByRole('button', { name: 'Ask it to keep the copy' }).click()
  await expect(card).toContainText("This browser keeps the app's copy of the data, and changes waiting to sync, until you sign out.")
  await expect(card.getByRole('button', { name: 'Ask it to keep the copy' })).toHaveCount(0)
})
