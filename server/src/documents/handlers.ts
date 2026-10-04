import { certificateOf, ERASED_REFUSAL, type CertificateKind, type CommandArgs, type DocumentDetails, type FileType, type Person } from '@sh/shared'
import { getPerson } from '../crew/store.ts'
import type { Queryable } from '../db.ts'
import { readErasure } from '../erasure/places.ts'
import { emit, emitRemoved, Refused, type Ctx } from '../kernel.ts'
import { claimFile, fileKeyOf, getDocument, queueFile } from './store.ts'

/**
 * People's documents (ADR 0029): the office's commands, and what the
 * server actions that carry a file share with them. A certificate's card
 * keeps no date of its own: saving or checking one sets the certificate on
 * the person, which holds it, so the two can't drift apart.
 */

export async function emitDocument(ctx: Ctx, id: string) {
  await emit(ctx, 'document', id, await getDocument(ctx.tx, id))
}

/** Whose a document can be: someone here, not archived, and not erased. */
export async function ownerOf(tx: Queryable, personId: string): Promise<Person> {
  const person = await getPerson(tx, personId)
  if (!person) throw new Refused({ code: 'not-found', message: 'That person no longer exists.' })
  // Checked here for the server actions, which don't go through the commands' own check.
  if (await readErasure(tx, personId)) throw new Refused({ code: 'conflict', message: ERASED_REFUSAL })
  if (person.archived) throw new Refused({ code: 'conflict', message: `${person.name} has been archived. Bring them back on the Crew tab to add or change their documents.` })
  return person
}

/** A certificate's card is in: the certificate is held, running out on its day. Nothing is sent when that's already so. */
async function setCertificate(ctx: Ctx, person: Person, kind: CertificateKind, expires: string | null) {
  const was = person.certificates[kind]
  if (was?.held === true && was.expires === expires) return
  const certificates = { ...person.certificates, [kind]: { held: true, expires, note: was?.note ?? '' } }
  await ctx.tx.query('UPDATE people SET certificates = $2 WHERE id = $1', [person.id, JSON.stringify(certificates)])
  await emit(ctx, 'person', person.id, await getPerson(ctx.tx, person.id))
}

/**
 * The office's details for a document: added as checked, or changed. One
 * sent from a link is checked before it's changed, so the office has seen
 * what was sent. Answers whether it was new. The caller sends it to devices.
 */
export async function saveDetails(ctx: Ctx, a: DocumentDetails): Promise<{ added: boolean }> {
  const person = await ownerOf(ctx.tx, a.personId)
  const was = await getDocument(ctx.tx, a.id)
  // The id is the device's to choose, so one already used for someone else's would write over theirs.
  if (was && was.personId !== a.personId) throw new Refused({ code: 'conflict', message: "That document is someone else's." })
  if (was && !was.checkedAt) throw new Refused({ code: 'conflict', message: `${person.name} sent this from their link: check it first, in Answers to check on the Crew tab.` })
  const cert = certificateOf(a.kind)
  await ctx.tx.query(
    `INSERT INTO documents (id, person_id, kind, title, expires, sent_via, sent_at, checked_at) VALUES ($1, $2, $3, $4, $5, 'office', now(), now())
     ON CONFLICT (id) DO UPDATE SET kind = EXCLUDED.kind, title = EXCLUDED.title, expires = EXCLUDED.expires`,
    [a.id, a.personId, a.kind, a.title, cert ? null : a.expires]
  )
  if (cert) await setCertificate(ctx, person, cert, a.expires)
  return { added: !was }
}

/** A file written to the storage put on a document, the one it had going back on the list of files to delete. Answers whether it had one. */
export async function putFile(ctx: Ctx, id: string, key: string, file: { type: FileType; bytes: number }): Promise<{ replaced: boolean }> {
  const old = await fileKeyOf(ctx.tx, id)
  await claimFile(ctx.tx, key)
  await ctx.tx.query(`UPDATE documents SET file_key = $2, file_type = $3, file_bytes = $4, file_at = now() WHERE id = $1`, [id, key, file.type, file.bytes])
  if (old && old !== key) await queueFile(ctx.tx, old, true)
  return { replaced: !!old }
}

/** A document gone, its file on the list of files to delete, in the same change. */
async function removeDocument(ctx: Ctx, id: string) {
  const key = await fileKeyOf(ctx.tx, id)
  if (key) await queueFile(ctx.tx, key, true)
  await ctx.tx.query('DELETE FROM documents WHERE id = $1', [id])
  await emitRemoved(ctx, 'document', id)
}

type DocumentCommand = 'document.save' | 'document.check' | 'document.remove'
type Handler<N extends DocumentCommand> = (ctx: Ctx, args: CommandArgs<N>) => Promise<void>

export const documentHandlers: { [N in DocumentCommand]: Handler<N> } = {
  async 'document.save'(ctx, a) {
    await saveDetails(ctx, a)
    await emitDocument(ctx, a.id)
  },

  async 'document.check'(ctx, a) {
    const d = await getDocument(ctx.tx, a.id)
    if (!d) throw new Refused({ code: 'not-found', message: 'That document is no longer there.' })
    // Checked once is checked, as for answers: a second device's Checked changes nothing.
    if (d.checkedAt) return
    const cert = certificateOf(d.kind)
    await ctx.tx.query('UPDATE documents SET checked_at = now(), expires = $2 WHERE id = $1', [d.id, cert ? null : a.expires])
    const person = await getPerson(ctx.tx, d.personId)
    if (cert && person) await setCertificate(ctx, person, cert, a.expires)
    await emitDocument(ctx, d.id)
    // A renewal takes the place of the one it renews, file and all, so the list keeps one of each.
    const old = d.renews ? await getDocument(ctx.tx, d.renews) : undefined
    if (old && old.personId === d.personId && old.id !== d.id) await removeDocument(ctx, old.id)
  },

  async 'document.remove'(ctx, a) {
    // Removed once is removed: a second device's Remove finds nothing to do.
    if (await getDocument(ctx.tx, a.id)) await removeDocument(ctx, a.id)
  },
}
