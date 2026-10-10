import {
  cleanText,
  DOCUMENT_KINDS,
  DOCUMENT_TITLES,
  documentDetails,
  documentFileName,
  FILE_HEAD_BYTES,
  FILE_TOO_BIG,
  FILE_TYPES,
  fileTypeOf,
  FILES_WAIT,
  FILES_WAIT_VENUE,
  isDay,
  MAX_FILE_BYTES,
  NO_FILE,
  WEB_FILE,
  type DocumentStorage,
  type FileType,
  type Person,
  venueDocumentDetails,
} from '@sh/shared'
import type { FastifyError, FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { renderGone } from '../crew/page.ts'
import { getPerson, personByToken } from '../crew/store.ts'
import type { Db } from '../db.ts'
import { describeDevice } from '../devices.ts'
import { Refused } from '../kernel.ts'
import { linkSend, officeFile } from './actions.ts'
import { FileGone, FileLocked, NotKept, type DocumentFiles } from './files.ts'
import { NotAForm, readForm } from './form.ts'
import { renderNoFile } from './page.ts'
import { fileKeyOf, getDocument } from './store.ts'
import { getVenueDocument, venueFile, venueFileKeyOf } from './venues.ts'
import { getVenue } from '../projects/store.ts'

/**
 * Documents' files (ADR 0029), read and written only through the server:
 * the office with its session (the /api routes are under sign-in like the
 * rest), and a freelancer through their own link, which finds only their
 * own. The app sends a file as the request's whole body; the link page has
 * no script, so its form posts multipart. Both take up to 10 MB and a
 * little over for the form, above the 5 MB the rest of the server takes,
 * and check what the file is by its first bytes.
 */

/** Room for the form round a 10 MB file, so a file just under it isn't turned away for its wrapping. */
const ROUTE_LIMIT = MAX_FILE_BYTES + 256 * 1024

/** What the link page says after a post, by code, as its other forms do (crew/links.ts). */
type Said = 'doc-sent' | 'doc-no-file' | 'doc-too-big' | 'doc-web-page' | 'doc-not-a-file' | 'doc-not-on' | 'doc-not-yours' | 'doc-not-kept' | 'check-the-dates' | 'try-again'

type OfficeReq = FastifyRequest<{ Params: { id: string }; Querystring: { client?: string; personId?: string; kind?: string; title?: string; expires?: string } }>
type VenueReq = FastifyRequest<{ Params: { id: string }; Querystring: { client?: string; venueId?: string; kind?: string; title?: string; link?: string } }>
type LinkReq = FastifyRequest<{ Params: { token: string; id?: string } }>

/**
 * A file on its way out: downloaded, never shown in the page that asked,
 * as the type its bytes say it is, with nothing a browser could guess
 * from, and its name made safe ("Pádraig Kenny - IPAF card.pdf", and the
 * same without the fada for browsers that want plain letters). Should a
 * browser show it anyway, the policy lets it load and run nothing, as if
 * from another site: a PDF or a photo can carry a web page after its
 * first bytes.
 */
function sendFile(reply: FastifyReply, data: Buffer, type: FileType, name: string) {
  const plain = name.normalize('NFD').replace(/\p{M}/gu, '').replace(/[^\x20-\x7e]|["\\]/g, '_')
  const encoded = encodeURIComponent(name).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)
  return reply
    .type(FILE_TYPES[type].mime)
    .header('content-disposition', `attachment; filename="${plain}"; filename*=UTF-8''${encoded}`)
    .header('x-content-type-options', 'nosniff')
    .header('content-security-policy', "default-src 'none'; sandbox; frame-ancestors 'none'")
    .header('cache-control', 'no-store')
    .send(data)
}

export function registerDocumentRoutes(app: FastifyInstance, { db, files, onChange }: { db: Db; files: DocumentFiles; onChange: () => void }) {
  // In a scope of their own, so only these routes take a file's bytes as they are, or a form with a file.
  void app.register(async (scope) => {
    const asBytes = { parseAs: 'buffer' as const, bodyLimit: ROUTE_LIMIT }
    scope.addContentTypeParser('application/octet-stream', asBytes, (_req, body, done) => done(null, body))
    scope.addContentTypeParser('multipart/form-data', asBytes, (_req, body, done) => done(null, body))

    /** Whether files can be kept, for the person's card and the reminders' messages. */
    scope.get('/api/documents/storage', async (_req, reply): Promise<DocumentStorage> => {
      reply.header('cache-control', 'no-store')
      return files.status()
    })

    /** The office puts a file on a document, with its details: added when new, replaced when it had one. */
    scope.post('/api/documents/:id/file', { bodyLimit: ROUTE_LIMIT }, async (req: OfficeReq, reply) => {
      if (!files.on) return reply.code(409).send({ error: FILES_WAIT })
      const body = req.body
      if (!Buffer.isBuffer(body) || body.length === 0) return reply.code(400).send({ error: NO_FILE })
      if (body.length > MAX_FILE_BYTES) return reply.code(413).send({ error: FILE_TOO_BIG })
      const found = fileTypeOf(body.subarray(0, FILE_HEAD_BYTES))
      if ('refused' in found) return reply.code(415).send({ error: found.refused })
      const q = req.query
      const details = documentDetails.safeParse({ id: req.params.id, personId: q.personId, kind: q.kind, title: q.title, expires: q.expires || null })
      if (!details.success) return reply.code(400).send({ error: details.error.issues[0]?.message ?? 'Check the details and try again.' })
      try {
        await officeFile(db, files, details.data, body, found.type, { clientId: q.client, userId: req.user?.id, device: describeDevice(req.headers['user-agent']) })
      } catch (err) {
        if (err instanceof Refused) return reply.code(409).send({ error: err.reason.message })
        if (err instanceof NotKept) return reply.code(502).send({ error: err.message })
        throw err
      }
      onChange()
      return { ok: true }
    })

    scope.get('/api/documents/:id/file', async (req: OfficeReq, reply) => {
      const doc = await getDocument(db, req.params.id)
      if (!doc) return reply.code(404).send({ error: 'That document is no longer there.' })
      const key = await fileKeyOf(db, doc.id)
      if (!key || !doc.file) return reply.code(404).send({ error: "There's no file for this document yet." })
      if (!files.on) return reply.code(409).send({ error: "The file is in the storage bucket, which isn't set up on this server." })
      try {
        return sendFile(reply, await files.read(key), doc.file.type, documentFileName((await getPerson(db, doc.personId))?.name ?? '', doc.title, doc.file.type))
      } catch (err) {
        if (err instanceof FileGone) return reply.code(404).send({ error: err.message })
        if (err instanceof FileLocked) return reply.code(409).send({ error: err.message })
        throw err
      }
    })

    /** The office puts a file on a venue's document (ADR 0032), with its details, as for a person's. */
    scope.post('/api/venue-documents/:id/file', { bodyLimit: ROUTE_LIMIT }, async (req: VenueReq, reply) => {
      if (!files.on) return reply.code(409).send({ error: FILES_WAIT_VENUE })
      const body = req.body
      if (!Buffer.isBuffer(body) || body.length === 0) return reply.code(400).send({ error: NO_FILE })
      if (body.length > MAX_FILE_BYTES) return reply.code(413).send({ error: FILE_TOO_BIG })
      const found = fileTypeOf(body.subarray(0, FILE_HEAD_BYTES))
      if ('refused' in found) return reply.code(415).send({ error: found.refused })
      const q = req.query
      const details = venueDocumentDetails.safeParse({ id: req.params.id, venueId: q.venueId, kind: q.kind, title: q.title, link: q.link || null })
      if (!details.success) return reply.code(400).send({ error: details.error.issues[0]?.message ?? 'Check the details and try again.' })
      try {
        await venueFile(db, files, details.data, body, found.type, { clientId: q.client, userId: req.user?.id, device: describeDevice(req.headers['user-agent']) })
      } catch (err) {
        if (err instanceof Refused) return reply.code(409).send({ error: err.reason.message })
        if (err instanceof NotKept) return reply.code(502).send({ error: err.message })
        throw err
      }
      onChange()
      return { ok: true }
    })

    scope.get('/api/venue-documents/:id/file', async (req: VenueReq, reply) => {
      const doc = await getVenueDocument(db, req.params.id)
      if (!doc) return reply.code(404).send({ error: 'That document is no longer there.' })
      const key = await venueFileKeyOf(db, doc.id)
      if (!key || !doc.file) return reply.code(404).send({ error: "There's no file for this document." })
      if (!files.on) return reply.code(409).send({ error: "The file is in the storage bucket, which isn't set up on this server." })
      try {
        return sendFile(reply, await files.read(key), doc.file.type, documentFileName((await getVenue(db, doc.venueId))?.name ?? '', doc.title, doc.file.type))
      } catch (err) {
        if (err instanceof FileGone) return reply.code(404).send({ error: err.message })
        if (err instanceof FileLocked) return reply.code(409).send({ error: err.message })
        throw err
      }
    })

    const noStore = (reply: FastifyReply) => reply.header('cache-control', 'no-store').header('x-robots-tag', 'noindex')
    /** Back to the page, the message in their documents, and a refused renewal's form open again under its card (o). */
    const backTo = (reply: FastifyReply, token: string, said: Said, renews?: string | null) =>
      reply.redirect(`/f/${encodeURIComponent(token)}?${new URLSearchParams({ m: said, s: 'documents', ...(renews ? { o: renews } : {}) })}#documents`, 303)

    /** Whose link a form is being sent on, found before its body is read. */
    const sender = new WeakMap<FastifyRequest, Person>()

    /**
     * A freelancer sends a document from their link, new or a renewal of
     * one of theirs, for the office to check. A form too big for the route
     * comes back to the page saying so, as any other refusal does.
     */
    scope.post(
      '/f/:token/documents',
      {
        bodyLimit: ROUTE_LIMIT,
        // The link is looked up before the body is read, so a made-up link, or one with nowhere to keep files, never has
        // 10 MB read into the server's memory for it: anyone can post to an address.
        onRequest: async (req: LinkReq, reply) => {
          const person = await personByToken(db, req.params.token)
          if (!person) return reply.code(404).type('text/html').send(renderGone())
          if (!files.on) return backTo(reply, person.linkToken, 'doc-not-on')
          sender.set(req, person)
        },
        errorHandler: (err: FastifyError, req: LinkReq, reply) => {
          if (err.code === 'FST_ERR_CTP_BODY_TOO_LARGE') return backTo(reply, req.params.token, 'doc-too-big')
          throw err
        },
      },
      async (req: LinkReq, reply) => {
        const person = sender.get(req)!
        const back = (said: Said) => backTo(reply, person.linkToken, said)
        let form
        try {
          form = readForm(req.body as Buffer, req.headers['content-type'])
        } catch (err) {
          if (err instanceof NotAForm) return back('try-again')
          throw err
        }
        const renews = form.fields.renews?.trim() || null
        // The page only ever sends one of the app's ids; anything else is no document of theirs.
        if (renews && !/^[\w-]{1,64}$/.test(renews)) return back('doc-not-yours')
        const again = (said: Said) => backTo(reply, person.linkToken, said, renews)
        const file = form.file
        if (!file?.length) return again('doc-no-file')
        if (file.length > MAX_FILE_BYTES) return again('doc-too-big')
        const found = fileTypeOf(file.subarray(0, FILE_HEAD_BYTES))
        if ('refused' in found) return again(found.refused === WEB_FILE ? 'doc-web-page' : 'doc-not-a-file')
        // A renewal is the kind of the one it renews, whatever the form says.
        const kind = DOCUMENT_KINDS.find((k) => k === form.fields.kind) ?? (renews ? 'other' : undefined)
        if (!kind) return back('try-again')
        // Control characters become spaces: the database takes no NUL, and none belongs in a title. Cleaned again once
        // cut to length, which can leave half an emoji at the end (shared/src/plain.ts).
        const title = cleanText((form.fields.title ?? '').replace(/[\u0000-\u001f\u007f]+/g, ' ').trim().slice(0, 100)).trim() || DOCUMENT_TITLES[kind] || 'Document'
        const expires = (form.fields.expires ?? '').trim()
        if (expires && !isDay(expires)) return again('check-the-dates')
        try {
          await linkSend(db, files, person, { kind, title, expires: expires || null, renews }, file, found.type, describeDevice(req.headers['user-agent']))
        } catch (err) {
          if (err instanceof Refused) return back(err.reason.code === 'not-found' ? 'doc-not-yours' : 'try-again')
          if (err instanceof NotKept) return again('doc-not-kept')
          throw err
        }
        onChange()
        return back('doc-sent')
      }
    )

    /** One of their own documents' files; anyone else's is "not found", as one that doesn't exist. */
    scope.get('/f/:token/documents/:id', async (req: LinkReq, reply) => {
      noStore(reply)
      const person = await personByToken(db, req.params.token)
      if (!person) return reply.code(404).type('text/html').send(renderGone())
      const base = `/f/${person.linkToken}`
      const doc = await getDocument(db, req.params.id ?? '')
      const key = doc?.personId === person.id ? await fileKeyOf(db, doc.id) : null
      if (!doc || doc.personId !== person.id || !key || !doc.file) return reply.code(404).type('text/html').send(renderNoFile(base, "There's no file here: it isn't one of yours, or it has gone."))
      if (!files.on) return reply.code(404).type('text/html').send(renderNoFile(base, "Files can't be opened here just now. Ask the office for a copy."))
      try {
        return sendFile(reply, await files.read(key), doc.file.type, documentFileName(person.name, doc.title, doc.file.type))
      } catch (err) {
        if (err instanceof FileGone) return reply.code(404).type('text/html').send(renderNoFile(base, "This file isn't in the storage any more. Send it again from your page."))
        if (err instanceof FileLocked) return reply.code(409).type('text/html').send(renderNoFile(base, "This file can't be opened just now. Ask the office for a copy."))
        throw err
      }
    })
  })
}
