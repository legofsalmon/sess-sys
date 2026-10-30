import {
  DEPARTMENT_LABELS,
  inShForm,
  normaliseNumber,
  plural,
  RETIRED_LABELS,
  valueLabel,
  type Department,
  type Tracking,
} from './stock.ts'
import { fullDayLabel, norm, type StockListRow } from './stock-import-file.ts'
import type {
  KnownItem,
  KnownProduct,
  KnownStock,
  PlannedChange,
  PlannedItem,
  PlannedProductChange,
  PlannedWhere,
  StockListCounts,
  StockListOptions,
  StockListPreview,
  StockListPreviewRow,
  StockPlan,
  StockRef,
} from './stock-import-plan.ts'
import { dayLabel, inWords, LIST_PAT_MONTHS, NUMBERED_FROM_CENTS, readRow, refKey, UNCHANGED, whereKey, withNotes, type Read } from './stock-import-rows.ts'

export {
  columnLetter,
  columnsFor,
  DATE_HINT,
  departmentNamed,
  fullDayLabel,
  needsColumnStep,
  productNameOf,
  readQuantity,
  readStockDay,
  readStockFile,
  splitNumbers,
  STOCK_FIELD_LABELS,
  STOCK_FIELDS,
  stockRows,
  tidyHeader,
  unreadColumns,
  type StockField,
  type StockFile,
  type StockListRow,
} from './stock-import-file.ts'
export {
  bringInStockLabel,
  knownStockOf,
  stockListSaid,
  type KnownItem,
  type KnownProduct,
  type KnownStock,
  type PlannedChange,
  type PlannedCount,
  type PlannedItem,
  type PlannedPrice,
  type PlannedProduct,
  type PlannedProductChange,
  type PlannedWhere,
  type StockListCounts,
  type StockListOptions,
  type StockListPreview,
  type StockListPreviewRow,
  type StockListReading,
  type StockListResult,
  type StockPlan,
  type StockProblem,
  type StockRef,
} from './stock-import-plan.ts'
export { UNCHANGED, withNotes } from './stock-import-rows.ts'

/**
 * Bringing in the stock list (ADR 0026): a spreadsheet nobody here has seen,
 * read into products, numbered items and counted stock for the office to
 * check before any of it is saved. Columns are found by their headers, with
 * many names for each, and a column the app doesn't know is the office's to
 * say, never guessed at. What a row says that the app isn't sure of is a
 * problem, fixed in place or skipped. The same reading and the same plan run
 * on the server for the preview, on the device as the office fixes a row,
 * and on the server again as the rows go in, so a second import of the same
 * file finds everything as the list says and changes nothing.
 */

/** One item a row names: one already here, or a new one with its key. */
type ItemOf =
  | { known: KnownItem; tag: string; serial: string; sh: string | undefined }
  | { known?: undefined; key: string; number: string | null; oldNumber: string; serial: string }

interface Group {
  key: string
  name: string
  known: KnownProduct | undefined
  /** The product's id in the old system, from the first row that gives one. */
  listId: string
  rows: Read[]
  isCase: boolean
  department: Department
  category: string
  valueCents: number | null
  dayCents: number | null
  /** New items of it the list adds, in row order, and its items here in stock. */
  added: string[]
}

/**
 * Every row checked and matched against what's here, with what bringing it
 * in would do, in words and as a plan. The device runs this again as the
 * office fixes or skips a row, with what it holds; the server runs it for
 * the preview and again as the rows go in.
 */
