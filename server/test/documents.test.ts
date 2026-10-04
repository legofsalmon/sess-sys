import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import { connect, type AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { addDays, dayLabel, FILE_TOO_BIG, FILES_WAIT, irishToday, MAX_FILE_BYTES, START_FRESH_WORDS, WEB_FILE, WRONG_FILE, type Document, type HistoryPage, type Person } from '@sh/shared'
import type { FastifyInstance } from 'fastify'
import { afterEach, describe, expect, it } from 'vitest'
import type { AppOptions } from '../src/app.ts'
import { dirStore, type BackupStore } from '../src/backup/store.ts'
import type { Db } from '../src/db.ts'
import { DocumentFiles, FILE_GONE, FileLocked } from '../src/documents/files.ts'
import { ANDROID, flashOf, IPHONE, server, staff, typedOnly } from './people.ts'

/**
 * People's documents (ADR 0029): the office adds, opens, replaces and
 * removes them, files kept in a folder as a bucket would keep them; a
 * file is taken by its first bytes and up to 10 MB; only the office's
 * session or the person's own link reads one; a freelancer sends a
 * renewed card from their link and checking it moves the certificate's
 * date; with no bucket, details still work and a file is refused in plain
 * words; erasing a person takes their documents everywhere and their files
 * from the storage; a file the storage won't delete stays on the list
 * until it goes; and with BACKUP_KEY the files are encrypted.
 */

const folders: string[] = []
afterEach(() => {
  for (const f of folders.splice(0)) rmSync(f, { recursive: true, force: true })
})
function folder() {
  const f = mkdtempSync(join(tmpdir(), 'sh-documents-'))
  folders.push(f)
  return f
}

/** Made-up files by their first bytes, as phones and scanners write them. */
const PDF = Buffer.from('%PDF-1.4\n% Made up for a test: not a real document.\n')
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from('a made-up photo of a card')])
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('a made-up screenshot')])
const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.from([0x24, 0, 0, 0]), Buffer.from('WEBPVP8 a made-up photo')])
const HEIC = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypheic'), Buffer.from([0, 0, 0, 0]), Buffer.from('mif1heic'), Buffer.from('a made-up iPhone photo')])
const SVG = Buffer.from('<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>')
const HTML = Buffer.from('﻿  <!doctype html><html><body><script>alert(1)</script></body></html>')

const TODAY = irishToday()
const day = (n: number) => addDays(TODAY, n)
const fullDay = (d: string) => `${dayLabel(d)} ${d.slice(0, 4)}`

/** Every file under documents/ in the folder. */
function filesIn(dir: string): string[] {
  const docs = join(dir, 'documents')
  return existsSync(docs) ? readdirSync(docs).map((f) => join(docs, f)) : []
}

/** The office signed in, with Pádraig (an IPAF card held, running out in 20 days) and Dara on the crew list. */
async function office(more: Partial<AppOptions> = {}) {
  const dir = folder()
  const { app, db } = await server({ documentStore: dirStore(dir), ...more })
  const colly = await staff(app, db, 'Colly Hewson', IPHONE, 'phone-c0ffee')
  const person = (id: string, name: string, certificates: Person['certificates'] = {}) =>
    colly.send('person.upsert', { id, name, kind: 'freelancer', email: `${id}@example.com`, phone: null, skills: ['Rigger'], dayRateCents: 29000, notes: '', certificates })
  expect(await person('padraig', 'Pádraig Kenny', { ipaf: { held: true, expires: day(20), note: '3a, 3b' } })).toMatchObject({ status: 'applied' })
  expect(await person('dara', 'Dara Quinn')).toMatchObject({ status: 'applied' })
  const token = async (id: string) => (await db.query<{ t: string }>('SELECT link_token AS t FROM people WHERE id = $1', [id])).rows[0]!.t
  /** A file put on a document from the person's card, as the app sends it: the file as the body, the details in the address. */
  const upload = (id: string, details: { personId: string; kind: string; title: string; expires?: string }, data: Buffer, cookies: Record<string, string> | null = colly.cookies) =>
    app.inject({
      method: 'POST',
      url: `/api/documents/${id}/file?${new URLSearchParams({ client: 'phonec0ffee', expires: '', ...details })}`,
      headers: { 'content-type': 'application/octet-stream', 'user-agent': IPHONE },
      cookies: cookies ?? undefined,
      payload: data,
    })
  /** Signed in as the office, or with no session at all (null). */
  const open = (id: string, cookies: Record<string, string> | null = colly.cookies) => app.inject({ url: `/api/documents/${id}/file`, cookies: cookies ?? undefined })
  /** Waits for the files no document has any more to go, as the server deletes them straight after each change. */
  const files = async () => {
    await app.documents.tidy()
    return filesIn(dir)
  }
  return { app, db, colly, dir, token, upload, open, files }
}

