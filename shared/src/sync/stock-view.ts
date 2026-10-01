import type { CommandArgs, Mutation } from '../commands.ts'
import { normaliseNumber, stockId, type Asset, type Model, type Place, type Stock, type StockEntities, type Where } from '../stock.ts'

/**
 * The Stock tab's view of a device's data (ADR 0013): what the server has
 * said, with this person's own waiting changes laid over it, as for jobs
 * and crew.
 */

export interface ModelView extends Model {
  pending: boolean
  /** Its items in stock, by number; ones still waiting for a number last. */
  items: AssetView[]
  /** Items no longer in stock, kept with their numbers. */
  retired: AssetView[]
  /** Where it's counted. For a numbered product, these are the ones not labelled yet. */
  counted: StockView[]
  countedTotal: number
  /** How many there are: items in stock and what's counted. */
  total: number
}

export interface AssetView extends Asset {
  pending: boolean
  model: Model | undefined
  /** The case it's in. */
  inCase: AssetView | undefined
  /** The place it's at: its own, or its case's, however deep. */
  at: Place | undefined
  /** For a case: the items and counted stock in it, directly. */
  items: AssetView[]
  counted: StockView[]
}

export interface StockView extends Stock {
  pending: boolean
  model: Model | undefined
  place: Place | undefined
  inCase: AssetView | undefined
  /** The place it's at: its own, or its case's. */
  at: Place | undefined
}

export interface PlaceView extends Place {
  pending: boolean
  /** Items kept here directly, cases among them. */
  items: AssetView[]
  /** Counted stock here directly. */
  counted: StockView[]
  /** Everything here, inside cases too. */
  itemTotal: number
  countedTotal: number
}

export interface WarehouseView {
  /** By name. */
  models: ModelView[]
  /** By name. */
  places: PlaceView[]
  /** Every item, retired ones too, by id. */
  assets: ReadonlyMap<string, AssetView>
  /** Every item by its number, and by any number it had before. */
  byNumber: ReadonlyMap<string, AssetView>
  /** Cases in stock, by number. */
  cases: AssetView[]
  /** Categories in use, alphabetically. */
  categories: string[]
}

type Tables = { [E in keyof StockEntities]: Record<string, StockEntities[E]> }

/** Copy only the fields a change names; the rest stay as they are. */
function patch<T extends object>(target: T, changes: object): T {
  const out = { ...target }
  for (const [k, v] of Object.entries(changes)) if (k !== 'id' && v !== undefined) (out as Record<string, unknown>)[k] = v
  return out
}

/** One collator, not one made for every comparison: with a few hundred products that was most of what a rebuild cost. */
const irishNames = new Intl.Collator('en-IE', { sensitivity: 'base' })
const byName = (a: { name: string }, b: { name: string }) => irishNames.compare(a.name, b.name) || a.name.localeCompare(b.name)
/** By number; items still waiting for one last, in the order they were added. */
const byNumber = (a: Asset, b: Asset) => (a.number ? 0 : 1) - (b.number ? 0 : 1) || a.number.localeCompare(b.number) || a.id.localeCompare(b.id)

