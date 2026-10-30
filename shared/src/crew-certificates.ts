import { z } from 'zod'
import { day } from './day.ts'
import { text } from './plain.ts'

/**
 * Certificates (ADR 0025, ADR 0028): the kinds a person holds and a call
 * needs, and what they're called in words.
 */

/** Safe Pass, working at height and IPAF came with what a call needs (ADR 0028). An IPAF card's categories, such as 3a, go in its note. */
export const CERTIFICATE_KINDS = ['first-aid', 'manual-handling', 'driving-licence', 'safe-pass', 'working-at-height', 'ipaf'] as const
export type CertificateKind = (typeof CERTIFICATE_KINDS)[number]
export const CERTIFICATE_LABELS: Record<CertificateKind, string> = {
  'first-aid': 'First aid',
  'manual-handling': 'Manual handling',
  'driving-licence': 'Driving licence',
  'safe-pass': 'Safe Pass',
  'working-at-height': 'Working at height',
  ipaf: 'IPAF',
}
/** Two are names, so they keep their capitals mid-sentence: "needs working at height and IPAF". */
export const certificateName = (kind: CertificateKind) => (kind === 'safe-pass' || kind === 'ipaf' ? CERTIFICATE_LABELS[kind] : CERTIFICATE_LABELS[kind].toLowerCase())
/** The thing itself, as a sentence says someone has it or not: "Tadhg Brady's manual handling certificate ran out". */
export const CERTIFICATE_WORDS: Record<CertificateKind, string> = {
  'first-aid': 'first aid certificate',
  'manual-handling': 'manual handling certificate',
  'driving-licence': 'driving licence',
  'safe-pass': 'Safe Pass',
  'working-at-height': 'working at height certificate',
  ipaf: 'IPAF',
}
/** Each kind once, in the list's order, whatever order they were ticked or sent in. */
export const tidyNeeds = (needs: readonly string[] | null | undefined): CertificateKind[] => CERTIFICATE_KINDS.filter((k) => needs?.includes(k))
/** "working at height and IPAF". */
export function needsLabel(needs: readonly CertificateKind[]): string {
  const names = tidyNeeds(needs).map(certificateName)
  return names.length < 2 ? (names[0] ?? '') : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`
}
export const needs = z.array(z.enum(CERTIFICATE_KINDS)).max(CERTIFICATE_KINDS.length)

/** One certificate: held, not held, or unknown (null), with an expiry day where there is one. */
export const certificate = z.object({ held: z.boolean().nullable(), expires: day.nullable(), note: text(200, 'The note') })
export type Certificate = z.infer<typeof certificate>
/** By kind; a kind that isn't there is unknown. */
export const certificates = z.partialRecord(z.enum(CERTIFICATE_KINDS), certificate)
export type Certificates = z.infer<typeof certificates>

/** The kinds that came with ADR 0028, which a version of the app from before can't send. */
const LATER_KINDS: readonly CertificateKind[] = ['safe-pass', 'working-at-height', 'ipaf']

/**
 * A person's certificates after an edit, on the server and on a device
 * alike. This version's form sends every kind. One from before sends only
 * the three it knows, and leaves one out to clear it: so a kind left out
 * is kept only if it came later, and an edit that sends none keeps them all.
 */
export function certificatesAfter(was: Certificates | undefined, sent: Certificates | undefined): Certificates {
  if (!sent) return was ?? {}
  const kept = LATER_KINDS.filter((k) => was?.[k] && !(k in sent)).map((k) => [k, was![k]] as const)
  return { ...Object.fromEntries(kept), ...sent }
}
