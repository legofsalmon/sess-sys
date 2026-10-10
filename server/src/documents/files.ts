import { irishToday, newId, type DocumentStorage } from '@sh/shared'
import { decryptBackup, encryptBackup, isEncrypted } from '../backup/crypto.ts'
import type { BackupStore } from '../backup/store.ts'
import type { Db } from '../db.ts'
import { queueFile } from './store.ts'

/**
 * Documents' files (ADR 0029), in the backups' storage under a prefix of
 * their own, encrypted with BACKUP_KEY when it's set, in the backups' own
 * format. Read only through the server. Every file written is on the list
 * of files to delete until a document takes it, and goes back on it when
 * the document no longer has it; the list is worked through after each
 * change and once a day, so a file is never left behind without the list
 * saying so.
 */

/** The app's own prefix in the bucket: nothing else should be put there. */
export const PREFIX = 'documents/'

const HOUR = 60 * 60 * 1000

/** Said when a document's file isn't in the storage, as after a restore from a backup, which holds details but not files. */
export const FILE_GONE =
  "This document's file isn't in the storage any more. It may have gone since the backup this copy of the data was put back from, which holds documents' details but not their files: ask for it again."

/** The storage doesn't have the file. */
export class FileGone extends Error {}
/** The storage wouldn't take the file, said in words. */
export class NotKept extends Error {}
/** The file is there but can't be opened, said in words. */
export class FileLocked extends Error {}

interface Log {
  info(obj: object, msg: string): void
  warn(obj: object, msg: string): void
}

/** A file the storage says it doesn't have: a folder's missing file, or a bucket's 404. */
const missing = (err: unknown) => (err as NodeJS.ErrnoException)?.code === 'ENOENT' || /answered 404\b/.test(err instanceof Error ? err.message : '')

export class DocumentFiles {
  private timer: NodeJS.Timeout | undefined
  private doneFor: string | undefined
  private tidying: Promise<void> | undefined
  private again = false

  constructor(
    private readonly db: Db,
    readonly store: BackupStore | undefined,
    private readonly options: { key?: Buffer; log?: Log; report?: (err: unknown) => void } = {}
  ) {}

  /** Whether files can be kept at all: a bucket or a folder is set up. */
  get on(): boolean {
    return !!this.store
  }

  status(): DocumentStorage {
    return { files: this.on, encrypted: this.on && !!this.options.key }
  }

  /**
   * Write a file to the storage under a fresh name, and answer where. It's
   * on the list of files to delete before it's written, for an hour, so a
   * change that never takes it (a refusal, a crash) leaves nothing behind.
   */
  async keep(data: Buffer): Promise<string> {
    const store = this.need()
    const key = `${PREFIX}${newId()}`
    await queueFile(this.db, key, false)
    try {
      await store.put(key, this.options.key ? encryptBackup(data, this.options.key) : data)
    } catch (err) {
      this.options.log?.warn({ err }, 'Could not put a document file in the storage')
      throw new NotKept("The file couldn't be kept in the storage just now, so nothing was saved. Try again in a minute.")
    }
    return key
  }

  /** A file written that no document took: deleted now, or by the list if that fails. */
  async drop(key: string) {
    await queueFile(this.db, key, true)
    await this.tidy()
  }

  /** A file as it was sent, opened with the key if it was stored encrypted. */
  async read(key: string): Promise<Buffer> {
    const store = this.need()
    let data: Buffer
    try {
      data = await store.get(key)
    } catch (err) {
      if (missing(err)) throw new FileGone(FILE_GONE)
      throw err
    }
    // Stored before BACKUP_KEY was set: plain, and still opens.
    if (!isEncrypted(data)) return data
    if (!this.options.key) throw new FileLocked('This file was stored encrypted, and the server has no BACKUP_KEY to open it. Set BACKUP_KEY on the server as it was when the file was sent.')
    try {
      return decryptBackup(data, this.options.key)
    } catch {
      throw new FileLocked("This file can't be opened with the server's BACKUP_KEY: it was stored with a different key, or it's damaged.")
    }
  }

