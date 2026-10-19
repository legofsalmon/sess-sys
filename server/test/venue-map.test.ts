import type { FoundPlace } from '@sh/shared'
import { describe, expect, it } from 'vitest'
import { findVenue, nominatim, shortLabel, type PlaceSearch } from '../src/projects/places.ts'
import { IPHONE, server, staff } from './people.ts'

/**
 * Venues on the map (ADR 0057): a venue's pin is kept on the venue, set on
 * its own so saving the venue's details (from any version of the app)
 * leaves it where it is, and said in the history. Looking a venue up goes
 * through the server, which asks OpenStreetMap's search at most once a
 * second, remembers what it found, and tries the name and address in
 * turn until something is found. Nothing here reaches the real search.
 */

const HERITAGE: FoundPlace = { lat: 53.1336529, lng: -7.151215, label: 'The Heritage, Rathmiles Grove, Killenard, County Laois, R32 PW10' }

/** A stand-in for the map search: what each search finds, and every search asked, in order. */
function fakeSearch(answers: Record<string, FoundPlace[]>) {
  const asked: string[] = []
  const search: PlaceSearch = async (q) => {
    asked.push(q)
    return answers[q] ?? []
  }
  return { search, asked }
}

async function office(search: PlaceSearch = fakeSearch({}).search) {
  const { app, db } = await server({ places: search })
  const colly = await staff(app, db, 'Colly Hewson', IPHONE, 'phone-c0ffee')
  expect(await colly.send('venue.upsert', { id: 'heritage', name: 'The Heritage', address: 'Killenard, Co. Laois\nR32 PW10', notes: '' })).toMatchObject({ status: 'applied' })
  return { app, colly }
}

describe("a venue's pin", () => {
  it('is put down, moved and taken off on its own, and saving the details leaves it where it is', async () => {
    // Proves: venue.pin sets and clears both numbers; venue.upsert (which never names a pin) keeps it; the history says each in words.
    const { colly } = await office()
    expect((await colly.record<{ pin: unknown }>('venue', 'heritage')).pin).toBeNull()

    expect(await colly.send('venue.pin', { id: 'heritage', pin: { lat: 53.13365, lng: -7.15122 } })).toMatchObject({ status: 'applied' })
    expect((await colly.record<{ pin: unknown }>('venue', 'heritage')).pin).toEqual({ lat: 53.13365, lng: -7.15122 })

    expect(await colly.send('venue.upsert', { id: 'heritage', name: 'The Heritage Hotel', address: 'Killenard, Co. Laois', notes: 'Ballroom load-in at the back.' })).toMatchObject({ status: 'applied' })
    expect(await colly.record('venue', 'heritage')).toMatchObject({ name: 'The Heritage Hotel', pin: { lat: 53.13365, lng: -7.15122 } })

    expect(await colly.send('venue.pin', { id: 'heritage', pin: null })).toMatchObject({ status: 'applied' })
    expect((await colly.record<{ pin: unknown }>('venue', 'heritage')).pin).toBeNull()

    const words = (await colly.history()).entries.map((e) => e.what)
    // Named as the venue is called now, as the history names everything.
    expect(words.slice(0, 3)).toEqual(['Took The Heritage Hotel off the map', 'Saved the venue The Heritage Hotel', 'Put The Heritage Hotel on the map'])
  })

  it('is refused for a venue that is not there, or a place that is not on the earth', async () => {
    // Proves: the venue must exist; the shared schema turns down numbers out of range in words.
    const { colly } = await office()
    expect(await colly.send('venue.pin', { id: 'nowhere', pin: { lat: 53, lng: -7 } })).toMatchObject({ status: 'rejected', reason: { message: 'That venue no longer exists.' } })
    expect(await colly.send('venue.pin', { id: 'heritage', pin: { lat: 95, lng: -7 } })).toMatchObject({ status: 'rejected', reason: { message: "That isn't a place on the map." } })
  })
})

