import { FILE_HEAD_BYTES, FILE_TOO_BIG, fileTypeOf, isPhotoType, MAX_FILE_BYTES, mayChangePhoto, NO_FILE, NOT_A_PHOTO, PHOTO_ACTIONS, PHOTO_REFUSAL, PHOTOS_WAIT, photoMime, readsPhotoOf, type PhotoType } from '@sh/shared'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { getPerson } from '../crew/store.ts'
import type { Db, Queryable } from '../db.ts'
import { describeDevice } from '../devices.ts'
import { emit, Refused, serverChange } from '../kernel.ts'
import { readingOf } from '../reading.ts'
import { recordArgs, withFile, type Who } from './actions.ts'
import { FileGone, FileLocked, NotKept, type DocumentFiles } from './files.ts'
import { claimFile, queueFile } from './store.ts'

/**
 * A person's photo on their page (ADR 0063), kept as documents' files are
 * (ADR 0029): sent by the device as the request's whole body, already made
 * a small square JPEG there, and checked again here by its first bytes.
 * Put up and taken down by the person themselves or a role that changes
 * crew; read by everyone signed in who reads that person's details. The
 * photo is sent back to be shown, not downloaded, and its address changes
 * with each new one, so a browser keeps it for as long as it likes.
 */

const ROUTE_LIMIT = MAX_FILE_BYTES + 256 * 1024

type Req = FastifyRequest<{ Params: { id: string }; Querystring: { client?: string } }>

/** Where a person's photo is kept and what it is, for the server alone. */
async function photoOf(q: Queryable, id: string): Promise<{ key: string; type: PhotoType } | undefined> {
  const { rows } = await q.query<{ photo_key: string | null; photo_type: PhotoType | null }>('SELECT photo_key, photo_type FROM people WHERE id = $1', [id])
  return rows[0]?.photo_key ? { key: rows[0].photo_key, type: rows[0].photo_type! } : undefined
}

/** The person whose photo is being changed, there and not erased. */
async function photoOwner(q: Queryable, id: string) {
  const person = await getPerson(q, id)
  if (!person) throw new Refused({ code: 'not-found', message: "That person isn't in the app any more." })
  const { rows } = await q.query('SELECT 1 FROM erasures WHERE person_id = $1', [id])
  if (rows.length) throw new Refused({ code: 'conflict', message: 'Their details were erased on request, so no photo can be put on their page.' })
  return person
}

/** A photo put on a person's page, in place of the one they had. */
export function putPhoto(db: Db, files: DocumentFiles, id: string, data: Buffer, type: PhotoType, who: Who) {
  const args = { id, type, bytes: data.length }
  return withFile(files, data, (key) =>
    serverChange(db, { name: PHOTO_ACTIONS.put, args, ...who }, async (ctx) => {
      await photoOwner(ctx.tx, id)
      const old = await photoOf(ctx.tx, id)
      await claimFile(ctx.tx, key)
      await ctx.tx.query('UPDATE people SET photo_key = $2, photo_type = $3, photo_bytes = $4, photo_at = now() WHERE id = $1', [id, key, type, data.length])
      if (old) await queueFile(ctx.tx, old.key, true)
      await emit(ctx, 'person', id, await getPerson(ctx.tx, id))
      await recordArgs(ctx, { ...args, replaced: !!old })
    })
  )
}

/** A person's photo taken down: their initials again, and the file on the list of files to delete. */
export function removePhoto(db: Db, id: string, who: Who) {
  return serverChange(db, { name: PHOTO_ACTIONS.remove, args: { id }, ...who }, async (ctx) => {
    if (!(await getPerson(ctx.tx, id))) throw new Refused({ code: 'not-found', message: "That person isn't in the app any more." })
    const old = await photoOf(ctx.tx, id)
    if (!old) return
    await queueFile(ctx.tx, old.key, true)
    await ctx.tx.query('UPDATE people SET photo_key = NULL, photo_type = NULL, photo_bytes = NULL, photo_at = NULL WHERE id = $1', [id])
    await emit(ctx, 'person', id, await getPerson(ctx.tx, id))
  })
}

export function registerPhotoRoutes(app: FastifyInstance, { db, files, onChange }: { db: Db; files: DocumentFiles; onChange: () => void }) {
  void app.register(async (scope) => {
    scope.addContentTypeParser('application/octet-stream', { parseAs: 'buffer', bodyLimit: ROUTE_LIMIT }, (_req, body, done) => done(null, body))

    const who = (req: Req): Who => ({ clientId: req.query.client, userId: req.user?.id, device: describeDevice(req.headers['user-agent']) })
    const allowed = (req: Req) => mayChangePhoto(req.role, req.reader?.personId, req.params.id)

    scope.post('/api/people/:id/photo', { bodyLimit: ROUTE_LIMIT }, async (req: Req, reply) => {
      if (!allowed(req)) return reply.code(403).send({ error: PHOTO_REFUSAL })
      if (!files.on) return reply.code(409).send({ error: PHOTOS_WAIT })
      const body = req.body
      if (!Buffer.isBuffer(body) || body.length === 0) return reply.code(400).send({ error: NO_FILE })
      if (body.length > MAX_FILE_BYTES) return reply.code(413).send({ error: FILE_TOO_BIG })
      const found = fileTypeOf(body.subarray(0, FILE_HEAD_BYTES))
      if ('refused' in found || !isPhotoType(found.type)) return reply.code(415).send({ error: NOT_A_PHOTO })
      try {
        await putPhoto(db, files, req.params.id, body, found.type, who(req))
      } catch (err) {
        if (err instanceof Refused) return reply.code(409).send({ error: err.reason.message })
        if (err instanceof NotKept) return reply.code(502).send({ error: err.message })
        throw err
      }
      onChange()
      return { ok: true }
    })

    scope.delete('/api/people/:id/photo', async (req: Req, reply) => {
      if (!allowed(req)) return reply.code(403).send({ error: PHOTO_REFUSAL })
      try {
        await removePhoto(db, req.params.id, who(req))
      } catch (err) {
        if (err instanceof Refused) return reply.code(409).send({ error: err.reason.message })
        throw err
      }
      onChange()
      return { ok: true }
    })

    scope.get('/api/people/:id/photo', async (req: Req, reply: FastifyReply) => {
      const notHere = () => reply.code(404).header('cache-control', 'no-store').send({ error: 'There is no photo here.' })
      if (!readsPhotoOf(await readingOf(db.reads, req.role, req.reader ?? {}), req.params.id)) return notHere()
      const photo = await photoOf(db.reads, req.params.id)
      if (!photo || !files.on) return notHere()
      let data: Buffer
      try {
        data = await files.read(photo.key)
      } catch (err) {
        if (err instanceof FileGone || err instanceof FileLocked) return notHere()
        throw err
      }
      // Shown in the page, as an image only: nothing a browser could guess from, and nothing it could run.
      return reply
        .type(photoMime(photo.type))
        .header('content-disposition', 'inline')
        .header('x-content-type-options', 'nosniff')
        .header('content-security-policy', "default-src 'none'; sandbox; frame-ancestors 'none'")
        .header('cache-control', 'private, max-age=31536000, immutable')
        .send(data)
    })
  })
}
