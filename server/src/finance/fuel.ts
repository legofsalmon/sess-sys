import { AA_FUEL_PAGE, type FuelPriceFound } from '@sh/shared'
import type { FastifyInstance } from 'fastify'

/**
 * The fuel price from AA Ireland's monthly survey (ADR 0086), for Admin's
 * "Read the AA's price". There's no feed, so the server reads the survey's
 * page and takes the diesel pump price from its table. What it reads is
 * only ever offered: the office sees the figure and the month and saves it
 * themselves, so a page that changes shape can't put a wrong price on a
 * client's quote. Read at most once an hour, however often it's pressed.
 */

export type FuelLookup = () => Promise<FuelPriceFound>

export const AA_FUEL_URL = AA_FUEL_PAGE

/** The table's words, without the page's tags. */
const words = (html: string) =>
  html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|&#160;/g, ' ')
    .replace(/&amp;|&#038;/g, '&')
    .replace(/\s+/g, ' ')

/**
 * "Irish Fuel Prices: October 2026 Petrol Diesel Pump price 198.16c 214.76c": the survey's month and its diesel pump
 * price, in cent a litre. Undefined when the page doesn't read that way, rather than a guess.
 */
export function readAaPage(html: string): FuelPriceFound | undefined {
  const m = /Irish (?:Petrol & Diesel |Fuel )Prices:?\s*([A-Z][a-z]+ \d{4})\s*Petrol\s+Diesel\s+Pump price\s+(\d{2,3}(?:\.\d+)?)\s*c\s+(\d{2,3}(?:\.\d+)?)\s*c/.exec(words(html))
  if (!m) return undefined
  const diesel = Number(m[3])
  if (!(diesel >= 50 && diesel <= 500)) return undefined
  return { centsPerLitre: Math.round(diesel * 10) / 10, month: m[1]!, source: AA_FUEL_URL }
}

const HOUR = 60 * 60 * 1000

export function aaFuel({ url = AA_FUEL_URL, fetch: get = fetch }: { url?: string; fetch?: typeof fetch } = {}): FuelLookup {
  let kept: { at: number; found: FuelPriceFound } | undefined
  return async () => {
    if (kept && Date.now() - kept.at < HOUR) return kept.found
    const res = await get(url, { headers: { 'user-agent': 'SessionHire/1.0 (+https://github.com/legofsalmon/sess-sys)', accept: 'text/html' }, signal: AbortSignal.timeout(10_000) })
    if (!res.ok) throw new Error(`The AA's page answered ${res.status}.`)
    const found = readAaPage(await res.text())
    if (!found) throw new Error("The AA's page didn't read as the survey.")
    kept = { at: Date.now(), found }
    return found
  }
}

export function registerFuelRoutes(app: FastifyInstance, { lookup }: { lookup: FuelLookup }) {
  // The fuel price is part of pricing quotes, so it needs what money needs.
  app.get('/api/fuel-price', { config: { needs: 'money' } }, async (req, reply) => {
    try {
      return reply.header('cache-control', 'no-store').send(await lookup())
    } catch (err) {
      req.log.warn({ err }, "The AA's fuel prices couldn't be read")
      return reply.code(502).send({ error: "The AA's fuel prices couldn't be read just now. Open their page and type the diesel price in." })
    }
  })
}
