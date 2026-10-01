import { describe, expect, it, vi } from 'vitest'
import type { Rejection } from '../src/commands.ts'
import type { EntityName } from '../src/model.ts'
import { PUSH_LIMIT, type PullResponse, type PushRequest, type PushResponse } from '../src/protocol.ts'
import { applyChange, emptySnapshot, MemoryStorage, SyncClient, type Transport } from '../src/sync/client.ts'

/**
 * The device side of sync on its own, against a pretend server: a big
 * outbox goes up in slices and none of it is lost; a date that isn't real
 * is turned away before it can strand the phone; a change the device's own
 * view can't show is taken back; a change for a table this build doesn't
 * know is kept for the build that will; a round that finds nothing saves
 * nothing and wakes nobody, unless a screen opened mid-round or the day has
 * turned, and the view is the same object until something changes; and a
 * device that can't save still works.
 */

/** A server that applies everything it's sent, in order, and remembers each push. */
class PretendServer implements Transport {
  pushes: PushRequest[] = []
  pulls = 0
  seq = 0
  changes: PullResponse['changes'] = []
  /** Answer the push with this number (counting from 1) as stale. */
  staleAt?: number
  /** Turn a change down, with this reason. */
  refuse?: (m: { name: string }) => Rejection | undefined
  /** No signal. */
  down = false
  /** Hold every answer until this settles, so a test can look in mid-round. */
  wait?: Promise<void>

  async push(req: PushRequest): Promise<PushResponse> {
    await this.wait
    if (this.down) throw new Error('No signal')
    this.pushes.push(req)
    if (this.pushes.length === this.staleAt) return { results: [], stale: true }
    return {
      results: req.mutations.map((m) => {
        const reason = this.refuse?.(m)
        return reason ? { id: m.id, status: 'rejected', reason } : { id: m.id, status: 'applied', seq: ++this.seq }
      }),
    }
  }

  async pull(after: number): Promise<PullResponse> {
    await this.wait
    if (this.down) throw new Error('No signal')
    this.pulls++
    const changes = this.changes.filter((c) => c.seq > after)
    return { changes, cursor: Math.max(after, this.seq, ...changes.map((c) => c.seq)), more: false }
  }
}

async function device(server: Transport, storage = new MemoryStorage()) {
  return new SyncClient({ storage, transport: server, clientId: 'phone' }).open()
}

const booking = (id: string, start = '2026-10-05', end = start) => ({ id, productId: 'y10p', project: 'Nissan', qty: 1, start, end })

describe('a big outbox', () => {
  const many = PUSH_LIMIT * 2 + 1

  it(`sends more than ${PUSH_LIMIT} waiting changes in slices, in order, and all of them leave the outbox`, async () => {
    const server = new PretendServer()
    const storage = new MemoryStorage()
    const phone = await device(server, storage)
    for (let i = 0; i < many; i++) await phone.mutate('product.upsert', { id: `p${i}`, name: `Product ${i}`, quantity: i })
    expect(phone.view().pendingCount).toBe(many)

    await phone.sync()
    expect(server.pushes.map((p) => p.mutations.length)).toEqual([PUSH_LIMIT, PUSH_LIMIT, 1])
    expect(server.pushes.flatMap((p) => p.mutations.map((m) => (m.args as { id: string }).id))).toEqual(Array.from({ length: many }, (_, i) => `p${i}`))
    expect(phone.view().pendingCount).toBe(0)
    expect((await storage.load())?.outbox).toEqual([])
  })

  it('stops at a slice the server calls stale, so what follows is never sent against a copy that is gone', async () => {
    const server = new PretendServer()
    server.staleAt = 2
    const phone = await device(server)
    for (let i = 0; i < many; i++) await phone.mutate('product.upsert', { id: `p${i}`, name: `Product ${i}`, quantity: i })

    await phone.sync()
    expect(server.pushes.map((p) => p.mutations.length)).toEqual([PUSH_LIMIT, PUSH_LIMIT])
    // The first slice went through; the second was stale, so the third stayed waiting.
    expect(phone.view().pendingCount).toBe(PUSH_LIMIT + 1)
  })
})