/** A form with a file, as the link page's no-script form posts it from a phone. */
function form(fields: Record<string, string>, file?: Buffer, name = 'IMG_0412.HEIC') {
  const boundary = '----WebKitFormBoundaryShDocs0029'
  const parts: Buffer[] = []
  for (const [k, v] of Object.entries(fields)) parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`))
  parts.push(
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${name}"\r\nContent-Type: application/octet-stream\r\n\r\n`),
    file ?? Buffer.alloc(0),
    Buffer.from(`\r\n--${boundary}--\r\n`)
  )
  return { payload: Buffer.concat(parts), headers: { 'content-type': `multipart/form-data; boundary=${boundary}`, 'user-agent': ANDROID } }
}

/** Send from a link page, and read the message the page it lands on shows. */
async function fromLink(app: FastifyInstance, token: string, fields: Record<string, string>, file?: Buffer, name?: string) {
  const res = await app.inject({ method: 'POST', url: `/f/${token}/documents`, ...form(fields, file, name) })
  expect(res.statusCode).toBe(303)
  const to = new URL(res.headers.location as string, 'http://x')
  expect(to.hash).toBe('#documents')
  const page = (await app.inject({ url: to.pathname + to.search })).body
  return { ...flashOf(page), page }
}

const THANKS = "Thanks, it's gone to the office. They'll check it, and it's on your list meanwhile."

async function documentRows(db: Db) {
  return (await db.query<{ id: string; person_id: string; file_key: string | null }>('SELECT id, person_id, file_key FROM documents ORDER BY id')).rows
}

describe("the office's documents, in a folder as a bucket would keep them", () => {
  it('adds one with a file, opens it, replaces the file and removes it, keeping only what a document has', async () => {
    // Proves: the file goes in under documents/, opens as a download of its own type with nosniff, is replaced without the old one left behind, and goes with its document, each step in the history in words.
    const { colly, upload, open, files } = await office()
    const insurance = { personId: 'dara', kind: 'insurance', title: 'Public liability insurance', expires: day(18) }
    const added = await upload('d1', insurance, PDF)
    expect(added.statusCode).toBe(200)
    const doc = await colly.record<Document>('document', 'd1')
    expect(doc).toMatchObject({ personId: 'dara', kind: 'insurance', expires: day(18), file: { type: 'pdf', bytes: PDF.length }, sentVia: 'office', renews: null })
    expect(doc.checkedAt).not.toBeNull()
    // Devices never hear where a file is kept.
    expect(JSON.stringify(doc)).not.toContain('documents/')
    expect(await files()).toHaveLength(1)

    const got = await open('d1')
    expect(got.statusCode).toBe(200)
    expect(got.headers['content-type']).toBe('application/pdf')
    expect(got.headers['content-disposition']).toBe(`attachment; filename="Dara Quinn - Public liability insurance.pdf"; filename*=UTF-8''Dara%20Quinn%20-%20Public%20liability%20insurance.pdf`)
    expect(got.headers['x-content-type-options']).toBe('nosniff')
    // Shown by mistake, it could load and run nothing: a PDF can carry a web page after its first bytes.
    expect(got.headers['content-security-policy']).toBe("default-src 'none'; sandbox; frame-ancestors 'none'")
    expect(got.headers['cache-control']).toBe('no-store')
    expect(got.rawPayload.equals(PDF)).toBe(true)

    expect((await upload('d1', insurance, JPEG)).statusCode).toBe(200)
    expect(await colly.record<Document>('document', 'd1')).toMatchObject({ file: { type: 'jpeg', bytes: JPEG.length } })
    const left = await files()
    expect(left).toHaveLength(1)
    expect(readFileSync(left[0]!).equals(JPEG)).toBe(true)
    const again = await open('d1')
    expect(again.headers['content-type']).toBe('image/jpeg')
    expect(again.rawPayload.equals(JPEG)).toBe(true)

    expect(await colly.send('document.remove', { id: 'd1' })).toMatchObject({ status: 'applied' })
    expect(await files()).toHaveLength(0)
    expect((await open('d1')).statusCode).toBe(404)
    // Removed twice, from two devices: the second finds nothing to do.
    expect(await colly.send('document.remove', { id: 'd1' })).toMatchObject({ status: 'applied' })

    const words = (await colly.history()).entries.map((e) => e.what)
    expect(words).toContain(`Added Dara Quinn's public liability insurance, with its file (PDF, 1 KB)`)
    expect(words).toContain(`Put a new file on Dara Quinn's public liability insurance (JPEG, 1 KB)`)
    expect(words).toContain(`Removed Dara Quinn's public liability insurance`)
  })

  it("sets a certificate from its card, so the certificate holds the one date, and refuses someone else's or someone archived", async () => {
    // Proves: saving an IPAF card sets Pádraig's IPAF to held with the card's day, his note kept, and the card keeps no day of its own; an id that's Dara's isn't written over; an archived person takes no new documents.
    const { colly } = await office()
    expect(await colly.send('document.save', { id: 'c1', personId: 'padraig', kind: 'ipaf', title: 'IPAF card', expires: day(400) })).toMatchObject({ status: 'applied' })
    expect((await colly.record<Person>('person', 'padraig')).certificates.ipaf).toEqual({ held: true, expires: day(400), note: '3a, 3b' })
    expect((await colly.record<Document>('document', 'c1')).expires).toBeNull()
    expect((await colly.history()).entries[0]!.what).toBe(`Saved Pádraig Kenny's IPAF card, with their IPAF running out on ${fullDay(day(400))}`)

    expect(await colly.send('document.save', { id: 'c1', personId: 'dara', kind: 'other', title: 'Not theirs', expires: null })).toMatchObject({
      status: 'rejected',
      reason: { message: "That document is someone else's." },
    })
    expect(await colly.send('person.archive', { id: 'dara', archived: true })).toMatchObject({ status: 'applied' })
    expect(await colly.send('document.save', { id: 'd9', personId: 'dara', kind: 'insurance', title: 'Public liability insurance', expires: null })).toMatchObject({
      status: 'rejected',
      reason: { message: 'Dara Quinn has been archived. Bring them back on the Crew tab to add or change their documents.' },
    })
  })
})

