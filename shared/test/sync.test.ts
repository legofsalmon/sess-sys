import { describe, expect, it, vi } from 'vitest'
import { commandSchemas, type Rejection } from '../src/commands.ts'
import type { EntityName } from '../src/model.ts'
import { FEED, PUSH_LIMIT, PUSH_SLICE, type MutationResult, type PullResponse, type PushRequest, type PushResponse } from '../src/protocol.ts'
import { applyChange, emptySnapshot, MemoryStorage, ServerBusy, SyncClient, type Transport } from '../src/sync/client.ts'
import { keepSyncing } from '../src/sync/retry.ts'

/**
 * The device side of sync on its own, against a pretend server: a big
 * outbox goes up in slices and none of it is lost; a date that isn't real
 * is turned away before it can strand the phone; a change the device's own
 * view can't show is taken back; a change for a table this build doesn't
 * know is kept for the build that will; a round that finds nothing saves
 * nothing and wakes nobody, unless a screen opened mid-round or the day has
 * turned, and the view is the same object until something changes; a
 * device that can't save still works; text pasted with control characters
 * is cleaned on the device as the server cleans it; a sync asked for while
 * a round fails gets a round of its own, and leaves one retry however many
 * asked, backing off to every 30 seconds; a long feed is pulled a page at a
 * time; after the server is restored from a backup the device starts its
 * copy afresh and sends again what it did lately, unless the server was
 * cleared on purpose, when it drops it; a push the server calls stale
 * is followed by just such a fresh start; a push answered only in part
 * sends the rest first, next round; a push that fails still lets the round
 * pull; a push the server is too busy to take waits quietly and goes again;
 * and a copy read before the feed’s fix reads it again, once,
 * keeping what it has waiting.
 */

/** A server that applies everything it's sent, in order, and remembers each push. */
class PretendServer implements Transport {
  pushes: PushRequest[] = []
  pulls = 0
  /** Where each pull asked to start from. */
  pulledAfter: number[] = []
  seq = 0
  changes: PullResponse['changes'] = []
  /** Answer the push with this number (counting from 1) as stale. */
  staleAt?: number
  /** Answer any push made against this copy of the data as stale, as the real server does once someone has started fresh. */
  staleFor?: string
  /** Which copy of the data this is; undefined plays a server from before copies were named. */
  generation?: string
  /** This copy began empty on purpose. */
  cleared = false
  /** Hand out at most this many changes per pull, saying there are more. */
  pageSize?: number
  /** Each change's answer, by its id: one sent again gets the same answer, as from the real server. */
  answered = new Map<string, MutationResult>()
  /** Turn a change down, with this reason. */
  refuse?: (m: { name: string }) => Rejection | undefined
  /** No signal. */
  down = false
  /** Hold every answer until this settles, so a test can look in mid-round. */
  wait?: Promise<void>
  /** Answer only this many of each push, as a slow server out of time does, leaving the rest for the next. */
  answerAtMost?: number
  /** Pushes fail, as when the server takes longer than the phone waits; pulls still answer. */
  pushFails = false
  /** Busy with a long change: answer only this many of each push, and say busy, as the server does when the write lock is held. */
  busyAfter?: number
  /** How it reads the feed (`FEED`); undefined plays a server from before. */
  feed?: number

  async push(req: PushRequest): Promise<PushResponse> {
    await this.wait
    if (this.down) throw new Error('No signal')
    if (this.pushFails) throw new Error('The server took too long')
    this.pushes.push(req)
    if (this.pushes.length === this.staleAt) return { results: [], stale: true }
    if (this.staleFor !== undefined && req.generation === this.staleFor) return { results: [], stale: true }
    return {
      ...(this.busyAfter !== undefined && this.busyAfter < req.mutations.length ? { busy: true } : {}),
      results: req.mutations.slice(0, this.busyAfter ?? this.answerAtMost).map((m): MutationResult => {
        const before = this.answered.get(m.id)
        if (before) return { ...before, duplicate: true }
        const reason = this.refuse?.(m)
        const result: MutationResult = reason ? { id: m.id, status: 'rejected', reason } : { id: m.id, status: 'applied', seq: ++this.seq }
        this.answered.set(m.id, result)
        return result
      }),
    }
  }

