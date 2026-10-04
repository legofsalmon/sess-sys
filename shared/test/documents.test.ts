import { describe, expect, it } from 'vitest'
import { renewalMessage } from '../src/certificates.ts'
import type { Person } from '../src/crew.ts'
import {
  certificateOf,
  DOCUMENT_KINDS,
  DOCUMENT_TITLES,
  documentFileName,
  documentRenewalMessage,
  documentRunsOut,
  fileLabel,
  fileTypeOf,
  NO_FILE,
  runningOut,
  runningOutLine,
  titleInSentence,
  WEB_FILE,
  WRONG_FILE,
  type Document,
} from '../src/documents.ts'
import { keptArgs } from '../src/erasure.ts'
import { crewView } from '../src/sync/crew-view.ts'
import { documentsView } from '../src/sync/documents-view.ts'

/**
 * People's documents (ADR 0029): their kinds, and the one date a
 * certificate's card goes by; what a file is, by its first bytes; the
 * reminders, documents' expiries joining the certificates' soonest first,
 * with a message asking for the new one; and a device's own changes laid
 * over what the server sent, the certificate following a card at once.
 */

const TODAY = '2026-10-03'
const held = (expires: string | null, note = '') => ({ held: true, expires, note })

const person = (id: string, name: string, certificates: Person['certificates'] = {}, archived = false): Person => ({
  id,
  name,
  kind: 'freelancer',
  email: null,
  phone: null,
  skills: [],
  dayRateCents: null,
  notes: '',
  linkToken: 'abcdefghijklmnopqrstuvwx',
  archived,
  approvesLeave: false,
  department: null,
  level: 2,
  knownAs: null,
  certificates,
  company: null,
})

const doc = (id: string, personId: string, more: Partial<Document> = {}): Document => ({
  id,
  personId,
  kind: 'insurance',
  title: 'Public liability insurance',
  expires: null,
  file: null,
  sentVia: 'office',
  sentAt: '2026-09-01T09:00:00.000Z',
  checkedAt: '2026-09-01T09:00:00.000Z',
  renews: null,
  ...more,
})

const bytes = (...parts: (string | number[])[]) => new Uint8Array(parts.flatMap((p) => (typeof p === 'string' ? [...p].map((c) => c.charCodeAt(0)) : p)))

describe('kinds, and the date each goes by', () => {
  it('has insurance, each certificate kind and something else, a certificate card going by the certificate once checked', () => {
    // Proves: the kinds are insurance, the six certificates and other; an IPAF card that's checked reads the date on the person, one waiting to be checked reads the day it was sent with, and insurance always its own.
    expect(DOCUMENT_KINDS).toEqual(['insurance', 'first-aid', 'manual-handling', 'driving-licence', 'safe-pass', 'working-at-height', 'ipaf', 'other'])
    expect(certificateOf('ipaf')).toBe('ipaf')
    expect(certificateOf('insurance')).toBeUndefined()
    expect(DOCUMENT_TITLES.ipaf).toBe('IPAF card')
    const pádraig = person('p1', 'Pádraig Kenny', { ipaf: held('2026-10-23', '3a, 3b') })
    expect(documentRunsOut(doc('c1', 'p1', { kind: 'ipaf', title: 'IPAF card' }), pádraig)).toBe('2026-10-23')
    expect(documentRunsOut(doc('c2', 'p1', { kind: 'ipaf', title: 'IPAF card', expires: '2027-10-23', checkedAt: null, sentVia: 'link' }), pádraig)).toBe('2027-10-23')
    expect(documentRunsOut(doc('c3', 'p1', { kind: 'ipaf', title: 'IPAF card' }), person('p1', 'Pádraig Kenny', { ipaf: { held: false, expires: null, note: '' } }))).toBeNull()
    expect(documentRunsOut(doc('i1', 'p1', { expires: '2026-11-01' }), pádraig)).toBe('2026-11-01')
    // A title reads in lower case mid-sentence only where it's ordinary words.
    expect(titleInSentence('Public liability insurance (Quinn Audio Ltd)')).toBe('public liability insurance (Quinn Audio Ltd)')
    expect(titleInSentence('IPAF card')).toBe('IPAF card')
    expect(titleInSentence('Quinn Audio insurance')).toBe('Quinn Audio insurance')
  })
})

