import { MemoryStorage, type Snapshot, type Storage } from '@sh/shared'
import { tabRole, tellTabs } from './tabs.ts'

/**
 * The device's copy, in IndexedDB: one record holding the whole snapshot.
 * Enough for the Phase 0 test; the real app moves to SQLite in the browser
 * once the data outgrows a single record (see docs/architecture.md).
 *
 * When IndexedDB is missing or won't open, the copy is kept in memory for
 * the session instead, and a bar at the top says so: the app still works,
 * and changes still go to the server, but nothing is kept after a reload.
 * A save that fails (the phone out of storage) settles with a plain reason
 * rather than hanging every form, and the bar shows it until one works.
 */
const DB = 'session-hire'
const STORE = 'sync'
const KEY = 'snapshot'
/** IndexedDB has been known to never answer at all; past this the copy is kept in memory. */
const OPEN_MS = 15_000

export const OUT_OF_STORAGE = 'This phone is out of storage. Free some space, then try again.'
export const OTHER_TAB = 'The app is open in another tab. Work there, or tap “Use this tab” at the top.'

export type StorageMode = 'indexeddb' | 'memory'
export interface StorageState {
  mode: StorageMode
  /** Why the last save didn't work, until one does. */
  problem: string | undefined
}

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1)
    req.onupgradeneeded = () => req.result.createObjectStore(STORE)
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error ?? new Error("IndexedDB wouldn't open"))
    req.onblocked = () => reject(new Error('IndexedDB is held open by another tab'))
    setTimeout(() => reject(new Error("IndexedDB didn't answer")), OPEN_MS)
  })
}

/** A plain reason for a save that failed. What the browser said is kept on the cause, for the console, not the office. */
function failed(err: unknown): Error {
  if (err instanceof DOMException && err.name === 'QuotaExceededError') return new Error(OUT_OF_STORAGE, { cause: err })
  return new Error("This device couldn't keep the change. Try again.", { cause: err })
}

export class IndexedDbStorage implements Storage {
  private wiped = false

  private constructor(private readonly db: IDBDatabase) {}

  static async open(): Promise<IndexedDbStorage> {
    return new IndexedDbStorage(await open())
  }

  async load(): Promise<Snapshot | undefined> {
    return new Promise((resolve, reject) => {
      const req = this.db.transaction(STORE).objectStore(STORE).get(KEY)
      req.onsuccess = () => resolve(req.result as Snapshot | undefined)
      req.onerror = () => reject(req.error)
    })
  }

  async save(snapshot: Snapshot): Promise<void> {
    if (this.wiped) return
    return this.write((store) => store.put(snapshot, KEY))
  }

  /** Forget this device's copy and stop saving, ahead of reloading the app signed out. */
  async wipe(): Promise<void> {
    this.wiped = true
    return this.write((store) => store.delete(KEY))
  }

  private write(fn: (store: IDBObjectStore) => void): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        const tx = this.db.transaction(STORE, 'readwrite')
        fn(tx.objectStore(STORE))
        tx.oncomplete = () => resolve()
        // A write that fails at commit (no room left) aborts rather than errors.
        // Without this it never settled, and every form after it hung with no message.
        tx.onabort = () => reject(failed(tx.error))
        // A request that fails says why on itself first; the transaction's own
        // error is only set once it aborts after that, so it's read from the request.
        tx.onerror = (e) => reject(failed((e.target as IDBRequest | IDBTransaction | null)?.error ?? tx.error))
      } catch (err) {
        // The connection closed under us, or the record can't be stored.
        reject(failed(err))
      }
    })
  }
}

/**
 * What the app saves to: IndexedDB when it can be, else memory. Reports
 * where it stands to the bar at the top, and refuses to save in a tab that
 * isn't the one doing the writing (tabs.ts), so the change is taken back
 * there rather than written over the other tab's.
 */
export class DeviceStorage implements Storage {
  mode: StorageMode
  problem: string | undefined
  private inner: Storage
  private wiped = false
  private listeners = new Set<(state: StorageState) => void>()

  constructor(db: IndexedDbStorage | undefined) {
    this.mode = db ? 'indexeddb' : 'memory'
    this.inner = db ?? new MemoryStorage()
  }

  state(): StorageState {
    return { mode: this.mode, problem: this.problem }
  }

  subscribe(fn: (state: StorageState) => void): () => void {
    this.listeners.add(fn)
    return () => void this.listeners.delete(fn)
  }

  async load(): Promise<Snapshot | undefined> {
    try {
      return await this.inner.load()
    } catch {
      // The record can't be read: carry on in memory, from the server, rather than show nothing.
      this.inner = new MemoryStorage()
      this.set({ mode: 'memory' })
      return undefined
    }
  }

  async save(snapshot: Snapshot): Promise<void> {
    if (this.wiped) return
    if (tabRole() !== 'writer') throw new Error(OTHER_TAB)
    try {
      await this.inner.save(snapshot)
      if (this.problem) this.set({ problem: undefined })
    } catch (err) {
      this.set({ problem: err instanceof Error ? err.message : String(err) })
      throw err
    }
  }

  /** Forget this device's copy and stop saving, in every tab, ahead of reloading the app signed out. */
  async wipe(): Promise<void> {
    this.forget()
    tellTabs('wipe')
    if (this.inner instanceof IndexedDbStorage) await this.inner.wipe()
  }

  /**
   * Another tab has signed out and wiped the copy. This one saves nothing
   * more, or a handed-back phone would get the company's data back from it.
   */
  forget() {
    this.wiped = true
  }

  private set(change: Partial<StorageState>) {
    Object.assign(this, change)
    const state = this.state()
    for (const fn of this.listeners) fn(state)
  }
}

/** The device's storage, whatever this browser allows: never throws, so the app always starts. */
export async function openStorage(): Promise<DeviceStorage> {
  try {
    if (typeof indexedDB === 'undefined') throw new Error('No IndexedDB')
    return new DeviceStorage(await IndexedDbStorage.open())
  } catch {
    // An old browser, a private window that refuses it, or a store that won't open: memory for this session.
    return new DeviceStorage(undefined)
  }
}
