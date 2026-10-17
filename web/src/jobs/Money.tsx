import {
  addDays,
  costsCsv,
  dayLabel,
  daysLabel,
  DEPARTMENT_LABELS,
  DEPARTMENTS,
  euroText,
  invoicesCsv,
  money,
  moneyMonth,
  parseEuro,
  pctWord,
  plural,
  vatPeriodOf,
  vatSummaryCsv,
  type CostRow,
  type MoneyView,
  type Period,
  type View,
} from '@sh/shared'
import { useState, type FormEvent } from 'react'
import { Refusal, useAct } from '../act.tsx'
import { Empty } from '../Empty.tsx'
import { ShowAll } from '../Fold.tsx'
import { Heading } from '../Icon.tsx'
import { useAccess } from '../role.ts'
import { Pending } from '../StatusPill.tsx'
import { client } from '../sync.ts'
import { JOBS, MONEY } from '../Up.tsx'
import { useToday } from '../view.ts'
import { Top } from './common.tsx'
import { JobViews } from './PlanScreen.tsx'
import { QuotePill } from './Quote.tsx'

/**
 * Money (ADR 0042), #jobs/money, on Jobs' row, where the director looks:
 * by month, what's quoted, confirmed and invoiced; who still owes; what's
 * owed to freelancers; each job's margin; and the accountant's files. The
 * price list it's all built from is its own page beneath it,
 * #jobs/money/prices. The app keeps the records and makes the files; it
 * sends nothing and books nothing into accounts.
 */

function NotYours({ view, here }: { view: View; here?: string }) {
  return (
    <div className="app crew jobs money">
      <Top view={view} up={here ? { steps: [JOBS, MONEY], here } : undefined} />
      {!here && <JobViews current="money" />}
      <section className="card">
        <p className="empty">Money is for the office and directors. A director can change your role on the Crew tab.</p>
      </section>
    </div>
  )
}

export function MoneyScreen({ view }: { view: View }) {
  const today = useToday()
  if (!useAccess().can('money')) return <NotYours view={view} />
  const m = view.money
  const month = moneyMonth(today)
  const now = m.months.find((x) => x.key === month.key)
  const owed = m.owed.reduce((s, o) => s + o.cents, 0)
  const toFreelancers = m.costsOwed.reduce((s, c) => s + c.cents, 0)
  return (
    <div className="app crew jobs money">
      <Top view={view} />
      <JobViews current="money" />
      <section className="card">
        <h1 className="with-icon">
          <span>Money</span>
        </h1>
        <dl className="facts money-facts">
          <div>
            <dt>Quoted for {month.label}</dt>
            <dd>{money(now?.quoted ?? 0)}</dd>
          </div>
          <div>
            <dt>Confirmed</dt>
            <dd>{money(now?.confirmed ?? 0)}</dd>
          </div>
          <div>
            <dt>Owed by clients</dt>
            <dd>{money(owed)}</dd>
          </div>
          <div>
            <dt>Owed to freelancers</dt>
            <dd>{money(toFreelancers)}</dd>
          </div>
        </dl>
        <p className="hint">
          Before VAT, by the month each job starts, except what's owed, which is with VAT, as invoiced. <a href="#jobs/money/prices">Price list</a>
        </p>
      </section>
      {!m.any && (
        <section className="card">
          <Empty>Nothing yet. Set prices on the price list, then make a quote from a job's page.</Empty>
        </section>
      )}
      <ByMonth m={m} />
      <Owed m={m} />
      <Freelancers m={m} />
      <Margins m={m} />
      <ForTheAccountant m={m} />
    </div>
  )
}

