import { z } from 'zod'
import { CERTIFICATE_SOON_DAYS, certificateReminders, longDate, reminderLine, sendItFrom, type CertificateReminder } from './certificates.ts'
import { CERTIFICATE_KINDS, CERTIFICATE_LABELS, certificateName, dayLabel, daysBetween, firstName, type CertificateKind, type Person } from './crew.ts'
import { day } from './day.ts'
import { needed } from './plain.ts'

/**
 * A person's documents (ADR 0029): insurance, certificate cards and the
 * like, each with a kind, a title, the day it runs out and a file. Devices
 * hold the details; the files stay in the storage beside the backups and
 * open through the server. A freelancer sends a new one from their private
 * link and the office checks it. Where a document is a certificate's
 * card, the certificate on the person holds its date, so the two never
 * drift apart.
 */

const id = z.string().min(1).max(64)

export const DOCUMENT_KINDS = ['insurance', ...CERTIFICATE_KINDS, 'other'] as const
export type DocumentKind = (typeof DOCUMENT_KINDS)[number]

export const DOCUMENT_KIND_LABELS: Record<DocumentKind, string> = { insurance: 'Insurance', ...CERTIFICATE_LABELS, other: 'Something else' }

/** The title each kind starts with, which can be changed; one for something else is typed. */
export const DOCUMENT_TITLES: Record<DocumentKind, string> = {
  insurance: 'Public liability insurance',
  'first-aid': 'First aid certificate',
  'manual-handling': 'Manual handling certificate',
  'driving-licence': 'Driving licence',
  'safe-pass': 'Safe Pass card',
  'working-at-height': 'Working at height certificate',
  ipaf: 'IPAF card',
  other: '',
}

/** A certificate's card, whose date the certificate on the person holds. */
export const certificateOf = (kind: DocumentKind): CertificateKind | undefined => CERTIFICATE_KINDS.find((k) => k === kind)

/** What a file may be, found from its first bytes. */
export const FILE_TYPES = {
  pdf: { mime: 'application/pdf', ext: 'pdf', label: 'PDF' },
  jpeg: { mime: 'image/jpeg', ext: 'jpg', label: 'JPEG' },
  png: { mime: 'image/png', ext: 'png', label: 'PNG' },
  webp: { mime: 'image/webp', ext: 'webp', label: 'WebP' },
  heic: { mime: 'image/heic', ext: 'heic', label: 'HEIC' },
} as const
export type FileType = keyof typeof FILE_TYPES

/** Up to 10 MB: a phone's photo, or a scanned schedule of insurance, with room to spare. */
export const MAX_FILE_BYTES = 10 * 1024 * 1024
/** How much of a file's start is read to tell what it is. */
export const FILE_HEAD_BYTES = 64

export const FILE_TOO_BIG = 'That file is over 10 MB. Send a smaller photo, or the PDF as it came.'
export const NO_FILE = 'Choose the file to send.'
export const WEB_FILE = "That file is a web page or a drawing (SVG), which could run code when it's opened. Send a PDF or a photo of it instead."
export const WRONG_FILE = "That isn't a PDF or a photo the app can keep. Send a PDF, or a JPEG, PNG, WebP or HEIC photo."
/** Said on the office's devices and by the server while there's no storage for files (ADR 0029). */
export const FILES_WAIT =
  'Files wait on the storage bucket being set up: set BACKUP_S3_ENDPOINT, BACKUP_S3_BUCKET, BACKUP_S3_ACCESS_KEY_ID and BACKUP_S3_SECRET_ACCESS_KEY on the server in Railway (docs/backups.md). The details and the day it runs out are saved without it, so the reminders work now.'

/** HEIF brands an iPhone writes: a generic HEIF one only counts with one of these beside it, so AVIF isn't taken for a photo. */
const HEIC_BRANDS = ['heic', 'heix', 'heim', 'heis', 'hevc', 'hevx', 'hevm', 'hevs']

const ascii = (b: Uint8Array, from: number, to: number) => String.fromCharCode(...b.subarray(from, to))
const starts = (b: Uint8Array, bytes: readonly number[]) => bytes.every((x, i) => b[i] === x)

/**
 * What a file is, by its first bytes, never by its name or the type a
 * browser says: a PDF or a photo, or why not. The server and the office's
 * device ask the same, so a refusal is said in place before anything is
 * sent. A web page or an SVG drawing is refused in words of its own, as a
 * browser can run code from them.
 */