export function previewStockList(
  input: readonly (StockListRow & { skip?: boolean })[],
  known: KnownStock,
  options: StockListOptions
): StockListPreview & { plan: StockPlan } {
  // What's here, looked up the ways a row names it.
  const productByName = new Map<string, KnownProduct>()
  for (const p of known.products) if (!p.mistake && !productByName.has(norm(p.name))) productByName.set(norm(p.name), p)
  const productById = new Map(known.products.map((p) => [p.id, p]))
  const productByListId = new Map<string, KnownProduct>()
  for (const p of known.products) if (!p.mistake && p.listId && !productByListId.has(p.listId)) productByListId.set(p.listId, p)
  const placeById = new Map(known.places.map((p) => [p.id, p]))
  const placeByName = new Map(known.places.map((p) => [norm(p.name), p]))
  const byNumber = new Map<string, KnownItem>()
  const byFormer = new Map<string, KnownItem>()
  const byOld = new Map<string, KnownItem>()
  const bySerial = new Map<string, KnownItem[]>()
  for (const i of known.items) {
    if (i.number) byNumber.set(i.number, i)
    for (const n of i.formerNumbers) byFormer.set(n, i)
    if (i.oldNumber) byOld.set(norm(i.oldNumber), i)
    if (i.serial) bySerial.set(norm(i.serial), [...(bySerial.get(norm(i.serial)) ?? []), i])
  }
  const countNow = new Map(known.counts.map((c) => [`${c.modelId}@${c.caseId ? `c:${c.caseId}` : `p:${c.placeId}`}`, c.qty]))
  const activeOf = (modelId: string) => known.items.filter((i) => i.modelId === modelId && i.status === 'active')
  const itemSaid = (i: KnownItem) => `${i.number || 'an item'} (${productById.get(i.modelId)?.name ?? 'another product'})`

  const rows = input.map((r) => readRow(r, options))
  const live = rows.filter((r) => r.live)
  // A list with one date written month first, skipped or not, may write them all that way: one that reads either way is then a guess.
  const monthFirst = rows.find((r) => r.monthFirst)
  if (monthFirst)
    for (const r of live)
      if (r.eitherWay)
        r.problems.push({
          field: 'patDue',
          text: `Row ${monthFirst.input.row} writes its date month first, so "${r.input.cells.patDue!.trim()}" could be either. Write the month as a word, like 30 Sep 2027.`,
        })

  // Products, by name, capitals and spacing aside.
  const groups = new Map<string, Group>()
  for (const r of live) {
    if (!r.name) continue
    const k = norm(r.name)
    let g = groups.get(k)
    if (!g) groups.set(k, (g = { key: k, name: r.name, known: productByName.get(k), listId: '', rows: [], isCase: false, department: 'other', category: '', valueCents: null, dayCents: null, added: [] }))
    g.rows.push(r)
  }
  // A product the old system's id names is matched by it before its name, so one renamed there is renamed here, not made again.
  for (const g of groups.values()) {
    g.listId = g.rows.find((r) => r.listId)?.listId ?? ''
    const byId = g.listId ? productByListId.get(g.listId) : undefined
    if (!byId || byId === g.known) continue
    if (g.known)
      g.rows[0]!.problems.push({
        field: 'product',
        text: `${g.known.name} is already here, and this row's id in the old system (${g.listId}) is ${byId.name}'s. Rename one of them on its page first.`,
      })
    g.known = byId
  }
  // One product here named by two of the list's products, one by its id and one by its name, is one of them twice.
  const claimed = new Map<string, Group>()
  for (const g of groups.values()) {
    if (!g.known) continue
    const other = claimed.get(g.known.id)
    if (other) g.rows[0]!.problems.push({ field: 'product', text: `${other.name} on row ${other.rows[0]!.input.row} is ${g.known.name} here too. Make them one product in the list, or skip one.` })
    else claimed.set(g.known.id, g)
  }
  for (const g of groups.values()) {
    let value: { cents: number; row: number } | undefined
    let department: { is: Department; row: number } | undefined
    let day: { cents: number; row: number } | undefined
    for (const r of g.rows) {
      if (r.dayCents !== null) {
        if (!day) day = { cents: r.dayCents, row: r.input.row }
        else if (day.cents !== r.dayCents)
          r.problems.push({
            field: 'dayPrice',
            text: `Row ${day.row} gives ${g.name} a day price of ${valueLabel(day.cents)}; this row says ${valueLabel(r.dayCents)}. Make them the same, or clear one.`,
          })
      }
      if (r.valueCents !== null) {
        if (!value) value = { cents: r.valueCents, row: r.input.row }
        else if (value.cents !== r.valueCents)
          r.problems.push({
            field: 'value',
            text: `Row ${value.row} gives ${g.name} a value of ${valueLabel(value.cents)}; this row says ${valueLabel(r.valueCents)}. Make them the same, or clear one.`,
          })
      }
      if (!g.known && r.department) {
        if (!department) department = { is: r.department, row: r.input.row }
        else if (department.is !== r.department)
          r.problems.push({
            field: 'department',
            text: `Row ${department.row} puts ${g.name} in ${DEPARTMENT_LABELS[department.is]}; this row says ${DEPARTMENT_LABELS[r.department]}. Make them the same.`,
          })
      }
      if (!g.category && r.category) g.category = r.category
    }
    g.valueCents = value?.cents ?? null
    g.dayCents = day?.cents ?? null
    g.department = department?.is ?? 'other'
  }
  const groupOf = (r: Read) => (r.name ? groups.get(norm(r.name)) : undefined)

  // Every number the list gives, so a second mention is marked and a case can be named by one.
  const fileSh = new Map<string, { row: Read; key: string }>()
  const fileOld = new Map<string, { row: Read; key: string }>()
  const fileSerial = new Map<string, number>()
  const fileItems = new Map<string, number>()

  // Which products hold other kit: those that do already, and those the Case column names.
  const named = (cell: string) => !inShForm(cell) && !byOld.has(norm(cell))
  const caseNames = new Set(live.filter((r) => r.caseCell && named(r.caseCell)).map((r) => norm(r.caseCell)))
  for (const g of groups.values()) g.isCase = !!g.known?.isCase || caseNames.has(g.key)

  // Each row's items: the ones already here it names, and the new ones.
  const itemsOf = new Map<Read, ItemOf[]>()
  for (const r of live) {
    const g = groupOf(r)
    const items: ItemOf[] = []
    if (r.numbered) {
      const n = Math.max(r.tags.length, r.serials.length)
      for (let i = 0; i < n; i++) {
        const tag = r.tags[i] ?? ''
        const serial = r.serials[i] ?? ''
        const sh = tag && inShForm(tag) ? normaliseNumber(tag) : undefined
        let hit: KnownItem | undefined
        if (sh) {
          hit = byNumber.get(sh)
          const before = !hit ? byFormer.get(sh) : undefined
          if (before)
            r.problems.push({ field: 'number', text: `${sh} was ${itemSaid(before)}'s number before, and a number is never used twice. Use the number it has now.` })
          const first = fileSh.get(sh)
          if (first && first.row !== r) r.problems.push({ field: 'number', text: `${sh} is on row ${first.row.input.row} too.` })
        } else if (tag) {
          hit = byOld.get(norm(tag))
          const first = fileOld.get(norm(tag))
          if (first && first.row !== r) r.problems.push({ field: 'number', text: `${tag} is on row ${first.row.input.row} too.` })
        }
        let bySer: KnownItem | undefined
        if (serial) {
          const same = (bySerial.get(norm(serial)) ?? []).filter((x) => x.modelId === g?.known?.id)
          if (same.length === 1) bySer = same[0]
          else if (same.length > 1 && !hit)
            r.problems.push({ field: 'serial', text: `${same.length} items of ${g!.name} have the serial ${serial}. Put their asset numbers in too.` })
          const k = `${g?.key}|${norm(serial)}`
          const first = fileSerial.get(k)
          if (first !== undefined && first !== r.input.row) r.problems.push({ field: 'serial', text: `The serial ${serial} is on row ${first} too.` })
          else fileSerial.set(k, r.input.row)
        }
        if (hit && bySer && hit.id !== bySer.id) r.problems.push({ field: 'serial', text: `${tag} is ${itemSaid(hit)}, but the serial ${serial} is on ${itemSaid(bySer)}.` })
        const item = hit ?? bySer
        // One item on two rows, however each names it, is one row too many.
        const before = item ? fileItems.get(item.id) : undefined
        if (item && before !== undefined && before !== r.input.row) r.problems.push({ field: hit ? 'number' : 'serial', text: `${itemSaid(item)} is on row ${before} too.` })
        else if (item) fileItems.set(item.id, r.input.row)
        if (item && item.modelId !== g?.known?.id)
          r.problems.push({ field: 'product', text: `${itemSaid(item)} is already here as ${productById.get(item.modelId)?.name ?? 'another product'}, not ${r.name || 'this'}. Fix the product, or skip the row.` })
        else if (item && item.status !== 'active')
          r.problems.push({
            field: null,
            text:
              item.retiredReason === 'mistake'
                ? `${itemSaid(item)} was added by mistake, so nothing more is done as it. Skip the row.`
                : `${itemSaid(item)} is retired (${item.retiredReason ? RETIRED_LABELS[item.retiredReason].toLowerCase() : 'retired'}). Bring it back first, or skip the row.`,
          })
        if (item) items.push({ known: item, tag, serial, sh })
        else {
          const key = `item:${r.input.row}:${i}`
          items.push({ key, number: sh ?? null, oldNumber: tag && !sh ? tag : '', serial })
          if (sh && !fileSh.has(sh)) fileSh.set(sh, { row: r, key })
          if (tag && !sh && !fileOld.has(norm(tag))) fileOld.set(norm(tag), { row: r, key })
          g?.added.push(key)
        }
      }
    }
    itemsOf.set(r, items)
  }
  // An item the list adds, named as a case by its number: its product holds other kit, so its counted rows make items too.
  for (const r of live) {
    const ref = !r.caseCell ? undefined : inShForm(r.caseCell) ? fileSh.get(normaliseNumber(r.caseCell)!) : fileOld.get(norm(r.caseCell))
    const g = ref && groupOf(ref.row)
    if (g) g.isCase = true
  }

  // Places, by name. One the list names that isn't here is made only if the office ticks to.
  const newPlaces = new Map<string, { name: string; row: number }>()
  const placeOf = (r: Read): StockRef | null => {
    if (!r.placeCell) return null
    const k = norm(r.placeCell)
    const p = placeByName.get(k)
    if (p) return { id: p.id }
    if (!newPlaces.has(k)) newPlaces.set(k, { name: r.placeCell.trim(), row: r.input.row })
    if (!options.make) r.problems.push({ field: 'place', text: `${r.placeCell.trim()} isn't a place here yet. Tick “Make the places and cases this list names”, or fix the place.`, tick: true })
    return { key: `place:${k}` }
  }
  // A row naming a case puts its kit in the case, which keeps its own place, so only rows with no case are placed here.
  const placeRefs = new Map(live.filter((r) => !r.caseCell).map((r) => [r, placeOf(r)]))

  // A case counted rather than numbered: it has a number of its own, so the list's count is of items, made up to that many
  // of the product altogether, never fewer. Worked out before cases are named, so "Amp rack 1, 1" can be named.
  const caseCountNew = new Map<Read, string[]>()
  const caseRowsOf = new Map<Group, Read[]>()
  for (const r of live) {
    const g = groupOf(r)
    if (g?.isCase && !r.numbered && r.qty !== null) caseRowsOf.set(g, [...(caseRowsOf.get(g) ?? []), r])
  }
  for (const [g, rs] of caseRowsOf) {
    let have = g.known ? activeOf(g.known.id).length : 0
    for (const r of rs) {
      const there = Math.min(have, r.qty!)
      have -= there
      const keys = Array.from({ length: r.qty! - there }, (_, i) => `item:${r.input.row}:${i}`)
      caseCountNew.set(r, keys)
      g.added.push(...keys)
    }
    if (have > 0) rs.at(-1)!.asides.push(`${plural(have, 'more')} of ${g.name} ${have === 1 ? 'is' : 'are'} here than the list counts. The list retires none: retire any that have gone on their pages.`)
  }

  // Cases: by number, by old number, or by the name of a product holding other kit with one item.
  const newCases = new Map<string, { name: string; product: string; known: KnownProduct | undefined; first: Read }>()
  const caseRefs = new Map<string, { ref: StockRef; said: string; made?: boolean } | { problem: string }>()
  const resolveCase = (r: Read): { ref: StockRef; said: string; made?: boolean } | { problem: string } => {
    const cell = r.caseCell.trim()
    const k = norm(cell)
    const byItem = (i: KnownItem) => {
      const p = productById.get(i.modelId)
      const g = p ? groups.get(norm(p.name)) : undefined
      if (!p?.isCase && !g?.isCase) return { problem: `${itemSaid(i)} doesn't hold other kit. Mark ${p?.name ?? 'its product'} as holding other kit on its page first.` }
      if (i.status !== 'active') return { problem: `${itemSaid(i)} is retired, so nothing can go in it.` }
      return { ref: { id: i.id }, said: itemSaid(i) }
    }
    // An item the list adds, named as a case by its number; its product holds other kit, as marked above.
    const byRow = (f: { row: Read; key: string }) => ({ ref: { key: f.key }, said: `${cell} (${f.row.name})` })
    if (inShForm(cell)) {
      const sh = normaliseNumber(cell)!
      const here = byNumber.get(sh)
      if (here) return byItem(here)
      const inList = fileSh.get(sh)
      if (inList) return byRow(inList)
      return { problem: `No item has the number ${sh}. Fix the case, or skip the row.` }
    }
    const old = byOld.get(k)
    if (old) return byItem(old)
    const oldInList = fileOld.get(k)
    if (oldInList) return byRow(oldInList)
    const g = groups.get(k)
    const p = g?.known ?? productByName.get(k)
    // A product here that the list doesn't make a case of isn't turned into one by being named as one.
    if (p && !p.isCase && !g?.isCase) return { problem: `${p.name} doesn't hold other kit. Mark it as holding other kit on its page first, or fix the case.` }
    const items = [...(p ? activeOf(p.id).map((i) => ({ ref: { id: i.id } as StockRef, said: itemSaid(i) })) : []), ...(g?.added ?? []).map((key) => ({ ref: { key } as StockRef, said: cell }))]
    if (items.length === 1) return items[0]!
    if (items.length > 1) return { problem: `There are ${items.length} × ${p?.name ?? g?.name ?? cell}. Put the case's number in the Case column, such as SH-000123.` }
    // Named by nothing here or in the list: a case to make, if the office ticks to.
    if (!newCases.has(k)) newCases.set(k, { name: cell, product: p?.name ?? cell, known: p, first: r })
    return { ref: { key: `case:${k}` }, said: cell, made: true }
  }
  for (const r of live) {
    if (!r.caseCell) continue
    const k = norm(r.caseCell)
    if (!caseRefs.has(k)) caseRefs.set(k, resolveCase(r))
  }
  // A case made from its name is kept where the first row naming it says, if it says.
  const newCasePlaces = new Map([...newCases].map(([k, c]) => [k, placeOf(c.first)]))

  // Where each row's kit goes: in its case, else at its place.
  const whereOf = new Map<Read, PlannedWhere>()
  const whereSaid = new Map<Read, string>()
  for (const r of live) {
    const place = placeRefs.get(r) ?? null
    let w: PlannedWhere = { place, case: null }
    let said = place ? `At ${r.placeCell.trim()}${place.key ? ' (new place)' : ''}` : ''
    if (r.caseCell) {
      const c = caseRefs.get(norm(r.caseCell))!
      if ('problem' in c) r.problems.push({ field: 'case', text: c.problem })
      else {
        w = { place: null, case: c.ref }
        said = `In ${c.said}${c.made ? ' (new case)' : ''}`
        if (c.made && !options.make)
          r.problems.push({ field: 'case', text: `${r.caseCell.trim()} isn't a case here yet. Tick “Make the places and cases this list names”, or fix the case.`, tick: true })
        const own = itemsOf.get(r)!.some((i) => (i.known ? i.known.id === c.ref.id : i.key === c.ref.key)) || (caseCountNew.get(r) ?? []).includes(c.ref.key ?? '')
        if (own) r.problems.push({ field: 'case', text: "A case can't go inside itself." })
      }
    }
    whereOf.set(r, w)
    whereSaid.set(r, said)
  }
  const atSaid = (r: Read) => {
    const s = whereSaid.get(r) ?? ''
    return s ? `${s[0]!.toLowerCase()}${s.slice(1)}` : ''
  }

  // The plan, and each row's words.
  const plan: StockPlan = { places: [...newPlaces].map(([k, p]) => ({ key: `place:${k}`, ...p })), products: [], productChanges: [], items: [], changes: [], counts: [], prices: [] }
  const modelRef = (g: Group): StockRef => (g.known ? { id: g.known.id } : { key: `product:${g.key}` })
  // Counted rows by product and where, so two rows counting one thing in one place are marked, and labelling takes from a count only the list leaves alone.
  const countedRows = new Map<string, Read>()
  // With "Put all of it there" ticked, a product the list has at two places is all at the one typed: its rows are added up into
  // the first one's count (audit, 20 October 2026, finding 105).
  const countOf = new Map<Read, number>()
  const addedInto = new Map<Read, Read>()
  for (const r of live) {
    const g = groupOf(r)
    if (!g || r.numbered || r.qty === null || g.isCase) continue
    const k = `${refKey(modelRef(g))}@${whereKey(whereOf.get(r)!)}`
    const first = countedRows.get(k)
    if (first && options.allAt && r.typedPlace && first.typedPlace) {
      countOf.set(first, (countOf.get(first) ?? first.qty!) + r.qty)
      addedInto.set(r, first)
    } else if (first) r.problems.push({ field: null, text: `Row ${first.input.row} counts ${g.name} ${atSaid(first).replace(/ \(new (place|case)\)$/, '')} too. Add them up into one row, or skip one.` })
    else countedRows.set(k, r)
  }
  // Where the list counts each product, so a count elsewhere is one the list doesn't mention.
  const countedAt = new Map<string, Set<string>>()
  for (const [k, r] of countedRows) {
    const m = k.slice(0, k.lastIndexOf('@'))
    countedAt.set(m, (countedAt.get(m) ?? new Set()).add(whereKey(whereOf.get(r)!)))
  }
  const takeable = new Map<string, number>()

  const said = new Map<Read, { does: string[]; updates: boolean }>()
  const doing = (r: Read) => {
    let s = said.get(r)
    if (!s) said.set(r, (s = { does: [], updates: false }))
    return s
  }
  for (const g of groups.values()) {
    const first = g.rows[0]!
    const makesItems = (r: Read) => r.numbered || g.isCase
    const patDays = g.rows.some((r) => makesItems(r) && r.patDue)
    const notes = [g.rows.find((r) => r.description)?.description ?? '', ...g.rows.filter((r) => !makesItems(r) && r.notes).map((r) => r.notes)]
      .filter((x, i, all) => x && all.indexOf(x) === i)
      .join('\n')
    if (!g.known) {
      const numbered = g.isCase || g.rows.some((r) => r.numbered || r.patDue) || (g.valueCents ?? 0) >= NUMBERED_FROM_CENTS
      const tracking: Tracking = numbered ? 'serialised' : 'bulk'
      const patMonths = patDays ? LIST_PAT_MONTHS : null
      plan.products.push({
        key: `product:${g.key}`,
        row: first.input.row,
        name: g.name,
        department: g.department,
        category: g.category,
        tracking,
        isCase: g.isCase,
        valueCents: g.valueCents,
        patMonths,
        notes: notes.slice(0, 2000),
        ...(g.listId ? { listId: g.listId } : {}),
      })
      const how = !numbered ? 'counted' : g.isCase ? 'numbered, holds other kit' : g.rows.some(makesItems) ? 'numbered' : 'numbered, counted until labelled'
      if (g.dayCents !== null) plan.prices.push({ row: first.input.row, model: { key: `product:${g.key}` }, dayCents: g.dayCents })
      doing(first).does.push(`New product, ${how}${patMonths ? `, a PAT every ${patMonths} months` : ''}${g.dayCents !== null ? `, ${dayLabel(g.dayCents)}` : ''}`)
    } else {
      const k = g.known
      const change: PlannedProductChange = { id: k.id, name: k.name, row: first.input.row }
      const parts: string[] = []
      if (norm(k.name) !== g.key) {
        change.rename = g.name
        parts.push(`renamed ${g.name}`)
      }
      if (g.listId && k.listId !== g.listId) {
        change.listId = g.listId
        parts.push(`its id in the old system kept, ${g.listId}`)
      }
      if (k.tracking === 'bulk' && (g.isCase || g.rows.some((r) => r.numbered))) {
        change.tracking = 'serialised'
        parts.push('numbered')
      }
      if (g.isCase && !k.isCase) {
        change.isCase = true
        parts.push('holds other kit')
      }
      if (k.valueCents === null && g.valueCents !== null) {
        change.valueCents = g.valueCents
        parts.push(`value ${valueLabel(g.valueCents)}`)
      }
      if (k.patMonths === null && patDays) {
        change.patMonths = LIST_PAT_MONTHS
        parts.push(`a PAT every ${LIST_PAT_MONTHS} months`)
      }
      const withList = withNotes(k.notes, notes)
      if (withList !== k.notes) {
        change.notes = withList
        parts.push('notes added to')
      }
      // The list fills a price list that has none for it, as it fills a blank value; a price set here stays.
      const prices = k.dayCents === null && g.dayCents !== null
      if (prices) plan.prices.push({ row: first.input.row, model: { id: k.id }, dayCents: g.dayCents! })
      if (parts.length) plan.productChanges.push(change)
      if (prices) parts.push(`day price ${valueLabel(g.dayCents!)}`)
      // A figure set here that the list differs from stays, and is said, so a change in the old system's rates isn't missed (audit, 20 October 2026, finding 106).
      if (typeof k.dayCents === 'number' && g.dayCents !== null && g.dayCents !== k.dayCents)
        first.asides.push(`Day price ${valueLabel(g.dayCents)} in the list; ${valueLabel(k.dayCents)} here stays. Change it on the product's page.`)
      if (k.valueCents !== null && g.valueCents !== null && g.valueCents !== k.valueCents)
        first.asides.push(`Value ${valueLabel(g.valueCents)} in the list; ${valueLabel(k.valueCents)} here stays. Change it on the product's page.`)
      if (parts.length) {
        const s = doing(first)
        s.does.push(`Updates ${k.name}: ${inWords(parts)}`)
        s.updates = true
      }
    }
  }

  // Cases to make, from their names alone.
  for (const [k, c] of newCases) {
    let model: StockRef
    // A product here named as a case holds other kit already, or the list makes it, as its own rows say.
    if (c.known) model = { id: c.known.id }
    else {
      model = { key: `product:${k}` }
      if (!plan.products.some((p) => p.key === model.key))
        plan.products.push({ key: model.key!, row: c.first.input.row, name: c.product, department: groupOf(c.first)?.department ?? 'other', category: 'Cases', tracking: 'serialised', isCase: true, valueCents: null, patMonths: null, notes: '' })
    }
    plan.items.push({ key: `case:${k}`, row: c.first.input.row, model, number: null, oldNumber: '', serial: '', patDue: null, notes: '', where: { place: newCasePlaces.get(k) ?? null, case: null }, fromCount: false, isCase: true })
  }

  for (const r of live) {
    const g = groupOf(r)
    if (!g) continue
    const w = whereOf.get(r)!
    const s = doing(r)
    const model = modelRef(g)
    if (r.numbered || g.isCase) {
      const fresh: PlannedItem[] = []
      const isNew = (i: ItemOf): i is Extract<ItemOf, { key: string }> => !i.known
      const listed = r.numbered ? itemsOf.get(r)! : (caseCountNew.get(r) ?? []).map((key): ItemOf => ({ key, number: null, oldNumber: '', serial: '' }))
      // Labelling one that was counted takes it off the count, unless the list counts it there itself.
      const k = `${refKey(model)}@${whereKey(w)}`
      if (!takeable.has(k))
        takeable.set(k, countedRows.has(k) || (!w.place?.id && !w.case?.id) || !g.known ? 0 : (countNow.get(`${g.known.id}@${w.case ? `c:${w.case.id}` : `p:${w.place!.id}`}`) ?? 0))
      let took = 0
      for (const i of listed) {
        if (isNew(i)) {
          const fromCount = takeable.get(k)! > 0
          if (fromCount) {
            takeable.set(k, takeable.get(k)! - 1)
            took++
          }
          fresh.push({ key: i.key, row: r.input.row, model, number: i.number, oldNumber: i.oldNumber, serial: i.serial, patDue: r.patDue, notes: r.notes, where: w, fromCount, isCase: g.isCase })
        }
      }
      plan.items.push(...fresh)
      if (fresh.length) {
        const kept = fresh.filter((i) => i.number).map((i) => i.number!)
        const numbered = fresh.length - kept.length
        const keptSaid = kept.length > 3 ? `${kept.slice(0, 2).join(', ')} and ${kept.length - 2} more` : inWords(kept)
        const how = kept.length
          ? `: keeps ${keptSaid}${numbered ? `, and ${numbered} numbered when brought in` : ''}`
          : `, numbered when brought in`
        s.does.push(`${plural(fresh.length, 'new item')}${how}`)
      }
      if (took) {
        s.does.push(`Takes ${took} off the ${takeable.get(k)! + took} counted ${atSaid(r)}`)
        s.updates = true
      }
      const changed: string[] = []
      for (const i of itemsOf.get(r) ?? []) {
        if (!i.known) continue
        const item = i.known
        const change: PlannedChange = { row: r.input.row, id: item.id }
        const parts: string[] = []
        const moves = (w.case || w.place) && !(w.case ? item.caseId === w.case.id && !w.case.key : item.placeId === w.place!.id && !item.caseId && !w.place!.key)
        if (moves) {
          change.where = w
          parts.push(`moves ${w.case ? 'into' : 'to'} ${(whereSaid.get(r) ?? '').replace(/^(At|In) /, '')}`)
        }
        if (i.serial && norm(i.serial) !== norm(item.serial)) {
          change.serial = i.serial
          parts.push(`serial to ${i.serial}`)
        }
        if (i.tag && !i.sh && norm(i.tag) !== norm(item.oldNumber)) {
          change.oldNumber = i.tag
          parts.push(`old number to ${i.tag}`)
        }
        if (r.patDue && r.patDue !== item.patDue) {
          change.patDue = r.patDue
          parts.push(`PAT due ${fullDayLabel(r.patDue)}`)
        }
        const notes = r.notes ? withNotes(item.notes, r.notes) : item.notes
        if (notes !== item.notes) {
          change.notes = notes
          parts.push('notes added to')
        }
        if (parts.length) {
          plan.changes.push(change)
          changed.push(`${item.number || 'An item'}: ${inWords(parts)}`)
        }
      }
      if (changed.length) {
        s.does.push(...(changed.length > 3 ? [...changed.slice(0, 2), `${changed.length - 2} more changed as the list says`] : changed))
        s.updates = true
      }
    } else if (r.qty !== null) {
      if (!w.place && !w.case) {
        // A case that couldn't be named has said so already.
        if (!r.caseCell)
          r.problems.push({ field: 'place', text: "Say where these are kept: counted stock is at a place or in a case. Fill in the place, or the place for kit the list doesn't place, above." })
        continue
      }
      if (r.patDue) r.asides.push("A PAT due day is kept on each item, so it isn't kept for counted stock.")
      const now = g.known && !w.place?.key && !w.case?.key ? (countNow.get(`${g.known.id}@${w.case ? `c:${w.case.id}` : `p:${w.place!.id}`}`) ?? 0) : 0
      const into = addedInto.get(r)
      if (into) s.does.push(`Added into row ${into.input.row}'s count ${atSaid(r)}`)
      if (countedRows.get(`${refKey(model)}@${whereKey(w)}`) !== r) continue
      const qty = countOf.get(r) ?? r.qty
      if (qty !== now) {
        plan.counts.push({ row: r.input.row, model, where: w, qty })
        s.does.push(`Counts ${qty.toLocaleString('en-IE')} ${atSaid(r)}${now ? ` (${now.toLocaleString('en-IE')} there now)` : ''}`)
        if (now) s.updates = true
      }
      // Counted at a place the list doesn't count it (audit, 20 October 2026, finding 7). Where the office typed the place
      // for the list, the list's count is all of it, so the count there is taken off (ADR 0061); a row's own place leaves it.
      if (g.known && !w.case) {
        const listed = countedAt.get(refKey(model))!
        const here = atSaid(r).replace(/ \(new (place|case)\)$/, '')
        for (const e of known.counts) {
          if (e.modelId !== g.known.id || e.caseId || !e.placeId || e.qty <= 0 || listed.has(`p:${e.placeId}`)) continue
          const at = placeById.get(e.placeId)?.name ?? 'another place'
          const n = e.qty.toLocaleString('en-IE')
          if (r.typedPlace) {
            plan.counts.push({ row: r.input.row, model, where: { place: { id: e.placeId }, case: null }, qty: 0 })
            s.does.push(`Counts none at ${at} (${n} there now): the list counts them all ${here}`)
            s.updates = true
          } else r.asides.push(`${n} more at ${at}, which the list doesn't count, so that count stays.`)
        }
      }
    }
  }

  // A new product much like one here the list doesn't name: the same category, value and count, as a rename in the old system looks.
  const heldOf = (p: KnownProduct) => known.counts.filter((c) => c.modelId === p.id).reduce((n, c) => n + c.qty, 0) + activeOf(p.id).length
  const unnamed = known.products.filter((p) => !p.mistake && !claimed.has(p.id))
  for (const g of groups.values()) {
    if (g.known || g.rows.some((r) => r.numbered || r.qty === null)) continue
    const qty = g.rows.reduce((n, r) => n + r.qty!, 0)
    const like = unnamed.filter(
      (p) => qty > 0 && p.valueCents === g.valueCents && p.category !== undefined && norm(p.category) === norm(g.category) && !(p.listId && g.listId) && heldOf(p) === qty
    )
    if (like.length === 1)
      g.rows[0]!.asides.push(`Looks like ${like[0]!.name} renamed: the same category, value and count. If it is, rename ${like[0]!.name} to ${g.name} on its page first, so it isn't counted twice.`)
  }

  // Each row as the preview shows it.
  const out: StockListPreviewRow[] = rows.map((r) => {
    const g = groupOf(r)
    const s = r.live ? said.get(r) : undefined
    const does = s?.does.length ? s.does : r.live && r.name ? [UNCHANGED] : []
    const n = r.numbered ? Math.max(r.tags.length, r.serials.length) : r.qty
    const items = r.numbered || g?.isCase
    const facts = [
      n === null ? '' : items ? plural(n, 'item') : `${n.toLocaleString('en-IE')} counted`,
      g?.known ? '' : DEPARTMENT_LABELS[r.department ?? g?.department ?? 'other'],
      r.category,
      r.valueCents !== null ? valueLabel(r.valueCents) : '',
      r.dayCents !== null ? dayLabel(r.dayCents) : '',
      r.patDue ? `PAT due ${fullDayLabel(r.patDue)}` : '',
    ].filter(Boolean)
    return {
      ...r.input,
      skip: !r.live,
      product: r.name,
      facts: facts.join(' · '),
      where: (r.live && whereSaid.get(r)) || (r.live && r.numbered ? 'Not placed yet' : ''),
      does,
      asides: r.asides,
      problems: r.problems,
      changes: does.length > 0 && does[0] !== UNCHANGED,
      updates: !!s?.updates,
    }
  })
  const liveOut = out.filter((r) => !r.skip)
  const counts: StockListCounts = {
    rows: out.length,
    products: plan.products.length,
    items: plan.items.length,
    counted: plan.counts.length,
    updates: liveOut.filter((r) => r.updates).length,
    unchanged: liveOut.filter((r) => !r.changes && r.problems.length === 0).length,
    skipped: out.length - liveOut.length,
    problems: liveOut.filter((r) => r.problems.length > 0).length,
  }
  return {
    rows: out,
    counts,
    places: [...newPlaces.values()].map((p) => p.name),
    cases: [...newCases.values()].map((c) => c.name),
    plan,
  }
}