export function warehouseView(entities: Partial<Tables>, outbox: readonly (Mutation & { appliedSeq?: number })[], cursor: number): WarehouseView {
  const models = new Map<string, Model & { pending: boolean }>()
  // Products saved before inspections (ADR 0020) have no intervals yet.
  const checks = (m: Partial<Model>) => ({ patMonths: m.patMonths ?? null, liftingMonths: m.liftingMonths ?? null })
  for (const m of Object.values(entities.model ?? {})) models.set(m.id, { ...m, ...checks(m), pending: false })
  const places = new Map<string, Place & { pending: boolean }>()
  for (const p of Object.values(entities.place ?? {})) places.set(p.id, { ...p, pending: false })
  const assets = new Map<string, Asset & { pending: boolean }>()
  for (const a of Object.values(entities.asset ?? {})) assets.set(a.id, { ...a, pending: false })
  const stock = new Map<string, Stock & { pending: boolean }>()
  for (const s of Object.values(entities.stock ?? {})) stock.set(s.id, { ...s, pending: false })

  const count = (modelId: string, w: Where, by: number, set?: number) => {
    const id = stockId(modelId, w)
    const qty = set ?? (stock.get(id)?.qty ?? 0) + by
    if (qty > 0) stock.set(id, { id, modelId, placeId: w.placeId, caseId: w.caseId, qty, pending: true })
    else stock.delete(id)
  }

  for (const m of outbox) {
    if (m.appliedSeq !== undefined && m.appliedSeq <= cursor) continue
    switch (m.name) {
      case 'model.create': {
        const a = m.args as CommandArgs<'model.create'>
        if (!models.has(a.id)) models.set(a.id, { ...a, ...checks(a), pending: true })
        break
      }
      case 'model.update': {
        const a = m.args as CommandArgs<'model.update'>
        const found = models.get(a.id)
        if (found) models.set(a.id, { ...patch(found, a), pending: true })
        break
      }
      case 'model.remove':
        models.delete((m.args as CommandArgs<'model.remove'>).id)
        break
      case 'place.upsert': {
        const a = m.args as CommandArgs<'place.upsert'>
        places.set(a.id, { ...a, pending: true })
        break
      }
      case 'place.remove':
        places.delete((m.args as CommandArgs<'place.remove'>).id)
        break
      case 'asset.add': {
        const a = m.args as CommandArgs<'asset.add'>
        if (assets.has(a.id)) break
        assets.set(a.id, {
          id: a.id,
          modelId: a.modelId,
          number: (a.number !== null && normaliseNumber(a.number)) || '',
          formerNumbers: [],
          serial: a.serial,
          placeId: a.placeId,
          caseId: a.caseId,
          status: 'active',
          retiredReason: null,
          retiredNote: null,
          notes: a.notes,
          pending: true,
        })
        if (a.fromCount && (a.placeId || a.caseId) && stock.has(stockId(a.modelId, a))) count(a.modelId, a, -1)
        break
      }
      case 'asset.update': {
        const a = m.args as CommandArgs<'asset.update'>
        const found = assets.get(a.id)
        if (found) assets.set(a.id, { ...patch(found, a), pending: true })
        break
      }
      case 'asset.move': {
        const a = m.args as CommandArgs<'asset.move'>
        const found = assets.get(a.id)
        if (found) assets.set(a.id, { ...found, placeId: a.placeId, caseId: a.caseId, pending: true })
        break
      }
      case 'asset.relabel': {
        const a = m.args as CommandArgs<'asset.relabel'>
        const found = assets.get(a.id)
        if (!found) break
        const formerNumbers = found.number ? [...found.formerNumbers, found.number] : found.formerNumbers
        assets.set(a.id, { ...found, number: (a.number !== null && normaliseNumber(a.number)) || '', formerNumbers, pending: true })
        break
      }
      case 'asset.retire': {
        const a = m.args as CommandArgs<'asset.retire'>
        const found = assets.get(a.id)
        if (found)
          assets.set(a.id, { ...found, status: 'retired', retiredReason: a.reason, retiredNote: a.note || null, placeId: null, caseId: null, pending: true })
        break
      }
      case 'asset.reinstate': {
        const found = assets.get((m.args as CommandArgs<'asset.reinstate'>).id)
        if (found) assets.set(found.id, { ...found, status: 'active', retiredReason: null, retiredNote: null, pending: true })
        break
      }
      case 'stock.set': {
        const a = m.args as CommandArgs<'stock.set'>
        count(a.modelId, a, 0, a.qty)
        break
      }
      case 'stock.move': {
        const a = m.args as CommandArgs<'stock.move'>
        count(a.modelId, { placeId: a.fromPlaceId, caseId: a.fromCaseId }, -a.qty)
        count(a.modelId, { placeId: a.toPlaceId, caseId: a.toCaseId }, a.qty)
        break
      }
    }
  }

  // Items first, then what they're in and where that is.
  const assetViews = new Map<string, AssetView>()
  for (const a of assets.values()) assetViews.set(a.id, { ...a, model: models.get(a.modelId), inCase: undefined, at: undefined, items: [], counted: [] })
  for (const a of assetViews.values()) {
    if (a.status !== 'active') continue
    a.inCase = a.caseId ? assetViews.get(a.caseId) : undefined
    a.inCase?.items.push(a)
  }
  /** The place at the top of the chain of cases; a loop (only ever from changes still waiting) has none. */
  const placeOf = (a: AssetView | undefined, seen = new Set<string>()): Place | undefined => {
    if (!a || seen.has(a.id)) return undefined
    seen.add(a.id)
    if (a.placeId) return places.get(a.placeId)
    return placeOf(a.inCase, seen)
  }
  for (const a of assetViews.values()) if (a.status === 'active') a.at = placeOf(a)

  const modelViews = new Map<string, ModelView>()
  for (const m of models.values()) modelViews.set(m.id, { ...m, items: [], retired: [], counted: [], countedTotal: 0, total: 0 })
  const placeViews = new Map<string, PlaceView>()
  for (const p of places.values()) placeViews.set(p.id, { ...p, items: [], counted: [], itemTotal: 0, countedTotal: 0 })

  for (const a of assetViews.values()) {
    const m = modelViews.get(a.modelId)
    if (a.status !== 'active') {
      m?.retired.push(a)
      continue
    }
    m?.items.push(a)
    if (a.placeId) placeViews.get(a.placeId)?.items.push(a)
    if (a.at) placeViews.get(a.at.id)!.itemTotal++
  }
  for (const s of stock.values()) {
    const inCase = s.caseId ? assetViews.get(s.caseId) : undefined
    const place = s.placeId ? places.get(s.placeId) : undefined
    const view: StockView = { ...s, model: models.get(s.modelId), place, inCase, at: place ?? inCase?.at }
    const m = modelViews.get(s.modelId)
    if (m) {
      m.counted.push(view)
      m.countedTotal += s.qty
    }
    if (s.placeId) placeViews.get(s.placeId)?.counted.push(view)
    inCase?.counted.push(view)
    if (view.at) placeViews.get(view.at.id)!.countedTotal += s.qty
  }

  const whereName = (s: StockView) => s.place?.name ?? s.inCase?.number ?? ''
  for (const m of modelViews.values()) {
    m.items.sort(byNumber)
    m.retired.sort(byNumber)
    m.counted.sort((a, b) => whereName(a).localeCompare(whereName(b)))
    m.total = m.items.length + m.countedTotal
  }
  for (const p of placeViews.values()) {
    p.items.sort(byNumber)
    p.counted.sort((a, b) => (a.model?.name ?? '').localeCompare(b.model?.name ?? ''))
  }
  for (const a of assetViews.values()) {
    a.items.sort(byNumber)
    a.counted.sort((x, y) => (x.model?.name ?? '').localeCompare(y.model?.name ?? ''))
  }

  const numbers = new Map<string, AssetView>()
  for (const a of assetViews.values()) if (a.number) numbers.set(a.number, a)
  for (const a of assetViews.values()) for (const n of a.formerNumbers) if (!numbers.has(n)) numbers.set(n, a)

  const categories = new Map<string, string>()
  for (const m of models.values()) {
    const c = m.category.trim()
    if (c && !categories.has(c.toLowerCase())) categories.set(c.toLowerCase(), c)
  }

  return {
    models: [...modelViews.values()].sort(byName),
    places: [...placeViews.values()].sort(byName),
    assets: assetViews,
    byNumber: numbers,
    cases: [...assetViews.values()].filter((a) => a.status === 'active' && a.model?.isCase).sort(byNumber),
    categories: [...categories.values()].sort((a, b) => a.localeCompare(b)),
  }
}
