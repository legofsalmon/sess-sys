import { MAX_QUOTE_NUMBER, TERMS_LENGTH, type MoneyView } from '@sh/shared'
import { useState, type FormEvent } from 'react'
import { Refusal, useAct } from './act.tsx'
import { Pending } from './StatusPill.tsx'
import { client } from './sync.ts'

type Fields = { next: string; terms: string; bank: string }
const fieldsOf = (q: MoneyView['quoting']): Fields => ({ next: q.nextNumber ? String(q.nextNumber) : '', terms: q.terms, bank: q.bank })
const same = (a: Fields, b: Fields) => a.next === b.next && a.terms === b.terms && a.bank === b.bank

/**
 * What every printed quote says that isn't about the job (ADR 0084): the
 * number the next quote gets, so numbering carries on from Current RMS's
 * with no jump for clients, and the company's terms and bank details.
 * Money's, so only those who see money have it.
 */
export function QuotingCard({ money }: { money: MoneyView }) {
  const saved = fieldsOf(money.quoting)
  const [f, setF] = useState(saved)
  // As on Office details: another device's change is followed, unless someone is part way through typing here.
  const [from, setFrom] = useState(saved)
  if (!same(from, saved)) {
    setFrom(saved)
    if (same(f, from)) setF(saved)
  }
  const { run, error, refuse } = useAct()
  const save = (e: FormEvent) => {
    e.preventDefault()
    const n = f.next.trim() ? Number(f.next.trim()) : null
    if (n !== null && !(Number.isInteger(n) && n >= 1 && n <= MAX_QUOTE_NUMBER))
      return refuse(`A quote number is a whole number from 1 to ${MAX_QUOTE_NUMBER.toLocaleString('en-IE')}.`)
    void run(() => client.mutate('quoting.update', { nextNumber: n, terms: f.terms.trim(), bank: f.bank.trim() }))
  }
  return (
    <section className="card office" aria-labelledby="quoting-title">
      <h2 id="quoting-title">Printed quotes</h2>
      <p>
        A quote gets its number when it's first marked sent, and keeps it on every version. The next one sent will be <b>{money.nextNumber}</b>. The terms and bank
        details go under every printed quote; the address and VAT number come from Office details.
      </p>
      <form className="office-form" onSubmit={save}>
        <label>
          Next quote number{' '}
          <input inputMode="numeric" value={f.next} onChange={(e) => setF({ ...f, next: e.target.value })} placeholder={String(money.nextNumber)} aria-describedby="next-hint" />
          <small id="next-hint">To carry on from Current RMS, one more than its last. Empty carries on from the highest given here.</small>
        </label>
        <label className="wide">
          Terms{' '}
          <textarea
            rows={4}
            value={f.terms}
            onChange={(e) => setF({ ...f, terms: e.target.value })}
            maxLength={TERMS_LENGTH}
            placeholder="Payment within 30 days of the invoice. Kit lost or damaged on hire is charged at its replacement cost."
          />
        </label>
        <label className="wide">
          Bank details{' '}
          <textarea rows={3} value={f.bank} onChange={(e) => setF({ ...f, bank: e.target.value })} maxLength={500} placeholder="Account name, IBAN and BIC, a line each" />
        </label>
        <div className="actions wide">
          <button type="submit" className="primary">
            Save printed quotes
          </button>
          <Pending pending={money.quoting.pending} />
        </div>
      </form>
      <Refusal error={error} />
    </section>
  )
}
