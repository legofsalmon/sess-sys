import { irishToday } from '@sh/shared'
import type { BackupStore } from '../backup/store.ts'
import { getPerson } from '../crew/store.ts'
import type { Db, Queryable } from '../db.ts'
import { ERASED_AGAIN_ACTION } from '../history.ts'
import { serverChange } from '../kernel.ts'
import { erasePerson, readErasure } from './places.ts'

/**
 * Backups can't be edited, so an erased person's details live on in them
 * until they age out (ADR 0027). A restore must never bring them back, so
 * the list of erasures (ids and dates, nothing about the person) is kept
 * beside the backups as well as in the database, and applied again after
 * any backup is loaded. The database it is loaded into is new and empty,
 * so the list in the storage is the only one that knows what came after
 * the backup.
 */

/** In the backup storage, beside the backups, and never thinned with them. */
export const LIST_KEY = 'erasures/list.json'
const FORMAT = 'session-hire-erasures'


export interface Listed {
  /** The person's id. */
  id: string
  erasedAt: string
  /** Their name is kept until this day, or null once it has gone. */
  nameKeptUntil: string | null
}

type Row = Record<string, any>

export async function listedIn(q: Queryable): Promise<Listed[]> {
  const { rows } = await q.query<Row>(`SELECT person_id, erased_at, name_kept_until::text FROM erasures ORDER BY person_id`)
  return rows.map((r) => ({ id: r.person_id, erasedAt: new Date(r.erased_at).toISOString(), nameKeptUntil: r.name_kept_until ?? null }))
}

/** The list kept in the storage; empty when there is none yet. */
export async function listedInStore(store: BackupStore): Promise<Listed[]> {
  if (!(await store.list('erasures/')).some((f) => f.key === LIST_KEY)) return []
  const file = JSON.parse((await store.get(LIST_KEY)).toString('utf8')) as { format?: string; erasures?: unknown }
  if (file.format !== FORMAT || !Array.isArray(file.erasures)) throw new Error(`${LIST_KEY} in the backup storage isn't a list of erasures.`)
  return file.erasures.filter((e): e is Listed => !!e && typeof e === 'object' && typeof (e as Listed).id === 'string' && typeof (e as Listed).erasedAt === 'string')
}

/**
 * Two lists as one. Only ever added to: an entry in either stays. Where
 * both have someone, the first erasure's date stands, and a name gone in
 * either is gone.
 */
export function together(a: readonly Listed[], b: readonly Listed[]): Listed[] {
  const out = new Map<string, Listed>()
  for (const e of [...a, ...b]) {
    const was = out.get(e.id)
    if (!was) {
      out.set(e.id, { id: e.id, erasedAt: e.erasedAt, nameKeptUntil: e.nameKeptUntil ?? null })
      continue
    }
    const kept = was.nameKeptUntil === null || e.nameKeptUntil === null ? null : was.nameKeptUntil < e.nameKeptUntil ? was.nameKeptUntil : e.nameKeptUntil
    out.set(e.id, { id: e.id, erasedAt: was.erasedAt < e.erasedAt ? was.erasedAt : e.erasedAt, nameKeptUntil: kept })
  }
  return [...out.values()].sort((x, y) => x.id.localeCompare(y.id))
}

interface Log {
  warn(obj: object, msg: string): void
}

/**
 * Keeps the list in the storage up to date: after each change in the app,
 * and once at start-up, it reads the table (a few rows) and writes the
 * list when the table has something the storage hasn't been given. A
 * write that fails is tried again after the next change; meanwhile the
 * nightly backup holds the table, and the device that erased someone
 * sends the erasure again after a restore.
 */
export class ErasureList {
  private written = ''
  private writing: Promise<void> = Promise.resolve()

  constructor(
    private readonly db: Db,
    private readonly store: BackupStore,
    private readonly log?: Log
  ) {}

  keep(): Promise<void> {
    // One at a time, so two changes close together can't write over each other's list.
    this.writing = this.writing.then(() => this.write()).catch((err) => this.log?.warn({ err }, 'Could not keep the list of erasures beside the backups'))
    return this.writing
  }

  private async write() {
    const table = await listedIn(this.db)
    const seen = JSON.stringify(table)
    if (seen === this.written || (table.length === 0 && this.written === '')) return
    const list = together(await listedInStore(this.store), table)
    await this.store.put(LIST_KEY, Buffer.from(`${JSON.stringify({ format: FORMAT, version: 1, erasures: list }, null, 1)}\n`))
    this.written = seen
  }
}

/**
 * Erase again everyone on the list who this copy of the data has back,
 * with the same decision about their name, each as a change of its own in
 * the history. After a restore (`everyone`), someone this copy has never
 * heard of goes on its own list too, so nothing sent again afterwards can
 * add them. Answers how many were erased again.
 */
export async function eraseAgain(db: Db, listed: readonly Listed[], { everyone }: { everyone: boolean }): Promise<number> {
  const today = irishToday()
  let again = 0
  for (const e of listed) {
    const person = await getPerson(db, e.id)
    const row = await readErasure(db, e.id)
    const how = { today, at: e.erasedAt, nameKeptUntil: e.nameKeptUntil }
    if (!person) {
      if (everyone && !row) await serverChange(db, undefined, (ctx) => erasePerson(ctx, e.id, how))
      continue
    }
    // Back with their details, or with a name that had gone since.
    if (row && !(row.nameKeptUntil !== null && e.nameKeptUntil === null)) continue
    await serverChange(db, { name: ERASED_AGAIN_ACTION, args: { id: e.id } }, (ctx) => erasePerson(ctx, e.id, how))
    again++
  }
  return again
}

/** After a backup is loaded: the storage's list and the backup's own, applied again. */
export async function eraseAgainFromStore(db: Db, store: BackupStore, opts: { everyone: boolean }): Promise<number> {
  return eraseAgain(db, together(await listedInStore(store), await listedIn(db)), opts)
}