describe('what a file may be', () => {
  it('takes a PDF and photos by their first bytes, whatever the name, and turns away SVG, HTML and anything else in words', async () => {
    // Proves: PDF, JPEG, PNG, WebP and an iPhone's HEIC are each kept as what their bytes say; an SVG, a web page (even sent as a photo from the link) and anything else are refused, and nothing of theirs is kept.
    const { app, colly, token, upload, files } = await office()
    const details = (title: string) => ({ personId: 'dara', kind: 'other', title })
    for (const [id, data, type] of [['pdf', PDF, 'pdf'], ['jpeg', JPEG, 'jpeg'], ['png', PNG, 'png'], ['webp', WEBP, 'webp'], ['heic', HEIC, 'heic']] as const) {
      expect((await upload(id, details(id), data)).statusCode, id).toBe(200)
      expect((await colly.record<Document>('document', id)).file?.type).toBe(type)
    }
    for (const [data, why] of [[SVG, WEB_FILE], [HTML, WEB_FILE], [Buffer.from('MZ\x90\x00 not a document'), WRONG_FILE]] as const) {
      const res = await upload('bad', details('Bad'), data)
      expect(res.statusCode).toBe(415)
      expect(res.json().error).toBe(why)
    }
    const html = await fromLink(app, await token('dara'), { kind: 'insurance', title: '', expires: '' }, HTML, 'insurance.jpg')
    expect(html).toMatchObject({ ok: false, message: WEB_FILE })
    const svg = await fromLink(app, await token('dara'), { kind: 'insurance', title: '', expires: '' }, SVG, 'card.svg')
    expect(svg).toMatchObject({ ok: false, message: WEB_FILE })
    expect(await files()).toHaveLength(5)
  })

  it('is up to 10 MB, on a route of its own above the 5 MB the rest of the server takes', async () => {
    // Proves: a file of exactly 10 MB is kept; a byte more is refused in words from the app and from the link, and far more is refused before it's read, the link page still saying why.
    const { app, token, upload, files } = await office()
    const sized = (bytes: number) => Buffer.concat([PDF, Buffer.alloc(bytes - PDF.length)])
    const details = { personId: 'dara', kind: 'other', title: 'Big scan' }
    expect((await upload('big', details, sized(MAX_FILE_BYTES))).statusCode).toBe(200)
    const over = await upload('over', details, sized(MAX_FILE_BYTES + 1))
    expect(over.statusCode).toBe(413)
    expect(over.json().error).toBe(FILE_TOO_BIG)
    expect((await upload('far', details, sized(12 * 1024 * 1024))).statusCode).toBe(413)
    const dara = await token('dara')
    expect(await fromLink(app, dara, { kind: 'other', title: 'Big scan', expires: '' }, sized(MAX_FILE_BYTES + 1))).toMatchObject({ ok: false, message: FILE_TOO_BIG })
    expect(await fromLink(app, dara, { kind: 'other', title: 'Big scan', expires: '' }, sized(12 * 1024 * 1024))).toMatchObject({ ok: false, message: FILE_TOO_BIG })
    expect(await files()).toHaveLength(1)
  })
})

