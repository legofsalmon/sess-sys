import { AA_FUEL_PAGE, DEFAULT_LITRES_PER_100_KM, DEFAULT_TRAVEL_FROM_KM, irishToday, QUOTE_SETTINGS_ID, type FuelPriceFound } from '@sh/shared'
import type { FastifyInstance } from 'fastify'
import { faultForLog, type Db } from '../db.ts'
import { emit, serverChange } from '../kernel.ts'
import { FUEL_FROM_AA_ACTION } from '../history.ts'
import { getQuoteSettings } from './store.ts'

/**
 * The fuel price from AA Ireland's monthly survey (ADR 0086). There's no
 * feed, so the server reads the survey's page and takes the diesel pump
 * price and the month from its table: each new month's by itself, unless
 * the office turns that off, and for Admin's "Read the AA's price". A page
 * that doesn't read as the survey offers nothing, and a price a long way
 * from the last isn't taken without someone looking. Read at most once an
 * hour, however often it's asked.
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
      req.log.warn({ err: faultForLog(err) }, "The AA's fuel prices couldn't be read")
      return reply.code(502).send({ error: "The AA's fuel prices couldn't be read just now. Open their page and type the diesel price in." })
    }
  })
}


/** A new survey's price further than this from the one before reads more like a page that changed shape than the pumps. */
const MOST_CHANGE = 0.3

/**
 * Takes the AA survey's price if it's a month not taken yet and the office hasn't turned it off, as a change of its own
 * recorded in the history as the server's. Answers the month taken, or undefined for nothing to do.
 */
export async function takeAaPrice(db: Db, lookup: FuelLookup, today = irishToday()): Promise<string | undefined> {
  const now = await getQuoteSettings(db)
  if (now?.fuelAuto === false) return undefined
  const found = await lookup()
  if (now?.fuelMonth === found.month) return undefined
  const was = now?.fuelCentsPerLitre ?? null
  if (was !== null && Math.abs(found.centsPerLitre - was) / was > MOST_CHANGE)
    throw new Error(`The AA's ${found.month} price, ${found.centsPerLitre}c, is too far from ${was}c to take without someone looking.`)
  return serverChange(db, { name: FUEL_FROM_AA_ACTION, args: { centsPerLitre: found.centsPerLitre, month: found.month } }, async (ctx) => {
    await ctx.tx.query(
      `INSERT INTO quote_settings (id, travel_from_km, litres_per_100_km) VALUES ($1, $2, $3)
       ON CONFLICT (id) DO UPDATE SET travel_from_km = coalesce(quote_settings.travel_from_km, EXCLUDED.travel_from_km),
         litres_per_100_km = coalesce(quote_settings.litres_per_100_km, EXCLUDED.litres_per_100_km)`,
      [QUOTE_SETTINGS_ID, DEFAULT_TRAVEL_FROM_KM, DEFAULT_LITRES_PER_100_KM]
    )
    // Looked at again under the lock, so a second copy of the server running at once takes it only once.
    const { rows } = await ctx.tx.query<{ fuel_month: string | null; fuel_auto: boolean }>('SELECT fuel_month, fuel_auto FROM quote_settings WHERE id = $1', [QUOTE_SETTINGS_ID])
    if (!rows[0]?.fuel_auto || rows[0].fuel_month === found.month) throw new NothingNew()
    await ctx.tx.query('UPDATE quote_settings SET fuel_cents_per_litre = $2, fuel_month = $3, fuel_set_on = $4 WHERE id = $1', [QUOTE_SETTINGS_ID, found.centsPerLitre, found.month, today])
    await emit(ctx, 'quoteSettings', QUOTE_SETTINGS_ID, await getQuoteSettings(ctx.tx))
    return found.month
  }).catch((err) => {
    if (err instanceof NothingNew) return undefined
    throw err
  })
}

class NothingNew extends Error {}

interface Log {
  info(obj: object, msg: string): void
  warn(obj: object, msg: string): void
}

/**
 * Keeps the fuel price up with the AA's survey (ADR 0086). The survey comes out on the second Monday of each month, so
 * the server looks once a day in Ireland (every hour it checks whether the day has turned) and takes a new month's
 * price the day it appears. A day the page can't be read is tried again the next day; Admin says which survey the
 * price is from, so a month missed shows.
 */
export class FuelUpdates {
  private timer: NodeJS.Timeout | undefined
  private doneFor: string | undefined
  private running: Promise<string | undefined> = Promise.resolve(undefined)

  constructor(
    private readonly db: Db,
    private readonly lookup: FuelLookup,
    private readonly options: { changed: () => void; log?: Log }
  ) {}

  start(): Promise<string | undefined> {
    if (!this.timer) {
      this.timer = setInterval(() => void this.run(), HOUR)
      this.timer.unref()
    }
    return this.run()
  }

  stop() {
    clearInterval(this.timer)
    this.timer = undefined
  }

  run(): Promise<string | undefined> {
    this.running = this.running.then(async () => {
      const today = irishToday()
      if (this.doneFor === today) return undefined
      this.doneFor = today
      try {
        const month = await takeAaPrice(this.db, this.lookup, today)
        if (month) {
          this.options.changed()
          this.options.log?.info({ month }, "Took the fuel price from the AA's survey")
        }
        return month
      } catch (err) {
        this.options.log?.warn({ err: faultForLog(err) }, "Could not take the fuel price from the AA's survey; trying again tomorrow")
        return undefined
      }
    })
    return this.running
  }
}
