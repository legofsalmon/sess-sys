import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { FILES_WAIT_LINK, newId, START_FRESH_WORDS, type ItemCertificate } from '@sh/shared'
import { afterEach, describe, expect, it } from 'vitest'
import { dirStore } from '../src/backup/store.ts'
import { IPHONE, server, staff } from './people.ts'

/**
 * Certificates on items (ADR 0094): a PAT certificate, a report of a
 * thorough examination, or another, kept on the items it covers as a
 * link, a file, or both. One covers a whole round. Files go where venues'
 * documents' files go, under the same rules; a test's own certificate
 * never runs out on a day of its own.
 */

const folders: string[] = []
afterEach(() => {
  for (const f of folders.splice(0)) rmSync(f, { recursive: true, force: true })
})

const PDF = Buffer.from('%PDF-1.4\n% Made up for a test: not a real report of thorough examination.\n')

function filesIn(dir: string): string[] {
  const docs = join(dir, 'documents')
  return existsSync(docs) ? readdirSync(docs) : []
}

/** The warehouse with three chain motors, signed in, and files kept in a folder as a bucket would keep them (or none). */
async function warehouse(withFiles = true) {
  const dir = mkdtempSync(join(tmpdir(), 'sh-certificates-'))
  folders.push(dir)
  const { app, db } = await server(withFiles ? { documentStore: dirStore(dir) } : {})
  const colly = await staff(app, db, 'Colly Hewson', IPHONE, 'phone-c0ffee')
  const motor = { id: newId(), name: 'CM Lodestar 1 t', department: 'rigging', category: 'Motors', tracking: 'serialised', isCase: false, valueCents: null, notes: '' } as const
  expect(await colly.send('model.create', motor as never)).toMatchObject({ status: 'applied' })
  const motors: string[] = []
  for (let i = 0; i < 3; i++) {
    const id = newId()
    expect(await colly.send('asset.add', { id, modelId: motor.id, number: null, serial: '', placeId: null, caseId: null, notes: '', fromCount: false } as never)).toMatchObject({
      status: 'applied',
    })
    motors.push(id)
  }
  const upload = (id: string, details: Record<string, string>, data: Buffer, cookies: Record<string, string> | undefined = colly.cookies) =>
    app.inject({
      method: 'POST',
      url: `/api/item-certificates/${id}/file?${new URLSearchParams({ client: 'phonec0ffee', kind: 'lifting', title: 'Report of thorough examination', day: '2026-10-20', link: '', ...details })}`,
      headers: { 'content-type': 'application/octet-stream', 'user-agent': IPHONE },
      cookies,
      payload: data,
    })
  const open = (id: string, cookies: Record<string, string> | undefined = colly.cookies) => app.inject({ url: `/api/item-certificates/${id}/file`, cookies })
  const files = async () => {
    await app.documents.tidy()
    return filesIn(dir)
  }
  return { app, db, colly, motors, upload, open, files }
}