describe('a date that is not real', () => {
  it('is turned away on the device with a plain message, before it is saved or sent', async () => {
    const server = new PretendServer()
    const storage = new MemoryStorage()
    const phone = await device(server, storage)
    await expect(phone.mutate('booking.create', booking('b', '2026-02-31'))).rejects.toThrow("That isn't a real date.")
    await expect(phone.mutate('unavailability.add', { id: 'u', personId: 'aoife', start: '2026-13-01', end: '2026-13-01', note: '' })).rejects.toThrow(
      "That isn't a real date."
    )
    // A year the app could never be about is a slip, not a date.
    await expect(phone.mutate('booking.create', booking('b', '0226-10-05'))).rejects.toThrow("That isn't a real date.")
    await expect(phone.mutate('booking.create', booking('b', '9999-10-05'))).rejects.toThrow("That isn't a real date.")
    expect(phone.view().pendingCount).toBe(0)
    await phone.sync()
    expect(server.pushes).toEqual([])
    expect((await storage.load())?.outbox ?? []).toEqual([])
  })
})

describe('a change the view cannot show', () => {
  it('is taken back off the outbox and refused in words, and the next change still goes in', async () => {
    const server = new PretendServer()
    const storage = new MemoryStorage()
    const phone = await device(server, storage)
    vi.spyOn(phone, 'view').mockImplementationOnce(() => {
      throw new RangeError('Invalid time value')
    })
    await expect(phone.mutate('booking.create', booking('b'))).rejects.toThrow("This change can't be shown on this device, so it wasn't kept: Invalid time value")
    expect(phone.view().pendingCount).toBe(0)
    expect((await storage.load())?.outbox ?? []).toEqual([])

    await phone.mutate('booking.create', booking('c'))
    expect(phone.view().bookings).toMatchObject([{ id: 'c', pending: true }])
  })

  it('is set aside as a problem when the app opens on a copy an older build saved it in, and the rest carries on', async () => {
    // A build from before mutate() checked could save a crew call on a day that
    // isn't one; this build's view throws on it. Opening must not leave the
    // screens blank: that change becomes a problem, the others stay and are sent.
    const server = new PretendServer()
    const storage = new MemoryStorage()
    const phone = await device(server, storage)
    await phone.mutate('project.create', { id: 'j', name: 'Nissan launch', clientId: null, venueId: null, status: 'confirmed', notes: '' })
    const snapshot = (await storage.load())!
    snapshot.outbox.push({
      id: 'bad',
      name: 'call.create',
      args: { id: 'c', projectId: 'j', phaseId: null, project: 'Nissan launch', phase: '', venue: '', role: 'Sound No.1', start: '2026-13-45', end: '2026-13-45', callTime: null, needed: 1, dayRateCents: null, details: '', replyBy: null },
      createdAt: '2026-10-01T09:00:00Z',
    } as never)
    snapshot.outbox.push({ id: 'after', name: 'product.upsert', args: { id: 'p', name: 'Cable', quantity: 1 }, createdAt: '2026-10-01T09:01:00Z' } as never)
    await storage.save(snapshot)

    const reopened = await device(server, storage)
    const view = reopened.view()
    expect(view.pendingCount).toBe(2)
    expect(view.problems).toMatchObject([{ mutation: { id: 'bad', name: 'call.create' }, reason: { code: 'invalid', message: expect.stringContaining("can't be shown on this device") } }])
    expect((await storage.load())!.outbox.map((m) => m.id)).not.toContain('bad')

    await reopened.sync()
    expect(server.pushes.flatMap((p) => p.mutations.map((m) => m.id))).toEqual(expect.arrayContaining(['after']))
    expect(server.pushes.flatMap((p) => p.mutations.map((m) => m.id))).not.toContain('bad')
    expect(reopened.view().pendingCount).toBe(0)
  })
})

describe('a change named after an object’s own insides', () => {
  it('is dropped rather than reaching every object', () => {
    const state = { ...emptySnapshot('phone') }
    applyChange(state, { seq: 1, entity: '__proto__' as EntityName, id: 'x', op: 'put', data: { polluted: true } })
    applyChange(state, { seq: 2, entity: 'product' as EntityName, id: '__proto__', op: 'put', data: { polluted: true } })
    expect(({} as { polluted?: boolean }).polluted).toBeUndefined()
    expect(Object.keys(state.entities.product)).toEqual([])
  })
})

