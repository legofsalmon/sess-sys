import type { Snapshot, Storage } from '@sh/shared'

/**
 * The device's copy, in IndexedDB: one record holding the whole snapshot.
 * Enough for the Phase 0 test; the real app moves to SQLite in the browser
 * once the data outgrows a single record (see docs/architecture.md).
 */
const DB = 'session-hire'
const STORE = 'sync'
const KEY = 'snapshot'

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1)
    req.onupgradeneeded = () => req.result.createObjectStore(STORE)
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

export class IndexedDbStorage implements Storage {
  private db = open()
  private wiped = false

  async load(): Promise<Snapshot | undefined> {
    const db = await this.db
    return new Promise((resolve, reject) => {
      const req = db.transaction(STORE).objectStore(STORE).get(KEY)
      req.onsuccess = () => resolve(req.result as Snapshot | undefined)
      req.onerror = () => reject(req.error)
    })
  }

  async save(snapshot: Snapshot): Promise<void> {
    if (this.wiped) return
    const db = await this.db
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite')
      tx.objectStore(STORE).put(snapshot, KEY)
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
  }

  /** Forget this device's copy and stop saving, ahead of reloading the app signed out. */
  async wipe(): Promise<void> {
    this.wiped = true
    const db = await this.db
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite')
      tx.objectStore(STORE).delete(KEY)
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
  }
}
