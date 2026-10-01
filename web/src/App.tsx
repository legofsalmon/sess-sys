import { newId, overlaps, type BookingView, type Product, type View } from '@sh/shared'
import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { Refusal, useAct } from './act.tsx'
import { useNotDone } from './problems.tsx'
import { client, syncSoon, transport } from './sync.ts'

/**
 * Phase 0 demo: the smallest screen that shows the sync promise working on
 * a real phone. Book speakers, switch the signal off, book on another
 * device, switch it back on, and watch the server decide.
 */

const today = new Date().toISOString().slice(0, 10)

function useView(): View {
  const [view, setView] = useState(() => client.view())
  useEffect(() => client.subscribe(setView), [])
  return view
}

/** The most booked on any one day in the range, counting pending requests too. */
function freeFor(p: Product, bookings: BookingView[], start: string, end: string) {
  let peak = 0
  for (let d = new Date(start); d.toISOString().slice(0, 10) <= end; d.setUTCDate(d.getUTCDate() + 1)) {
    const day = d.toISOString().slice(0, 10)
    const used = bookings
      .filter((b) => b.productId === p.id && b.status === 'confirmed' && overlaps(b, { start: day, end: day }))
      .reduce((n, b) => n + b.qty, 0)
    peak = Math.max(peak, used)
  }
  return p.quantity - peak
}

export function App() {
  const view = useView()
  const [noSignal, setNoSignal] = useState(false)
  const [range, setRange] = useState({ start: today, end: today })

  const toggleSignal = () => {
    transport.forcedOffline = !noSignal
    setNoSignal(!noSignal)
    if (noSignal) syncSoon()
  }
  const { run, error } = useAct()
  const act = (fn: () => Promise<unknown>) => void run(fn)
  const notDone = useNotDone(view)

  const products = new Map(view.products.map((p) => [p.id, p]))
  const status = view.connection === 'offline' || noSignal ? 'offline' : view.connection === 'syncing' ? 'syncing' : 'online'
  const statusText =
    status === 'offline'
      ? `No signal${view.pendingCount ? ` · ${view.pendingCount} waiting` : ''}`
      : status === 'syncing'
        ? 'Syncing'
        : view.pendingCount
          ? `${view.pendingCount} waiting`
          : 'Up to date'

  return (
    <div className="app sync-test">
      <header className="top">
        <div className="brand">
          <span className="mark">SH</span>
          <span>
            <b>Session Hire</b>
            <small>Sync test · Phase 0</small>
          </span>
        </div>
        <div className="state">
          {notDone.count}
          <span className={`conn ${status}`} role="status">
            {statusText}
          </span>
        </div>
        {notDone.list}
      </header>
      <a className="back" href="#stock">
        ‹ Stock
      </a>

      <label className="signal">
        <input type="checkbox" id="no-signal" checked={noSignal} onChange={toggleSignal} />
        <span>
          <b>Simulate no signal</b>
          <small>Everything keeps working; changes wait on this device until you switch it back.</small>
        </span>
      </label>

      {view.issues.length > 0 && (
        <section className="card attention">
          <h2>Needs attention</h2>
          {view.issues.map((i) => (
            <div className="row" key={i.id}>
              <div>
                <b>Scan doesn't match the plan</b>
                <p>{i.message}</p>
              </div>
            </div>
          ))}
        </section>
      )}

      <Refusal error={error} />

      <section className="card">
        <h2>Stock</h2>
        <div className="range">
          <label>
            From <input type="date" id="range-start" value={range.start} onChange={(e) => setRange({ ...range, start: e.target.value })} />
          </label>
          <label>
            To <input type="date" id="range-end" value={range.end} min={range.start} onChange={(e) => setRange({ ...range, end: e.target.value })} />
          </label>
        </div>
        {view.products.length === 0 && <p className="empty">No stock yet. Add a product below to start.</p>}
        <ul className="stock">
          {view.products.map((p) => {
            const free = freeFor(p, view.bookings, range.start, range.end)
            return (
              <li key={p.id}>
                <span>{p.name}</span>
                <span className={free <= 0 ? 'free none' : 'free'}>
                  <b>{free}</b> of {p.quantity} free
                </span>
              </li>
            )
          })}
        </ul>
        <AddProduct onAdd={(name, quantity) => act(() => client.mutate('product.upsert', { id: newId(), name, quantity }))} />
      </section>

      <section className="card">
        <h2>Book kit</h2>
        <BookForm products={view.products} range={range} onBook={(b) => act(() => client.mutate('booking.create', { id: newId(), ...b }))} />
      </section>

      <section className="card">
        <h2>Bookings</h2>
        {view.bookings.length === 0 && <p className="empty">Nothing booked yet.</p>}
        {view.bookings.map((b) => (
          <div className="row" key={b.id}>
            <div>
              <b>{b.project}</b>
              <p>
                {b.qty} × {products.get(b.productId)?.name ?? 'Unknown'} · {b.start === b.end ? b.start : `${b.start} to ${b.end}`}
              </p>
            </div>
            <div className="actions">
              <span className={`pill ${b.pending ? 'pending' : b.status}`}>{b.pending ? 'Waiting to sync' : b.status === 'confirmed' ? 'Confirmed' : 'Cancelled'}</span>
              {b.status === 'confirmed' && (
                <>
                  <button
                    type="button"
                    onClick={() =>
                      act(() => client.mutate('scan.record', { id: newId(), productId: b.productId, bookingId: b.id, direction: 'out', at: new Date().toISOString() }))
                    }
                  >
                    Scan one out
                  </button>
                  <button type="button" onClick={() => act(() => client.mutate('booking.cancel', { id: b.id }))}>
                    Cancel
                  </button>
                </>
              )}
            </div>
          </div>
        ))}
        {view.scans.length > 0 && (
          <p className="scans">
            {view.scans.length} scan{view.scans.length === 1 ? '' : 's'} recorded
            {view.scans.some((s) => s.pending) ? `, ${view.scans.filter((s) => s.pending).length} waiting to sync` : ''}
          </p>
        )}
      </section>

      <footer className="foot">
        Device {client.clientId.slice(-6)} · change #{view.cursor}
      </footer>
    </div>
  )
}

