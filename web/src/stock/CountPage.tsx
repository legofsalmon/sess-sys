import {
  countSetTo,
  countSummaryWords,
  dayLabel,
  keptWithin,
  normaliseNumber,
  RETIRED_LABELS,
  type AssetView,
  type CountItem,
  type CountProduct,
  type CountView,
  type View,
  type WarehouseView,
  type Where,
  type Ability,
} from '@sh/shared'
import { useState, type ReactNode } from 'react'
import { Refusal, useAct } from '../act.tsx'
import { Top } from '../jobs/common.tsx'
import { useAccess } from '../role.ts'
import { Pending } from '../StatusPill.tsx'
import { client } from '../sync.ts'
import { closeFault, reportFault } from './Faults.tsx'
import { STOCK } from '../Up.tsx'
import { isHere, itemName, jobName, keptWords, openMissing, since, time } from './countWords.ts'
import { Numbers } from './CountKit.tsx'

/**
 * A count's page (ADR 0030): what it found, each difference with its fix.
 */

/** #stock/count/<id>: what a count found, each difference with its fix, worked out against what this phone holds now. */
export function CountPage({ view, id }: { view: View; id: string }) {
  const c = view.counts.byId(id)
  const up = { steps: c ? [STOCK, { href: c.placeId ? `#stock/place/${c.placeId}` : `#stock/item/${c.caseId}`, label: c.what }] : [STOCK], here: c && 'Count' }
  if (!c)
    return (
      <div className="app warehouse counting">
        <Top view={view} title="Stock" up={up} />
        <section className="card">
          <header className="title">
            <h1>A count</h1>
          </header>
          <p className="empty">This count isn't on this device. It may still be on its way: check again once it says “Up to date”.</p>
        </section>
      </div>
    )
  const at: Where = { placeId: c.placeId, caseId: c.caseId }
  const items = (...kinds: CountItem['said'][]) => c.items.filter((i) => kinds.includes(i.said))
  return (
    <div className="app warehouse counting">
      <Top view={view} title="Stock" up={up} />
      <section className="card">
        <header className="title">
          <h1>Count of {c.what}</h1>
          <Pending pending={c.pending} />
        </header>
        <dl className="facts">
          <div>
            <dt>When</dt>
            <dd>
              {dayLabel(c.day)}, {time(c.startedAt)} to {time(c.finishedAt)}
            </dd>
          </div>
          <div>
            <dt>Counted by</dt>
            <dd>{c.person?.name ?? 'Not said'}</dd>
          </div>
          <div className="wide">
            <dt>What it found</dt>
            <dd>{countSummaryWords(c.summary)}</dd>
          </div>
        </dl>
      </section>
      <NotFound view={view} c={c} at={at} list={items('not-found')} />
      <Elsewhere view={view} at={at} list={items('elsewhere')} />
      <NotExpected view={view} c={c} at={at} />
      <Products view={view} c={c} at={at} />
      <Rest view={view} c={c} />
    </div>
  )
}

/**
 * A fix: one existing command (or two), with its refusal under it. Held while it's being kept, so a second tap can't send it twice.
 * Not drawn for a role without what it `needs` (audit finding 9): stock's, but for reporting kit missing, which anyone can.
 */
function Fix({ label, act, className, needs = 'stock' }: { label: string; act: () => Promise<unknown>; className?: string; needs?: Ability }) {
  const { run, error } = useAct()
  const [busy, setBusy] = useState(false)
  const may = useAccess().can(needs)
  const go = () => {
    setBusy(true)
    void run(act).finally(() => setBusy(false))
  }
  if (!may) return null
  return (
    <>
      <button type="button" className={className} onClick={go} disabled={busy}>
        {label}
      </button>
      <Refusal error={error} />
    </>
  )
}

