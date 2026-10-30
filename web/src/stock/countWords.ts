import type { AssetView, View, WarehouseView, Where } from '@sh/shared'
import { atLabel, numberLabel } from './common.tsx'

/**
 * How a count (ADR 0030) names what it found: places and cases, items, where
 * they were kept, the job they went out on, and what's become of them since.
 */

/** "Bay A3", or "SH-000200 (Amp rack)". */
export function targetName(w: WarehouseView, x: Where): string {
  if (x.placeId) return w.places.find((p) => p.id === x.placeId)?.name ?? 'a place since removed'
  const c = x.caseId ? w.assets.get(x.caseId) : undefined
  return c ? `${numberLabel(c)} (${c.model?.name ?? 'a case'})` : 'a case'
}

/** "SH-000123 d&b Y10P". */
export const itemName = (a: AssetView | undefined) => (a ? [numberLabel(a), a.model?.name].filter(Boolean).join(' ') : 'An item')
/** "at Bay B1", "in SH-000200 (Amp rack)", or "not placed yet", for where an item was kept. */
export const keptWords = (x: Partial<Where>, w: WarehouseView) => (x.placeId || x.caseId ? `kept ${atLabel({ placeId: x.placeId ?? null, caseId: x.caseId ?? null }, w)}` : 'not placed yet')
export const jobName = (view: View, id: string | null | undefined) => view.jobs.jobs.find((j) => j.id === id)?.name ?? 'a job'
export const isHere = (a: AssetView, x: Where) => (x.placeId ? a.placeId === x.placeId : a.caseId === x.caseId)
/** An item's open missing report: the oldest, standing for any others (audit, 20 October 2026, finding 45). */
export const openMissing = (view: View, id: string) => view.faults.ofAsset(id).find((f) => f.open && f.kind === 'missing' && !f.merged)
/** "10:05", in Irish time. */
export const time = (iso: string) => new Date(iso).toLocaleTimeString('en-IE', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Dublin' })

/** What's become of an item since, for a fix that's no longer to do; undefined while it is. */
export function since(view: View, a: AssetView | undefined, missingIsDone: boolean): string | undefined {
  if (!a) return 'Not on this phone.'
  if (a.status !== 'active') return 'Retired since.'
  const out = view.moves.outOf(a.id)
  if (out) return `Out with ${jobName(view, out.projectId)} now.`
  if (openMissing(view, a.id)) return missingIsDone ? 'Reported missing.' : undefined
  return undefined
}