export function fileTypeOf(head: Uint8Array): { type: FileType } | { refused: string } {
  if (head.length === 0) return { refused: NO_FILE }
  if (ascii(head, 0, 5) === '%PDF-') return { type: 'pdf' }
  if (starts(head, [0xff, 0xd8, 0xff])) return { type: 'jpeg' }
  if (starts(head, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return { type: 'png' }
  if (ascii(head, 0, 4) === 'RIFF' && ascii(head, 8, 12) === 'WEBP') return { type: 'webp' }
  if (ascii(head, 4, 8) === 'ftyp') {
    const size = Math.min(head.length, (head[0]! << 24) | (head[1]! << 16) | (head[2]! << 8) | head[3]!)
    const major = ascii(head, 8, 12)
    const compatible: string[] = []
    for (let at = 16; at + 4 <= size; at += 4) compatible.push(ascii(head, at, at + 4))
    if (HEIC_BRANDS.includes(major) || ((major === 'mif1' || major === 'msf1') && compatible.some((b) => HEIC_BRANDS.includes(b)))) return { type: 'heic' }
  }
  // Text that opens with a tag, after any byte-order mark and spaces: HTML, SVG or XML.
  const text = ascii(head, 0, head.length).replace(/^﻿|^\xEF\xBB\xBF/, '').trimStart()
  if (text.startsWith('<')) return { refused: WEB_FILE }
  return { refused: WRONG_FILE }
}

/** "PDF, 240 KB". */
export function fileLabel(f: { type: FileType; bytes: number }): string {
  const size = f.bytes < 1024 * 1024 ? `${Math.max(1, Math.round(f.bytes / 1024))} KB` : `${(f.bytes / 1024 / 1024).toFixed(1)} MB`
  return `${FILE_TYPES[f.type].label}, ${size}`
}

/** The file's name when it's downloaded: "Pádraig Kenny - IPAF card.pdf", with nothing a file name can't hold. */
export function documentFileName(personName: string, title: string, type: FileType): string {
  const clean = (s: string) => s.replace(/[\u0000-\u001f\u007f"\\/:*?<>|]+/g, ' ').replace(/\s+/g, ' ').trim()
  // Cut by whole characters: half an emoji can't be written in the download's header, and the server would fail sending it.
  const name = [...[clean(personName), clean(title)].filter(Boolean).join(' - ')].slice(0, 120).join('').trim() || 'Document'
  return `${name}.${FILE_TYPES[type].ext}`
}

export interface StoredFileInfo {
  type: FileType
  bytes: number
  /** When it was put there. */
  at: string
}

export interface Document {
  id: string
  personId: string
  kind: DocumentKind
  title: string
  /**
   * The day it runs out. A certificate's card has none of its own once
   * it's in: the certificate on the person holds it. One sent from a link
   * carries the day typed there until the office checks it.
   */
  expires: string | null
  /** The file's type and size, never its name or where it's kept; null for details alone. */
  file: StoredFileInfo | null
  /** Who sent it: the office, or the person on their private link. */
  sentVia: 'office' | 'link'
  sentAt: string
  /** When the office checked it; null while one sent from a link waits. */
  checkedAt: string | null
  /** The document a renewal sent from a link replaces once checked. */
  renews: string | null
}

export interface DocumentEntities {
  document: Document
}
export const DOCUMENT_ENTITY_NAMES = ['document'] as const

/** What a document is, as typed: the same on the office's form, an upload's details and the link's form. */
export const documentDetails = z.object({
  id,
  personId: id,
  kind: z.enum(DOCUMENT_KINDS),
  title: needed(100, 'The title', 'A title'),
  expires: day.nullable(),
})
export type DocumentDetails = z.infer<typeof documentDetails>

export const documentCommandSchemas = {
  /** Add a document's details with no file, or change them. A certificate's card sets the certificate too. */
  'document.save': documentDetails,
  /** The office checked one sent from a link, with the day it runs out as checked. */
  'document.check': z.object({ id, expires: day.nullable() }),
  /** Remove it; its file is deleted from the storage. */
  'document.remove': z.object({ id }),
} as const

/** What the server records a file put on a document as, and one sent from a link: not commands, as they carry the file. */
export const DOCUMENT_ACTIONS = { file: 'document.file', send: 'document.send' } as const
export type DocumentAction = (typeof DOCUMENT_ACTIONS)[keyof typeof DOCUMENT_ACTIONS]

/** Whether the server has somewhere to keep files, for the office's devices. */
export interface DocumentStorage {
  files: boolean
  encrypted: boolean
}

/**
 * The day a document runs out, as everything shows it: a certificate's
 * card, once checked, by the certificate on the person; anything else, or
 * a card waiting to be checked, by its own.
 */
export function documentRunsOut(d: Pick<Document, 'kind' | 'expires' | 'checkedAt'>, person: Pick<Person, 'certificates'> | undefined): string | null {
  const cert = certificateOf(d.kind)
  if (!cert || !d.checkedAt) return d.expires
  const c = person?.certificates?.[cert]
  return c?.held ? c.expires : null
}

/** The titles a kind starts with that are ordinary words, not names: these read in lower case mid-sentence. */
const PLAIN_TITLES = Object.values(DOCUMENT_TITLES).filter((t) => t && !/^(Safe Pass|IPAF)\b/.test(t))

/**
 * A title as it reads mid-sentence: "your public liability insurance",
 * while "IPAF card", and anything typed ("Quinn Audio insurance"), stays as
 * it is, since a capital there may be a name.
 */
export const titleInSentence = (title: string) => (PLAIN_TITLES.some((t) => title.startsWith(t)) ? title.charAt(0).toLowerCase() + title.slice(1) : title)

/** A document run out, or running out soon, to ask the person about. */
export interface DocumentReminder<P> {
  person: P
  document: Pick<Document, 'id' | 'kind' | 'title'>
  expires: string
  ranOut: boolean
}

/**
 * Documents that aren't a certificate's card (the certificate has its own
 * line), whose day has passed or falls in the next 30 days, for everyone
 * not archived. One a renewal waiting to be checked replaces is left out:
 * the new one is in hand.
 */
export function documentReminders<P extends Pick<Person, 'id' | 'name'> & { archived?: boolean }>(
  people: readonly P[],
  documents: readonly Pick<Document, 'id' | 'personId' | 'kind' | 'title' | 'expires' | 'checkedAt' | 'renews'>[],
  today: string,
  within = CERTIFICATE_SOON_DAYS
): DocumentReminder<P>[] {
  const byId = new Map(people.map((p) => [p.id, p]))
  const renewed = new Set(documents.filter((d) => !d.checkedAt && d.renews).map((d) => d.renews))
  const out: DocumentReminder<P>[] = []
  for (const d of documents) {
    const person = byId.get(d.personId)
    if (!person || person.archived || certificateOf(d.kind) || !d.expires || renewed.has(d.id) || daysBetween(today, d.expires) > within) continue
    out.push({ person, document: { id: d.id, kind: d.kind, title: d.title }, expires: d.expires, ranOut: d.expires < today })
  }
  return out
}

/** Everything running out, certificates and documents in one list (ADR 0029), soonest first, so the longest run out heads it. */
export type RunningOut<P> = ({ what: 'certificate' } & CertificateReminder<P>) | ({ what: 'document' } & DocumentReminder<P>)

export function runningOut<P extends Pick<Person, 'id' | 'name' | 'certificates'> & { archived?: boolean }>(
  people: readonly P[],
  documents: Parameters<typeof documentReminders>[1],
  today: string
): RunningOut<P>[] {
  const all: RunningOut<P>[] = [
    ...certificateReminders(people, today).map((r) => ({ what: 'certificate' as const, ...r })),
    ...documentReminders(people, documents, today).map((r) => ({ what: 'document' as const, ...r })),
  ]
  // Every order ends on something unique, so two devices agree.
  const tie = (r: RunningOut<P>) => (r.what === 'certificate' ? `0 ${String(CERTIFICATE_KINDS.indexOf(r.kind)).padStart(2, '0')}` : `1 ${r.document.title} ${r.document.id}`)
  return all.sort((a, b) => a.expires.localeCompare(b.expires) || a.person.name.localeCompare(b.person.name) || a.person.id.localeCompare(b.person.id) || tie(a).localeCompare(tie(b)))
}

/** "IPAF runs out on Thu 22 Oct", "Public liability insurance ran out on Wed 2 Sep": a line of the list. */
export function runningOutLine(r: RunningOut<unknown>, today: string): string {
  if (r.what === 'certificate') return reminderLine(r, today)
  const what = r.document.title
  if (r.expires === today) return `${what} runs out today`
  return `${what} ${r.ranOut ? 'ran' : 'runs'} out on ${dayLabel(r.expires)}${r.expires.slice(0, 4) === today.slice(0, 4) ? '' : ` ${r.expires.slice(0, 4)}`}`
}

/**
 * Asking for the new one, in the voice of the certificate's message. The
 * app sends nothing itself.
 */
export function documentRenewalMessage(
  p: Pick<Person, 'name'> & Partial<Pick<Person, 'knownAs'>>,
  r: Pick<DocumentReminder<unknown>, 'document' | 'expires' | 'ranOut'>,
  today: string,
  /** Their private link, once files can be sent from it. */
  link?: string
): { text: string; subject: string; what: string } {
  const words = titleInSentence(r.document.title)
  const when = r.ranOut ? `ran out on ${longDate(r.expires, today)}` : r.expires === today ? 'runs out today' : `runs out on ${longDate(r.expires, today)}`
  return {
    text: [
      `Hi ${firstName(p)}, our records say your ${words} ${when}.`,
      `${r.ranOut ? "If you've" : "When you've"} renewed it, could you send us the new one? We need it to offer you work.`,
      link ? sendItFrom(link) : '',
      'Thanks.',
    ]
      .filter(Boolean)
      .join('\n'),
    subject: `Your ${words}`,
    what: `reminder about ${words}`,
  }
}

/** What saving or checking a certificate's card does, to follow "Checking it": "sets Pádraig's IPAF to run out on Thu 3 Nov 2027". */
export function certificateFollows(p: Pick<Person, 'name'> & Partial<Pick<Person, 'knownAs'>>, kind: CertificateKind, expires: string | null): string {
  const whose = `${firstName(p)}'s ${certificateName(kind)}`
  return expires ? `sets ${whose} to run out on ${dayLabel(expires)} ${expires.slice(0, 4)}` : `sets ${whose} as held, with no expiry`
}
