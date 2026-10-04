import type { Document } from '@sh/shared'
import type { Queryable } from '../db.ts'

/** Reading documents back as devices and the link page see them (ADR 0029): never where a file is kept. */

const DOC = `id, person_id, kind, title, expires::text, file_type, file_bytes, file_at, sent_via, sent_at, checked_at, renews`

type Row = Record<string, any>

const at = (v: unknown) => (v ? new Date(v as string).toISOString() : null)

export const toDocument = (r: Row): Document => ({
  id: r.id,
  personId: r.person_id,
  kind: r.kind,
  title: r.title,
  expires: r.expires ?? null,
  file: r.file_type ? { type: r.file_type, bytes: r.file_bytes, at: at(r.file_at)! } : null,
  sentVia: r.sent_via,
  sentAt: at(r.sent_at)!,
  checkedAt: at(r.checked_at),
  renews: r.renews ?? null,
})

export async function getDocument(q: Queryable, id: string) {
  const { rows } = await q.query(`SELECT ${DOC} FROM documents WHERE id = $1`, [id])
  return rows[0] ? toDocument(rows[0]) : undefined
}

/** Where a document's file is kept, for the server alone. */
export async function fileKeyOf(q: Queryable, id: string): Promise<string | null> {
  const { rows } = await q.query<{ file_key: string | null }>(`SELECT file_key FROM documents WHERE id = $1`, [id])
  return rows[0]?.file_key ?? null
}

/** A person's documents, for their link page and their own download. */
export async function documentsOf(q: Queryable, personId: string) {
  const { rows } = await q.query(`SELECT ${DOC} FROM documents WHERE person_id = $1 ORDER BY sent_at, id`, [personId])
  return rows.map(toDocument)
}

/**
 * Put a file on the list of files to delete: at once for one a document
 * no longer has, or in an hour for one being written now, which the
 * change that puts it on a document takes off the list again.
 */
export async function queueFile(q: Queryable, key: string, now: boolean) {
  await q.query(
    `INSERT INTO document_files_to_delete (key, since, after) VALUES ($1, now(), now() + $2::interval)
     ON CONFLICT (key) DO UPDATE SET after = LEAST(document_files_to_delete.after, EXCLUDED.after)`,
    [key, now ? '0' : '1 hour']
  )
}

/** A file put on a document: off the list of files to delete. */
export async function claimFile(q: Queryable, key: string) {
  await q.query(`DELETE FROM document_files_to_delete WHERE key = $1`, [key])
}

/** Every file of a person's documents, on the list at once: they're being erased (ADR 0027). */
export async function queueFilesOf(q: Queryable, personId: string) {
  await q.query(
    `INSERT INTO document_files_to_delete (key, since, after) SELECT file_key, now(), now() FROM documents WHERE person_id = $1 AND file_key IS NOT NULL
     ON CONFLICT (key) DO UPDATE SET after = now()`,
    [personId]
  )
}

/** Every document's file, on the list at once: everything is going (starting fresh, ADR 0019). */
export async function queueAllFiles(q: Queryable) {
  await q.query(
    `INSERT INTO document_files_to_delete (key, since, after) SELECT file_key, now(), now() FROM documents WHERE file_key IS NOT NULL
     ON CONFLICT (key) DO UPDATE SET after = now()`
  )
}