function ByMonth({ m }: { m: MoneyView }) {
  if (!m.months.length) return null
  return (
    <section className="card" aria-label="By month">
      <Heading icon="calendar">By month</Heading>
      <div className="quote-table-wrap">
        <table className="quote-table money-months">
          <thead>
            <tr>
              <th scope="col">Month</th>
              <th scope="col">Quoted</th>
              <th scope="col">Confirmed</th>
              <th scope="col">Invoiced</th>
              <th scope="col">Freelancers</th>
            </tr>
          </thead>
          <tbody>
            {m.months.map((x) => (
              <tr key={x.key}>
                <th scope="row">{x.label}</th>
                <td className="n">{money(x.quoted)}</td>
                <td className="n">{money(x.confirmed)}</td>
                <td className="n">{money(x.invoiced)}</td>
                <td className="n">{money(x.costs)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="hint">Quoted counts the quote that stands on each job, sent or accepted; confirmed, the accepted ones. A job turned down or cancelled isn't counted.</p>
    </section>
  )
}

function Owed({ m }: { m: MoneyView }) {
  return (
    <section className="card" aria-label="Owed by clients">
      <Heading icon="company">Owed by clients</Heading>
      {m.owed.length === 0 ? (
        <Empty>Nobody owes anything: every accepted quote is marked paid.</Empty>
      ) : (
        m.owed.map((o) => (
          <div key={o.clientId ?? ''} className="owed">
            <div className="row">
              <b>{o.client}</b>
              <span className="amount">{money(o.cents)}</span>
            </div>
            <ul className="plain">
              {o.quotes.map(({ job, quote }) => (
                <li key={quote.id} className="row">
                  <div>
                    <a href={`#jobs/${encodeURIComponent(job.id)}/quote`}>{job.name}</a>
                    <p>
                      Version {quote.version} · {money(quote.totals.gross)}
                      {quote.invoicedOn ? ` · invoiced ${dayLabel(quote.invoicedOn)}${quote.invoiceRef ? ` as ${quote.invoiceRef}` : ''}` : ' · not invoiced yet'}
                    </p>
                  </div>
                  <QuotePill q={quote} />
                </li>
              ))}
            </ul>
          </div>
        ))
      )}
    </section>
  )
}

function Freelancers({ m }: { m: MoneyView }) {
  const today = useToday()
  const { run, error } = useAct()
  if (!m.costsOwed.length && !m.costsPaid.length) return null
  const row = (c: CostRow, paid: boolean) => (
    <div key={c.row.offer.id} className="row ts-row">
      <div>
        <b>{c.row.person?.name ?? 'Someone'}</b>
        <p>
          {c.row.call.project} · {c.row.call.role} · {daysLabel(c.row.timesheet?.days ?? c.row.offer.days)}
          {paid && c.paidOn && ` · paid ${dayLabel(c.paidOn)}`}
        </p>
      </div>
      <div className="actions">
        <span className="amount">{money(c.cents)}</span>
        <Pending pending={c.pending} />
        {paid ? (
          <button type="button" className="link" onClick={() => void run(() => client.mutate('cost.paid', { id: c.row.offer.id, on: null }))}>
            Not paid
          </button>
        ) : (
          <button
            type="button"
            onClick={() => void run(() => client.mutate('cost.paid', { id: c.row.offer.id, on: today }))}
            aria-label={`Mark ${c.row.person?.name ?? 'them'} paid for ${c.row.call.project}`}
          >
            Mark paid
          </button>
        )}
      </div>
    </div>
  )
  return (
    <section className="card timesheets" aria-label="Owed to freelancers">
      <Heading icon="timesheet">Owed to freelancers</Heading>
      <Refusal error={error} />
      {m.costsOwed.length === 0 ? (
        <Empty>Every approved timesheet is marked paid.</Empty>
      ) : (
        <ShowAll items={m.costsOwed} limit={5} what="timesheets">
          {(rows) => rows.map((c) => row(c, false))}
        </ShowAll>
      )}
      {m.costsPaid.length > 0 && (
        <div className="ts-group" role="group" aria-label="Paid lately">
          <h3>Paid lately</h3>
          {m.costsPaid.slice(0, 5).map((c) => row(c, true))}
        </div>
      )}
      <p className="hint">From approved timesheets, as approved. Mark one paid once the money has gone; the timesheet then stays as approved.</p>
    </section>
  )
}

function Margins({ m }: { m: MoneyView }) {
  const shown = m.jobs.filter((j) => j.current || j.costs > 0)
  if (!shown.length) return null
  return (
    <section className="card" aria-label="Margin by job">
      <Heading icon="calendar">Margin by job</Heading>
      <div className="quote-table-wrap">
        <table className="quote-table money-margins">
          <thead>
            <tr>
              <th scope="col">Job</th>
              <th scope="col">Quoted</th>
              <th scope="col">Freelancers</th>
              <th scope="col">Margin</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((j) => (
              <tr key={j.job.id}>
                <th scope="row">
                  <a href={`#jobs/${encodeURIComponent(j.job.id)}/quote`}>{j.job.name}</a>
                  {j.job.span && <small>{dayLabel(j.job.span.start)}</small>}
                </th>
                <td className="n">{j.current ? money(j.quoted) : 'No quote'}</td>
                <td className="n">
                  {money(j.costs)}
                  {j.toCome > 0 && <small>+ {money(j.toCome)} to come</small>}
                </td>
                <td className={`n${j.margin !== null && j.margin < 0 ? ' bad' : ''}`}>{j.margin === null ? '–' : money(j.margin)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="hint">The quote that stands, before VAT, less freelancers' approved timesheets and those booked and still to come at their booked rate. Staff and subhire aren't in it.</p>
    </section>
  )
}

/** The periods an accountant asks for: Revenue's two-month VAT periods lately, and whole years. */
function periodsTo(today: string): (Period & { key: string })[] {
  const out: (Period & { key: string })[] = []
  let d = today
  for (let i = 0; i < 6; i++) {
    const p = vatPeriodOf(d)
    out.push({ key: p.key, start: p.start, end: p.end, label: p.label })
    d = addDays(p.start, -1)
  }
  const year = Number(today.slice(0, 4))
  for (const y of [year, year - 1]) out.push({ key: String(y), start: `${y}-01-01`, end: `${y}-12-31`, label: `${y}${y === year ? ', so far' : ''}` })
  return out
}

function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv' }))
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

function ForTheAccountant({ m }: { m: MoneyView }) {
  const today = useToday()
  const periods = periodsTo(today)
  const [key, setKey] = useState(periods[1]!.key)
  const p = periods.find((x) => x.key === key) ?? periods[0]!
  const file = (what: string) => `session-hire-${what}-${p.start}-to-${p.end}.csv`
  return (
    <section className="card" aria-label="For the accountant">
      <Heading icon="download">For the accountant</Heading>
      <label className="field">
        Period
        <select value={key} onChange={(e) => setKey(e.target.value)}>
          {periods.map((x) => (
            <option key={x.key} value={x.key}>
              {x.label}
            </option>
          ))}
        </select>
      </label>
      <div className="actions">
        <button type="button" onClick={() => download(file('invoices'), invoicesCsv(m, p))}>
          Invoices
        </button>
        <button type="button" onClick={() => download(file('vat'), vatSummaryCsv(m, p))}>
          VAT by rate
        </button>
        <button type="button" onClick={() => download(file('freelancers'), costsCsv(m, p))}>
          Freelancer costs
        </button>
      </div>
      <p className="hint">
        Spreadsheets made on this device: each invoice by VAT rate, by the day it was invoiced; the VAT on them by Revenue's two-month period and rate; and
        freelancers' approved timesheets, by the day approved. Every table is also in Download everything, on <a href="#admin">Admin</a>.
      </p>
    </section>
  )
}

// The price list.

export function PricesScreen({ view }: { view: View }) {
  const [search, setSearch] = useState('')
  if (!useAccess().can('money')) return <NotYours view={view} here="Price list" />
  const m = view.money
  const words = search.trim().toLowerCase().split(/\s+/).filter(Boolean)
  const models = view.warehouse.models.filter((x) => words.every((w) => x.name.toLowerCase().includes(w)))
  const priced = view.warehouse.models.filter((x) => m.productPrice(x.id) !== undefined).length
  return (
    <div className="app crew jobs money prices">
      <Top view={view} up={{ steps: [JOBS, MONEY], here: 'Price list' }} />
      <section className="card">
        <h1>Price list</h1>
        <p className="hint">
          Day prices before VAT, which a new quote is built from. Changing one here changes no quote already made: open a quote's draft to change its lines.
        </p>
      </section>

      <section className="card" aria-label="Kit">
        <Heading icon="kit">Kit</Heading>
        <p className="hint">
          {priced} of {plural(view.warehouse.models.length, 'product')} priced. A product with no price goes on a quote at nothing, for you to price there.
        </p>
        <input className="search" type="search" placeholder="Find a product" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Find a product" />
        {DEPARTMENTS.map((d) => {
          const here = models.filter((x) => x.department === d)
          if (!here.length) return null
          return (
            <div key={d} className="price-group" role="group" aria-label={DEPARTMENT_LABELS[d]}>
              <h3>{DEPARTMENT_LABELS[d]}</h3>
              <ShowAll items={here} limit={8} what="products">
                {(rows) =>
                  rows.map((x) => (
                    <PriceRow
                      key={`${x.id} ${m.productPrice(x.id)}`}
                      label={x.name}
                      cents={m.productPrice(x.id)}
                      pending={m.pricePending('product', x.id)}
                      onSave={(cents) => client.mutate('price.product', { modelId: x.id, dayCents: cents })}
                    />
                  ))
                }
              </ShowAll>
            </div>
          )
        })}
        {view.warehouse.models.length === 0 && <Empty>No products yet: they come from the Stock tab.</Empty>}
      </section>

      <section className="card" aria-label="Crew">
        <Heading icon="people">Crew</Heading>
        <p className="hint">A day's price for each role, to the client. A role with none is quoted at the rate its crew were asked for at.</p>
        {m.roles.map((r) => (
          <PriceRow
            key={`${r.role} ${r.cents}`}
            label={r.role}
            sub={r.booked !== undefined ? `Asked for at ${money(r.booked)} a day` : undefined}
            cents={r.cents}
            pending={m.pricePending('role', r.role)}
            onSave={(cents) => client.mutate('price.role', { role: r.role, dayCents: cents })}
          />
        ))}
        {m.roles.length === 0 && <Empty>No roles yet: add one below, or they come as crew are asked for.</Empty>}
        <AddRole />
      </section>

      <section className="card" aria-label="Client discounts">
        <Heading icon="company">Client discounts</Heading>
        <p className="hint">A client's usual discount goes on each new quote for them, and can be changed on the quote.</p>
        {view.jobs.clients.map((c) => (
          <DiscountRow key={`${c.id} ${m.discountOf(c.id)}`} label={c.name} pct={m.discountOf(c.id)} pending={m.pricePending('client', c.id)} clientId={c.id} />
        ))}
        {view.jobs.clients.length === 0 && <Empty>No clients yet: they're added as you type them into a job.</Empty>}
      </section>
    </div>
  )
}

/** One price, changed in place: nothing typed takes it off the list. */
function PriceRow({ label, sub, cents, pending, onSave }: { label: string; sub?: string; cents: number | undefined; pending: boolean; onSave: (cents: number | null) => Promise<unknown> }) {
  const [text, setText] = useState(cents === undefined ? '' : euroText(cents))
  const { run, error, refuse } = useAct()
  const was = cents === undefined ? '' : euroText(cents)
  const save = (e: FormEvent) => {
    e.preventDefault()
    const p = parseEuro(text)
    if (p.reason) return refuse(p.reason)
    void run(() => onSave(p.cents ?? null))
  }
  return (
    <form className="row price-row" onSubmit={save}>
      <div>
        <b>{label}</b>
        {sub && <p>{sub}</p>}
      </div>
      <div className="actions">
        <label className="euro">
          <span>€</span>
          <input inputMode="decimal" value={text} onChange={(e) => setText(e.target.value)} placeholder="No price" aria-label={`${label}: price a day`} />
          <span className="muted">a day</span>
        </label>
        <Pending pending={pending} />
        {text.trim() !== was && (
          <button type="submit" className="primary">
            Save
          </button>
        )}
      </div>
      <Refusal error={error} />
    </form>
  )
}

function DiscountRow({ label, pct, pending, clientId }: { label: string; pct: number | undefined; pending: boolean; clientId: string }) {
  const was = pct === undefined ? '' : String(pct)
  const [text, setText] = useState(was)
  const { run, error, refuse } = useAct()
  const save = (e: FormEvent) => {
    e.preventDefault()
    const t = text.trim().replace(',', '.').replace(/%$/, '')
    const n = Number(t)
    if (t && !(n >= 0 && n <= 100 && Number.isInteger(n * 10))) return refuse('A discount is a percentage from 0 to 100, such as 10 or 12.5.')
    void run(() => client.mutate('price.client', { clientId, pct: t && n > 0 ? n : null }))
  }
  return (
    <form className="row price-row" onSubmit={save}>
      <div>
        <b>{label}</b>
        {pct !== undefined && <p>{pctWord(pct)} off each new quote</p>}
      </div>
      <div className="actions">
        <label className="euro">
          <input inputMode="decimal" value={text} onChange={(e) => setText(e.target.value)} placeholder="None" aria-label={`${label}: discount, %`} />
          <span className="muted">% off</span>
        </label>
        <Pending pending={pending} />
        {text.trim() !== was && (
          <button type="submit" className="primary">
            Save
          </button>
        )}
      </div>
      <Refusal error={error} />
    </form>
  )
}

function AddRole() {
  const [role, setRole] = useState('')
  const [price, setPrice] = useState('')
  const { run, error, refuse } = useAct()
  const add = (e: FormEvent) => {
    e.preventDefault()
    const p = parseEuro(price)
    if (!role.trim()) return refuse('Say which role it is.')
    if (p.reason) return refuse(p.reason)
    if (p.cents === null) return refuse('Put in its price a day, like 380.')
    void run(() => client.mutate('price.role', { role, dayCents: p.cents ?? null })).then((ok) => {
      if (!ok) return
      setRole('')
      setPrice('')
    })
  }
  return (
    <form className="grid-form add-role" onSubmit={add}>
      <label>
        Role <input value={role} onChange={(e) => setRole(e.target.value)} placeholder="e.g. Rigger" maxLength={100} />
      </label>
      <label>
        € a day <input inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="380" />
      </label>
      <Refusal error={error} className="wide" />
      <button type="submit" className="wide">
        Add a role
      </button>
    </form>
  )
}