  async pull(after: number): Promise<PullResponse> {
    await this.wait
    if (this.down) throw new Error('No signal')
    this.pulls++
    this.pulledAfter.push(after)
    const all = this.changes.filter((c) => c.seq > after)
    const changes = this.pageSize ? all.slice(0, this.pageSize) : all
    const more = changes.length < all.length
    return {
      changes,
      cursor: more ? changes[changes.length - 1]!.seq : Math.max(after, this.seq, ...changes.map((c) => c.seq)),
      more,
      head: this.seq,
      ...(this.feed !== undefined ? { feed: this.feed } : {}),
      ...(this.generation !== undefined ? { generation: this.generation } : {}),
      ...(this.cleared ? { cleared: true } : {}),
    }
  }
}

async function device(server: Transport, storage = new MemoryStorage()) {
  return new SyncClient({ storage, transport: server, clientId: 'phone' }).open()
}

/** A phase of a job, for the changes with dates in them. */
const phase = (id: string, start = '2026-10-05', end = start) => ({ id, projectId: 'j', name: 'Build', start, end, venueId: null, notes: '' })
/** A place in the warehouse: the plainest change there is, for the tests that only need one. */
const place = (id: string, name = `Bay ${id}`) => ({ id, name, notes: '' })

// A thousand changes made one by one, each saved as it would be on a phone, take a second or two here and more on a busy
// machine, close to the five seconds a test gets by default: the time allowed is generous so a slow run isn't taken for a fault.
describe('a big outbox', { timeout: 30_000 }, () => {
  const many = PUSH_LIMIT * 2 + 1

  it(`sends ${many} waiting changes ${PUSH_SLICE} at a time, in order, and all of them leave the outbox`, async () => {
    const server = new PretendServer()
    const storage = new MemoryStorage()
    const phone = await device(server, storage)
    for (let i = 0; i < many; i++) await phone.mutate('place.upsert', place(`p${i}`))
    expect(phone.view().pendingCount).toBe(many)

    await phone.sync()
    expect(server.pushes.map((p) => p.mutations.length)).toEqual([...Array<number>(Math.floor(many / PUSH_SLICE)).fill(PUSH_SLICE), many % PUSH_SLICE])
    expect(server.pushes.every((p) => p.partial === true)).toBe(true)
    expect(server.pushes.flatMap((p) => p.mutations.map((m) => (m.args as { id: string }).id))).toEqual(Array.from({ length: many }, (_, i) => `p${i}`))
    expect(phone.view().pendingCount).toBe(0)
    expect((await storage.load())?.outbox).toEqual([])
  })

  it('stops at a slice the server calls stale, so what follows is never sent against a copy that is gone', async () => {
    const server = new PretendServer()
    server.staleAt = 2
    const phone = await device(server)
    for (let i = 0; i < many; i++) await phone.mutate('place.upsert', place(`p${i}`))

    await phone.sync()
    expect(server.pushes.map((p) => p.mutations.length)).toEqual([PUSH_SLICE, PUSH_SLICE])
    // The first slice went through; the second was stale, so the rest stayed waiting.
    expect(phone.view().pendingCount).toBe(many - PUSH_SLICE)
  })
})

describe('a date that is not real', () => {
  it('is turned away on the device with a plain message, before it is saved or sent', async () => {
    const server = new PretendServer()
    const storage = new MemoryStorage()
    const phone = await device(server, storage)
    await expect(phone.mutate('phase.add', phase('b', '2026-02-31'))).rejects.toThrow("That isn't a real date.")
    await expect(phone.mutate('unavailability.add', { id: 'u', personId: 'aoife', start: '2026-13-01', end: '2026-13-01', note: '' })).rejects.toThrow(
      "That isn't a real date."
    )
    // A year the app could never be about is a slip, not a date.
    await expect(phone.mutate('phase.add', phase('b', '0226-10-05'))).rejects.toThrow("That isn't a real date.")
    await expect(phone.mutate('phase.add', phase('b', '9999-10-05'))).rejects.toThrow("That isn't a real date.")
    expect(phone.view().pendingCount).toBe(0)
    await phone.sync()
    expect(server.pushes).toEqual([])
    expect((await storage.load())?.outbox ?? []).toEqual([])
  })
})