describe('who can read them', () => {
  it("needs the office's session or the person's own link; another freelancer's link finds nothing", async () => {
    // Proves: with sign-in on, the office's routes are refused without a session; Pádraig's link opens his file as a download; Dara's link can neither open it nor renew it; a made-up link finds nothing; his own download lists the details only.
    const { app, upload, open, token, files } = await office()
    expect((await upload('p1', { personId: 'padraig', kind: 'ipaf', title: 'IPAF card', expires: day(20) }, JPEG)).statusCode).toBe(200)
    expect((await open('p1', null)).statusCode).toBe(401)
    expect((await upload('p2', { personId: 'padraig', kind: 'other', title: 'Sneaked in' }, PDF, null)).statusCode).toBe(401)

    const padraig = await token('padraig')
    const mine = await app.inject({ url: `/f/${padraig}/documents/p1` })
    expect(mine.statusCode).toBe(200)
    expect(mine.headers['content-disposition']).toMatch(/^attachment; filename="Padraig Kenny - IPAF card\.jpg"; filename\*=UTF-8''P%C3%A1draig%20Kenny%20-%20IPAF%20card\.jpg$/)
    expect(mine.headers['x-content-type-options']).toBe('nosniff')
    expect(mine.headers['content-security-policy']).toBe("default-src 'none'; sandbox; frame-ancestors 'none'")
    expect(mine.rawPayload.equals(JPEG)).toBe(true)

    const dara = await token('dara')
    const theirs = await app.inject({ url: `/f/${dara}/documents/p1` })
    expect(theirs.statusCode).toBe(404)
    expect(theirs.body).toContain('There&#39;s no file here: it isn&#39;t one of yours, or it has gone.')
    expect(theirs.rawPayload.includes(JPEG)).toBe(false)
    expect(await fromLink(app, dara, { renews: 'p1', expires: day(400) }, JPEG)).toMatchObject({ ok: false, message: "That document isn't one of yours." })
    expect((await app.inject({ url: `/f/not-a-real-link-at-all/documents/p1` })).statusCode).toBe(404)

    const data = (await app.inject({ url: `/f/${padraig}/data.json` })).json()
    expect(data.documents).toEqual([expect.objectContaining({ id: 'p1', title: 'IPAF card', file: expect.objectContaining({ type: 'jpeg' }) })])
    expect(JSON.stringify(data)).not.toContain('documents/')
    expect((await app.inject({ url: `/f/${dara}/data.json` })).json().documents).toEqual([])
    expect(await files()).toHaveLength(1)
  })

  it('opens a file whose name, cut to length, would end in half an emoji', async () => {
    // Proves: the download's name is cut at whole characters, so a long name and a title with an emoji where the cut falls still open from the person's card and from their link, rather than failing on the server.
    const { app, colly, upload, open, token } = await office()
    const name = 'Siobhán Ní Mhaoldomhnaigh-Kelly'
    const send = await colly.send('person.upsert', { id: 'siobhan', name, kind: 'freelancer', email: null, phone: null, skills: [], dayRateCents: null, notes: '' })
    expect(send).toMatchObject({ status: 'applied' })
    // "Name - title" reaches 120 in the middle of the clapperboard, which is two of JavaScript's characters.
    const title = `${'Insurance schedule '.repeat(5).slice(0, 120 - name.length - 4)}\u{1F3AC} scan`
    expect((await upload('s1', { personId: 'siobhan', kind: 'other', title }, PDF)).statusCode).toBe(200)
    const got = await open('s1')
    expect(got.statusCode).toBe(200)
    expect(got.headers['content-disposition']).toMatch(/filename\*=UTF-8''Siobh%C3%A1n%20N%C3%AD%20Mhaoldomhnaigh-Kelly%20-%20Insurance%20schedule%20.*\.pdf$/)
    expect((await app.inject({ url: `/f/${await token('siobhan')}/documents/s1` })).statusCode).toBe(200)
  })
})