describe('looking a venue up on the map', () => {
  it('tries the name and address, then less, until something is found, and says what found it', async () => {
    // Proves: the first search that finds anything answers; an Eircode the open map data doesn't know is dropped on a later try.
    const fake = fakeSearch({ 'Killenard, Co. Laois': [HERITAGE] })
    const { app, colly } = await office(fake.search)
    const res = await app.inject({ url: `/api/places?${new URLSearchParams({ name: 'The Heritage', address: 'Killenard, Co. Laois\nR32 PW10' })}`, cookies: colly.cookies })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ found: [HERITAGE], searched: 'Killenard, Co. Laois' })
    expect(fake.asked).toEqual(['The Heritage, Killenard, Co. Laois, R32 PW10', 'Killenard, Co. Laois, R32 PW10', 'Killenard, Co. Laois'])
  })

  it('answers with nothing found, asks for something to look for, and says so in words when the search is down', async () => {
    // Proves: found nothing is an empty list, not an error; no name or address is a 400; a search that throws is a 502 with what to do instead.
    const { app, colly } = await office()
    const ask = (q: Record<string, string>) => app.inject({ url: `/api/places?${new URLSearchParams(q)}`, cookies: colly.cookies })
    expect((await ask({ name: 'Nowhere Hall', address: '' })).json()).toEqual({ found: [] })
    expect((await ask({ name: ' ', address: '' })).statusCode).toBe(400)

    const down = await office(async () => {
      throw new Error('ECONNREFUSED')
    })
    const res = await down.app.inject({ url: '/api/places?name=The+Heritage', cookies: down.colly.cookies })
    expect(res.statusCode).toBe(502)
    expect(res.json().error).toMatch(/Put the pin in by hand/)
  })

  it('needs someone signed in', async () => {
    const { app } = await office()
    expect((await app.inject({ url: '/api/places?name=The+Heritage' })).statusCode).toBe(401)
  })
})

describe("OpenStreetMap's search", () => {
  it('is asked one at a time, a gap apart, with the app named, and the same search is answered from memory', async () => {
    // Proves: Nominatim's rules are kept (one a second, a User-Agent naming the app); the answer is read into places with short labels.
    const calls: { url: string; at: number; agent: string | null }[] = []
    const fetch = (async (url: URL, init?: RequestInit) => {
      calls.push({ url: String(url), at: Date.now(), agent: new Headers(init?.headers).get('user-agent') })
      return new Response(JSON.stringify([{ lat: '53.1336529', lon: '-7.1512150', display_name: 'The Heritage, Rathmiles Grove, Killenard, The Municipal District of Graiguecullen — Portarlington, County Laois, Leinster, R32 PW10, Éire / Ireland' }]))
    }) as typeof globalThis.fetch
    const search = nominatim({ fetch, gapMs: 50 })
    const [a, b] = await Promise.all([search('The Heritage, Killenard'), search('Killenard')])
    expect(a).toEqual([{ lat: 53.1336529, lng: -7.151215, label: 'The Heritage, Rathmiles Grove, Killenard, County Laois, R32 PW10' }])
    expect(b).toHaveLength(1)
    expect(calls).toHaveLength(2)
    expect(calls[1]!.at - calls[0]!.at).toBeGreaterThanOrEqual(45)
    expect(calls[0]!.agent).toMatch(/^SessionHire\//)
    expect(new URL(calls[0]!.url).searchParams.get('countrycodes')).toBe('ie,gb')
    // Asked again, in other capitals: from memory.
    await search('the heritage, killenard')
    expect(calls).toHaveLength(2)
  })

  it('throws when the search answers with an error, and the next search still goes', async () => {
    let first = true
    const fetch = (async () => {
      if (first) {
        first = false
        return new Response('busy', { status: 503 })
      }
      return new Response('[]')
    }) as typeof globalThis.fetch
    const search = nominatim({ fetch, gapMs: 0 })
    await expect(search('The Heritage')).rejects.toThrow('503')
    expect(await search('Killenard')).toEqual([])
  })

  it('shortens its long names to what a person checks', () => {
    expect(shortLabel('Vicar Street, 58-59, Thomas Street, The Liberties, Dublin 8, Dublin, County Dublin, Leinster, D08 A0F1, Éire / Ireland')).toBe('Vicar Street, 58-59, Thomas Street, The Liberties, Dublin 8')
  })

  it('stops after four searches for one venue', async () => {
    const fake = fakeSearch({})
    expect(await findVenue(fake.search, { name: 'The Heritage', address: 'Rathmiles Grove\nKillenard\nR32 PW10' })).toEqual({ found: [] })
    expect(fake.asked.length).toBeLessThanOrEqual(4)
  })
})
