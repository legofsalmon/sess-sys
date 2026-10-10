import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { FILES_WAIT_VENUE, START_FRESH_WORDS, WEB_FILE, type VenueDocument } from '@sh/shared'
import { afterEach, describe, expect, it } from 'vitest'
import { dirStore } from '../src/backup/store.ts'
import { IPHONE, server, staff } from './people.ts'

/**
 * Venues' documents (ADR 0032): the office keeps a venue's tech spec,
 * floor plan and the like on its page, as a link, a file, or both. Files
 * go where people's documents' files go, under the same rules: checked by
 * their first bytes, read only through the server, deleted through the
 * same list. A link is only ever a web address. With no bucket, links
 * still work and a file is refused in plain words.
 */

const folders: string[] = []
afterEach(() => {
  for (const f of folders.splice(0)) rmSync(f, { recursive: true, force: true })
})

const PDF = Buffer.from('%PDF-1.4\n% Made up for a test: not a real floor plan.\n')
const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>')

function filesIn(dir: string): string[] {
  const docs = join(dir, 'documents')
  return existsSync(docs) ? readdirSync(docs) : []
}

/** The office signed in, with the Heritage as a venue, and files kept in a folder as a bucket would keep them (or none). */
async function office(withFiles = true) {
  const dir = mkdtempSync(join(tmpdir(), 'sh-venue-documents-'))
  folders.push(dir)
  const { app, db } = await server(withFiles ? { documentStore: dirStore(dir) } : {})
  const colly = await staff(app, db, 'Colly Hewson', IPHONE, 'phone-c0ffee')
  expect(await colly.send('venue.upsert', { id: 'heritage', name: 'The Heritage', address: 'Killenard, Co. Laois\nR32 AK37', notes: '' })).toMatchObject({ status: 'applied' })
  const upload = (id: string, details: Record<string, string>, data: Buffer, cookies: Record<string, string> | undefined = colly.cookies) =>
    app.inject({
      method: 'POST',
      url: `/api/venue-documents/${id}/file?${new URLSearchParams({ client: 'phonec0ffee', venueId: 'heritage', link: '', ...details })}`,
      headers: { 'content-type': 'application/octet-stream', 'user-agent': IPHONE },
      cookies,
      payload: data,
    })
  const open = (id: string, cookies: Record<string, string> | undefined = colly.cookies) => app.inject({ url: `/api/venue-documents/${id}/file`, cookies })
  const files = async () => {
    await app.documents.tidy()
    return filesIn(dir)
  }
  return { app, db, colly, upload, open, files }
}