  /**
   * Delete what's due on the list of files to delete, one run at a time; a
   * call while one runs gets one more run after it, for what the change
   * that called it added. A file that can't be deleted stays on the list,
   * with why, and the log says how many.
   */
  tidy(): Promise<void> {
    if (!this.store) return Promise.resolve()
    if (this.tidying) {
      this.again = true
      return this.tidying
    }
    this.tidying = (async () => {
      try {
        do {
          this.again = false
          await this.deleteDue(this.store!)
        } while (this.again)
      } catch (err) {
        // The database or the storage away: the list keeps every file, for the next change or tomorrow.
        this.options.log?.warn({ err }, 'Could not work through the list of document files to delete; trying again after the next change and tomorrow')
        this.options.report?.(err)
      } finally {
        this.tidying = undefined
      }
    })()
    return this.tidying
  }

  private async deleteDue(store: BackupStore) {
    const { rows } = await this.db.query<{ key: string }>(`SELECT key FROM document_files_to_delete WHERE after <= now() ORDER BY since, key LIMIT 500`)
    let failed = 0
    for (const { key } of rows) {
      try {
        await store.delete(key)
        await this.db.query(`DELETE FROM document_files_to_delete WHERE key = $1`, [key])
      } catch (err) {
        failed++
        const why = (err instanceof Error ? err.message : String(err)).slice(0, 300)
        await this.db.query(`UPDATE document_files_to_delete SET tries = tries + 1, last_error = $2 WHERE key = $1`, [key, why])
      }
    }
    if (failed)
      this.options.log?.warn(
        { files: failed },
        `Could not delete ${failed} document ${failed === 1 ? 'file' : 'files'} from the storage. They stay on the list of files to delete and are tried again after the next change and tomorrow.`
      )
  }

  /**
   * Files under documents/ that neither a document nor the list knows,
   * such as ones added after the backup a restore came from: counted, and
   * said in the log, never deleted, since a server pointed at this bucket
   * by mistake (a restore drill, say) must never delete the live one's.
   * Listed before the database is read, so a file being written now is
   * already on the list.
   */
  async strays(): Promise<number> {
    if (!this.store) return 0
    const listed = await this.store.list(PREFIX)
    const { rows } = await this.db.query<{ key: string }>(`SELECT file_key AS key FROM documents WHERE file_key IS NOT NULL UNION SELECT file_key FROM venue_documents WHERE file_key IS NOT NULL UNION SELECT key FROM document_files_to_delete`)
    const known = new Set(rows.map((r) => r.key))
    const n = listed.filter((f) => !known.has(f.key)).length
    if (n)
      this.options.log?.warn(
        { files: n },
        `${n} ${n === 1 ? 'file' : 'files'} under documents/ in the storage belong to no document, as after a restore from a backup made before they were sent. They're left alone: delete them in the bucket once you're sure (ADR 0029).`
      )
    return n
  }

  /** The list worked through, and strays counted, at start and then once each day in Ireland; the database is asked only on a new day. */
  start(): Promise<void> {
    if (!this.store) return Promise.resolve()
    if (!this.timer) {
      this.timer = setInterval(() => void this.daily(), HOUR)
      this.timer.unref()
    }
    return this.daily()
  }

  stop() {
    clearInterval(this.timer)
    this.timer = undefined
  }

  private async daily() {
    const today = irishToday()
    if (this.doneFor === today) return
    this.doneFor = today
    await this.tidy()
    try {
      await this.strays()
    } catch (err) {
      this.options.log?.warn({ err }, 'Could not count the files under documents/ in the storage')
    }
  }

  private need(): BackupStore {
    if (!this.store) throw new Error('No storage is set up for files.')
    return this.store
  }
}
