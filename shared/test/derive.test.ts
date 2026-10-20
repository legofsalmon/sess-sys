import { describe, expect, it, vi } from 'vitest'
import type { Phase, Project } from '../src/jobs.ts'
import type { KitLine } from '../src/kit.ts'
import type { Change, PullResponse, PushRequest, PushResponse } from '../src/protocol.ts'
import type { Model, Place } from '../src/stock.ts'
import { MemoryStorage, SyncClient, type Snapshot, type Transport, type View } from '../src/sync/client.ts'

/**
 * The view kept between changes (audit, 18 October 2026, finding 11): each
 * part is built when a screen reads it and kept until a table it read, a
 * change waiting it reads, or a part it's built from changes; the kit's
 * days are worked out again only for the products a change touches; and
 * a save names the tables changed, so storage can write only those. Kept
 * or not, a device shows exactly what one opened afresh on the same copy
 * would.
 */

const TODAY = new Date('2026-10-01T09:00:00Z')
const day = (n: number) => `2026-10-${String(n).padStart(2, '0')}`

const model = (id: string, name: string): Model => ({
  aliases: [],
  id,
  name,
  department: 'audio',
  category: '',
  tracking: 'bulk',
  isCase: false,
  valueCents: null,
  notes: '',
  patMonths: null,
  liftingMonths: null,
  mistake: false,
})
const place = (id: string, name: string): Place => ({ id, name, notes: '' })
const project = (id: string, name: string): Project => ({ id, name, clientId: null, venueId: null, status: 'confirmed', notes: '' })
const phase = (id: string, projectId: string, start: string, end: string): Phase => ({ id, projectId, name: 'Show', start, end, venueId: null, notes: '' })
const line = (id: string, projectId: string, modelId: string, qty: number): KitLine => ({ id, projectId, phaseId: null, modelId, qty, subhireQty: 0, supplier: '', notes: '' })

/** A server that takes every change and hands out what the test gives it. */
class Server implements Transport {
  seq = 0
  changes: Change[] = []
  give(entity: Change['entity'], data: { id: string }) {
    this.changes.push({ seq: ++this.seq, entity, id: data.id, op: 'put', data } as Change)
  }
  async push(req: PushRequest): Promise<PushResponse> {
    return { results: req.mutations.map((m) => ({ id: m.id, status: 'applied', seq: ++this.seq })) }
  }
  async pull(after: number): Promise<PullResponse> {
    return { changes: this.changes.filter((c) => c.seq > after), cursor: this.seq, more: false }
  }
}

/** What a screen sees of a view, as plain data: maps and sets as their entries, functions left out. */
function plain(view: View): unknown {
  const seen = new WeakSet<object>()
  return JSON.parse(
    JSON.stringify(
      Object.fromEntries((['crew', 'jobs', 'warehouse', 'kit', 'moves', 'faults', 'notesKit', 'money', 'office', 'attachments', 'timesheets', 'vehicles'] as const).map((k) => [k, view[k]])),
      (_, v: unknown) => {
        if (typeof v === 'function') return undefined
        if (v instanceof Map) return [...v.entries()]
        if (v instanceof Set) return [...v]
        if (v && typeof v === 'object') {
          // A record seen already (a job on each of its kit lines) is written once.
          if (seen.has(v)) return (v as { id?: string }).id ?? '…'
          seen.add(v)
        }
        return v
      }
    )
  )
}

async function setUp() {
  const server = new Server()
  for (let m = 0; m < 4; m++) server.give('model', model(`m${m}`, `Product ${m}`))
  server.give('place', place('bay', 'Bay A1'))
  for (let m = 0; m < 4; m++) server.give('stock', { id: `m${m}:bay`, modelId: `m${m}`, placeId: 'bay', caseId: null, qty: 6 } as never)
  for (let j = 0; j < 6; j++) {
    server.give('project', project(`j${j}`, `Job ${j}`))
    server.give('phase', phase(`ph${j}`, `j${j}`, day(2 + j), day(4 + j)))
    for (let m = 0; m < 4; m++) server.give('kitLine', line(`k${j}${m}`, `j${j}`, `m${m}`, 1 + ((j + m) % 3)))
  }
  const storage = new MemoryStorage()
  const phone = await new SyncClient({ storage, transport: server, clientId: 'phone', now: () => TODAY }).open()
  await phone.sync()
  return { server, storage, phone }
}

/** A device opened afresh on what the phone has saved. */
async function afresh(storage: MemoryStorage) {
  const copy = new MemoryStorage()
  await copy.save((await storage.load())!)
  return new SyncClient({ storage: copy, transport: new Server(), now: () => TODAY }).open()
}

