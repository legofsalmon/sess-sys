import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { NOT_A_PHOTO, PHOTO_REFUSAL, PHOTOS_WAIT, photoPath, type Person } from '@sh/shared'
import type { FastifyInstance } from 'fastify'
import { afterEach, describe, expect, it } from 'vitest'
import { dirStore } from '../src/backup/store.ts'
import type { Db } from '../src/db.ts'
import { IPHONE, server, staff } from './people.ts'

/**
 * A person's photo on their page (ADR 0065): put up, changed and taken
 * down by the office or the person themselves, kept in the storage as
 * documents' files are, shown to everyone who reads that person's details,
 * and gone from the storage when it's replaced, removed, the person is
 * erased, or combined into someone who has their own.
 */

const folders: string[] = []
afterEach(() => {
  for (const f of folders.splice(0)) rmSync(f, { recursive: true, force: true })
})

const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from('a made-up face')])
const JPEG2 = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from('a newer made-up face')])
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('a made-up face, as a screenshot')])
const PDF = Buffer.from('%PDF-1.4\n% not a face\n')
const HEIC = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypheic'), Buffer.from([0, 0, 0, 0]), Buffer.from('mif1heic'), Buffer.from('an iPhone photo')])

const person = (id: string, name: string, extra: Partial<Person> = {}) => ({
  id,
  name,
  kind: 'staff' as const,
  email: `${id}@sessionhire.com`,
  phone: '+353871234567',
  skills: [],
  dayRateCents: null,
  notes: '',
  ...extra,
})

async function company(withStore = true) {
  const dir = mkdtempSync(join(tmpdir(), 'sh-photos-'))
  folders.push(dir)
  const { app, db } = await server(withStore ? { documentStore: dirStore(dir) } : {})
  const colly = await staff(app, db, 'Colly Hewson', IPHONE, 'phonec0ffee')
  const sean = await staff(app, db, 'Sean Walsh', IPHONE, 'phonebeef')
  for (const p of [person('colly', 'Colly Hewson'), person('sean', 'Seán Walsh'), person('dara', 'Dara Quinn', { kind: 'freelancer' })])
    expect(await colly.send('person.upsert', p)).toMatchObject({ status: 'applied' })
  const photo = (id: string, data: Buffer, cookies = colly.cookies) =>
    app.inject({ method: 'POST', url: `/api/people/${id}/photo?client=phonec0ffee`, headers: { 'content-type': 'application/octet-stream', 'user-agent': IPHONE }, cookies, payload: data })
  const remove = (id: string, cookies = colly.cookies) => app.inject({ method: 'DELETE', url: `/api/people/${id}/photo`, cookies })
  const show = (id: string, at: string, cookies = colly.cookies) => app.inject({ url: photoPath(id, at), cookies })
  /** The files left in the storage once what's due is deleted. */
  const files = async () => {
    await app.documents.tidy()
    const docs = join(dir, 'documents')
    return existsSync(docs) ? readdirSync(docs) : []
  }
  return { app, db, colly, sean, photo, remove, show, files }
}

const photoAt = async (app: FastifyInstance, cookies: Record<string, string>, id: string): Promise<string | undefined> => {
  const res = await app.inject({ url: '/api/sync/pull?after=0', cookies })
  const copies = res.json().changes.filter((c: { entity: string; id: string }) => c.entity === 'person' && c.id === id)
  return copies[copies.length - 1]?.data?.photo?.at
}
const keyOf = async (db: Db, id: string) => (await db.query<{ k: string | null }>('SELECT photo_key AS k FROM people WHERE id = $1', [id])).rows[0]?.k ?? null