describe('text pasted with control characters', () => {
  it('is cleaned on the device before it is saved or sent, as the server cleans it, so both hold the same words', async () => {
    // Proves: a NUL, a vertical tab (Word's line break), a C1 control, DEL and half an emoji, as text pasted from Word or a PDF
    // or cut at a length can carry, are cleaned out of what the device keeps and sends; tab and line breaks stay where notes
    // have them; a name of nothing but control characters is "needed"; and cleaning what's clean, as the server does, changes nothing.
    const server = new PretendServer()
    const storage = new MemoryStorage()
    const phone = await device(server, storage)
    const sent = await phone.mutate('place.upsert', { id: 'a3', name: 'Bay\u0000 A3\u007f\ud83c', notes: 'Top shelf\u000bspares\u0085\tonly\r\nNo\u0001 cases \u{1F3AC}' })
    const clean = { id: 'a3', name: 'Bay A3', notes: 'Top shelf\nspares\n\tonly\r\nNo cases \u{1F3AC}' }
    expect(sent.args).toEqual(clean)
    expect((await storage.load())!.outbox[0]!.args).toEqual(clean)
    expect(commandSchemas['place.upsert'].parse(clean)).toEqual(clean)
    await expect(phone.mutate('place.upsert', { id: 'a4', name: '\u0000\u0001', notes: '' })).rejects.toThrow("The place's name is needed.")
    await phone.sync()
    expect(server.pushes[0]!.mutations[0]!.args).toEqual(clean)
  })
})

