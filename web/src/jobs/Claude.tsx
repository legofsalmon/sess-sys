import {
  RATE_LABELS,
  RATE_UNIT,
  adviceSuggestions,
  assistantBlocked,
  changeWords,
  euroText,
  matcherFor,
  money,
  plural,
  withModel,
  ASK_LENGTH,
  ENQUIRY_LENGTH,
  type AskedLine,
  type AssistantStatus,
  type EnquiryReading,
  type Pricing,
  type QuoteAdvice,
  type Suggestion,
  type View,
} from '@sh/shared'
import { useState } from 'react'
import { ProductPicker } from '../ProductPicker.tsx'
import { useAccess } from '../role.ts'
import { useLate } from '../useLate.ts'
import { getJson, postJson, useAsked, type Loaded } from './rms.ts'

/**
 * Claude on the quote screens (ADR 0096). It reads an enquiry into a job
 * and its lines, or suggests changes to a quote when asked in words, and
 * the screen shows what it suggests under "Suggested by Claude", every
 * line ticked to take or not and every product to change: nothing is
 * saved until a person presses to take it, and then it's saved as if they
 * had typed it. Offered only to the office and directors, once the
 * company turns Claude on under Admin.
 */

/** Long enough for Claude to read a long enquiry; anything else the app asks waits 15 seconds. */
const CLAUDE_WAITS_MS = 100_000

/** Whether Claude is offered here, and once asked, whether it can be asked now. */
export function useClaude(view: View): { offered: boolean; status: Loaded<AssistantStatus> } {
  const access = useAccess()
  const offered = view.office.useAssistant && access.can('money')
  const status = useAsked(offered, 'assistant', () => getJson<AssistantStatus>('/api/assistant'))
  return { offered, status }
}

const blocked = (s: Loaded<AssistantStatus>) => (s.state === 'ready' ? assistantBlocked(s.data) : s.state === 'loading' ? null : s.state === 'gone' ? s.error : 'Claude needs signal.')

/** What the device matches and prices Claude's lines with: the stock list and the price list. */
export function pricingOf(view: View): Pricing {
  const models = view.warehouse.models
  return {
    matcher: matcherFor(models),
    model: (id) => models.find((x) => x.id === id),
    productPrice: view.money.productPrice,
    productRate: view.money.productRate,
    rolePrice: view.money.rolePrice,
    roles: view.money.roles.map((r) => r.role),
  }
}

/** One of Claude's lines, and whether it's to be taken. */
export interface Offered {
  s: Suggestion
  take: boolean
}
export const offer = (ss: readonly Suggestion[]): Offered[] => ss.map((s) => ({ s, take: true }))

async function asking<T>(url: string, body: unknown): Promise<{ data?: T; error?: string }> {
  const l = await postJson<T>(url, body, CLAUDE_WAITS_MS)
  if (l.state === 'ready') return { data: l.data }
  if (l.state === 'gone') return { error: l.error }
  return { error: 'Claude didn’t answer in time, or there’s no signal. Try again.' }
}

/** The label on everything Claude suggests, so it's never taken for what someone typed. */
export function ByClaude({ children }: { children?: string }) {
  return <p className="by-claude">{children ?? 'Suggested by Claude. Check each line before you take it.'}</p>
}

/** Pasting an enquiry in for Claude to read. */
export function FromEnquiry({ status, onRead }: { status: Loaded<AssistantStatus>; onRead: (r: EnquiryReading) => void }) {
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const late = useLate(busy)
  const no = blocked(status)
  const read = async () => {
    setBusy(true)
    setError('')
    const { data, error } = await asking<EnquiryReading>('/api/assistant/enquiry', { text })
    setBusy(false)
    if (data) onRead(data)
    else setError(error ?? '')
  }
  return (
    <section className="from-enquiry wide" aria-label="From an enquiry">
      <label>
        Paste an enquiry
        <textarea value={text} onChange={(e) => setText(e.target.value)} maxLength={ENQUIRY_LENGTH} rows={5} placeholder="Paste the client’s email or message, and Claude fills in the job and suggests its lines." />
      </label>
      <div className="actions">
        <button type="button" onClick={() => void read()} disabled={busy || !!no || text.trim().length < 20}>
          {late ? 'Reading…' : 'Read it with Claude'}
        </button>
        <span className="hint" aria-live="polite">
          {busy ? (late ? 'Claude is reading it. This can take up to a minute.' : '') : (no ?? 'What you paste is sent to Anthropic to read. The app doesn’t keep it.')}
        </span>
      </div>
      {error && (
        <p className="alert" role="alert">
          {error}
        </p>
      )}
    </section>
  )
}

