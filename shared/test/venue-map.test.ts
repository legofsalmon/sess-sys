import { describe, expect, it } from 'vitest'
import type { Mutation } from '../src/commands.ts'
import { directionsLink, mapLink, pinFromText, pinSearches, type Venue } from '../src/jobs.ts'
import { jobsView } from '../src/sync/jobs-view.ts'

/**
 * Venues on the map (ADR 0057), the shared part: what to search for to find
 * a venue, reading a pin from a pasted link or coordinates, the links out
 * to a maps app, and a pin set on this device shown before it syncs.
 */

describe('what to search for', () => {
  it('tries the name with the address, the address, the address without its Eircode, then the name', () => {
    expect(pinSearches({ name: 'The Heritage', address: 'Killenard, Co. Laois\nR32 PW10' })).toEqual([
      'The Heritage, Killenard, Co. Laois, R32 PW10',
      'Killenard, Co. Laois, R32 PW10',
      'Killenard, Co. Laois',
      'The Heritage',
    ])
  })

  it('says the name once when the address starts with it, and has only the name when there is no address', () => {
    expect(pinSearches({ name: 'Vicar Street', address: 'Vicar Street\n58 Thomas Street, Dublin 8' })).toEqual(['Vicar Street, 58 Thomas Street, Dublin 8', '58 Thomas Street, Dublin 8', 'Vicar Street'])
    expect(pinSearches({ name: 'Iveagh Gardens', address: '' })).toEqual(['Iveagh Gardens'])
    // Dublin 6W has its own Eircode shape.
    expect(pinSearches({ name: 'X', address: 'Terenure, D6W XY12' })).toContain('Terenure')
  })
})

describe('a pin pasted in', () => {
  it('reads coordinates and the links maps apps share', () => {
    const at = { lat: 53.1336, lng: -7.1512 }
    expect(pinFromText('53.1336, -7.1512')).toEqual(at)
    expect(pinFromText(' 53.1336 -7.1512 ')).toEqual(at)
    expect(pinFromText('https://www.google.com/maps/place/The+Heritage/@53.1336,-7.1512,17z/data=!3m1')).toEqual(at)
    expect(pinFromText('https://www.google.com/maps/place/x/data=!4m6!3m5!1s0x0:0x0!8m2!3d53.1336!4d-7.1512')).toEqual(at)
    expect(pinFromText('https://maps.google.com/?q=53.1336,-7.1512')).toEqual(at)
    expect(pinFromText('https://www.openstreetmap.org/?mlat=53.1336&mlon=-7.1512#map=17/53.1336/-7.1512')).toEqual(at)
    expect(pinFromText('https://www.openstreetmap.org/#map=17/53.1336/-7.1512')).toEqual(at)
  })

  it('leaves words, and numbers that are not on the earth, to be searched for', () => {
    expect(pinFromText('The Heritage')).toBeUndefined()
    expect(pinFromText('R32 PW10')).toBeUndefined()
    expect(pinFromText('95.1, -7.1')).toBeUndefined()
    // A short link (maps.app.goo.gl) says nothing until it's opened.
    expect(pinFromText('https://maps.app.goo.gl/AbCdEf123')).toBeUndefined()
  })
})

describe('links out to a maps app', () => {
  it('go straight to the pin once there is one, and search by name and address before', () => {
    const heritage: Venue = { id: 'v1', name: 'The Heritage', address: 'Killenard\nR32 PW10', notes: '', pin: null }
    expect(mapLink(heritage)).toBe('https://www.google.com/maps/search/?api=1&query=The%20Heritage%2C%20Killenard%2C%20R32%20PW10')
    expect(mapLink({ ...heritage, pin: { lat: 53.1336, lng: -7.1512 } })).toBe('https://www.google.com/maps/search/?api=1&query=53.1336,-7.1512')
    expect(directionsLink({ lat: 53.1336, lng: -7.1512 })).toBe('https://www.google.com/maps/dir/?api=1&destination=53.1336,-7.1512')
  })
})

describe('a pin set on this device', () => {
  const pending = (name: Mutation['name'], args: object, id: string): Mutation => ({ id, name, args, createdAt: '2026-10-19T09:00:00Z' }) as Mutation
  const heritage: Venue = { id: 'v1', name: 'The Heritage', address: '', notes: '', pin: null }

  it('shows before it syncs, and saving the details after keeps it', () => {
    // Proves: venue.pin is laid over the server's venue; a venue.upsert queued behind it (which names no pin) leaves it.
    const placed = pending('venue.pin', { id: 'v1', pin: { lat: 53.1, lng: -7.1 } }, 'm1')
    expect(jobsView({ venue: { v1: heritage } }, [placed], 0, []).venues[0]).toMatchObject({ pin: { lat: 53.1, lng: -7.1 }, pending: true })
    const renamed = pending('venue.upsert', { id: 'v1', name: 'The Heritage Hotel', address: '', notes: '' }, 'm2')
    expect(jobsView({ venue: { v1: heritage } }, [placed, renamed], 0, []).venues[0]).toMatchObject({ name: 'The Heritage Hotel', pin: { lat: 53.1, lng: -7.1 } })
    // A venue saved on this device that the server has with a pin keeps the server's pin.
    expect(jobsView({ venue: { v1: { ...heritage, pin: { lat: 53, lng: -7 } } } }, [renamed], 0, []).venues[0]!.pin).toEqual({ lat: 53, lng: -7 })
  })
})