describe('text typed with spaces round it', () => {
  it('is kept trimmed on the device while it waits, as the server keeps it, so it shows and sorts the same before and after a sync', async () => {
    // Proves (audit, 20 October 2026, finding 63): the spaces round a name and its notes are gone from what the device keeps, shows
    // and sends, the line breaks inside the notes stay, and a name of nothing but spaces is "needed" on the phone as on the server.
    const server = new PretendServer()
    const storage = new MemoryStorage()
    const phone = await device(server, storage)
    const sent = await phone.mutate('place.upsert', { id: 'b7', name: '  Bay B7  ', notes: '\n  Top shelf\nspares  \n' })
    const kept = { id: 'b7', name: 'Bay B7', notes: 'Top shelf\nspares' }
    expect(sent.args).toEqual(kept)
    expect(phone.view().warehouse.places).toMatchObject([{ id: 'b7', name: 'Bay B7', pending: true }])
    await expect(phone.mutate('place.upsert', { id: 'b8', name: '   ', notes: '' })).rejects.toThrow("The place's name is needed.")
    await phone.sync()
    expect(server.pushes[0]!.mutations[0]!.args).toEqual(kept)
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
    await expect(phone.mutate('place.upsert', place('b'))).rejects.toThrow("This change can't be shown on this device, so it wasn't kept: Invalid time value")
    expect(phone.view().pendingCount).toBe(0)
    expect((await storage.load())?.outbox ?? []).toEqual([])

    await phone.mutate('place.upsert', place('c'))
    expect(phone.view().warehouse.places).toMatchObject([{ id: 'c', pending: true }])
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
    snapshot.outbox.push({ id: 'after', name: 'place.upsert', args: place('p'), createdAt: '2026-10-01T09:01:00Z' } as never)
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
    applyChange(state, { seq: 2, entity: 'place', id: '__proto__', op: 'put', data: { polluted: true } })
    expect(({} as { polluted?: boolean }).polluted).toBeUndefined()
    expect(Object.keys(state.entities.place)).toEqual([])
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

const placed = (id: string, name: string): PullResponse['changes'][number] => ({ seq: 0, entity: 'place', id, op: 'put', data: { id, name, notes: '' } })

describe('a round that finds nothing', () => {
  it('saves nothing and tells no screen, and the view is the same object before and after', async () => {
    const server = new PretendServer()
    server.seq = 1
    server.changes = [{ ...placed('a3', 'Bay A3'), seq: 1 }]
    const storage = new MemoryStorage()
    const phone = await device(server, storage)
    await phone.sync()
    expect(phone.view().warehouse.places).toHaveLength(1)

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
    // Once that the copy has arrived (it was a new phone's first read), once that the round is over.
    expect(told).toHaveBeenCalledTimes(2)
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
    // Opening, the copy arrived (a new phone's first read), and the round over.
    expect(told).toHaveBeenCalledTimes(3)
    expect(told).toHaveBeenLastCalledWith(expect.objectContaining({ connection: 'idle' }))
    expect(told.mock.calls[2]![0]).toBe(phone.view())

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

    await phone.mutate('place.upsert', place('p', 'Van 1'))
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
    server.changes = [{ ...placed('a3', 'Bay A3'), seq: 2 }]
    await phone.sync()
    const v3 = phone.view()
    expect(v3).not.toBe(v2)
    expect(v3.warehouse.places.map((p) => p.name)).toEqual(['Bay A3'])

    server.refuse = (m) => (m.name === 'place.remove' ? { code: 'conflict', message: 'Bay A3 still has 4 counted. Move them first.' } : undefined)
    await phone.mutate('place.remove', { id: 'a3' })
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
    await expect(phone.mutate('place.upsert', place('p', 'Van 1'))).rejects.toThrow('This phone is out of storage')
    expect(phone.pendingCount).toBe(0)
    expect(phone.view().warehouse.places).toEqual([])

    // A pull whose save fails is not "no signal": the copy in memory is right, and the screens get it.
    server.seq = 1
    server.changes = [{ ...placed('a3', 'Bay A3'), seq: 1 }]
    await expect(phone.sync()).resolves.toBeUndefined()
    expect(phone.view().warehouse.places.map((p) => p.name)).toEqual(['Bay A3'])
    expect(phone.view().connection).toBe('idle')
    expect(phone.cursor).toBe(1)
  })
})

describe('a long feed', () => {
  it('is pulled a page at a time until the server says there is no more, each page kept before the next is asked for', async () => {
    // Proves: a feed longer than a page comes in pages, each saved before the next is asked for.
    const server = new PretendServer()
    server.pageSize = 2
    server.seq = 5
    server.changes = Array.from({ length: 5 }, (_, i) => ({ ...placed(`p${i + 1}`, `Bay ${i + 1}`), seq: i + 1 }))
    const storage = new MemoryStorage()
    const phone = await device(server, storage)
    const save = vi.spyOn(storage, 'save')
    await phone.sync()
    expect(server.pulledAfter).toEqual([0, 2, 4])
    expect(save).toHaveBeenCalledTimes(3)
    expect(phone.view().warehouse.places.map((p) => p.id)).toEqual(['p1', 'p2', 'p3', 'p4', 'p5'])
    expect(phone.cursor).toBe(5)
    expect((await storage.load())?.cursor).toBe(5)
  })
})

describe('a copy still arriving', () => {
  // Audit, 20 October 2026, finding 1: "Up to date" was said while a new phone's first copy was still coming in.
  it('says so until the copy has been read to the end, with how far it has got, and remembers once it has', async () => {
    const server = new PretendServer()
    server.pageSize = 2
    server.seq = 5
    server.changes = Array.from({ length: 5 }, (_, i) => ({ ...placed(`p${i + 1}`, `Bay ${i + 1}`), seq: i + 1 }))
    const storage = new MemoryStorage()
    const phone = await device(server, storage)
    expect(phone.view().copying).toEqual({})
    const seen: unknown[] = []
    phone.subscribe((v) => seen.push(v.copying))
    await phone.sync()
    expect(seen).toContainEqual({ share: 0.4 })
    expect(seen).toContainEqual({ share: 0.8 })
    expect(phone.view().copying).toBe(false)
    expect((await device(server, storage)).view().copying).toBe(false)
  })

  it('stays so while the first read cannot get through', async () => {
    const server = new PretendServer()
    server.down = true
    const phone = await device(server)
    await phone.sync().catch(() => {})
    expect(phone.view().copying).toEqual({})
  })

  it('is not said of a copy saved before the flag that holds a copy already', async () => {
    const storage = new MemoryStorage()
    await storage.save({ ...emptySnapshot('phone'), cursor: 7 })
    const phone = await device(new PretendServer(), storage)
    expect(phone.view().copying).toBe(false)
  })
})

describe('after the server is restored from a backup', () => {
  it('starts its copy afresh and sends again what it did lately, in order, against the new copy', async () => {
    // Proves: a device that finds the server on another copy of the data starts afresh and sends again what it did lately.
    const server = new PretendServer()
    server.generation = 'before'
    const storage = new MemoryStorage()
    const phone = await device(server, storage)
    await phone.mutate('place.upsert', place('p1'))
    await phone.sync()
    expect(phone.pendingCount).toBe(0)
    expect(await storage.load()).toMatchObject({ generation: 'before', sent: [expect.objectContaining({ name: 'place.upsert' })] })

    // Last night's backup is put back: another copy of the data, which knows nothing the phone sent today.
    server.generation = 'after'
    server.seq = 0
    server.answered.clear()
    await phone.mutate('place.upsert', place('p2'))
    await phone.sync()
    // The first push names no copy: the phone hadn't pulled yet, so it didn't know which it was on.
    const sent = server.pushes.map((p) => [p.generation, ...p.mutations.map((m) => (m.args as { id: string }).id)])
    expect(sent).toEqual([
      [undefined, 'p1'],
      ['before', 'p2'],
      ['after', 'p1', 'p2'],
    ])
    // p2 reached the new copy before the phone knew of it, so sent again it is a duplicate; p1 is new there. The phone ends at the new copy's head.
    expect(phone.pendingCount).toBe(0)
    expect(await storage.load()).toMatchObject({ generation: 'after', cursor: 2, outbox: [] })
  })

  it('notices the server has gone back in time even when it does not say so', async () => {
    // Proves: a server from before copies were named, wound back by hand, is noticed by its head being behind the phone, and the copy starts afresh.
    const server = new PretendServer()
    server.seq = 3
    server.changes = [{ ...placed('a3', 'Bay A3'), seq: 3 }]
    const phone = await device(server)
    await phone.sync()
    expect(phone.cursor).toBe(3)
    server.seq = 1
    server.changes = []
    await phone.sync()
    expect(phone.cursor).toBe(1)
    expect(phone.view().warehouse.places).toEqual([])
  })

  it('drops what it did, and the problems it had, when the server was cleared on purpose', async () => {
    // Proves: after someone starts fresh, the device drops its waiting changes and old problems rather than sending them again.
    const server = new PretendServer()
    server.generation = 'g1'
    const storage = new MemoryStorage()
    const phone = await device(server, storage)
    await phone.mutate('place.upsert', place('p1'))
    await phone.sync()
    server.refuse = (m) => (m.name === 'place.remove' ? { code: 'conflict', message: 'Bay p1 still has 4 counted. Move them first.' } : undefined)
    await phone.mutate('place.remove', { id: 'b1' })
    await phone.sync()
    expect(phone.view().problems).toHaveLength(1)

    // Someone started fresh (ADR 0019): the next push is stale, and the pull says the copy was cleared.
    server.generation = 'g2'
    server.cleared = true
    server.staleFor = 'g1'
    server.seq = 0
    await phone.mutate('place.upsert', place('p2'))
    await phone.sync()
    expect(server.pushes.map((p) => p.mutations.map((m) => (m.args as { id: string }).id))).toEqual([['p1'], ['b1'], ['p2']])
    expect(phone.pendingCount).toBe(0)
    expect(phone.view().problems).toEqual([])
    expect(await storage.load()).toMatchObject({ generation: 'g2', outbox: [], problems: [] })
  })
})

describe('a sync asked for while a round is failing', () => {
  it('gets a round of its own, so the signal coming back mid-round is not lost', async () => {
    // Proves: a round whose push went out with no signal fails, but a sync asked for while it was on its way (as the app asks
    // when the phone says it's back online) still runs, and its answer is the one given: the change goes and the device is up
    // to date, rather than saying "No signal" until the next retry, up to 30 seconds on. With no second ask, a failed round fails.
    const server = new PretendServer()
    let lost: (() => void) | undefined
    const transport: Transport = {
      push: (req) => (lost ? server.push(req) : new Promise((_, fail) => (lost = () => fail(new Error('No signal'))))),
      pull: (after) => server.pull(after),
    }
    const phone = await device(transport)
    await phone.mutate('place.upsert', place('a3'))
    const first = phone.sync()
    await vi.waitFor(() => expect(lost).toBeDefined())
    const back = phone.sync()
    lost!()
    await expect(Promise.all([first, back])).resolves.toBeDefined()
    expect(server.pushes).toHaveLength(1)
    expect(phone.view()).toMatchObject({ connection: 'idle', pendingCount: 0 })

    server.down = true
    await phone.mutate('place.upsert', place('van1'))
    await expect(phone.sync()).rejects.toThrow('No signal')
    expect(phone.view().connection).toBe('offline')
  })
})

describe('trying again with no signal', () => {
  it('backs off to every 30 seconds, and leaves one retry however many asked while a slow round failed', async () => {
    // Proves: with no signal, and each push taking five seconds to fail as on a poor signal, the device tries again 2, 4, 8,
    // then 16 seconds after each failure in turn, then every 30; five "back online" asks while the first round is on its way
    // get one more round between them and then that same backing off, not a retry each, which stacked up into a push every
    // few seconds for ten minutes; a failure trying again can't fix, such as being signed out, stops it.
    vi.useFakeTimers()
    try {
      const pushedAt: number[] = []
      let signedOut = false
      const transport: Transport = {
        push: () => {
          pushedAt.push(Date.now())
          return new Promise((_, fail) => setTimeout(() => fail(new Error(signedOut ? 'Sign in first.' : 'No signal')), 5000))
        },
        pull: () => Promise.reject(new Error('No signal')),
      }
      const phone = await device(transport)
      await phone.mutate('place.upsert', place('a3'))
      const start = Date.now()
      const retry = keepSyncing(() => phone.sync(), { may: () => true, stop: (err) => (err as Error).message === 'Sign in first.' })
      retry.soon()
      for (let i = 0; i < 5; i++) {
        await vi.advanceTimersByTimeAsync(300)
        retry.soon()
      }
      await vi.advanceTimersByTimeAsync(180_000 - 1500)
      expect(pushedAt.map((t) => (t - start) / 1000)).toEqual([0, 5, 12, 21, 34, 55, 90, 125, 160])

      signedOut = true
      await vi.advanceTimersByTimeAsync(120_000)
      expect(pushedAt).toHaveLength(10)
      retry.pause()
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('a push the server calls stale', () => {
  it('sends nothing more, and the pull that follows starts the copy afresh', async () => {
    // Proves: a push answered as stale stops the sending, and the next pull starts the copy afresh.
    const server = new PretendServer()
    server.generation = 'g1'
    const phone = await device(server)
    await phone.sync()
    for (let i = 0; i < 3; i++) await phone.mutate('place.upsert', place(`p${i}`))
    server.generation = 'g2'
    server.cleared = true
    server.staleFor = 'g1'
    await phone.sync()
    expect(server.pushes).toHaveLength(1)
    expect(server.pushes[0]!.generation).toBe('g1')
    expect(phone.pendingCount).toBe(0)
    expect(phone.view().warehouse.places).toEqual([])
  })
})

describe('a push answered only in part', () => {
  it('sends the rest again first, straight after, so the server takes them in the order they were made', async () => {
    // Proves: a server out of time answers the first of a slice; the phone sends nothing after the rest until they're
    // answered, pulls in between, and the same sync goes round again until all of it is through, each change sent once more
    // at most, and every one applied in the order it was made.
    const server = new PretendServer()
    server.answerAtMost = 20
    const phone = await device(server)
    const n = PUSH_SLICE * 2 + 10
    for (let i = 0; i < n; i++) await phone.mutate('place.upsert', place(`p${i}`))
    await phone.sync()
    expect(phone.view()).toMatchObject({ connection: 'idle', pendingCount: 0 })
    const firsts = server.pushes.map((p) => (p.mutations[0]!.args as { id: string }).id)
    expect(firsts).toEqual(Array.from({ length: Math.ceil(n / 20) }, (_, i) => `p${i * 20}`))
    expect([...server.answered.values()].map((r) => (r.status === 'applied' ? r.seq : 0))).toEqual(Array.from({ length: n }, (_, i) => i + 1))
    // A pull between each push, so a phone working through a backlog still hears from the server.
    expect(server.pulls).toBe(server.pushes.length)
  })
})

describe('a push that fails', () => {
  it('still lets the round pull, so a phone that cannot get its own changes through keeps hearing everyone else’s', async () => {
    // Proves: with every push failing (as when the server takes longer than the phone waits), the round still pulls and lands
    // what others did, keeps its own change waiting, and says the round failed so it's tried again.
    const server = new PretendServer()
    server.seq = 1
    server.changes = [{ ...placed('a3', 'Bay A3'), seq: 1 }]
    server.pushFails = true
    const phone = await device(server)
    await phone.mutate('place.upsert', place('van1', 'Van 1'))
    await expect(phone.sync()).rejects.toThrow('The server took too long')
    expect(server.pulls).toBe(1)
    expect(phone.cursor).toBe(1)
    expect(phone.view()).toMatchObject({ connection: 'offline', pendingCount: 1 })
    expect(phone.view().warehouse.places.map((p) => p.id).sort()).toEqual(['a3', 'van1'])

    server.pushFails = false
    await phone.sync()
    expect(phone.view()).toMatchObject({ connection: 'idle', pendingCount: 0 })
  })
})

describe('a push the server is too busy to take', () => {
  it('keeps what is waiting without showing a problem, still pulls, and sends it again shortly', async () => {
    // Proves (audit finding 7): while a long change holds the server's write lock, a push answered "busy" keeps the rest
    // waiting in order, the round still pulls everyone else's changes, the connection isn't shown as lost, and the round
    // fails quietly so `keepSyncing` tries again; once the server is free, everything goes.
    const server = new PretendServer()
    server.seq = 1
    server.changes = [{ ...placed('a3', 'Bay A3'), seq: 1 }]
    server.busyAfter = 1
    const phone = await device(server)
    await phone.mutate('place.upsert', place('van1', 'Van 1'))
    await phone.mutate('place.upsert', place('van2', 'Van 2'))
    await expect(phone.sync()).rejects.toBeInstanceOf(ServerBusy)
    expect(server.pulls).toBe(1)
    expect(phone.cursor).toBe(2)
    expect(phone.view()).toMatchObject({ connection: 'idle', pendingCount: 1 })
    expect(phone.view().warehouse.places.map((p) => p.id)).toEqual(expect.arrayContaining(['a3', 'van2']))

    // Busy and no signal for the pull: that's no signal.
    server.busyAfter = 0
    server.pushFails = false
    const pull = server.pull.bind(server)
    server.pull = () => Promise.reject(new Error('No signal'))
    await expect(phone.sync()).rejects.toThrow('No signal')
    expect(phone.view().connection).toBe('offline')
    server.pull = pull

    server.busyAfter = undefined
    await phone.sync()
    expect(phone.view()).toMatchObject({ connection: 'idle', pendingCount: 0 })
    expect(server.pushes.map((p) => p.mutations.map((m) => (m.args as { id: string }).id))).toEqual([['van1', 'van2'], ['van2'], ['van2']])
  })

  it('is tried again by keepSyncing, like any round that did not finish', async () => {
    vi.useFakeTimers()
    try {
      let rounds = 0
      const retry = keepSyncing(
        async () => {
          rounds++
          if (rounds === 1) throw new ServerBusy()
        },
        { may: () => true, stop: () => false }
      )
      retry.soon()
      await vi.advanceTimersByTimeAsync(2_000)
      expect(rounds).toBe(2)
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('a copy read before the feed was fixed', () => {
  it('reads it again from the start, once, keeping everything waiting to go', async () => {
    // Proves: a server on FEED tells a copy saved before it to read the feed again from 0, which lands a change it was moved
    // past; its waiting change stays and is sent; the next sync reads on from where it is, not from the start again; a new
    // copy, starting from 0 anyway, reads it once.
    const server = new PretendServer()
    server.seq = 3
    server.changes = [1, 2, 3].map((seq) => ({ ...placed(`b${seq}`, `Bay ${seq}`), seq }))
    const storage = new MemoryStorage()
    // A copy at cursor 3 that was moved past change 2 without being sent it, as an empty pull could.
    const old = emptySnapshot('phone')
    old.cursor = 3
    for (const seq of [1, 3]) applyChange(old, server.changes[seq - 1]!)
    await storage.save(old)
    const phone = await device(server, storage)
    await phone.mutate('place.upsert', place('van1', 'Van 1'))
    expect(phone.view().warehouse.places.map((p) => p.id).sort()).toEqual(['b1', 'b3', 'van1'])

    // A server from before says nothing, and nothing is read again.
    server.down = true
    await expect(phone.sync()).rejects.toThrow()
    server.down = false
    server.feed = FEED
    await phone.sync()
    expect(server.pulledAfter).toEqual([3, 0])
    // This pretend server sends no change back for Van 1, so only the bays are in the copy, the missed one among them.
    expect(phone.view().warehouse.places.map((p) => p.id).sort()).toEqual(['b1', 'b2', 'b3'])
    expect(phone.view().pendingCount).toBe(0)
    expect(server.pushes.flatMap((p) => p.mutations.map((m) => (m.args as { id: string }).id))).toEqual(['van1'])
    expect(await storage.load()).toMatchObject({ feed: FEED, cursor: 4 })

    server.pulledAfter = []
    await phone.sync()
    expect(server.pulledAfter).toEqual([4])

    const fresh = await device(server)
    await fresh.sync()
    expect(fresh.view().warehouse.places.map((p) => p.id).sort()).toEqual(['b1', 'b2', 'b3'])
  })
})