describe('an address anyone can post to', () => {
  it('turns a link that does not exist away before reading what is sent to it', async () => {
    // Proves: a form posted to a made-up link, saying it holds 10 MB but sending none of it, is answered "not found" at once, so nobody without a link can have the server hold 10 MB in memory for them.
    const { app } = await office()
    await app.listen({ port: 0, host: '127.0.0.1' })
    const { port } = app.server.address() as AddressInfo
    const firstLine = await new Promise<string>((resolve) => {
      let got = ''
      const socket = connect(port, '127.0.0.1', () =>
        socket.write(`POST /f/not-a-real-link-at-all/documents HTTP/1.1\r\nHost: x\r\nContent-Type: multipart/form-data; boundary=b\r\nContent-Length: ${MAX_FILE_BYTES}\r\n\r\n`)
      )
      const done = () => {
        socket.destroy()
        resolve(got.split('\r\n')[0]!)
      }
      socket.on('data', (d) => {
        got += d.toString('latin1')
        if (got.includes('\r\n')) done()
      })
      socket.on('error', done)
      // Long enough for an answer; without one, the server is waiting for the body.
      setTimeout(done, 2000)
    })
    expect(firstLine).toBe('HTTP/1.1 404 Not Found')
  })
})

describe("from the freelancer's link", () => {
  it("waits for the office, and checking it moves the certificate's date and takes the old card's place", async () => {
    // Proves: Pádraig sends a renewed IPAF card from his link with no script (one turned down opens again under its card); it waits unchecked with the day he typed, his certificate unchanged, in the history as his; checking it sets his IPAF to that day and removes the old card and its file.
    const { app, db, colly, upload, token, files } = await office()
    expect((await upload('p1', { personId: 'padraig', kind: 'ipaf', title: 'IPAF card', expires: day(20) }, JPEG)).statusCode).toBe(200)
    const padraig = await token('padraig')
    const page = (await app.inject({ url: `/f/${padraig}` })).body
    expect(page).toContain('<h2>Your documents</h2>')
    expect(page).toContain(`Runs out on ${fullDay(day(20))}`)
    expect(page).toContain('Runs out soon')
    expect(page).toContain('Send a new one')
    expect(page).toContain('enctype="multipart/form-data"')

    // A renewal turned down opens again under its card, saying why, and keeps nothing.
    const refused = await fromLink(app, padraig, { renews: 'p1', expires: day(385) }, SVG, 'card.svg')
    expect(refused).toMatchObject({ ok: false, message: WEB_FILE })
    expect(refused.page).toContain('<details open><summary>Send a new one</summary>')
    expect(refused.page).toContain('<details class="send-doc"><summary>')
    const sent = await fromLink(app, padraig, { renews: 'p1', expires: day(385) }, HEIC)
    expect(sent).toMatchObject({ ok: true, message: THANKS })
    expect(sent.page).toContain('With the office to check')
    const fresh = (await documentRows(db)).find((d) => d.id !== 'p1')!
    expect(await colly.record<Document>('document', fresh.id)).toMatchObject({ personId: 'padraig', kind: 'ipaf', title: 'IPAF card', expires: day(385), sentVia: 'link', checkedAt: null, renews: 'p1', file: { type: 'heic' } })
    expect((await colly.record<Person>('person', 'padraig')).certificates.ipaf?.expires).toBe(day(20))
    const theirs = (await colly.history()).entries[0]!
    expect(theirs).toMatchObject({ who: { kind: 'link', name: 'Pádraig Kenny' }, what: `Pádraig Kenny sent a renewed IPAF card, running out ${fullDay(day(385))} (HEIC, 1 KB)` })

    expect(await colly.send('document.check', { id: fresh.id, expires: day(386) })).toMatchObject({ status: 'applied' })
    expect((await colly.record<Person>('person', 'padraig')).certificates.ipaf).toEqual({ held: true, expires: day(386), note: '3a, 3b' })
    expect(await colly.record<Document>('document', fresh.id)).toMatchObject({ expires: null, checkedAt: expect.any(String) })
    expect((await documentRows(db)).map((d) => d.id)).toEqual([fresh.id])
    expect(await files()).toHaveLength(1)
    expect((await colly.history()).entries[0]!.what).toBe(`Checked Pádraig Kenny's IPAF card, in place of the one before, and set their IPAF to run out on ${fullDay(day(386))}`)
    // Checked once is checked.
    expect(await colly.send('document.check', { id: fresh.id, expires: day(999) })).toMatchObject({ status: 'applied' })
    expect((await colly.record<Person>('person', 'padraig')).certificates.ipaf?.expires).toBe(day(386))
  })

  it('takes a new document as typed, its title from its kind when none is given', async () => {
    // Proves: Dara's insurance sent from the link keeps its kind and day, and is called by its kind; the office's history shows it as his.
    const { app, db, colly, token } = await office()
    expect(await fromLink(app, await token('dara'), { kind: 'insurance', title: '  ', expires: day(300) }, PDF, 'scan.pdf')).toMatchObject({ ok: true, message: THANKS })
    const [row] = await documentRows(db)
    expect(await colly.record<Document>('document', row!.id)).toMatchObject({ kind: 'insurance', title: 'Public liability insurance', expires: day(300), sentVia: 'link', checkedAt: null })
    expect((await colly.history()).entries[0]!.what).toBe(`Dara Quinn sent a new public liability insurance, running out ${fullDay(day(300))} (PDF, 1 KB)`)
  })
})