function AddProduct({ onAdd }: { onAdd: (name: string, qty: number) => void }) {
  const [name, setName] = useState('')
  const [qty, setQty] = useState(4)
  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (!name.trim()) return
    onAdd(name.trim(), qty)
    setName('')
  }
  return (
    <form className="inline" onSubmit={submit}>
      <input id="product-name" placeholder="Product, e.g. d&b Y10P" value={name} onChange={(e) => setName(e.target.value)} />
      <input id="product-qty" type="number" min={0} value={qty} onChange={(e) => setQty(Number(e.target.value))} aria-label="Quantity" />
      <button type="submit">Add</button>
    </form>
  )
}

function BookForm({
  products,
  range,
  onBook,
}: {
  products: Product[]
  range: { start: string; end: string }
  onBook: (b: { productId: string; project: string; qty: number; start: string; end: string }) => void
}) {
  const [productId, setProductId] = useState('')
  const [project, setProject] = useState('')
  const [qty, setQty] = useState(1)
  const chosen = useMemo(() => productId || products[0]?.id || '', [productId, products])
  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (!chosen || !project.trim()) return
    onBook({ productId: chosen, project: project.trim(), qty, start: range.start, end: range.end })
    setProject('')
  }
  if (products.length === 0) return <p className="empty">Add stock first.</p>
  return (
    <form className="book" onSubmit={submit}>
      <label>
        Project
        <input id="book-project" placeholder="e.g. Nissan" value={project} onChange={(e) => setProject(e.target.value)} />
      </label>
      <label>
        Product
        <select id="book-product" value={chosen} onChange={(e) => setProductId(e.target.value)}>
          {products.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        How many
        <input id="book-qty" type="number" min={1} value={qty} onChange={(e) => setQty(Number(e.target.value))} />
      </label>
      <p className="hint">
        For {range.start === range.end ? range.start : `${range.start} to ${range.end}`} (change the dates under Stock)
      </p>
      <button type="submit" className="primary">
        Book
      </button>
    </form>
  )
}