describe('what a file is, by its first bytes', () => {
  it('knows a PDF and photos whatever they are called, and turns away SVG, HTML and anything else in words', () => {
    // Proves: PDF, JPEG, PNG, WebP and an iPhone's HEIC are found; a generic HEIF needs an iPhone brand beside it, so AVIF isn't taken for one; a web page or SVG, even after a byte-order mark and spaces, says why; an empty file asks for one.
    expect(fileTypeOf(bytes('%PDF-1.7\n'))).toEqual({ type: 'pdf' })
    expect(fileTypeOf(bytes([0xff, 0xd8, 0xff, 0xe1], 'Exif'))).toEqual({ type: 'jpeg' })
    expect(fileTypeOf(bytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toEqual({ type: 'png' })
    expect(fileTypeOf(bytes('RIFF', [0x24, 0, 0, 0], 'WEBPVP8 '))).toEqual({ type: 'webp' })
    expect(fileTypeOf(bytes([0, 0, 0, 0x18], 'ftypheic', [0, 0, 0, 0], 'mif1heic'))).toEqual({ type: 'heic' })
    expect(fileTypeOf(bytes([0, 0, 0, 0x1c], 'ftypmif1', [0, 0, 0, 0], 'mif1heicmiaf'))).toEqual({ type: 'heic' })
    expect(fileTypeOf(bytes([0, 0, 0, 0x1c], 'ftypavif', [0, 0, 0, 0], 'avifmif1miaf'))).toEqual({ refused: WRONG_FILE })
    expect(fileTypeOf(bytes('<svg xmlns="http://www.w3.org/2000/svg">'))).toEqual({ refused: WEB_FILE })
    expect(fileTypeOf(bytes([0xef, 0xbb, 0xbf], '  \n<!DOCTYPE html>'))).toEqual({ refused: WEB_FILE })
    expect(fileTypeOf(bytes('<?xml version="1.0"?>'))).toEqual({ refused: WEB_FILE })
    expect(fileTypeOf(bytes('PK', [3, 4], 'a zip'))).toEqual({ refused: WRONG_FILE })
    expect(fileTypeOf(new Uint8Array())).toEqual({ refused: NO_FILE })
    expect(fileLabel({ type: 'heic', bytes: 2_400_000 })).toBe('HEIC, 2.3 MB')
    expect(fileLabel({ type: 'pdf', bytes: 300 })).toBe('PDF, 1 KB')
    // Never a name a file system or a header can trip on.
    expect(documentFileName('Pádraig Kenny', 'IPAF card: 3a/3b "new"', 'jpeg')).toBe('Pádraig Kenny - IPAF card 3a 3b new.jpg')
  })
})

describe('what is running out', () => {
  const people = [
    person('p1', 'Pádraig Kenny', { ipaf: held('2026-10-23', '3a, 3b') }),
    person('p2', 'Dara Quinn'),
    person('p3', 'Gráinne Power'),
    person('p4', 'Fionn Gallagher'),
    person('p5', 'Old Timer', {}, true),
  ]
  const documents = [
    doc('d1', 'p2', { expires: '2026-10-21', title: 'Public liability insurance (Quinn Audio Ltd)' }),
    doc('g1', 'p3', { expires: '2026-09-27' }),
    // Months away, so not listed.
    doc('f1', 'p4', { expires: '2027-06-01' }),
    // A certificate's card adds no line of its own: the IPAF has one.
    doc('c1', 'p1', { kind: 'ipaf', title: 'IPAF card' }),
    // Run out, but a renewal sent from the link waits to be checked: the new one is in hand.
    doc('f2', 'p4', { expires: '2026-09-20', title: 'Van insurance' }),
    doc('f3', 'p4', { expires: '2027-09-20', title: 'Van insurance', sentVia: 'link', checkedAt: null, renews: 'f2' }),
    // Archived people are out of it.
    doc('o1', 'p5', { expires: '2026-10-05' }),
  ]

  it("joins documents' expiries to the certificates', soonest first, a card's certificate listed once", () => {
    // Proves: Gráinne's insurance that ran out heads the list, Dara's running out comes next and Pádraig's IPAF last; nothing months away, nothing for the card itself, nothing a waiting renewal replaces, and no one archived.
    const list = runningOut(people, documents, TODAY)
    expect(list.map((r) => [r.person.name, r.what, r.expires, r.ranOut])).toEqual([
      ['Gráinne Power', 'document', '2026-09-27', true],
      ['Dara Quinn', 'document', '2026-10-21', false],
      ['Pádraig Kenny', 'certificate', '2026-10-23', false],
    ])
    expect(list.map((r) => runningOutLine(r, TODAY))).toEqual([
      'Public liability insurance ran out on Sun 27 Sep',
      'Public liability insurance (Quinn Audio Ltd) runs out on Wed 21 Oct',
      'IPAF runs out on Fri 23 Oct',
    ])
  })

  it('asks for the new one in a message to send, with their page when files can be sent from it', () => {
    // Proves: the document's message names it as it reads mid-sentence and asks for the new one; with their link it says where to send it, and the certificate's message does the same.
    const [grainne, dara, padraig] = runningOut(people, documents, TODAY)
    if (dara?.what !== 'document' || grainne?.what !== 'document' || padraig?.what !== 'certificate') throw new Error('Not the list expected')
    const link = 'https://shserver-production.up.railway.app/f/abcdefghijklmnopqrstuvwx'
    expect(documentRenewalMessage(dara.person, dara, TODAY)).toEqual({
      text: "Hi Dara, our records say your public liability insurance (Quinn Audio Ltd) runs out on 21 October.\nWhen you've renewed it, could you send us the new one? We need it to offer you work.\nThanks.",
      subject: 'Your public liability insurance (Quinn Audio Ltd)',
      what: 'reminder about public liability insurance (Quinn Audio Ltd)',
    })
    expect(documentRenewalMessage(grainne.person, grainne, TODAY, link).text).toBe(
      `Hi Gráinne, our records say your public liability insurance ran out on 27 September.\nIf you've renewed it, could you send us the new one? We need it to offer you work.\nYou can send it from your page, under Your documents: ${link}\nThanks.`
    )
    expect(renewalMessage(padraig.person, padraig, TODAY, link).text).toMatch(/could you send us a photo of the new card\? We need it to offer you work that asks for it\.\nYou can send it from your page, under Your documents: https:\/\/.+\nThanks\.$/)
  })
})

describe('on a device', () => {
  const pádraig = person('p1', 'Pádraig Kenny', { ipaf: held('2026-10-23', '3a, 3b') })
  const old = doc('c1', 'p1', { kind: 'ipaf', title: 'IPAF card', file: { type: 'jpeg', bytes: 2000, at: '2026-09-01T09:00:00.000Z' } })
  const renewal = doc('c2', 'p1', { kind: 'ipaf', title: 'IPAF card', expires: '2027-10-23', sentVia: 'link', checkedAt: null, renews: 'c1', sentAt: '2026-10-02T18:00:00.000Z' })
  const entities = { person: { p1: pádraig }, document: { c1: old, c2: renewal } }
  const m = (name: string, args: unknown, n = 1) => ({ id: `m${n}`, name, args, createdAt: `2026-10-03T09:0${n}:00.000Z` }) as never

  it("waits in the office's queue, and checking it with no signal sets the certificate and takes the old card's place at once", () => {
    // Proves: the renewal sent from the link is to check; the office's check waiting to send shows the IPAF moved to the checked day, the card checked with no date of its own, and the old card gone, before the server has said so.
    const before = documentsView(entities, [], 0, crewView(entities, [], 0, TODAY))
    expect(before.toCheck.map((d) => d.id)).toEqual(['c2'])
    expect(before.of('p1').map((d) => [d.id, d.runsOut])).toEqual([
      ['c1', '2026-10-23'],
      ['c2', '2027-10-23'],
    ])
    const outbox = [m('document.check', { id: 'c2', expires: '2027-10-24' })]
    const crew = crewView(entities, outbox, 0, TODAY)
    expect(crew.people[0]!.certificates.ipaf).toEqual(held('2027-10-24', '3a, 3b'))
    expect(crew.people[0]!.pending).toBe(true)
    const after = documentsView(entities, outbox, 0, crew)
    expect(after.toCheck).toEqual([])
    expect(after.of('p1').map((d) => [d.id, d.expires, d.runsOut, d.pending])).toEqual([['c2', null, '2027-10-24', true]])
  })

  it("shows the office's own card at once, with the certificate it sets, and an erased person's documents nowhere", () => {
    // Proves: an insurance added with no signal is listed checked at once; an IPAF card saved sets the certificate in the crew view too; once an erasure is on its way, none of that person's documents show.
    const outbox = [
      m('document.save', { id: 'i1', personId: 'p1', kind: 'insurance', title: 'Public liability insurance', expires: '2027-01-31' }, 1),
      m('document.save', { id: 'c1', personId: 'p1', kind: 'ipaf', title: 'IPAF card', expires: '2028-01-01' }, 2),
    ]
    const crew = crewView(entities, outbox, 0, TODAY)
    expect(crew.people[0]!.certificates.ipaf).toEqual(held('2028-01-01', '3a, 3b'))
    const view = documentsView(entities, outbox, 0, crew)
    expect(view.of('p1').map((d) => [d.id, d.runsOut, d.checkedAt !== null, d.file?.type ?? null])).toEqual([
      ['i1', '2027-01-31', true, null],
      ['c1', '2028-01-01', true, 'jpeg'],
      ['c2', '2027-10-23', false, null],
    ])
    expect(documentsView(entities, outbox, 0, crew, { p1: {} }).all).toEqual([])
  })

  it('keeps only which document and what kind once its person is erased', () => {
    // Proves: what the history and devices keep of a document's command or action about someone erased holds no title, day or file details beyond its type and size.
    expect(keptArgs('document.save', { id: 'i1', personId: 'p1', kind: 'insurance', title: 'Kenny Rigging van insurance', expires: '2027-01-31' }, 'Erased person')).toEqual({ id: 'i1', personId: 'p1', kind: 'insurance' })
    expect(keptArgs('document.check', { id: 'c2', expires: '2027-10-24' }, 'Erased person')).toEqual({ id: 'c2' })
    expect(keptArgs('document.send', { id: 'c2', personId: 'p1', kind: 'ipaf', title: 'IPAF card', expires: '2027-10-23', type: 'heic', bytes: 2000, renews: 'c1' }, 'Erased person')).toEqual({
      id: 'c2',
      personId: 'p1',
      kind: 'ipaf',
      type: 'heic',
      bytes: 2000,
      renews: 'c1',
    })
  })
})
