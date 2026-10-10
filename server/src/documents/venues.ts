import { VENUE_DOCUMENT_FILE_ACTION, type CommandArgs, type FileType, type VenueDocument, type VenueDocumentDetails } from '@sh/shared'
import type { Db, Queryable } from '../db.ts'
import { emit, emitRemoved, Refused, serverChange, type Ctx } from '../kernel.ts'
import { getVenue } from '../projects/store.ts'
import { recordArgs, withFile, type Who } from './actions.ts'
import type { DocumentFiles } from './files.ts'
import { claimFile, queueFile } from './store.ts'

/**
 * Venues' documents (ADR 0032): a tech spec, a floor plan, a health and
 * safety pack, kept on the venue's page as a file, a link, or both. Files
 * go where people's documents' files go (ADR 0029), on the same list of
 * files to delete, so everything that list promises holds for them too.
 */

const DOC = `id, venue_id, kind, title, link, file_type, file_bytes, file_at, added_at`

type Row = Record<string, any>
const at = (v: unknown) => new Date(v as string).toISOString()

const toVenueDocument = (r: Row): VenueDocument => ({
  id: r.id,
  venueId: r.venue_id,
  kind: r.kind,
  title: r.title,
  link: r.link ?? null,
  file: r.file_type ? { type: r.file_type, bytes: r.file_bytes, at: at(r.file_at) } : null,
  addedAt: at(r.added_at),
})

export async function getVenueDocument(q: Queryable, id: string) {
  const { rows } = await q.query(`SELECT ${DOC} FROM venue_documents WHERE id = $1`, [id])
  return rows[0] ? toVenueDocument(rows[0]) : undefined
}

/** Where its file is kept, for the server alone. */
export async function venueFileKeyOf(q: Queryable, id: string): Promise<string | null> {
  const { rows } = await q.query<{ file_key: string | null }>(`SELECT file_key FROM venue_documents WHERE id = $1`, [id])
  return rows[0]?.file_key ?? null
}

const emitVenueDocument = async (ctx: Ctx, id: string) => emit(ctx, 'venueDocument', id, await getVenueDocument(ctx.tx, id))

/**
 * Its details, added or changed. With no file it needs a link, as there
 * would be nothing to open; with `file` coming in the same change, it
 * doesn't. A file it has already stays. Answers whether it was new.
 */
async function saveVenueDetails(ctx: Ctx, a: VenueDocumentDetails, fileComing: boolean): Promise<{ added: boolean }> {
  if (!(await getVenue(ctx.tx, a.venueId))) throw new Refused({ code: 'not-found', message: 'That venue is no longer there.' })
  const was = await getVenueDocument(ctx.tx, a.id)
  // The id is the device's to choose, so one already used for another venue's would write over it.
  if (was && was.venueId !== a.venueId) throw new Refused({ code: 'conflict', message: "That document is another venue's." })
  if (!a.link && !fileComing && !was?.file) throw new Refused({ code: 'invalid', message: 'Add the link to it, or choose its file.' })
  await ctx.tx.query(
    `INSERT INTO venue_documents (id, venue_id, kind, title, link, added_at) VALUES ($1, $2, $3, $4, $5, now())
     ON CONFLICT (id) DO UPDATE SET kind = EXCLUDED.kind, title = EXCLUDED.title, link = EXCLUDED.link`,
    [a.id, a.venueId, a.kind, a.title, a.link]
  )
  return { added: !was }
}

/** A document gone, its file on the list of files to delete, in the same change. */
async function removeVenueDocument(ctx: Ctx, id: string) {
  const key = await venueFileKeyOf(ctx.tx, id)
  if (key) await queueFile(ctx.tx, key, true)
  await ctx.tx.query('DELETE FROM venue_documents WHERE id = $1', [id])
  await emitRemoved(ctx, 'venueDocument', id)
}

type VenueDocumentCommand = 'venueDocument.save' | 'venueDocument.remove'
type Handler<N extends VenueDocumentCommand> = (ctx: Ctx, args: CommandArgs<N>) => Promise<void>

export const venueDocumentHandlers: { [N in VenueDocumentCommand]: Handler<N> } = {
  async 'venueDocument.save'(ctx, a) {
    await saveVenueDetails(ctx, a, false)
    await emitVenueDocument(ctx, a.id)
  },

  async 'venueDocument.remove'(ctx, a) {
    // Removed once is removed: a second device's Remove finds nothing to do.
    if (await getVenueDocument(ctx.tx, a.id)) await removeVenueDocument(ctx, a.id)
  },
}

/**
 * The office puts a file on a venue's document from its page: the document
 * added with it when it's new, its details changed when they differ, the
 * file it had replaced and put on the list of files to delete.
 */
export function venueFile(db: Db, files: DocumentFiles, details: VenueDocumentDetails, data: Buffer, type: FileType, who: Who) {
  const args = { ...details, type, bytes: data.length }
  return withFile(files, data, (key) =>
    serverChange(db, { name: VENUE_DOCUMENT_FILE_ACTION, args, ...who }, async (ctx) => {
      const { added } = await saveVenueDetails(ctx, details, true)
      const old = await venueFileKeyOf(ctx.tx, details.id)
      await claimFile(ctx.tx, key)
      await ctx.tx.query(`UPDATE venue_documents SET file_key = $2, file_type = $3, file_bytes = $4, file_at = now() WHERE id = $1`, [details.id, key, type, data.length])
      if (old && old !== key) await queueFile(ctx.tx, old, true)
      await emitVenueDocument(ctx, details.id)
      await recordArgs(ctx, { ...args, added, replaced: !!old })
    })
  )
}
