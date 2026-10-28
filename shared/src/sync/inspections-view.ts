import { irishToday } from '../calendar.ts'
import type { CommandArgs, Mutation } from '../commands.ts'
import {
  DUE_SOON_DAYS,
  INSPECTION_KINDS,
  ITEM_CERTIFICATE_KINDS,
  monthsLater,
  type Inspection,
  type InspectionEntities,
  type InspectionKind,
  type ItemCertificate,
} from '../inspections.ts'
import type { Model } from '../stock.ts'
import { addDays } from './plan.ts'
import type { AssetView, WarehouseView } from './stock-view.ts'

/**
 * Inspections (ADR 0020) as a device sees them: each item's records, with
 * this person's waiting ones laid over them, and for each inspection its
 * product needs, when it's next due. An item whose last one failed, or
 * that's overdue, can't go out; one never recorded here is listed, but not
 * stopped, since its last test may be on paper.
 *
 * Certificates (ADR 0094) are laid over the same way: each test's is the
 * one of its kind covering its item, dated the day it was done. A test
 * with none is listed, never stopped, as a test not recorded is: the
 * certificate may be in the tester's post.
 */

export interface ItemCertificateView extends ItemCertificate {
  pending: boolean
}

/** Another certificate's standing: `ok`, `soon` (runs out within 30 days), `expired`, or `open` (never runs out). */
export type ItemCertificateState = 'ok' | 'soon' | 'expired' | 'open'

export interface InspectionView extends Inspection {
  pending: boolean
  /** The day it was done, in Ireland. */
  day: string
}

/**
 * Where an item stands on one inspection: `ok`, `soon` (due within 30
 * days), `overdue`, `failed` (the last one), or `unrecorded` (none here yet).
 */
export type DueState = 'ok' | 'soon' | 'overdue' | 'failed' | 'unrecorded'

export interface Due {
  asset: AssetView
  kind: InspectionKind
  /** How many months apart, as its product says. */
  months: number
  last: InspectionView | undefined
  /** The day it's next due; undefined when never recorded, or failed. */
  due: string | undefined
  state: DueState
  /** Due on the day the stock list gave, with no test recorded here yet (ADR 0026). */
  fromList?: boolean
  /** The last one's certificate, when one is kept (ADR 0094). */
  certificate?: ItemCertificateView
}

/** A certificate that runs out, on an item in stock, within 30 days or already. */
export interface CertificateDue {
  asset: AssetView
  certificate: ItemCertificateView
  state: 'soon' | 'expired'
}

export interface InspectionsView {
  /** An item's records, newest first. */
  ofAsset(assetId: string): InspectionView[]
  /** Each inspection an item's product needs, and where it stands; none for a retired item. */
  dueOf(assetId: string): Due[]
  /** What keeps an item from going out: the last one failed, or overdue. */
  blocks(assetId: string): Due | undefined
  /** Every item in stock failed, overdue, or due within 30 days: failed and overdue first, longest first, then soonest. */
  attention: Due[]
  /** Items in stock needing an inspection with none recorded here yet. */
  unrecorded: Due[]
  /** An item's certificates, the newest day first (ADR 0094). */
  certificatesOf(assetId: string): ItemCertificateView[]
  /** The certificate kept for one test: of its kind, on its item, dated its day. */
  certificateFor(i: Pick<Inspection, 'assetId' | 'kind'> & { day: string }): ItemCertificateView | undefined
  /** Where another certificate stands today. */
  certificateState(c: ItemCertificate): ItemCertificateState
  /** Items in stock whose last test passed with no certificate kept for it, the oldest test first. */
  uncertified: Due[]
  /** Other certificates on items in stock that ran out, or run out within 30 days, soonest first. */
  certificatesDue: CertificateDue[]
}

type Tables = { [E in keyof InspectionEntities]: Record<string, InspectionEntities[E]> }

const monthsFor = (m: Model | undefined, kind: InspectionKind) => (kind === 'pat' ? m?.patMonths : m?.liftingMonths) ?? null
const newest = (a: Inspection, b: Inspection) => b.at.localeCompare(a.at) || b.id.localeCompare(a.id)
const rank: Record<DueState, number> = { failed: 0, overdue: 1, soon: 2, unrecorded: 3, ok: 4 }

/**
 * The day in Ireland a record was made: what `irishToday` says, from one
 * formatter rather than one made for every record, which was most of what
 * this view cost. A time that isn't one reads as it did before.
 */
const dublin = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Dublin' })
const irishDay = (at: string) => {
  const d = new Date(at)
  return Number.isNaN(d.getTime()) ? irishToday(d) : dublin.format(d)
}