describe('what the link page sends, as typed', () => {
  it('takes a title with control characters as words, and a renewal naming something that is no id as not theirs', async () => {
    // Proves: a NUL or a line break in the title, which the database can't hold, arrives as a space rather than failing on the server; a renewal naming something that isn't one of the app's ids is "not one of yours", and keeps nothing.
    const { app, db, colly, token, files } = await office()
    const dara = await token('dara')
    expect(await fromLink(app, dara, { kind: 'other', title: 'Van\u0000insurance\r\nscan', expires: '' }, PDF)).toMatchObject({ ok: true, message: THANKS })
    const [row] = await documentRows(db)
    expect((await colly.record<Document>('document', row!.id)).title).toBe('Van insurance scan')
    expect(await fromLink(app, dara, { renews: 'p1\u0000', expires: day(400) }, PDF)).toMatchObject({ ok: false, message: "That document isn't one of yours." })
    expect(await documentRows(db)).toHaveLength(1)
    expect(await files()).toHaveLength(1)
  })

  it('takes a title cut to its 100 characters in the middle of an emoji, without the half', async () => {
    // Proves: the title is cut at 100 of JavaScript's characters, which can fall inside an emoji; the half left, which the
    // database's JSON can't hold, goes, so the document is sent rather than failing on the server.
    const { app, db, colly, token } = await office()
    const title = `${'Van insurance '.repeat(8).slice(0, 99)}\u{1F69A}`
    expect(await fromLink(app, await token('dara'), { kind: 'other', title, expires: '' }, PDF)).toMatchObject({ ok: true, message: THANKS })
    const [row] = await documentRows(db)
    expect((await colly.record<Document>('document', row!.id)).title).toBe(title.slice(0, 99).trim())
  })
})

describe('what the office sends, as typed', () => {
  it('takes a title in the address with control characters in it, cleaned as the app cleans what it types', async () => {
    // Proves: the title of a file put on a document from the person's card comes in the query string, where a NUL, DEL and a C1
    // control, as text pasted from Word or a PDF can carry, are cleaned out as any typed text is, so the file goes on rather than
    // failing on the server, and the title is kept as it reads.
    const { colly, upload } = await office()
    const added = await upload('d1', { personId: 'dara', kind: 'insurance', title: 'Van\u0000 insurance\u007f\u0090', expires: day(30) }, PDF)
    expect(added.statusCode).toBe(200)
    expect(await colly.record<Document>('document', 'd1')).toMatchObject({ title: 'Van insurance', file: { type: 'pdf' } })
    expect((await colly.history()).entries[0]!.what).toBe(`Added Dara Quinn's Van insurance, with its file (PDF, 1 KB)`)
  })
})

describe('with no bucket on the server', () => {
  it('records the details and expiry, so reminders work, and says plainly that files wait on the bucket', async () => {
    // Proves: on a server with no storage, as the live one is, details save, the app is told files are off, a file is refused naming the Railway variables, and the link page says to send it another way.
    const { app, db } = await server()
    const colly = await staff(app, db, 'Colly Hewson', IPHONE, 'phone-c0ffee')
    await colly.send('person.upsert', { id: 'dara', name: 'Dara Quinn', kind: 'freelancer', email: null, phone: null, skills: [], dayRateCents: null, notes: '' })
    expect((await app.inject({ url: '/api/documents/storage', cookies: colly.cookies })).json()).toEqual({ files: false, encrypted: false })
    expect(await colly.send('document.save', { id: 'd1', personId: 'dara', kind: 'insurance', title: 'Public liability insurance', expires: day(10) })).toMatchObject({ status: 'applied' })
    expect(await colly.record<Document>('document', 'd1')).toMatchObject({ expires: day(10), file: null })

    const res = await app.inject({ method: 'POST', url: `/api/documents/d1/file?personId=dara&kind=insurance&title=x`, headers: { 'content-type': 'application/octet-stream' }, cookies: colly.cookies, payload: PDF })
    expect(res.statusCode).toBe(409)
    expect(res.json().error).toBe(FILES_WAIT)
    for (const name of ['BACKUP_S3_ENDPOINT', 'BACKUP_S3_BUCKET', 'BACKUP_S3_ACCESS_KEY_ID', 'BACKUP_S3_SECRET_ACCESS_KEY', 'Railway']) expect(FILES_WAIT).toContain(name)

    const token = (await db.query<{ t: string }>('SELECT link_token AS t FROM people')).rows[0]!.t
    const page = (await app.inject({ url: `/f/${token}` })).body
    expect(page).toContain('Public liability insurance')
    expect(page).toContain("Sending documents here isn't switched on yet.")
    expect(page).not.toContain('multipart/form-data')
    expect(await fromLink(app, token, { kind: 'insurance', title: '', expires: '' }, PDF)).toMatchObject({
      ok: false,
      message: "Sending documents here isn't switched on yet. For now, send a photo or a PDF of it to the office by WhatsApp or email.",
    })
  })
})