describe('a change for a table this build does not know', () => {
  it('is kept under its name and is still there after the app is opened again from storage', async () => {
    const server = new PretendServer()
    server.seq = 1
    server.changes = [{ seq: 1, entity: 'widget' as EntityName, id: 'w1', op: 'put', data: { id: 'w1', colour: 'red' } }]
    const storage = new MemoryStorage()
    const phone = await device(server, storage)
    await phone.sync()
    expect(phone.view().cursor).toBe(1)
    const tables = (await storage.load())!.entities as Record<string, Record<string, unknown>>
    expect(tables.widget).toEqual({ w1: { id: 'w1', colour: 'red' } })

    // The phone dies and the app is opened again from storage, then syncs, saving its copy again.
    const reopened = await device(server, storage)
    expect(() => reopened.view()).not.toThrow()
    await reopened.sync()
    const again = (await storage.load())!.entities as Record<string, Record<string, unknown>>
    expect(again.widget).toEqual({ w1: { id: 'w1', colour: 'red' } })

    // A later delete for it is honoured too.
    server.seq = 2
    server.changes.push({ seq: 2, entity: 'widget' as EntityName, id: 'w1', op: 'delete', data: null })
    await reopened.sync()
    expect(((await storage.load())!.entities as Record<string, Record<string, unknown>>).widget).toEqual({})
  })
})

const product = (id: string, name: string): PullResponse['changes'][number] => ({ seq: 0, entity: 'product' as EntityName, id, op: 'put', data: { id, name, quantity: 4 } })

describe('a round that finds nothing', () => {
  it('saves nothing and tells no screen, and the view is the same object before and after', async () => {
    const server = new PretendServer()
    server.seq = 1
    server.changes = [{ ...product('y10p', 'd&b Y10P'), seq: 1 }]
    const storage = new MemoryStorage()
    const phone = await device(server, storage)
    await phone.sync()
    expect(phone.view().products).toHaveLength(1)

    const save = vi.spyOn(storage, 'save')
    const told = vi.fn()
    phone.subscribe(told)
    told.mockClear()
    const before = phone.view()
    await phone.sync()
    await phone.sync()
    expect(server.pulls).toBe(3)
    expect(save).not.toHaveBeenCalled()
    expect(told).not.toHaveBeenCalled()
    expect(phone.view()).toBe(before)
    // What a poke and the sign-in page need, without a view.
    expect(phone.cursor).toBe(1)
    expect(phone.pendingCount).toBe(0)
  })

  it('still says when the signal is back', async () => {
    const server = new PretendServer()
    const phone = await device(server)
    const told = vi.fn()
    phone.subscribe(told)
    server.down = true
    await expect(phone.sync()).rejects.toThrow('No signal')
    expect(phone.view().connection).toBe('offline')
    const offline = phone.view()
    told.mockClear()
    server.down = false
    await phone.sync()
    expect(phone.view().connection).toBe('idle')
    expect(phone.view()).not.toBe(offline)
    expect(told).toHaveBeenCalledTimes(1)
  })

  it('still tells a screen that opened mid-round how the round ended', async () => {
    // The first screen always does: the app starts a round before it draws.
    // Left untold, its header would say "Up to date" with no signal, or
    // "Syncing" for good.
    const server = new PretendServer()
    const phone = await device(server)
    let release!: () => void
    server.wait = new Promise<void>((r) => (release = r))
    const round = phone.sync()
    const told = vi.fn()
    phone.subscribe(told)
    expect(told).toHaveBeenLastCalledWith(expect.objectContaining({ connection: 'syncing' }))
    release()
    await round
    expect(told).toHaveBeenCalledTimes(2)
    expect(told).toHaveBeenLastCalledWith(expect.objectContaining({ connection: 'idle' }))
    expect(told.mock.calls[1]![0]).toBe(phone.view())

    // And one opened during a retry with no signal hears that there still is none.
    server.wait = undefined
    server.down = true
    await expect(phone.sync()).rejects.toThrow('No signal')
    expect(phone.view().connection).toBe('offline')
    server.wait = new Promise<void>((r) => (release = r))
    const retry = phone.sync()
    const other = vi.fn()
    phone.subscribe(other)
    expect(other).toHaveBeenLastCalledWith(expect.objectContaining({ connection: 'syncing' }))
    release()
    await expect(retry).rejects.toThrow('No signal')
    expect(other).toHaveBeenCalledTimes(2)
    expect(other).toHaveBeenLastCalledWith(expect.objectContaining({ connection: 'offline' }))
  })
})