/** A row on a count's page: what, what the count said, and its fix or what's become of it since. */
function Line({ title, href, said, children }: { title: string; href?: string; said: ReactNode; children?: ReactNode }) {
  return (
    <li className="count-line">
      <div>
        {href ? <a href={href}>{title}</a> : <b>{title}</b>}
        <p>{said}</p>
      </div>
      <div className="actions">{children}</div>
    </li>
  )
}

function NotFound({ view, c, at, list }: { view: View; c: CountView; at: Where; list: CountItem[] }) {
  if (list.length === 0) return null
  const w = view.warehouse
  const report = (a: AssetView) => reportFault({ kind: 'missing', assetId: a.id, modelId: a.modelId, qty: 1, projectId: null, usable: false, note: `Not found in the count of ${c.what}.` })
  const rows = list.map((i) => {
    const a = w.assets.get(i.assetId)
    const done = since(view, a, true) ?? (a && !isHere(a, at) ? `Now ${keptWords(a, w)}.` : undefined)
    return { i, a, done }
  })
  const toDo = rows.filter((r) => !r.done && r.a).map((r) => r.a!)
  return (
    <section className="card count-fixes" aria-label="Not found">
      <h2>Not found ({list.length})</h2>
      <p className="hint">Expected here and not scanned. Look again, or report it missing: it joins the repair list, and scanning it later marks it found.</p>
      <ul className="count-lines">
        {rows.map(({ i, a, done }) => (
          <Line key={i.assetId} title={itemName(a)} href={a && `#stock/item/${a.id}`} said={done ?? 'Not scanned.'}>
            {!done && a && <Fix label="Report missing" act={() => report(a)} needs="fault" />}
          </Line>
        ))}
      </ul>
      {toDo.length > 1 && <Fix className="all" label={`Report all ${toDo.length} missing`} act={async () => { for (const a of toDo) await report(a) }} needs="fault" />}
    </section>
  )
}

function Elsewhere({ view, at, list }: { view: View; at: Where; list: CountItem[] }) {
  if (list.length === 0) return null
  const w = view.warehouse
  const move = (a: AssetView) => client.mutate('asset.move', { id: a.id, ...at })
  const doneOf = (i: CountItem, a: AssetView | undefined) => {
    if (a && keptWithin(a, at)) return 'Moved here.'
    const gone = since(view, a, false)
    if (gone || !a) return gone
    // Moved somewhere else since the count: that's newer word than the count's, so it isn't moved back.
    return a.placeId !== (i.placeId ?? null) || a.caseId !== (i.caseId ?? null) ? `Now ${keptWords(a, w)}.` : undefined
  }
  const rows = list.map((i) => {
    const a = w.assets.get(i.assetId)
    return { i, a, done: doneOf(i, a) }
  })
  const toDo = rows.filter((r) => !r.done && r.a).map((r) => r.a!)
  return (
    <section className="card count-fixes" aria-label="In the wrong place">
      <h2>In the wrong place ({list.length})</h2>
      <p className="hint">Scanned here, but recorded somewhere else. Move it here, or leave it.</p>
      <ul className="count-lines">
        {rows.map(({ i, a, done }) => (
          <Line key={i.assetId} title={itemName(a)} href={a && `#stock/item/${a.id}`} said={done ?? `Was ${keptWords(i, w)}.`}>
            {!done && a && <Fix label="Move here" act={() => move(a)} />}
          </Line>
        ))}
      </ul>
      {toDo.length > 1 && <Fix className="all" label={`Move all ${toDo.length} here`} act={async () => { for (const a of toDo) await move(a) }} />}
    </section>
  )
}

