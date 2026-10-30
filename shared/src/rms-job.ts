import { crewSuggestion, kitSuggestion, otherSuggestion, type Pricing, type Suggestion } from './assistant.ts'
import { departmentOfGroup } from './current-rms.ts'
import type { RmsLine, RmsOpportunity } from './current-rms-api.ts'
import { irishToday } from './day.ts'
import { MAX_LINES, type RateRule } from './quotes.ts'
import { rmsOutcome, sameClient } from './rms-history.ts'
import { DEPARTMENT_LABELS } from './stock.ts'

/**
 * A job made from a past quote from Current RMS (ADR 0102): the job's name,
 * client, venue and days as Current RMS had them, and each priced line as a
 * line of a draft quote here, matched to the stock list where it's plainly
 * the same product and charged as it was there: the same price for a day or
 * a week, the same rate rule, days and discount. The office checks it all
 * before anything is made, the same way as lines Claude read from an enquiry.
 */

/** Current RMS's rate definitions, as the rules here call them (ADR 0085). */
const RULES: Record<string, RateRule> = { 'daily rate': 'daily', '3 day week rate': 'week3', 'weekly rate': 'weekly' }

/** The rule a line was charged by in Current RMS, or none for one charged by the day there without one. */
export const rmsRule = (definition: string): RateRule | undefined => RULES[definition.trim().toLowerCase()]

/** A number of days in halves, from half a day to a year, as a quote's line takes them. */
const halves = (n: number) => Math.min(365, Math.max(0.5, Math.round(n * 2) / 2))
/** A discount to a tenth of a percent, from none to all of it. */
const tenths = (n: number) => Math.min(100, Math.max(0, Math.round(n * 10) / 10))
/** The most a line's price can be here: what any one thing could cost a day. */
const MOST_CENTS = 100_000_00

/** One of a past quote's lines, as it would go on a quote here, and whether it's taken unless unticked. */
export interface RmsOffered {
  s: Suggestion
  /** Lines charged nothing in Current RMS are offered unticked, so the quote comes to what it did there. */
  take: boolean
}

/**
 * Each line of a past quote worth a line here, in its order: groups name the department of what's under them, and an
 * accessory charged nothing came with the product above it, so neither is a line of its own. Products hired out are
 * kit, matched to the stock list; services are crew, under the company's own name for the role when it's the same;
 * typed lines and anything sold are as written. The days are its chargeable days there, the days out where a rule
 * charges for them.
 */
export function rmsSuggestions(lines: readonly RmsLine[], p: Pricing): RmsOffered[] {
  const groups = lines.filter((l) => l.kind === 'Group')
  const groupOf = (l: RmsLine) =>
    groups.filter((g) => l.path.startsWith(g.path) && l.path !== g.path).sort((a, b) => b.path.length - a.path.length)[0]?.name ?? ''
  const out: RmsOffered[] = []
  for (const l of lines) {
    if (l.kind === 'Group' || !l.name.trim()) continue
    if (l.kind === 'Accessory' && l.priceCents <= 0) continue
    const key = `rms-${l.id}`
    const said = l.name.trim().slice(0, 200)
    const qty = Math.min(10_000, Math.max(1, Math.round(l.quantity)))
    const days = halves(l.chargeableDays || 1)
    const cents = l.priceCents > 0 ? Math.min(MOST_CENTS, l.priceCents) : 0
    const dept = departmentOfGroup(groupOf(l))
    const rule = rmsRule(l.rateDefinition)
    const sold = l.transaction.toLowerCase() === 'sale'
    let s: Suggestion
    if (!sold && l.itemType === 'Product') {
      s = kitSuggestion(p, key, said, dept, qty, days, cents)
      // The rule it was charged by there, whatever the product's rule here, so it comes to the same.
      s = { ...s, rate: rule && rule !== 'daily' ? rule : null }
    } else if (!sold && l.itemType === 'Service') s = crewSuggestion(p, key, said, qty, days, cents)
    else if (sold) s = otherSuggestion(key, said, qty, 'once', 1, cents)
    else s = { ...otherSuggestion(key, said, qty, 'day', days, cents), rate: rule && rule !== 'daily' ? rule : null }
    if (s.kind === 'other' && dept !== 'other') s = { ...s, group: DEPARTMENT_LABELS[dept] }
    out.push({ s: { ...s, charged: cents, ...(l.discountPct > 0 ? { discountPct: tenths(l.discountPct) } : {}) }, take: cents > 0 })
  }
  return out.slice(0, MAX_LINES)
}

/** What the lines there came to, before VAT: a total off by more than a euro means a deal was agreed on the whole. */
export function rmsLinesCents(lines: readonly RmsLine[]): number {
  return lines.filter((l) => l.kind !== 'Group').reduce((n, l) => n + l.totalCents, 0)
}

export interface RmsJobDraft {
  name: string
  client: string
  venue: string
  start: string
  end: string
  /** Confirmed for an order that wasn't cancelled, an enquiry for the rest. */
  status: 'enquiry' | 'confirmed'
  /** The total agreed on the whole in Current RMS, when it isn't what the lines came to; null when there was no deal. */
  agreedCents: number | null
}

/**
 * The job a past quote makes, as the form starts it: its name, its client as one already here spells it, its venue and
 * its days in Ireland (today when it had none), confirmed when it was an order that wasn't cancelled.
 */
export function rmsJobDraft(o: RmsOpportunity, lines: readonly RmsLine[], clients: readonly string[], today = irishToday()): RmsJobDraft {
  const start = o.startsAt ? irishToday(new Date(o.startsAt)) : today
  const endsOn = o.endsAt ? irishToday(new Date(o.endsAt)) : start
  const client = o.client.trim() ? (clients.find((c) => sameClient(c, o.client)) ?? o.client.trim()) : ''
  const deal = Math.abs(rmsLinesCents(lines) - o.netCents) > 100 && o.netCents > 0
  return {
    name: (o.subject || o.number || 'Job from Current RMS').trim().slice(0, 200),
    client,
    venue: o.venue.trim(),
    start,
    end: endsOn < start ? start : endsOn,
    status: rmsOutcome(o, today) === 'ahead' ? 'confirmed' : 'enquiry',
    agreedCents: deal ? o.netCents : null,
  }
}