describe("a person's photo", () => {
  it('is put up, shown, replaced and taken down by the office, leaving nothing behind in the storage', async () => {
    // Proves: devices hear when it was put up, never where it's kept; it's sent back as the image it is, to be shown and kept by the browser; a new one deletes the old; taking it down deletes it; the history says each in words.
    const { app, colly, photo, remove, show, files } = await company()
    expect((await photo('dara', JPEG)).statusCode).toBe(200)
    const at = (await photoAt(app, colly.cookies, 'dara'))!
    expect(at).toBeTruthy()
    const seen = await show('dara', at)
    expect(seen.statusCode).toBe(200)
    expect(seen.headers['content-type']).toBe('image/jpeg')
    expect(seen.headers['content-disposition']).toBe('inline')
    expect(seen.headers['x-content-type-options']).toBe('nosniff')
    expect(seen.headers['cache-control']).toContain('immutable')
    expect(seen.rawPayload.equals(JPEG)).toBe(true)
    expect(JSON.stringify((await app.inject({ url: '/api/sync/pull?after=0', cookies: colly.cookies })).json())).not.toContain('documents/')
    expect(await files()).toHaveLength(1)

    expect((await photo('dara', PNG)).statusCode).toBe(200)
    const again = (await photoAt(app, colly.cookies, 'dara'))!
    expect(again).not.toBe(at)
    expect((await show('dara', again)).headers['content-type']).toBe('image/png')
    expect(await files()).toHaveLength(1)

    expect((await remove('dara')).statusCode).toBe(200)
    expect(await photoAt(app, colly.cookies, 'dara')).toBeUndefined()
    expect((await show('dara', again)).statusCode).toBe(404)
    expect(await files()).toHaveLength(0)

    const said = (await colly.history()).entries.map((e) => e.what)
    expect(said).toEqual(expect.arrayContaining(["Put a photo on Dara Quinn's page", "Put a new photo on Dara Quinn's page", "Took the photo off Dara Quinn's page"]))
  })

  it('takes only a photo a browser can show, and says so when there is nowhere to keep it', async () => {
    const { photo, files } = await company()
    for (const data of [PDF, HEIC]) {
      const res = await photo('dara', data)
      expect(res.statusCode).toBe(415)
      expect(res.json().error).toBe(NOT_A_PHOTO)
    }
    expect((await photo('dara', Buffer.alloc(0))).statusCode).toBe(400)
    expect(await files()).toHaveLength(0)

    const none = await company(false)
    const res = await none.photo('dara', JPEG)
    expect(res.statusCode).toBe(409)
    expect(res.json().error).toBe(PHOTOS_WAIT)
  })

  it('is theirs to change and the office’s, and not shown to a freelancer signed in, once roles are on', async () => {
    // Proves: staff crew put up their own and nobody else's; a freelancer signed in reads only their own, as with phone numbers (ADR 0062).
    const { app, colly, sean, photo, remove, show } = await company()
    expect(await colly.send('person.role', { id: 'colly', role: 'director' })).toMatchObject({ status: 'applied' })
    expect((await photo('dara', JPEG)).statusCode).toBe(200)

    expect((await photo('sean', JPEG2, sean.cookies)).statusCode).toBe(200)
    const theirs = await photo('dara', JPEG2, sean.cookies)
    expect(theirs.statusCode).toBe(403)
    expect(theirs.json().error).toBe(PHOTO_REFUSAL)
    expect((await remove('dara', sean.cookies)).statusCode).toBe(403)
    // Staff crew see others' faces, as they see their phone numbers.
    const daraAt = (await photoAt(app, sean.cookies, 'dara'))!
    expect((await show('dara', daraAt, sean.cookies)).statusCode).toBe(200)

    expect(await colly.send('person.role', { id: 'sean', role: 'freelancer' })).toMatchObject({ status: 'applied' })
    expect(await photoAt(app, sean.cookies, 'dara')).toBeUndefined()
    expect((await show('dara', daraAt, sean.cookies)).statusCode).toBe(404)
    expect(await photoAt(app, sean.cookies, 'sean')).toBeTruthy()
  })

  it('goes from the storage when they are erased, and from every copy devices are sent', async () => {
    const { app, db, colly, photo, files } = await company()
    expect((await photo('dara', JPEG)).statusCode).toBe(200)
    expect(await colly.send('person.archive', { id: 'dara', archived: true })).toMatchObject({ status: 'applied' })
    expect(await colly.send('person.erase', { id: 'dara' })).toMatchObject({ status: 'applied' })
    expect(await keyOf(db, 'dara')).toBeNull()
    expect(await files()).toHaveLength(0)
    const copies = (await app.inject({ url: '/api/sync/pull?after=0', cookies: colly.cookies })).json().changes.filter((c: { entity: string; id: string }) => c.entity === 'person' && c.id === 'dara')
    expect(copies.every((c: { data: Person | null }) => !c.data?.photo)).toBe(true)
    // Nothing can be put on an erased person's page again.
    expect((await photo('dara', JPEG)).statusCode).toBe(409)
    expect(await files()).toHaveLength(0)
  })

  it('stays with the one kept when people brought in twice are combined', async () => {
    // Proves: the one kept takes the other's photo when they have none, keeps their own when they have one, and the other's file goes.
    const { app, db, colly, photo, files } = await company()
    expect(await colly.send('person.upsert', person('dara2', 'Dara Quinn', { kind: 'freelancer', email: 'dara.quinn@example.com' }))).toMatchObject({ status: 'applied' })
    expect((await photo('dara2', JPEG)).statusCode).toBe(200)
    const key = await keyOf(db, 'dara2')
    expect(await colly.send('person.merge', { id: 'dara', from: ['dara2'] })).toMatchObject({ status: 'applied' })
    expect(await keyOf(db, 'dara')).toBe(key)
    expect(await photoAt(app, colly.cookies, 'dara')).toBeTruthy()
    expect(await files()).toHaveLength(1)

    expect(await colly.send('person.upsert', person('dara3', 'Dara Quinn', { kind: 'freelancer', email: 'dq@example.com' }))).toMatchObject({ status: 'applied' })
    expect((await photo('dara3', JPEG2)).statusCode).toBe(200)
    expect(await colly.send('person.merge', { id: 'dara', from: ['dara3'] })).toMatchObject({ status: 'applied' })
    expect(await keyOf(db, 'dara')).toBe(key)
    expect(await files()).toHaveLength(1)
  })
})