describe('certificates on items', () => {
  it('keeps a link covering a round of items, and refuses one that makes no sense', async () => {
    // Proves: a link alone saves through the outbox covering many items; it needs a link or a file and real items; a test's certificate can't run out on a day of its own; another can, after its day; removing it twice is fine.
    const { colly, motors } = await warehouse()
    const link = 'https://www.dropbox.com/s/made-up/lifting-round-october.pdf'
    const save = (args: Record<string, unknown>) =>
      colly.send('itemCertificate.save', { id: 'c1', kind: 'lifting', title: 'Report of thorough examination', day: '2026-10-20', expires: null, assetIds: motors, link, ...args } as never)
    expect(await save({})).toMatchObject({ status: 'applied' })
    expect(await colly.record<ItemCertificate>('itemCertificate', 'c1')).toMatchObject({ kind: 'lifting', day: '2026-10-20', expires: null, assetIds: motors, link, file: null })
    // Saved again with fewer, it covers fewer, in the order sent.
    expect(await save({ assetIds: [motors[2], motors[0], motors[2]] })).toMatchObject({ status: 'applied' })
    expect((await colly.record<ItemCertificate>('itemCertificate', 'c1')).assetIds).toEqual([motors[2], motors[0]])

    expect(await save({ link: null })).toMatchObject({ status: 'rejected', reason: { message: 'Add the link to it, or choose its file.' } })
    expect(await save({ assetIds: [] })).toMatchObject({ status: 'rejected' })
    expect(await save({ assetIds: [...motors, 'never-added'] })).toMatchObject({ status: 'rejected', reason: { code: 'not-found' } })
    expect(await save({ expires: '2027-04-20' })).toMatchObject({ status: 'rejected' })
    expect(await save({ link: 'javascript:alert(1)' })).toMatchObject({ status: 'rejected' })
    expect(await save({ id: 'c2', kind: 'other', title: 'Declaration of conformity', day: '2026-01-10', expires: '2025-01-01' })).toMatchObject({ status: 'rejected' })
    expect(await save({ id: 'c2', kind: 'other', title: 'Declaration of conformity', day: '2026-01-10', expires: '2031-01-10', assetIds: [motors[0]] })).toMatchObject({
      status: 'applied',
    })

    expect(await colly.send('itemCertificate.remove', { id: 'c2' })).toMatchObject({ status: 'applied' })
    expect(await colly.send('itemCertificate.remove', { id: 'c2' })).toMatchObject({ status: 'applied' })
    const words = (await colly.history()).entries.map((e) => e.what)
    expect(words.some((w) => /^Saved the report of thorough examination for SH-\d{6} \(CM Lodestar 1 t\) and 2 more items, as a link$/.test(w))).toBe(true)
    expect(words.some((w) => /^Removed “Declaration of conformity” for SH-\d{6} \(CM Lodestar 1 t\)$/.test(w))).toBe(true)
  })

  it('adds one with a file, opens it named for the item, adds items to it, and deletes the file with it', async () => {
    // Proves: the file goes in under documents/, opens as a download named for its first item, needs a session, an upload adds its items to the ones it covers, details change with the file kept, and it goes when removed.
    const { colly, motors, upload, open, files } = await warehouse()
    expect((await upload('c1', { assets: motors[0]! }, PDF)).statusCode).toBe(200)
    const cert = await colly.record<ItemCertificate & { number?: string }>('itemCertificate', 'c1')
    expect(cert).toMatchObject({ kind: 'lifting', assetIds: [motors[0]], link: null, file: { type: 'pdf', bytes: PDF.length } })
    expect(JSON.stringify(cert)).not.toContain('documents/')
    expect(await files()).toHaveLength(1)

    const got = await open('c1')
    expect(got.statusCode).toBe(200)
    expect(got.headers['content-type']).toBe('application/pdf')
    expect(got.headers['content-disposition']).toMatch(/filename="SH-\d{6} CM Lodestar 1 t - Report of thorough examination\.pdf"/)
    expect(got.rawPayload.equals(PDF)).toBe(true)
    expect((await open('c1', {})).statusCode).toBe(401)

    // A new file, for the other two as well: the old file goes, and it covers all three.
    expect((await upload('c1', { assets: `${motors[1]},${motors[2]}` }, Buffer.concat([PDF, Buffer.from('v2')]))).statusCode).toBe(200)
    expect((await colly.record<ItemCertificate>('itemCertificate', 'c1')).assetIds).toEqual(motors)
    expect(await files()).toHaveLength(1)
    expect((await open('c1')).headers['content-disposition']).toMatch(/filename="SH-\d{6} CM Lodestar 1 t and 2 more - Report/)

    expect(
      await colly.send('itemCertificate.save', { id: 'c1', kind: 'lifting', title: 'Report 4471', day: '2026-10-20', expires: null, assetIds: motors, link: null } as never)
    ).toMatchObject({ status: 'applied' })
    expect(await colly.record<ItemCertificate>('itemCertificate', 'c1')).toMatchObject({ title: 'Report 4471', file: { type: 'pdf' } })

    expect((await upload('bad', { assets: 'never-added' }, PDF)).statusCode).toBe(409)
    expect(await files()).toHaveLength(1)

    expect(await colly.send('itemCertificate.remove', { id: 'c1' })).toMatchObject({ status: 'applied' })
    expect(await files()).toHaveLength(0)
    expect((await open('c1')).statusCode).toBe(404)

    const words = (await colly.history()).entries.map((e) => e.what)
    expect(words.some((w) => /^Added the report of thorough examination for SH-\d{6} \(CM Lodestar 1 t\), with its file \(PDF, 1 KB\)$/.test(w))).toBe(true)
    expect(words.some((w) => /^Put a new file on the report of thorough examination for SH-\d{6} \(CM Lodestar 1 t\) and 1 more item \(PDF, 1 KB\)$/.test(w))).toBe(true)
  })

  it('counts their files as known, and starting fresh deletes them', async () => {
    // Proves: a certificate's file is no stray in the daily count, and starting fresh puts it on the list so the folder ends empty.
    const { app, colly, motors, upload, files } = await warehouse()
    expect((await upload('c1', { kind: 'pat', title: 'PAT certificate', assets: motors.join(',') }, PDF)).statusCode).toBe(200)
    expect(await app.documents.strays()).toBe(0)
    expect((await app.inject({ method: 'POST', url: '/api/data/start-fresh', cookies: colly.cookies, payload: { confirm: START_FRESH_WORDS } })).statusCode).toBe(200)
    expect(await files()).toHaveLength(0)
  })

  it('with no bucket, keeps links and says a file waits, pointing to a link meanwhile', async () => {
    // Proves: on a server with no storage, as the live one may be, a file is refused saying to keep a link meanwhile.
    const { motors, upload } = await warehouse(false)
    const res = await upload('c1', { assets: motors[0]! }, PDF)
    expect(res.statusCode).toBe(409)
    expect(res.json().error).toBe(FILES_WAIT_LINK)
  })
})
