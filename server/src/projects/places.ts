import { pinSearches, type FoundPlace, type PlacesFound } from '@sh/shared'
import type { FastifyInstance } from 'fastify'

/**
 * Finding a venue on the map (ADR 0057). The phone asks the server, and the
 * server asks OpenStreetMap's own search (Nominatim), so one place keeps to
 * its rules: a name saying which app is asking, at most one search a
 * second however many phones ask at once, and the same search answered
 * from memory for a day. What is found is only ever suggested; a pin is
 * set when someone picks one, and is kept on the venue from then on, so
 * the search is never asked again for it, and the map works without it.
 */

/** Places for one search, best first; empty when it finds nothing. Throws when the search can't be reached. */
export type PlaceSearch = (query: string) => Promise<FoundPlace[]>

export interface NominatimOptions {
  /** NOMINATIM_URL, for a copy of the search run elsewhere; OpenStreetMap's own otherwise. */
  base?: string
  /** Stands in for the network in tests. */
  fetch?: typeof fetch
  /** The least time between two searches; Nominatim asks for a second. */
  gapMs?: number
}

const DAY = 24 * 60 * 60 * 1000
const KEEP = 500

export function nominatim({ base = 'https://nominatim.openstreetmap.org', fetch: get = fetch, gapMs = 1100 }: NominatimOptions = {}): PlaceSearch {
  const kept = new Map<string, { at: number; found: FoundPlace[] }>()
  let queue: Promise<unknown> = Promise.resolve()
  let last = 0

  const ask = async (query: string): Promise<FoundPlace[]> => {
    const wait = last + gapMs - Date.now()
    if (wait > 0) await new Promise((r) => setTimeout(r, wait))
    last = Date.now()
    const url = new URL('/search', base)
    url.search = new URLSearchParams({ q: query, format: 'jsonv2', limit: '5', countrycodes: 'ie,gb', 'accept-language': 'en' }).toString()
    const res = await get(url, {
      headers: { 'user-agent': 'SessionHire/1.0 (+https://github.com/legofsalmon/sess-sys)', accept: 'application/json' },
      signal: AbortSignal.timeout(10_000),
    })
    if (!res.ok) throw new Error(`The map search answered ${res.status}.`)
    const rows = (await res.json()) as { lat: string; lon: string; display_name: string; name?: string }[]
    return rows.flatMap((r) => {
      const lat = Number(r.lat)
      const lng = Number(r.lon)
      return Number.isFinite(lat) && Number.isFinite(lng) ? [{ lat, lng, label: shortLabel(r.display_name) }] : []
    })
  }

  return (query) => {
    const key = query.trim().toLowerCase()
    const hit = kept.get(key)
    if (hit && Date.now() - hit.at < DAY) return Promise.resolve(hit.found)
    // One at a time, in the order asked.
    const answer = queue.then(() => ask(query))
    queue = answer.catch(() => undefined)
    return answer.then((found) => {
      if (kept.size >= KEEP) kept.delete(kept.keys().next().value!)
      kept.set(key, { at: Date.now(), found })
      return found
    })
  }
}

/** "The Heritage, Rathmiles Grove, Killenard, County Laois, R32 PW10": the search's long name, without its districts and country. */
export function shortLabel(name: string): string {
  const parts = name
    .split(',')
    .map((p) => p.trim())
    .filter((p) => p && !/^(Éire \/ Ireland|Ireland|United Kingdom|Leinster|Munster|Connacht|Ulster|Northern Ireland|England|Scotland|Wales)$/i.test(p) && !/Municipal District|Electoral Division/i.test(p))
  return [...new Set(parts)].slice(0, 5).join(', ')
}

/** The first of a venue's searches that finds anything, at most four searched. */
export async function findVenue(search: PlaceSearch, venue: { name: string; address: string }): Promise<PlacesFound> {
  for (const q of pinSearches(venue).slice(0, 4)) {
    const found = await search(q)
    if (found.length > 0) return { found, searched: q }
  }
  return { found: [] }
}

export function registerPlaceRoutes(app: FastifyInstance, { search }: { search: PlaceSearch }) {
  // Putting a venue on the map is changing the venue, so it needs what changing jobs needs.
  app.get<{ Querystring: { name?: string; address?: string } }>('/api/places', { config: { needs: 'jobs' } }, async (req, reply) => {
    const name = (req.query.name ?? '').slice(0, 200)
    const address = (req.query.address ?? '').slice(0, 500)
    if (!name.trim() && !address.trim()) return reply.code(400).send({ error: 'Say what to look for: a name or an address.' })
    try {
      return reply.header('cache-control', 'no-store').send(await findVenue(search, { name, address }))
    } catch (err) {
      req.log.warn({ err }, 'The map search failed')
      return reply.code(502).send({ error: "The map search isn't answering. Put the pin in by hand on the map, or try again later." })
    }
  })
}