const steps: [string, (s: Awaited<ReturnType<typeof setUp>>) => Promise<unknown>][] = [
  ['a kit line changed here', ({ phone }) => phone.mutate('kit.update', { id: 'k01', qty: 5 })],
  ['a job renamed here', ({ phone }) => phone.mutate('project.update', { id: 'j2', name: 'Harbour Lights' })],
  ['a place added here', ({ phone }) => phone.mutate('place.upsert', { id: 'van', name: 'Van 1', notes: '' })],
  ['the office’s details changed here', ({ phone }) => phone.mutate('office.update', { name: 'Session Hire', phone: null, email: null })],
  ['all of it sent', ({ phone }) => phone.sync()],
  [
    'a kit line pulled',
    ({ server, phone }) => {
      server.give('kitLine', line('k30', 'j3', 'm0', 6))
      return phone.sync()
    },
  ],
  [
    'a phase moved, pulled',
    ({ server, phone }) => {
      server.give('phase', phase('ph4', 'j4', day(3), day(3)))
      return phone.sync()
    },
  ],
  [
    'a product pulled',
    ({ server, phone }) => {
      server.give('model', model('m2', 'Product two'))
      return phone.sync()
    },
  ],
  ['a kit line removed here', ({ phone }) => phone.mutate('kit.remove', { id: 'k52' })],
]

describe('the view, kept between changes', () => {
  it('shows what a device opened afresh on the same copy would, after each kind of change', async () => {
    const s = await setUp()
    // Every part read, as the screens would, so each is kept from one change to the next.
    expect(plain(s.phone.view())).toEqual(plain((await afresh(s.storage)).view()))
    expect(s.phone.view().kit.short.length).toBeGreaterThan(0)
    for (const [what, step] of steps) {
      await step(s)
      expect(plain(s.phone.view()), what).toEqual(plain((await afresh(s.storage)).view()))
    }
  })

  it('builds a part only when it is read, and keeps it through a change it has no part in', async () => {
    const { server, phone } = await setUp()
    // A kind of change a part hasn't had in front of it yet builds it again, once: then it's known to pass it over.
    await phone.mutate('office.update', { name: 'Session', phone: null, email: null })
    const before = phone.view()
    const kit = before.kit
    const crew = before.crew

    // The office's details, here and pulled: nothing of the kit or the crew changes.
    await phone.mutate('office.update', { name: 'Session Hire', phone: null, email: null })
    expect(phone.view()).not.toBe(before)
    expect(phone.view().kit).toBe(kit)
    expect(phone.view().crew).toBe(crew)
    expect(phone.view().office.details?.name).toBe('Session Hire')
    server.give('attachment', { id: 'a1', owner: 'venue', ownerId: 'v1', kind: 'other', title: 'Plan', link: 'https://example.com/plan', file: null, addedAt: '2026-10-01T09:00:00Z' } as never)
    await phone.sync()
    expect(phone.view().kit).toBe(kit)
    expect(phone.view().crew).toBe(crew)

    // A change to the kit is shown at once.
    await phone.mutate('kit.update', { id: 'k00', qty: 6 })
    expect(phone.view().kit).not.toBe(kit)
    expect(phone.view().kit.byJob.get('j0')!.find((l) => l.id === 'k00')).toMatchObject({ qty: 6, pending: true })
  })

  it('works out the kit days again only for the products a change touches', async () => {
    const { server, phone } = await setUp()
    const others = (v: View, id: string) => v.kit.lines.find((l) => l.id === id)!.others
    const before = phone.view()
    const [kit, k10, k11] = [before.kit, others(before, 'k10'), others(before, 'k11')]
    server.give('kitLine', line('k00', 'j0', 'm0', 4))
    await phone.sync()
    const after = phone.view()
    expect(after.kit).not.toBe(kit)
    // Product 0's lines are worked out again; product 1's are as they were, the very same.
    expect(others(after, 'k10')).not.toBe(k10)
    expect(others(after, 'k11')).toBe(k11)
    expect(k11.length).toBeGreaterThan(0)
    expect(after.kit.lines.find((l) => l.id === 'k00')!.qty).toBe(4)
  })

  it('saves only the tables a change landed in, and all of them after a fresh start', async () => {
    const { server, storage, phone } = await setUp()
    const save = vi.spyOn(storage, 'save')
    await phone.mutate('place.upsert', { id: 'van', name: 'Van 1', notes: '' })
    // A change of this device's own goes in the outbox: no table is written.
    expect(save.mock.calls.at(-1)![1]).toEqual(new Set())
    server.give('kitLine', line('k00', 'j0', 'm0', 4))
    server.give('place', place('van', 'Van 1'))
    await phone.sync()
    const named = save.mock.calls.map((c) => c[1]).filter((c): c is Set<string> => c instanceof Set && c.size > 0)
    expect(new Set(named.flatMap((c) => [...c]))).toEqual(new Set(['kitLine', 'place']))
    // And what's kept is the copy, table for table.
    const kept = (await storage.load()) as Snapshot
    expect(kept.entities.kitLine.k00!.qty).toBe(4)
    expect(kept.entities.place.van).toBeTruthy()
    expect(kept.entities.model.m0).toBeTruthy()
  })
})
