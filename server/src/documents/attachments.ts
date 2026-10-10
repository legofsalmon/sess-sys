import { ATTACHMENT_FILE_ACTION, type Attachment, type AttachmentDetails, type AttachmentOwner, type CommandArgs, type FileType } from '@sh/shared'
import type { Db, Queryable } from '../db.ts'
import { emit, emitRemoved, Refused, serverChange, type Ctx } from '../kernel.ts'
import { getClient, getVenue } from '../projects/store.ts'
import { recordArgs, withFile, type Who } from './actions.ts'
import type { DocumentFiles } from './files.ts'
import { claimFile, queueFile } from './store.ts'

/**
 * Documents kept on venues and clients (ADR 0032): a venue's tech spec or
 * floor plan, a client's contract or purchase order, each a file, a link,
 * or both. Files go where people's documents' files go (ADR 0029), on the
 * same list of files to delete, so everything that list promises holds
 * for them too. One table, with a column for each owner and exactly one
 * of them set, so the database itself keeps every one on something real.
 */

const DOC = `id, venue_id, client_id, kind, title, link, file_type, file_bytes, file_at, added_at`

type Row = Record<string, any>
const at = (v: unknown) => new Date(v as string).toISOString()

const toAttachment = (r: Row): Attachment => ({
  id: r.id,
  owner: r.venue_id ? 'venue' : 'client',
  ownerId: r.venue_id ?? r.client_id,
  kind: r.kind,
  title: r.title,
  link: r.link ?? null,
  file: r.file_type ? { type: r.file_type, bytes: r.file_bytes, at: at(r.file_at) } : null,
  addedAt: at(r.added_at),
})

export async function getAttachment(q: Queryable, id: string) {
  const { rows } = await q.query(`SELECT ${DOC} FROM attachments WHERE id = $1`, [id])
  return rows[0] ? toAttachment(rows[0]) : undefined
}

/** Where its file is kept, for the server alone. */
export async function attachmentFileKeyOf(q: Queryable, id: string): Promise<string | null> {
  const { rows } = await q.query<{ file_key: string | null }>(`SELECT file_key FROM attachments WHERE id = $1`, [id])
  return rows[0]?.file_key ?? null
}

/** The venue's or client's name, for a download's name. */
export async function ownerName(q: Queryable, owner: AttachmentOwner, ownerId: string): Promise<string | undefined> {
  return (owner === 'venue' ? await getVenue(q, ownerId) : await getClient(q, ownerId))?.name
}

const emitAttachment = async (ctx: Ctx, id: string) => emit(ctx, 'attachment', id, await getAttachment(ctx.tx, id))

/**
 * Its details, added or changed. With no file it needs a link, as there
 * would be nothing to open; with a file coming in the same change, it
 * doesn't. A file it has already stays. Answers whether it was new.
 */
async function saveDetails(ctx: Ctx, a: AttachmentDetails, fileComing: boolean): Promise<{ added: boolean }> {
  if (!(await ownerName(ctx.tx, a.owner, a.ownerId))) throw new Refused({ code: 'not-found', message: `That ${a.owner} is no longer there.` })
  const was = await getAttachment(ctx.tx, a.id)
  // The id is the device's to choose, so one already used for something else's would write over it.
  if (was && (was.owner !== a.owner || was.ownerId !== a.ownerId)) throw new Refused({ code: 'conflict', message: `That document is another ${was.owner}'s.` })
  if (!a.link && !fileComing && !was?.file) throw new Refused({ code: 'invalid', message: 'Add the link to it, or choose its file.' })
  await ctx.tx.query(
    `INSERT INTO attachments (id, venue_id, client_id, kind, title, link, added_at) VALUES ($1, $2, $3, $4, $5, $6, now())
     ON CONFLICT (id) DO UPDATE SET kind = EXCLUDED.kind, title = EXCLUDED.title, link = EXCLUDED.link`,
    [a.id, a.owner === 'venue' ? a.ownerId : null, a.owner === 'client' ? a.ownerId : null, a.kind, a.title, a.link]
  )
  return { added: !was }
}

/** One gone, its file on the list of files to delete, in the same change. */
async function removeAttachment(ctx: Ctx, id: string) {
  const key = await attachmentFileKeyOf(ctx.tx, id)
  if (key) await queueFile(ctx.tx, key, true)
  await ctx.tx.query('DELETE FROM attachments WHERE id = $1', [id])
  await emitRemoved(ctx, 'attachment', id)
}

type AttachmentCommand = 'attachment.save' | 'attachment.remove'
type Handler<N extends AttachmentCommand> = (ctx: Ctx, args: CommandArgs<N>) => Promise<void>

export const attachmentHandlers: { [N in AttachmentCommand]: Handler<N> } = {
  async 'attachment.save'(ctx, a) {
    await saveDetails(ctx, a, false)
    await emitAttachment(ctx, a.id)
  },

  async 'attachment.remove'(ctx, a) {
    // Removed once is removed: a second device's Remove finds nothing to do.
    if (await getAttachment(ctx.tx, a.id)) await removeAttachment(ctx, a.id)
  },
}

/**
 * The office puts a file on a venue's or client's document from its page:
 * the document added with it when it's new, its details changed when they
 * differ, the file it had replaced and put on the list of files to delete.
 */
export function attachmentFile(db: Db, files: DocumentFiles, details: AttachmentDetails, data: Buffer, type: FileType, who: Who) {
  const args = { ...details, type, bytes: data.length }
  return withFile(files, data, (key) =>
    serverChange(db, { name: ATTACHMENT_FILE_ACTION, args, ...who }, async (ctx) => {
      const { added } = await saveDetails(ctx, details, true)
      const old = await attachmentFileKeyOf(ctx.tx, details.id)
      await claimFile(ctx.tx, key)
      await ctx.tx.query(`UPDATE attachments SET file_key = $2, file_type = $3, file_bytes = $4, file_at = now() WHERE id = $1`, [details.id, key, type, data.length])
      if (old && old !== key) await queueFile(ctx.tx, old, true)
      await emitAttachment(ctx, details.id)
      await recordArgs(ctx, { ...args, added, replaced: !!old })
    })
  )
}