/** Scanned, but retired, reported missing or out with a job; and numbers no item has. */
function NotExpected({ view, c, at }: { view: View; c: CountView; at: Where }) {
  const w = view.warehouse
  const list = c.items.filter((i) => i.scanned && (i.said === 'retired' || i.said === 'missing' || i.said === 'out'))
  if (list.length === 0 && c.unknown.length === 0) return null
  const line = (i: CountItem) => {
    const a = w.assets.get(i.assetId)
    const title = itemName(a)
    const href = a && `#stock/item/${a.id}`
    if (i.said === 'retired') {
      const mistake = a?.retiredReason === 'mistake' || !!(a && w.mistakes.has(a.modelId))
      const still = a?.status === 'retired'
      return (
        <Line key={i.assetId} title={title} href={href} said={!still ? 'Brought back.' : mistake ? 'Added by mistake, so it stays out of the stock list.' : `Marked as ${a?.retiredReason ? RETIRED_LABELS[a.retiredReason].toLowerCase() : 'retired'}, but it's here.`}>
          {still && !mistake && a && (
            <Fix
              label="Bring it back and keep it here"
              act={async () => {
                await client.mutate('asset.reinstate', { id: a.id })
                await client.mutate('asset.move', { id: a.id, ...at })
              }}
            />
          )}
        </Line>
      )
    }
    if (i.said === 'missing') {
      const fault = a && openMissing(view, a.id)
      const elsewhere = !!a && a.status === 'active' && !keptWithin(a, at)
      return (
        <Line key={i.assetId} title={title} href={href} said={fault ? `Reported missing, but it's here${elsewhere ? `. It was ${keptWords(i, w)}` : ''}.` : 'Marked found.'}>
          {fault && a && (
            <Fix
              label={elsewhere ? 'Mark found and keep it here' : 'Mark found'}
              act={async () => {
                await closeFault(fault, 'found')
                if (elsewhere) await client.mutate('asset.move', { id: a.id, ...at })
              }}
            />
          )}
        </Line>
      )
    }
    const out = a ? view.moves.outOf(a.id) : undefined
    return (
      <Line
        key={i.assetId}
        title={title}
        href={href}
        said={
          out ? (
            <>
              Recorded as out with {jobName(view, out.projectId)}, but it's here. Scan it back in on <a href={`#jobs/${out.projectId}/pick`}>the job's pick list</a>.
            </>
          ) : (
            'Recorded as out with a job when counted; scanned back in since.'
          )
        }
      />
    )
  }
  return (
    <section className="card count-fixes" aria-label="Not expected">
      <h2>Not expected ({list.length + c.unknown.length})</h2>
      <ul className="count-lines">
        {list.map(line)}
        {c.unknown.map((code) => {
          const now = normaliseNumber(code) ? w.byNumber.get(normaliseNumber(code)!) : undefined
          return (
            <Line
              key={code}
              title={code}
              said={
                now ? (
                  `Now on ${itemName(now)}.`
                ) : (
                  <>
                    No item has this number. Scan or type it in <a href="#stock">the Stock search</a> to put it on its item.
                  </>
                )
              }
            />
          )
        })}
      </ul>
    </section>
  )
}

/** "XLR 10 m", or "d&b Y10P, not labelled yet" for a numbered product's counted ones. */
function productLabel(w: WarehouseView, modelId: string): string {
  const m = w.models.find((x) => x.id === modelId)
  return m ? `${m.name}${m.tracking === 'serialised' ? ', not labelled yet' : ''}` : 'A product since removed'
}

