import { MAX_QTY, RETIRED_LABELS, type AssetView, type CountDraft, type CountItem, type View } from '@sh/shared'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Refusal, useAct } from '../act.tsx'
import { Empty } from '../Empty.tsx'
import { ShowAll } from '../Fold.tsx'
import { numberLabel, ProductChoices } from './common.tsx'
import { jobName, keptWords } from './countWords.ts'

/**
 * The kit in a count (ADR 0030): items by product with their numbers, and
 * counted kit, a number per product.
 */

/**
 * Items by product, each number a link to its page, as on a place's page: how many in each product's name, and its first
 * twenty numbers until Show all, as the catalogue does (audit, 20 October 2026, finding 43).
 */
export function Numbers({ title, items, view, each }: { title?: string; items: readonly CountItem[]; view: View; each: string }) {
  const w = view.warehouse
  const groups = new Map<string, AssetView[]>()
  for (const i of items) {
    const a = w.assets.get(i.assetId)
    if (a) groups.set(a.modelId, [...(groups.get(a.modelId) ?? []), a])
  }
  return (
    <div className="group">
      {title && <h3>{title}</h3>}
      {[...groups.values()].map((list) => (
        <div key={list[0]!.modelId}>
          <p className="group-name">
            {list[0]!.model?.name ?? 'A product since removed'}{' '}
            <small>
              · {list.length.toLocaleString('en-IE')} {each}
            </small>
          </p>
          <ShowAll items={list} limit={20} what="numbers">
            {(shown) => (
              <ul className="numbers">
                {shown.map((a) => (
                  <li key={a.id}>
                    <a href={`#stock/item/${a.id}`}>{numberLabel(a)}</a>
                  </li>
                ))}
              </ul>
            )}
          </ShowAll>
        </div>
      ))}
    </div>
  )
}

/** What a count said of an item scanned that wasn't as recorded, in words. */
export function itemWords(view: View, i: CountItem): string {
  const w = view.warehouse
  const a = w.assets.get(i.assetId)
  switch (i.said) {
    case 'elsewhere':
    case 'in-case':
      return `Found here, ${keptWords(i, w)}.`
    case 'out':
      return `Recorded as out with ${jobName(view, i.projectId)}.`
    case 'missing':
      return 'Reported missing.'
    case 'retired':
      return a?.retiredReason === 'mistake' ? 'Added by mistake.' : `Marked as ${a?.retiredReason ? RETIRED_LABELS[a.retiredReason].toLowerCase() : 'retired'}.`
    default:
      return ''
  }
}

/**
 * Counted kit: a number per product, without the record beside it (a blind
 * count, as the research says: a counter shown 120 tends to find 120). One
 * left blank isn't counted; 0 is none there. A product that's there but
 * wasn't expected is added by name.
 */
export function CountedKit({
  view,
  d,
  products,
  onChange,
  onAdd,
}: {
  view: View
  d: CountDraft
  products: string[]
  onChange: (counted: Record<string, number>) => void
  onAdd: (modelId: string) => void
}) {
  const w = view.warehouse
  const [adding, setAdding] = useState('')
  // What's typed here; a number typed in another tab shows from the count itself.
  const [typed, setTyped] = useState<Record<string, string>>({})
  const added = useRef<string>('')
  const { error, refuse } = useAct()
  const model = (id: string) => w.models.find((m) => m.id === id)
  useEffect(() => {
    if (!added.current) return
    document.getElementById(`count-${added.current}`)?.focus()
    added.current = ''
  }, [products.length])
  const set = (modelId: string, text: string) => {
    setTyped({ ...typed, [modelId]: text })
    const n = Number(text)
    const counted = { ...d.counted }
    if (text.trim() === '' || !Number.isInteger(n) || n < 0 || n > MAX_QTY) delete counted[modelId]
    else counted[modelId] = n
    onChange(counted)
  }
  const add = (e: FormEvent) => {
    e.preventDefault()
    const m = w.models.find((x) => x.name.trim().toLowerCase() === adding.trim().toLowerCase())
    if (!m) return refuse(`No product is called ${adding.trim()}. Add it on the Stock page first.`)
    if (products.includes(m.id)) return refuse(`${m.name} is on the count already.`)
    refuse('')
    added.current = m.id
    onAdd(m.id)
    setAdding('')
  }
  return (
    <section className="card counted-kit" aria-label="Counted kit">
      <h2>Counted kit</h2>
      <p className="hint">Type how many you count of each, without looking at the record: they're compared when you finish. Leave one blank if you didn't count it.</p>
      {products.length === 0 && <Empty>Nothing counted is recorded here. Add a product below if there is some.</Empty>}
      {products.map((id) => {
        const m = model(id)
        return (
          <label key={id} className="count-field">
            <span>
              <b>{m?.name ?? 'A product since removed'}</b>
              {m?.tracking === 'serialised' && <small>Not labelled yet</small>}
            </span>
            <input
              id={`count-${id}`}
              type="number"
              inputMode="numeric"
              min={0}
              max={MAX_QTY}
              value={typed[id] ?? String(d.counted[id] ?? '')}
              onChange={(e) => set(id, e.target.value)}
              placeholder="How many"
            />
          </label>
        )
      })}
      <form className="add-product" onSubmit={add}>
        <label className="field">
          A product that's here but not on the list
          <input list="product-names" value={adding} onChange={(e) => setAdding(e.target.value)} placeholder="e.g. XLR 10 m" autoComplete="off" />
        </label>
        <button type="submit">Add</button>
      </form>
      <Refusal error={error} />
      <ProductChoices w={w} />
    </section>
  )
}