describe('the view', () => {
  it('changes after a change of their own, a pull, a problem dismissed, and the day turning in Ireland, and not otherwise', async () => {
    const server = new PretendServer()
    const storage = new MemoryStorage()
    // 23:30 in Ireland, in summer time.
    let now = new Date('2026-10-01T22:30:00Z')
    const phone = await new SyncClient({ storage, transport: server, clientId: 'phone', now: () => now }).open()
    const v0 = phone.view()
    expect(phone.view()).toBe(v0)

    await phone.mutate('product.upsert', { id: 'p', name: 'Cable', quantity: 1 })
    const v1 = phone.view()
    expect(v1).not.toBe(v0)
    expect(v1.pendingCount).toBe(1)

    // Pushed and its result pulled: the outbox empties, which is a change.
    await phone.sync()
    const v2 = phone.view()
    expect(v2).not.toBe(v1)
    expect(v2.pendingCount).toBe(0)
    await phone.sync()
    expect(phone.view()).toBe(v2)

    server.seq = 2
    server.changes = [{ ...product('y10p', 'd&b Y10P'), seq: 2 }]
    await phone.sync()
    const v3 = phone.view()
    expect(v3).not.toBe(v2)
    expect(v3.products.map((p) => p.name)).toEqual(['d&b Y10P'])

    server.refuse = (m) => (m.name === 'booking.create' ? { code: 'short', message: 'Only 0 × d&b Y10P free' } : undefined)
    await phone.mutate('booking.create', booking('b'))
    await phone.sync()
    const v4 = phone.view()
    expect(v4.problems).toHaveLength(1)
    // Dismissing a problem that isn't there changes nothing.
    await phone.dismissProblem('nothing')
    expect(phone.view()).toBe(v4)
    await phone.dismissProblem(v4.problems[0]!.mutation.id)
    const v5 = phone.view()
    expect(v5).not.toBe(v4)
    expect(v5.problems).toEqual([])

    // Half an hour on: midnight has passed in Ireland, though not in UTC. A
    // screen left open overnight is told so by the next round, though it
    // finds nothing, and not again by the one after.
    const told = vi.fn()
    phone.subscribe(told)
    told.mockClear()
    now = new Date('2026-10-01T23:30:00Z')
    await phone.sync()
    const v6 = phone.view()
    expect(v6).not.toBe(v5)
    expect(told).toHaveBeenCalledTimes(1)
    expect(told).toHaveBeenLastCalledWith(v6)
    expect(phone.view()).toBe(v6)
    await phone.sync()
    expect(told).toHaveBeenCalledTimes(1)
  })
})

describe('a device that cannot save', () => {
  it('takes a change of their own back and says why, and still shows what the server sends', async () => {
    const server = new PretendServer()
    const storage = new MemoryStorage()
    const phone = await device(server, storage)
    vi.spyOn(storage, 'save').mockRejectedValue(new Error('This phone is out of storage. Free some space, then try again.'))
    await expect(phone.mutate('product.upsert', { id: 'p', name: 'Cable', quantity: 1 })).rejects.toThrow('This phone is out of storage')
    expect(phone.pendingCount).toBe(0)
    expect(phone.view().products).toEqual([])

    // A pull whose save fails is not "no signal": the copy in memory is right, and the screens get it.
    server.seq = 1
    server.changes = [{ ...product('y10p', 'd&b Y10P'), seq: 1 }]
    await expect(phone.sync()).resolves.toBeUndefined()
    expect(phone.view().products.map((p) => p.name)).toEqual(['d&b Y10P'])
    expect(phone.view().connection).toBe('idle')
    expect(phone.cursor).toBe(1)
  })
})
