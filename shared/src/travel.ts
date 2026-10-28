import type { Pin } from './jobs.ts'
import { STANDARD_VAT, type LineExtra, type QuoteLine, type QuoteSettings } from './quotes.ts'

/**
 * Travel and subsistence on a quote (ADR 0086), worked out by the quote
 * itself so nobody has to remember them or do the sums.
 *
 * - **Travel**: a venue further than so many km from Dublin city centre is
 *   charged the fuel its vehicles use there and back: the distance each
 *   way, twice, at what a vehicle uses for 100 km and the fuel price. The
 *   distance comes from the venue's pin on the map, as the crow flies and
 *   then a fifth more for the roads, unless the office types the real
 *   one on the quote.
 * - **Subsistence**: a per diem for each of the crew for each day they're
 *   quoted for, unless the job gives them their meals.
 *
 * The office sets the fuel price, what a vehicle uses, where travel starts
 * and the per diem in Admin. A price not set yet charges nothing, and the
 * quote says so, rather than guessing a figure for a client's quote.
 */

/** Dublin city centre: O'Connell Bridge. */
export const DUBLIN_CENTRE: Pin = { lat: 53.3472, lng: -6.2592 }

/** How much further Irish roads are than a straight line, on the whole: about a fifth (Galway, Cork and Belfast all come close). */
export const ROAD_FACTOR = 1.2

/** Until the office says otherwise: travel past 50 km, and a van using 10 litres for 100 km. */
export const DEFAULT_TRAVEL_FROM_KM = 50
export const DEFAULT_LITRES_PER_100_KM = 10

/** Past this many days the fuel price is worth checking again. */
export const FUEL_PRICE_FRESH_DAYS = 30

export interface TravelSettings {
  fromKm: number
  /** Cent a litre, to one place: 174.9. Null while not set. */
  fuelCentsPerLitre: number | null
  litresPer100Km: number
  perDiemCents: number | null
  fuelSetOn: string | null
}

export function travelSettingsOf(s: Partial<QuoteSettings> | undefined): TravelSettings {
  return {
    fromKm: s?.travelFromKm ?? DEFAULT_TRAVEL_FROM_KM,
    fuelCentsPerLitre: s?.fuelCentsPerLitre ?? null,
    litresPer100Km: s?.litresPer100Km ?? DEFAULT_LITRES_PER_100_KM,
    perDiemCents: s?.perDiemCents ?? null,
    fuelSetOn: s?.fuelSetOn ?? null,
  }
}

/** The distance between two pins along the ground, in km. */
export function kmBetween(a: Pin, b: Pin): number {
  const rad = (d: number) => (d * Math.PI) / 180
  const dLat = rad(b.lat - a.lat)
  const dLng = rad(b.lng - a.lng)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2
  return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(h)))
}

/** About how far a venue is from Dublin city centre by road, each way, in whole km. */
export const roadKmFromDublin = (pin: Pin) => Math.round(kmBetween(DUBLIN_CENTRE, pin) * ROAD_FACTOR)

/** The fuel for one vehicle there and back, to the cent. */
export const fuelCents = (kmEachWay: number, s: Pick<TravelSettings, 'fuelCentsPerLitre' | 'litresPer100Km'>) =>
  Math.round(((2 * kmEachWay * s.litresPer100Km) / 100) * (s.fuelCentsPerLitre ?? 0))

/** The crew's days on a quote: each crew line's how many times its days, a half day counted as a day for meals. */
export const crewDays = (lines: readonly Pick<QuoteLine, 'kind' | 'qty' | 'days' | 'per' | 'extra'>[]) =>
  lines.filter((l) => l.kind === 'crew' && !l.extra).reduce((n, l) => n + l.qty * Math.ceil(l.per === 'once' ? 1 : l.days), 0)

/** Where the distance came from: typed on the quote, the venue's pin, or nowhere yet. */
export type KmFrom = 'typed' | 'map' | 'none'

export interface Extras {
  /** The lines to put at the end of the quote, travel first. */
  lines: QuoteLine[]
  travel: {
    km: number | null
    from: KmFrom
    /** Why there's no travel line, in words, or null when there is one. */
    none: string | null
    vehicles: number
  }
  subsistence: {
    crewDays: number
    none: string | null
  }
}

export const EXTRA_GROUP = 'Travel and subsistence'

/**
 * The travel and subsistence lines a draft should have, from its other lines, the venue and the settings. Each keeps
 * the id it had, so a draft that already has them reads as saved.
 */
export function extrasFor(o: {
  lines: readonly QuoteLine[]
  settings: TravelSettings
  /** The venue's pin, if it's on the map. */
  pin: Pin | null | undefined
  /** The distance typed on the quote, which wins over the map. */
  typedKm: number | null | undefined
  /** Vans booked on the job; at least one goes. */
  vehicles: number
  mealsProvided: boolean
  ids: Partial<Record<LineExtra, string>>
  newId: () => string
}): Extras {
  const s = o.settings
  const km = o.typedKm ?? (o.pin ? roadKmFromDublin(o.pin) : null)
  const from: KmFrom = o.typedKm != null ? 'typed' : o.pin ? 'map' : 'none'
  const vehicles = Math.max(1, o.vehicles)
  const lines: QuoteLine[] = []
  let travelNone: string | null = null
  if (km === null) travelNone = "The venue isn't on the map, so the distance isn't known: put it on the map, or type the distance."
  else if (km <= s.fromKm) travelNone = `${km} km from Dublin city centre, so within the ${s.fromKm} km travel starts after.`
  else if (s.fuelCentsPerLitre === null) travelNone = 'No fuel price set yet: set it in Admin › Company › Travel and subsistence.'
  else
    lines.push({
      id: o.ids.travel ?? o.newId(),
      kind: 'other',
      what: `Travel, ${km} km each way from Dublin${vehicles > 1 ? `, ${vehicles} vehicles` : ''}`,
      ref: null,
      group: EXTRA_GROUP,
      qty: vehicles,
      days: 1,
      unitCents: fuelCents(km, s),
      vat: STANDARD_VAT,
      per: 'once',
      extra: 'travel',
    })
  const days = crewDays(o.lines)
  let subNone: string | null = null
  if (o.mealsProvided) subNone = 'The job gives the crew their meals.'
  else if (days === 0) subNone = 'No crew on the quote yet.'
  else if (s.perDiemCents === null) subNone = 'No per diem set yet: set it in Admin › Company › Travel and subsistence.'
  else if (days > 10_000) subNone = 'More crew days than a line has room for.'
  else
    lines.push({
      id: o.ids.subsistence ?? o.newId(),
      kind: 'other',
      what: `Crew subsistence, ${days} crew day${days === 1 ? '' : 's'}`,
      ref: null,
      group: EXTRA_GROUP,
      // So many crew days, for a day each: printed as the per diem a day.
      qty: days,
      days: 1,
      unitCents: s.perDiemCents,
      vat: STANDARD_VAT,
      per: 'day',
      extra: 'subsistence',
    })
  return { lines, travel: { km, from, none: travelNone, vehicles }, subsistence: { crewDays: days, none: subNone } }
}

/** The fuel price read from AA Ireland's monthly survey (ADR 0086), offered to the office to save. */
export interface FuelPriceFound {
  /** Diesel at the pump, cent a litre, to one place. */
  centsPerLitre: number
  /** The survey's month: "October 2026". */
  month: string
  source: string
}

/** AA Ireland's monthly survey of pump prices, the second Monday of each month. */
export const AA_FUEL_PAGE = 'https://www.theaa.ie/aa-membership/fuel-prices/'