/** Claude's lines, each ticked to take, its number to change, and kit's product to choose from those most like it. */
export function Suggestions({ view, items, onChange }: { view: View; items: Offered[]; onChange: (next: Offered[]) => void }) {
  const p = pricingOf(view)
  const models = view.warehouse.models
  const set = (i: number, o: Partial<Offered>) => onChange(items.map((x, j) => (j === i ? { ...x, ...o } : x)))
  return (
    <ul className="plain claude-lines">
      {items.map(({ s, take }, i) => {
        const unsure = s.kind === 'kit' && (s.how === 'close' || s.how === 'none') && !s.modelId
        const likely = s.likely.map((id) => models.find((m) => m.id === id)).filter((m): m is NonNullable<typeof m> => !!m)
        return (
          <li key={s.key} className={take ? 'claude-line' : 'claude-line left'}>
            <label className="take">
              <input type="checkbox" checked={take} onChange={(e) => set(i, { take: e.target.checked })} />
              <span>
                <b>
                  {s.qty} × {s.what}
                </b>
                <small>
                  {[
                    s.group || 'Other',
                    s.what !== s.said ? `written “${s.said}”` : '',
                    s.per === 'once' ? 'once' : `${s.days} ${s.days === 1 ? 'day' : 'days'}`,
                    s.rate ? RATE_LABELS[s.rate] : '',
                    s.cents === undefined ? 'no price yet' : `${money(s.cents)}${s.per === 'once' ? '' : s.rate && RATE_UNIT[s.rate] === 'week' ? ' a week' : ' a day'}`,
                    s.discountPct ? `${s.discountPct}% off` : '',
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </small>
              </span>
            </label>
            {take && (
              <div className="grid-form">
                {s.kind === 'kit' && (
                  <ProductPicker
                    label={unsure ? 'Which product? Not sure' : 'Product'}
                    products={models}
                    value={s.modelId ?? ''}
                    shownAs={s.modelId ? undefined : 'As written'}
                    first={likely}
                    actions={[{ key: 'none', label: 'As written, not from the stock list' }]}
                    onPick={(id) => set(i, { s: withModel(p, s, id) })}
                    onAction={() => set(i, { s: withModel(p, s, null) })}
                  />
                )}
                <label>
                  How many
                  <input
                    type="number"
                    inputMode="numeric"
                    min={1}
                    max={10_000}
                    value={s.qty}
                    onChange={(e) => {
                      const n = Number(e.target.value)
                      if (Number.isInteger(n) && n >= 1 && n <= 10_000) set(i, { s: { ...s, qty: n } })
                    }}
                  />
                </label>
              </div>
            )}
          </li>
        )
      })}
    </ul>
  )
}

/** "9 lines, 2 with no price yet": what pressing take will put on the quote. */
export function takingWords(items: readonly Offered[]): string {
  const taking = items.filter((x) => x.take)
  const unpriced = taking.filter((x) => x.s.cents === undefined).length
  return `${plural(taking.length, 'line')}${unpriced ? `, ${unpriced} with no price yet` : ''}`
}

/** What Claude suggests for an open quote, to take in one press or to leave. */
export interface Advice {
  advice: QuoteAdvice
  add: Offered[]
  /** Of the lines to take off and the changes, which are ticked. */
  remove: Record<string, boolean>
  change: Record<string, boolean>
  discount: boolean
}

/** Asking Claude to change the quote, in words. */
export function AskClaude({
  view,
  status,
  name,
  jobDays,
  discountPct,
  lines,
  onAdvice,
}: {
  view: View
  status: Loaded<AssistantStatus>
  name: string
  jobDays: number
  discountPct: number
  lines: AskedLine[]
  onAdvice: (a: Advice) => void
}) {
  const [ask, setAsk] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const late = useLate(busy)
  const no = blocked(status)
  const send = async () => {
    setBusy(true)
    setError('')
    const { data, error } = await asking<QuoteAdvice>('/api/assistant/quote', { ask, name, jobDays, discountPct, lines })
    setBusy(false)
    if (!data) return setError(error ?? '')
    setAsk('')
    onAdvice({
      advice: data,
      add: offer(adviceSuggestions(data, pricingOf(view), jobDays)),
      remove: Object.fromEntries(data.remove.map((id) => [id, true])),
      change: Object.fromEntries(data.change.map((c) => [c.lineId, true])),
      discount: data.discountPct !== null,
    })
  }
  return (
    <section className="ask-claude" aria-label="Ask Claude">
      <label>
        Ask Claude to change this quote
        <textarea
          rows={2}
          maxLength={ASK_LENGTH}
          value={ask}
          onChange={(e) => setAsk(e.target.value)}
          placeholder="Such as: add two more radio mics, make it three days, and take 10% off the lighting."
        />
      </label>
      <div className="actions">
        <button type="button" onClick={() => void send()} disabled={busy || !!no || ask.trim().length < 3}>
          {late ? 'Asking…' : 'Ask Claude'}
        </button>
        <span className="hint" aria-live="polite">
          {busy ? (late ? 'Claude is looking at the quote.' : '') : (no ?? 'Claude suggests; nothing changes until you take it.')}
        </span>
      </div>
      {error && (
        <p className="alert" role="alert">
          {error}
        </p>
      )}
    </section>
  )
}

/** Claude's suggestions for the quote: each ticked to take, then taken in one press, or left. */
export function AdviceCard({
  view,
  a,
  lines,
  discountPct,
  onChange,
  onTake,
  onLeave,
}: {
  view: View
  a: Advice
  lines: AskedLine[]
  discountPct: number
  onChange: (a: Advice) => void
  onTake: () => void
  onLeave: () => void
}) {
  const by = new Map(lines.map((l) => [l.id, l]))
  const removes = a.advice.remove.filter((id) => by.has(id))
  const changes = a.advice.change.filter((c) => by.has(c.lineId))
  const count = a.add.filter((x) => x.take).length + removes.filter((id) => a.remove[id]).length + changes.filter((c) => a.change[c.lineId]).length + (a.discount ? 1 : 0)
  const nothing = !a.add.length && !removes.length && !changes.length && a.advice.discountPct === null
  const euro = (c: number) => `€${euroText(c)}`
  return (
    <section className="claude-advice" aria-label="Suggested by Claude">
      <ByClaude>Suggested by Claude</ByClaude>
      {a.advice.note && <p>{a.advice.note}</p>}
      {a.add.length > 0 && (
        <>
          <h3>To add</h3>
          <Suggestions view={view} items={a.add} onChange={(add) => onChange({ ...a, add })} />
        </>
      )}
      {(removes.length > 0 || changes.length > 0 || a.advice.discountPct !== null) && (
        <>
          <h3>To change</h3>
          <ul className="plain claude-lines">
            {removes.map((id) => (
              <li key={`r-${id}`} className="claude-line">
                <label className="take">
                  <input type="checkbox" checked={!!a.remove[id]} onChange={(e) => onChange({ ...a, remove: { ...a.remove, [id]: e.target.checked } })} />
                  <span>
                    <b>Take off {by.get(id)!.what}</b>
                  </span>
                </label>
              </li>
            ))}
            {changes.map((c) => (
              <li key={`c-${c.lineId}`} className="claude-line">
                <label className="take">
                  <input type="checkbox" checked={!!a.change[c.lineId]} onChange={(e) => onChange({ ...a, change: { ...a.change, [c.lineId]: e.target.checked } })} />
                  <span>
                    <b>{by.get(c.lineId)!.what}</b>
                    <small>{changeWords(c, by.get(c.lineId)!, euro)}</small>
                  </span>
                </label>
              </li>
            ))}
            {a.advice.discountPct !== null && (
              <li className="claude-line">
                <label className="take">
                  <input type="checkbox" checked={a.discount} onChange={(e) => onChange({ ...a, discount: e.target.checked })} />
                  <span>
                    <b>
                      Discount on the whole quote: {discountPct}% to {a.advice.discountPct}%
                    </b>
                  </span>
                </label>
              </li>
            )}
          </ul>
        </>
      )}
      {nothing && !a.advice.note && <p>Claude had nothing to change.</p>}
      <div className="actions">
        {!nothing && (
          <button type="button" className="primary" onClick={onTake} disabled={count === 0}>
            {count === 1 ? 'Make this change' : `Make these ${count} changes`}
          </button>
        )}
        <button type="button" className="link" onClick={onLeave}>
          {nothing ? 'Close' : 'Leave it as it is'}
        </button>
      </div>
    </section>
  )
}
