import { describe, expect, it, vi } from 'vitest'
import type { EntityName } from '../src/model.ts'
import { PUSH_LIMIT, type PullResponse, type PushRequest, type PushResponse } from '../src/protocol.ts'
import { MemoryStorage, SyncClient, type Transport } from '../src/sync/client.ts'

/**
 * The device side of sync on its own, against a pretend server: a big
 * outbox goes up in slices and none of it is lost; a date that isn't real
 * is turned away before it can strand the phone; a change the device's own
 * view can't show is taken back; and a change for a table this build
 * doesn't know is kept for the build that will.
 */

/** A server that applies everything it's sent, in order, and remembers each push. */
class PretendServer implements Transport {
  pushes: PushRequest[] = []
  seq = 0
  changes: PullResponse['changes'] = []
  /** Answer the push with this number (counting from 1) as stale. */
  staleAt?: number

  async push(req: PushRequest): Promise<PushResponse> {
    this.pushes.push(req)
    if (this.pushes.length === this.staleAt) return { results: [], stale: true }
    return { results: req.mutations.map((m) => ({ id: m.id, status: 'applied', seq: ++this.seq })) }
  }

  async pull(after: number): Promise<PullResponse> {
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