/** Counted kit: counted against recorded, how many were away, and what the fix sets it to (ADR 0030). */
function Products({ view, c, at }: { view: View; c: CountView; at: Where }) {
  if (c.products.length === 0) return null
  const w = view.warehouse
  const here = (at.placeId ? w.places.find((p) => p.id === at.placeId)?.counted : w.assets.get(at.caseId ?? '')?.counted) ?? []
  const now = (modelId: string) => here.find((s) => s.modelId === modelId)?.qty ?? 0
  const set = (p: CountProduct, qty: number) => client.mutate('stock.set', { modelId: p.modelId, ...at, qty })
  const rows = c.products.map((p) => {
    const setTo = countSetTo(p)
    const off = setTo !== null && setTo !== p.recorded
    const n = now(p.modelId)
    // Set only while the record is what the count was compared with: changed since (counted again, say), it's newer than the count.
    return { p, setTo, off, toDo: off && n === p.recorded, changed: off && n !== p.recorded && n !== setTo }
  })
  const toDo = rows.filter((r) => r.toDo)
  const words = ({ p, setTo, off, changed }: (typeof rows)[number]) => {
    if (p.counted === null) return `Not counted; ${p.recorded.toLocaleString('en-IE')} recorded.`
    const away = p.away ? `, ${p.away.toLocaleString('en-IE')} out with jobs or reported missing` : ''
    const base = `${p.counted.toLocaleString('en-IE')} counted, ${p.recorded.toLocaleString('en-IE')} recorded${away}`
    // Fewer on the shelf than recorded, but no more than are away: a loss, if any, waits until they're back, and the next count finds it.
    if (!off || setTo === null)
      return p.counted < p.recorded
        ? `${base}: the ${(p.recorded - p.counted).toLocaleString('en-IE')} not here may be among those away, so it stays as recorded.`
        : `${base}: as recorded.`
    const said = `${base}: ${Math.abs(setTo - p.recorded).toLocaleString('en-IE')} ${setTo < p.recorded ? 'short' : 'over'}.`
    return changed ? `${said} The record has changed since: ${now(p.modelId).toLocaleString('en-IE')} now.` : said
  }
  return (
    <section className="card count-fixes" aria-label="Counted kit">
      <h2>Counted kit</h2>
      <p className="hint">Kit out with a job, or reported missing, stays in the count it came from, so a count is never lowered for it.</p>
      <ul className="count-lines">
        {rows.map((r) => (
          <Line key={r.p.modelId} title={productLabel(w, r.p.modelId)} href={`#stock/product/${r.p.modelId}`} said={words(r)}>
            {r.off && r.setTo !== null && !r.changed && (r.toDo ? <Fix label={`Set to ${r.setTo.toLocaleString('en-IE')}`} act={() => set(r.p, r.setTo!)} /> : <span className="done">Set to {r.setTo.toLocaleString('en-IE')}</span>)}
          </Line>
        ))}
      </ul>
      {toDo.length > 1 && <Fix className="all" label={`Set all ${toDo.length} counts`} act={async () => { for (const r of toDo) await set(r.p, r.setTo!) }} />}
    </section>
  )
}

/** What was as recorded, folded: found, and kit away (out with a job, already missing, in repair) that the count said nothing new about. */
function Rest({ view, c }: { view: View; c: CountView }) {
  const w = view.warehouse
  const found = c.items.filter((i) => i.said === 'found' || i.said === 'in-case')
  const away = c.items.filter((i) => !i.scanned && (i.said === 'out' || i.said === 'missing' || i.said === 'repair'))
  if (found.length === 0 && away.length === 0) return null
  const fault = (id: string) => view.faults.ofAsset(id).find((f) => f.kind === 'damaged' && f.open)
  return (
    <section className="card">
      {found.length > 0 && (
        <details>
          <summary>Found ({found.length.toLocaleString('en-IE')})</summary>
          <Numbers items={found} view={view} each="found" />
        </details>
      )}
      {away.length > 0 && (
        <details>
          <summary>Out with jobs, missing or in repair ({away.length})</summary>
          <ul className="count-lines">
            {away.map((i) => {
              const a = w.assets.get(i.assetId)
              const said =
                i.said === 'out'
                  ? `Out with ${jobName(view, i.projectId)}.`
                  : i.said === 'missing'
                    ? 'Already reported missing.'
                    : `In repair${a && fault(a.id)?.note ? `: ${fault(a.id)!.note}` : ''}.`
              return <Line key={i.assetId} title={itemName(a)} href={a && `#stock/item/${a.id}`} said={said} />
            })}
          </ul>
        </details>
      )}
    </section>
  )
}
