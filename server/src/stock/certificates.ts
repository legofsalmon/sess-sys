import { ITEM_CERTIFICATE_FILE_ACTION, type CommandArgs, type FileType, type ItemCertificate, type ItemCertificateDetails } from '@sh/shared'
import type { Db, Queryable } from '../db.ts'
import { recordArgs, withFile, type Who } from '../documents/actions.ts'
import type { DocumentFiles } from '../documents/files.ts'
import { claimFile, queueFile } from '../documents/store.ts'
import { emit, emitRemoved, Refused, serverChange, type Ctx } from '../kernel.ts'

/**
 * Certificates on items (ADR 0094): a PAT certificate, a report of a
 * thorough examination, or another, such as a declaration of conformity,
 * each a file kept where venues' documents are (ADR 0032), on the same
 * list of files to delete, or a link, or both. One covers as many items
 * as it names, as a tester's report of a round does. The tests themselves
 * stay as they were recorded: a certificate is kept beside them, and
 * which test it's for each device works out from its kind and day
 * (shared/src/sync/inspections-view.ts).
 */

const CERT = `id, kind, title, to_char(day, 'YYYY-MM-DD') AS day, to_char(expires, 'YYYY-MM-DD') AS expires, link, file_type, file_bytes, file_at, added_at`

type Row = Record<string, any>
const at = (v: unknown) => new Date(v as string).toISOString()

export async function getItemCertificate(q: Queryable, id: string): Promise<ItemCertificate | undefined> {
  const { rows } = await q.query(`SELECT ${CERT} FROM item_certificates WHERE id = $1`, [id])
  const r: Row | undefined = rows[0]
  if (!r) return undefined
  const { rows: items } = await q.query<{ asset_id: string }>('SELECT asset_id FROM item_certificate_items WHERE certificate_id = $1 ORDER BY place, asset_id', [id])
  return {
    id: r.id,
    kind: r.kind,
    title: r.title,
    day: r.day,
    expires: r.expires ?? null,
    assetIds: items.map((i) => i.asset_id),
    link: r.link ?? null,
    file: r.file_type ? { type: r.file_type, bytes: r.file_bytes, at: at(r.file_at) } : null,
    addedAt: at(r.added_at),
  }
}

/** Where its file is kept, for the server alone. */
export async function itemCertificateFileKeyOf(q: Queryable, id: string): Promise<string | null> {
  const { rows } = await q.query<{ file_key: string | null }>(`SELECT file_key FROM item_certificates WHERE id = $1`, [id])
  return rows[0]?.file_key ?? null
}

/** The first item's number and product, for a download's name: "SH-000123 CM Lodestar". */
export async function certificateItemName(q: Queryable, c: ItemCertificate): Promise<string> {
  const { rows } = await q.query<{ value: string | null; name: string | null }>(
    `SELECT i.value, m.name FROM assets a LEFT JOIN models m ON m.id = a.model_id
       LEFT JOIN identifiers i ON i.asset_id = a.id AND i.kind = 'sh' AND i.retired_at IS NULL
      WHERE a.id = $1`,
    [c.assetIds[0]]
  )
  const first = rows[0] ? [rows[0].value, rows[0].name].filter(Boolean).join(' ') : ''
  return c.assetIds.length > 1 ? `${first} and ${c.assetIds.length - 1} more` : first
}

const emitCertificate = async (ctx: Ctx, id: string) => emit(ctx, 'itemCertificate', id, await getItemCertificate(ctx.tx, id))

/**
 * Its details, added or changed. The items it covers are the ones sent,
 * in that order; with `adding`, as an upload's are, they're added to the
 * ones it has. With no file it needs a link, as there would be nothing to
 * open; with a file coming in the same change, it doesn't. Answers
 * whether it was new.
 */
async function saveDetails(ctx: Ctx, c: ItemCertificateDetails, fileComing: boolean, adding: boolean): Promise<{ added: boolean }> {
  const { rows: found } = await ctx.tx.query<{ id: string }>('SELECT id FROM assets WHERE id = ANY($1::text[])', [c.assetIds])
  const missing = c.assetIds.length - found.length
  if (missing)
    throw new Refused({
      code: 'not-found',
      message: `${missing === 1 ? 'One item it covers was' : `${missing} items it covers were`} never added to the stock list, so the certificate wasn't kept. Add them, then try again.`,
    })
  const was = await getItemCertificate(ctx.tx, c.id)
  if (!c.link && !fileComing && !was?.file) throw new Refused({ code: 'invalid', message: 'Add the link to it, or choose its file.' })
  await ctx.tx.query(
    `INSERT INTO item_certificates (id, kind, title, day, expires, link, added_at) VALUES ($1, $2, $3, $4, $5, $6, now())
     ON CONFLICT (id) DO UPDATE SET kind = EXCLUDED.kind, title = EXCLUDED.title, day = EXCLUDED.day, expires = EXCLUDED.expires, link = EXCLUDED.link`,
    [c.id, c.kind, c.title.trim(), c.day, c.expires, c.link]
  )
  const ids = adding ? [...new Set([...(was?.assetIds ?? []), ...c.assetIds])] : c.assetIds
  await ctx.tx.query('DELETE FROM item_certificate_items WHERE certificate_id = $1', [c.id])
  await ctx.tx.query(
    `INSERT INTO item_certificate_items (certificate_id, asset_id, place) SELECT $1, a, p::integer - 1 FROM unnest($2::text[]) WITH ORDINALITY AS t(a, p)`,
    [c.id, ids]
  )
  return { added: !was }
}

type CertificateCommand = 'itemCertificate.save' | 'itemCertificate.remove'
type Handler<N extends CertificateCommand> = (ctx: Ctx, args: CommandArgs<N>) => Promise<void>

export const itemCertificateHandlers: { [N in CertificateCommand]: Handler<N> } = {
  async 'itemCertificate.save'(ctx, a) {
    await saveDetails(ctx, a, false, false)
    await emitCertificate(ctx, a.id)
  },

  async 'itemCertificate.remove'(ctx, a) {
    // Removed once is removed: a second device's Remove finds nothing to do.
    if (!(await getItemCertificate(ctx.tx, a.id))) return
    const key = await itemCertificateFileKeyOf(ctx.tx, a.id)
    if (key) await queueFile(ctx.tx, key, true)
    await ctx.tx.query('DELETE FROM item_certificates WHERE id = $1', [a.id])
    await emitRemoved(ctx, 'itemCertificate', a.id)
  },
}

/**
 * A file put on a certificate from an item's page or a round of testing:
 * the certificate added with it when it's new, the items sent added to the
 * ones it covers, the file it had replaced and put on the list of files to
 * delete.
 */
export function itemCertificateFile(db: Db, files: DocumentFiles, details: ItemCertificateDetails, data: Buffer, type: FileType, who: Who) {
  const args = { ...details, type, bytes: data.length }
  return withFile(files, data, (key) =>
    serverChange(db, { name: ITEM_CERTIFICATE_FILE_ACTION, args, ...who }, async (ctx) => {
      const { added } = await saveDetails(ctx, details, true, true)
      const old = await itemCertificateFileKeyOf(ctx.tx, details.id)
      await claimFile(ctx.tx, key)
      await ctx.tx.query(`UPDATE item_certificates SET file_key = $2, file_type = $3, file_bytes = $4, file_at = now() WHERE id = $1`, [details.id, key, type, data.length])
      if (old && old !== key) await queueFile(ctx.tx, old, true)
      await emitCertificate(ctx, details.id)
      await recordArgs(ctx, { ...args, added, replaced: !!old })
    })
  )
}
