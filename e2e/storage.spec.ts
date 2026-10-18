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