export function inspectionsView(
  entities: Partial<Tables>,
  outbox: readonly (Mutation & { appliedSeq?: number })[],
  cursor: number,
  warehouse: WarehouseView,
  today: string
): InspectionsView {
  const records = new Map<string, InspectionView>()
  const view = (i: Inspection, pending: boolean): InspectionView => ({ ...i, pending, day: irishDay(i.at) })
  for (const i of Object.values(entities.inspection ?? {})) records.set(i.id, view(i, false))
  for (const m of outbox) {
    if (m.appliedSeq !== undefined && m.appliedSeq <= cursor) continue
    if (m.name !== 'inspection.record') continue
    const a = m.args as CommandArgs<'inspection.record'>
    if (!records.has(a.id)) records.set(a.id, view({ ...a, at: new Date(a.at).toISOString() }, true))
  }

  const certs = new Map<string, ItemCertificateView>()
  for (const c of Object.values(entities.itemCertificate ?? {})) certs.set(c.id, { ...c, pending: false })
  for (const m of outbox) {
    if (m.appliedSeq !== undefined && m.appliedSeq <= cursor) continue
    if (m.name === 'itemCertificate.save') {
      const a = m.args as CommandArgs<'itemCertificate.save'>
      const was = certs.get(a.id)
      certs.set(a.id, { ...a, assetIds: [...new Set(a.assetIds)], file: was?.file ?? null, addedAt: was?.addedAt ?? m.createdAt, pending: true })
    } else if (m.name === 'itemCertificate.remove') certs.delete((m.args as CommandArgs<'itemCertificate.remove'>).id)
  }
  const certsOf = new Map<string, ItemCertificateView[]>()
  // Every order ends on the id, so two devices agree.
  const certOrder = (a: ItemCertificate, b: ItemCertificate) =>
    b.day.localeCompare(a.day) || ITEM_CERTIFICATE_KINDS.indexOf(a.kind) - ITEM_CERTIFICATE_KINDS.indexOf(b.kind) || a.id.localeCompare(b.id)
  for (const c of [...certs.values()].sort(certOrder))
    for (const assetId of c.assetIds) {
      const list = certsOf.get(assetId) ?? []
      list.push(c)
      certsOf.set(assetId, list)
    }
  const certificateFor = (i: Pick<Inspection, 'assetId' | 'kind'> & { day: string }) =>
    certsOf.get(i.assetId)?.find((c) => c.kind === i.kind && c.day === i.day)

  const byAsset = new Map<string, InspectionView[]>()
  for (const i of records.values()) {
    const list = byAsset.get(i.assetId) ?? []
    list.push(i)
    byAsset.set(i.assetId, list)
  }
  for (const list of byAsset.values()) list.sort(newest)

  const soon = addDays(today, DUE_SOON_DAYS)
  const dues = new Map<string, Due[]>()
  const dueOf = (assetId: string): Due[] => {
    const found = dues.get(assetId)
    if (found) return found
    const asset = warehouse.assets.get(assetId)
    const list: Due[] = []
    if (asset?.status === 'active') {
      for (const kind of INSPECTION_KINDS) {
        const months = monthsFor(asset.model, kind)
        if (!months) continue
        const last = byAsset.get(assetId)?.find((i) => i.kind === kind)
        // The stock list's day for its next PAT stands until a test is recorded here (ADR 0026).
        const listed = !last && kind === 'pat' ? (asset.patDue ?? undefined) : undefined
        const due = last?.passed ? monthsLater(last.day, months) : listed
        const state: DueState = !last && !listed ? 'unrecorded' : last && !last.passed ? 'failed' : due! < today ? 'overdue' : due! <= soon ? 'soon' : 'ok'
        const certificate = last && certificateFor(last)
        list.push({ asset, kind, months, last, due, state, ...(listed ? { fromList: true } : {}), ...(certificate ? { certificate } : {}) })
      }
    }
    dues.set(assetId, list)
    return list
  }
  const blocks = (assetId: string) => dueOf(assetId).find((d) => d.state === 'failed' || d.state === 'overdue')

  const all = warehouse.models.flatMap((m) => (m.patMonths || m.liftingMonths ? m.items.flatMap((a) => dueOf(a.id)) : []))
  const attention = all
    .filter((d) => d.state === 'failed' || d.state === 'overdue' || d.state === 'soon')
    .sort(
      (a, b) =>
        Math.min(rank[a.state], 1) - Math.min(rank[b.state], 1) ||
        (a.due ?? a.last?.day ?? '').localeCompare(b.due ?? b.last?.day ?? '') ||
        a.asset.number.localeCompare(b.asset.number)
    )
  const unrecorded = all.filter((d) => d.state === 'unrecorded')
  const uncertified = all
    .filter((d) => d.last?.passed && !d.certificate)
    .sort((a, b) => a.last!.day.localeCompare(b.last!.day) || a.asset.number.localeCompare(b.asset.number) || a.kind.localeCompare(b.kind))

  const certificateState = (c: ItemCertificate): ItemCertificateState =>
    !c.expires ? 'open' : c.expires < today ? 'expired' : c.expires <= soon ? 'soon' : 'ok'
  const certificatesDue: CertificateDue[] = []
  for (const c of certs.values()) {
    const state = certificateState(c)
    if (state !== 'expired' && state !== 'soon') continue
    for (const assetId of c.assetIds) {
      const asset = warehouse.assets.get(assetId)
      // Only the newest of a title counts: a renewed certificate leaves the old one as the record.
      const newer = certsOf.get(assetId)?.some((o) => o.kind === 'other' && o.id !== c.id && o.title.toLowerCase() === c.title.toLowerCase() && o.day > c.day)
      if (asset?.status === 'active' && !newer) certificatesDue.push({ asset, certificate: c, state })
    }
  }
  certificatesDue.sort((a, b) => a.certificate.expires!.localeCompare(b.certificate.expires!) || a.asset.number.localeCompare(b.asset.number) || a.certificate.id.localeCompare(b.certificate.id))

  return {
    ofAsset: (id) => byAsset.get(id) ?? [],
    dueOf,
    blocks,
    attention,
    unrecorded,
    certificatesOf: (id) => certsOf.get(id) ?? [],
    certificateFor,
    certificateState,
    uncertified,
    certificatesDue,
  }
}