describe('erasing a person', () => {
  it('takes their documents from the table, the feed and the history, and their files from the storage', async () => {
    // Proves: Pádraig's card from the office, the renewal from his link and his van insurance all go when he's erased: no row, no copy in the feed, no title in the history, and no file left in the folder.
    const { app, db, colly, upload, token, files } = await office()
    expect((await upload('p1', { personId: 'padraig', kind: 'ipaf', title: 'IPAF card', expires: day(20) }, JPEG)).statusCode).toBe(200)
    expect((await fromLink(app, await token('padraig'), { renews: 'p1', expires: day(385) }, HEIC)).ok).toBe(true)
    expect(await colly.send('document.save', { id: 'p2', personId: 'padraig', kind: 'insurance', title: 'Kenny Rigging van insurance', expires: day(90) })).toMatchObject({ status: 'applied' })
    expect((await upload('d1', { personId: 'dara', kind: 'insurance', title: 'Quinn Audio insurance', expires: day(90) }, PDF)).statusCode).toBe(200)
    expect(await files()).toHaveLength(3)

    expect(await colly.send('person.archive', { id: 'padraig', archived: true })).toMatchObject({ status: 'applied' })
    expect(await colly.send('person.erase', { id: 'padraig' })).toMatchObject({ status: 'applied' })
    expect((await documentRows(db)).map((d) => d.id)).toEqual(['d1'])
    const feed = (await db.query<{ op: string; data: unknown }>(`SELECT op, data FROM changes WHERE entity = 'document' AND entity_id <> 'd1'`)).rows
    expect(feed.length).toBeGreaterThan(0)
    expect(feed.every((c) => c.op === 'delete' && c.data === null)).toBe(true)
    const stored = typedOnly((await db.query<{ j: string }>(`SELECT row_to_json(m)::text AS j FROM mutations m`)).rows.map((r) => r.j).join('\n'))
    expect(stored).not.toContain('van insurance')
    expect(stored).not.toContain(day(385))
    // Dara's stays, file and all.
    const left = await files()
    expect(left).toHaveLength(1)
    expect(readFileSync(left[0]!).equals(PDF)).toBe(true)
    const words = (await colly.history()).entries.map((e) => e.what).join('\n')
    expect(words).not.toContain('van insurance')
    expect(words).toContain("Quinn Audio insurance")
  })
})

describe('a file the storage will not delete', () => {
  it('stays on the list with why, is said in the log, and goes on a later try', async () => {
    // Proves: removing a document whose file the storage refuses to delete keeps the file on the list of files to delete, with the reason, warns in the log without naming anyone, and the next try (after a change, or the daily look) deletes it.
    const dir = folder()
    const real = dirStore(dir)
    let refusing = true
    const store: BackupStore = {
      ...real,
      delete: async (key) => {
        if (refusing) throw new Error('The backup storage answered 503: Slow Down')
        return real.delete(key)
      },
    }
    const lines: string[] = []
    const { app, db, colly, upload } = await office({ documentStore: store, logger: true, logTo: { write: (l) => lines.push(l) } })
    expect((await upload('d1', { personId: 'dara', kind: 'insurance', title: 'Public liability insurance' }, PDF)).statusCode).toBe(200)
    expect(await colly.send('document.remove', { id: 'd1' })).toMatchObject({ status: 'applied' })
    await app.documents.tidy()
    const listed = (await db.query<{ tries: number; last_error: string }>('SELECT tries, last_error FROM document_files_to_delete')).rows
    expect(listed).toEqual([{ tries: expect.any(Number), last_error: 'The backup storage answered 503: Slow Down' }])
    expect(listed[0]!.tries).toBeGreaterThanOrEqual(1)
    expect(filesIn(dir)).toHaveLength(1)
    const warned = lines.find((l) => l.includes('Could not delete 1 document file from the storage'))
    expect(warned).toContain('tried again after the next change and tomorrow')
    expect(warned).not.toContain('Dara')

    refusing = false
    await app.documents.start()
    expect(filesIn(dir)).toHaveLength(0)
    expect((await db.query('SELECT 1 FROM document_files_to_delete')).rows).toHaveLength(0)
  })
})