describe("a venue's documents", () => {
  it('keeps a link with no file, works offline as a command, and refuses one that is not a web address', async () => {
    // Proves: a link alone saves through the outbox; javascript: and words are refused; a document needs a link or a file; another venue's id isn't written over.
    const { colly } = await office()
    const link = 'https://www.dropbox.com/s/made-up/heritage-tech-spec.pdf'
    expect(await colly.send('venueDocument.save', { id: 'v1', venueId: 'heritage', kind: 'tech-spec', title: 'Tech spec', link })).toMatchObject({ status: 'applied' })
    expect(await colly.record<VenueDocument>('venueDocument', 'v1')).toMatchObject({ venueId: 'heritage', kind: 'tech-spec', title: 'Tech spec', link, file: null })

    for (const bad of ['javascript:alert(1)', 'not a link', 'ftp://example.com/plan.pdf'])
      expect(await colly.send('venueDocument.save', { id: 'v2', venueId: 'heritage', kind: 'other', title: 'Plan', link: bad })).toMatchObject({ status: 'rejected' })
    expect(await colly.send('venueDocument.save', { id: 'v2', venueId: 'heritage', kind: 'other', title: 'Plan', link: null })).toMatchObject({
      status: 'rejected',
      reason: { message: 'Add the link to it, or choose its file.' },
    })
    expect(await colly.send('venueDocument.save', { id: 'v3', venueId: 'nowhere', kind: 'other', title: 'Plan', link })).toMatchObject({ status: 'rejected', reason: { code: 'not-found' } })

    await colly.send('venue.upsert', { id: 'rds', name: 'RDS', address: 'Ballsbridge, Dublin 4', notes: '' })
    expect(await colly.send('venueDocument.save', { id: 'v1', venueId: 'rds', kind: 'other', title: 'Not theirs', link })).toMatchObject({ status: 'rejected', reason: { code: 'conflict' } })

    expect(await colly.send('venueDocument.remove', { id: 'v1' })).toMatchObject({ status: 'applied' })
    expect(await colly.send('venueDocument.remove', { id: 'v1' })).toMatchObject({ status: 'applied' })
    const words = (await colly.history()).entries.map((e) => e.what)
    expect(words).toContain("Saved The Heritage's tech spec, as a link")
    expect(words).toContain("Removed The Heritage's tech spec")
  })

  it('adds one with a file, opens it only for the office, replaces it, and deletes the file with it', async () => {
    // Proves: the file goes in under documents/, opens as a download named for the venue, needs the office's session, is replaced without the old one left behind, keeps its link when details change, and goes when it's removed.
    const { colly, upload, open, files } = await office()
    const plan = { kind: 'floor-plan', title: 'Ballroom floor plan' }
    const added = await upload('f1', plan, PDF)
    expect(added.statusCode).toBe(200)
    const doc = await colly.record<VenueDocument>('venueDocument', 'f1')
    expect(doc).toMatchObject({ venueId: 'heritage', kind: 'floor-plan', link: null, file: { type: 'pdf', bytes: PDF.length } })
    expect(JSON.stringify(doc)).not.toContain('documents/')
    expect(await files()).toHaveLength(1)

    const got = await open('f1')
    expect(got.statusCode).toBe(200)
    expect(got.headers['content-type']).toBe('application/pdf')
    expect(got.headers['content-disposition']).toContain('filename="The Heritage - Ballroom floor plan.pdf"')
    expect(got.headers['content-security-policy']).toBe("default-src 'none'; sandbox; frame-ancestors 'none'")
    expect(got.rawPayload.equals(PDF)).toBe(true)
    expect((await open('f1', {})).statusCode).toBe(401)

    // A file that could run code is refused in words, and nothing is kept.
    const svg = await upload('f2', plan, SVG)
    expect(svg.statusCode).toBe(415)
    expect(svg.json().error).toBe(WEB_FILE)

    expect((await upload('f1', plan, Buffer.concat([PDF, Buffer.from('v2')]))).statusCode).toBe(200)
    expect(await files()).toHaveLength(1)
    // Its details changed with no new file: the file stays, and now a link sits beside it.
    expect(await colly.send('venueDocument.save', { id: 'f1', venueId: 'heritage', kind: 'floor-plan', title: 'Ballroom floor plan', link: 'https://example.com/plan' })).toMatchObject({
      status: 'applied',
    })
    expect(await colly.record<VenueDocument>('venueDocument', 'f1')).toMatchObject({ link: 'https://example.com/plan', file: { type: 'pdf' } })

    expect(await colly.send('venueDocument.remove', { id: 'f1' })).toMatchObject({ status: 'applied' })
    expect(await files()).toHaveLength(0)
    expect((await open('f1')).statusCode).toBe(404)

    const words = (await colly.history()).entries.map((e) => e.what)
    expect(words).toContain("Added The Heritage's Ballroom floor plan, with its file (PDF, 1 KB)")
    expect(words).toContain("Put a new file on The Heritage's Ballroom floor plan (PDF, 1 KB)")
  })

  it('counts its files as known, and starting fresh deletes them', async () => {
    // Proves: a venue's file is no stray in the daily count, and starting fresh puts it on the list so the folder ends empty.
    const { app, colly, upload, files } = await office()
    expect((await upload('f1', { kind: 'power', title: 'Power spec' }, PDF)).statusCode).toBe(200)
    expect(await app.documents.strays()).toBe(0)
    expect((await app.inject({ method: 'POST', url: '/api/data/start-fresh', cookies: colly.cookies, payload: { confirm: START_FRESH_WORDS } })).statusCode).toBe(200)
    expect(await files()).toHaveLength(0)
  })

  it('with no bucket, keeps links and says a file waits, pointing to a link meanwhile', async () => {
    // Proves: on a server with no storage, as the live one is, links work and a file is refused saying to keep a link meanwhile.
    const { colly, upload } = await office(false)
    expect(await colly.send('venueDocument.save', { id: 'v1', venueId: 'heritage', kind: 'access', title: 'Access and load-in', link: 'https://example.com/access' })).toMatchObject({
      status: 'applied',
    })
    const res = await upload('f1', { kind: 'power', title: 'Power spec' }, PDF)
    expect(res.statusCode).toBe(409)
    expect(res.json().error).toBe(FILES_WAIT_VENUE)
  })
})
