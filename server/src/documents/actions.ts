import { addDays, DOCUMENT_ACTIONS, newId, type DocumentDetails, type DocumentKind, type FileType, type Person } from '@sh/shared'
import type { Db } from '../db.ts'
import { MADE_UP_RENEWAL } from '../data/madeup.ts'
import { Refused, serverChange, type Ctx } from '../kernel.ts'
import type { DocumentFiles } from './files.ts'
import { emitDocument, ownerOf, putFile, saveDetails } from './handlers.ts'
import { getDocument } from './store.ts'

/**
 * What carries a file (ADR 0029): a server action, done at once with
 * signal and recorded in the history like a command. The file goes to the
 * storage first, on the list of files to delete; the change that puts it
 * on a document takes it off, and a change turned down deletes it again.
 */

/** Who did it, for the history: the app's device code, the signed-in member of staff, and the kind of device. */
export interface Who {
  clientId?: string
  userId?: string
  device?: string
}

/** The history's record of the action, filled in once the change knows whether the document was new and had a file. */
async function recordArgs(ctx: Ctx, args: Record<string, unknown>) {
  await ctx.tx.query('UPDATE mutations SET args = $2 WHERE id = $1', [ctx.mutationId, JSON.stringify(args)])
}

/** Write the file, then make the change; a change turned down takes the file back out of the storage. */
async function withFile<T>(files: DocumentFiles, data: Buffer, change: (key: string) => Promise<T>): Promise<T> {
  const key = await files.keep(data)
  try {
    return await change(key)
  } catch (err) {
    await files.drop(key).catch(() => {})
    throw err
  }
}

/**
 * The office puts a file on a document from the person's card: the
 * document added with it when it's new, its details changed when they
 * differ, the file it had replaced.
 */
export function officeFile(db: Db, files: DocumentFiles, details: DocumentDetails, data: Buffer, type: FileType, who: Who) {
  const args = { id: details.id, personId: details.personId, kind: details.kind, title: details.title, expires: details.expires, type, bytes: data.length }
  return withFile(files, data, (key) =>
    serverChange(db, { name: DOCUMENT_ACTIONS.file, args, ...who }, async (ctx) => {
      const { added } = await saveDetails(ctx, details)
      const { replaced } = await putFile(ctx, details.id, key, { type, bytes: data.length })
      await emitDocument(ctx, details.id)
      await recordArgs(ctx, { ...args, added, replaced })
    })
  )
}

/** What a freelancer's form on their link says: what it is, or which of theirs it renews, and the day it runs out. */
export interface Sent {
  kind: DocumentKind
  title: string
  expires: string | null
  renews: string | null
}

/**
 * A freelancer sends a document from their private link: new, or a
 * renewal of one of theirs. It waits for the office to check it, with the
 * day they typed, even for a certificate's card: the record is the
 * office's, and checking it is what moves the certificate's date.
 */
export function linkSend(db: Db, files: DocumentFiles, person: Pick<Person, 'id'>, sent: Sent, data: Buffer, type: FileType, device?: string) {
  const id = newId()
  return withFile(files, data, (key) =>
    serverChange(db, { name: DOCUMENT_ACTIONS.send, args: {}, link: person.id, device }, async (ctx) => {
      await ownerOf(ctx.tx, person.id)
      const old = sent.renews ? await getDocument(ctx.tx, sent.renews) : undefined
      if (sent.renews && old?.personId !== person.id) throw new Refused({ code: 'not-found', message: "That document isn't one of yours." })
      const kind = old?.kind ?? sent.kind
      const title = old?.title ?? sent.title
      await ctx.tx.query(
        `INSERT INTO documents (id, person_id, kind, title, expires, sent_via, sent_at, checked_at, renews) VALUES ($1, $2, $3, $4, $5, 'link', now(), NULL, $6)`,
        [id, person.id, kind, title, sent.expires, old?.id ?? null]
      )
      await putFile(ctx, id, key, { type, bytes: data.length })
      await emitDocument(ctx, id)
      await recordArgs(ctx, { id, personId: person.id, kind, title, expires: sent.expires, type, bytes: data.length, renews: old?.id ?? null })
      return id
    })
  )
}

/**
 * A small PDF that says what it is: made-up data's files (ADR 0019), so
 * opening one shows something and nothing could be taken for a real
 * person's. One page of Helvetica, laid out by hand: the byte offsets are
 * counted as it's written.
 */
export function madeUpPdf(lines: readonly string[]): Buffer {
  // WinAnsi has the fadas; anything else becomes a question mark, and the characters PDF strings use are escaped.
  const pdfText = (s: string) =>
    [...s].map((c) => (c === '(' || c === ')' || c === '\\' ? `\\${c}` : c.charCodeAt(0) < 128 ? c : c.charCodeAt(0) < 256 ? `\\${c.charCodeAt(0).toString(8)}` : '?')).join('')
  const stream = `BT /F1 16 Tf 60 770 Td ${lines.map((l, i) => `${i ? '0 -26 Td ' : ''}(${pdfText(l)}) Tj`).join(' ')} ET`
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
  ]
  let pdf = '%PDF-1.4\n'
  const offsets: number[] = []
  objects.forEach((o, i) => {
    offsets.push(pdf.length)
    pdf += `${i + 1} 0 obj\n${o}\nendobj\n`
  })
  const xref = pdf.length
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return Buffer.from(pdf, 'latin1')
}

const MADE_UP = 'Made-up data'

/**
 * Made-up data's files, where a store is set up (ADR 0029): a made-up PDF
 * on each made-up document, and the renewed card one made-up freelancer
 * has sent from their link, waiting in "Answers to check". With no store,
 * the documents stay details only, as on a server with no bucket.
 */
export async function putMadeUpFiles(db: Db, files: DocumentFiles, today: string, who: Who = {}): Promise<number> {
  if (!files.on) return 0
  const { rows } = await db.query<{ id: string; person_id: string; kind: DocumentKind; title: string; expires: string | null; name: string }>(
    `SELECT d.id, d.person_id, d.kind, d.title, d.expires::text, p.name FROM documents d JOIN people p ON p.id = d.person_id WHERE d.file_key IS NULL ORDER BY d.sent_at, d.id`
  )
  for (const d of rows) {
    // The file alone: a certificate's card holds no date of its own, so its details sent again would clear the certificate's.
    const data = madeUpPdf([`${d.title}: ${d.name}`, 'Made up, to try the Session Hire app.', 'Not a real document.'])
    const args = { id: d.id, personId: d.person_id, kind: d.kind, title: d.title, expires: d.expires, type: 'pdf', bytes: data.length, added: false, replaced: false }
    await withFile(files, data, (key) =>
      serverChange(db, { name: DOCUMENT_ACTIONS.file, args, ...who, device: MADE_UP }, async (ctx) => {
        await putFile(ctx, d.id, key, { type: 'pdf', bytes: data.length })
        await emitDocument(ctx, d.id)
      })
    )
  }
  const renewal = rows.find((d) => d.name === MADE_UP_RENEWAL.name && d.kind === MADE_UP_RENEWAL.kind)
  if (renewal) {
    const pdf = madeUpPdf([`${renewal.title} (renewed): ${renewal.name}`, 'Made up, to try the Session Hire app.', 'Not a real document.'])
    await linkSend(db, files, { id: renewal.person_id }, { kind: renewal.kind, title: renewal.title, expires: addDays(today, MADE_UP_RENEWAL.days), renews: renewal.id }, pdf, 'pdf', MADE_UP)
  }
  return rows.length + (renewal ? 1 : 0)
}