describe('encrypted with BACKUP_KEY', () => {
  it('keeps each file encrypted in the storage, opens it with the key, and says why without it', async () => {
    // Proves: with BACKUP_KEY set, the file in the folder is the backups' encrypted format, never the bytes sent; the office opens the file as sent; and a server without the key says it can't open it, in words.
    const key = randomBytes(32)
    const { app, db, colly, dir, upload, open } = await office({ backupKey: key })
    expect((await app.inject({ url: '/api/documents/storage', cookies: colly.cookies })).json()).toEqual({ files: true, encrypted: true })
    expect((await upload('d1', { personId: 'dara', kind: 'insurance', title: 'Public liability insurance' }, PDF)).statusCode).toBe(200)
    const [stored] = filesIn(dir)
    const raw = readFileSync(stored!)
    expect(raw.subarray(0, 4).toString()).toBe('SHBK')
    expect(raw.includes(Buffer.from('%PDF'))).toBe(false)
    expect(raw.includes(Buffer.from('Made up for a test'))).toBe(false)
    expect((await open('d1')).rawPayload.equals(PDF)).toBe(true)

    const fileKey = (await db.query<{ k: string }>('SELECT file_key AS k FROM documents')).rows[0]!.k
    await expect(new DocumentFiles(db, dirStore(dir)).read(fileKey)).rejects.toThrow(FileLocked)
    await expect(new DocumentFiles(db, dirStore(dir), { key: randomBytes(32) }).read(fileKey)).rejects.toThrow("This file can't be opened with the server's BACKUP_KEY")
  })
})

describe('details whose file has gone', () => {
  it('say so plainly when the file is opened, as after a restore from a backup, which holds details but not files', async () => {
    // Proves: a document whose file isn't in the storage any more opens to a sentence saying so and what to do, from the app and from the link.
    const { app, dir, upload, open, token } = await office()
    expect((await upload('p1', { personId: 'padraig', kind: 'other', title: 'Rigging ticket' }, PNG)).statusCode).toBe(200)
    for (const f of filesIn(dir)) rmSync(f)
    const res = await open('p1')
    expect(res.statusCode).toBe(404)
    expect(res.json().error).toBe(FILE_GONE)
    const page = await app.inject({ url: `/f/${await token('padraig')}/documents/p1` })
    expect(page.statusCode).toBe(404)
    expect(page.body).toContain("This file isn&#39;t in the storage any more. Send it again from your page.")
  })
})

describe('made-up data and starting fresh', () => {
  it('puts made-up files on the made-up documents where there is a store, and starting fresh deletes them all', async () => {
    // Proves: with a store, each made-up document gets a made-up PDF and Róisín's renewed Safe Pass waits to be checked; starting fresh puts every file on the list first and the folder ends empty.
    const { app, db, colly, dir } = await office()
    // Made-up data goes only into an empty app.
    expect((await app.inject({ method: 'POST', url: '/api/data/start-fresh', cookies: colly.cookies, payload: { confirm: START_FRESH_WORDS } })).statusCode).toBe(200)
    expect((await app.inject({ method: 'POST', url: '/api/data/made-up', cookies: colly.cookies })).statusCode).toBe(200)
    const rows = (await db.query<{ title: string; sent_via: string; checked_at: string | null; file_type: string | null; name: string }>(
      `SELECT d.title, d.sent_via, d.checked_at, d.file_type, p.name FROM documents d JOIN people p ON p.id = d.person_id ORDER BY d.sent_at, d.id`
    )).rows
    expect(rows.length).toBe(7)
    expect(rows.every((r) => r.file_type === 'pdf')).toBe(true)
    expect(rows.filter((r) => r.sent_via === 'link')).toEqual([expect.objectContaining({ name: 'Róisín Farrell', title: 'Safe Pass card', checked_at: null })])
    await app.documents.tidy()
    expect(filesIn(dir)).toHaveLength(7)
    expect(readFileSync(filesIn(dir)[0]!).subarray(0, 5).toString()).toBe('%PDF-')

    expect((await app.inject({ method: 'POST', url: '/api/data/start-fresh', cookies: colly.cookies, payload: { confirm: START_FRESH_WORDS } })).statusCode).toBe(200)
    await app.documents.tidy()
    expect(filesIn(dir)).toHaveLength(0)
    expect((await db.query('SELECT 1 FROM document_files_to_delete')).rows).toHaveLength(0)
    const history: HistoryPage = await colly.history()
    expect(history.entries).toHaveLength(1)
  })
})
