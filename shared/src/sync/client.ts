import { commandSchemas, type CommandArgs, type CommandName, type Mutation, type Rejection } from '../commands.ts'
import { newId } from '../ids.ts'
import { ENTITY_NAMES, type Booking, type Entities, type EntityName, type Scan } from '../model.ts'
import type { Change, MutationResult, PullResponse, PushRequest, PushResponse } from '../protocol.ts'
import { crewView, type CrewView } from './crew-view.ts'

/**
 * The device side of sync: a local copy of what the server has told us, an
 * outbox of what this person has asked for, and a view that shows both.
 *
 * Nothing here assumes a network. `sync()` tries to push and pull, and if the
 * transport throws, everything stays exactly where it was: the outbox is
 * saved before any attempt and only shrinks when the server has answered.
 * The same code runs in the browser (IndexedDB storage) and in tests
 * (memory storage and a transport that can be switched off).
 */

export interface Transport {
  push(req: PushRequest): Promise<PushResponse>
  pull(after: number): Promise<PullResponse>
}

/** Everything a device keeps between reloads. */
export interface Snapshot {
  clientId: string
  cursor: number
  entities: { [E in EntityName]: Record<string, Entities[E]> }
  outbox: PendingMutation[]
  problems: Problem[]
}

export interface Storage {
  load(): Promise<Snapshot | undefined>
  save(snapshot: Snapshot): Promise<void>
}

export interface PendingMutation extends Mutation {
  /**
   * Set when the server has applied it: the change sequence number that
   * carries its result. The mutation stays in the outbox, still shown, until
   * a pull has brought us up to that point, so nothing flickers out and back.
   */
  appliedSeq?: number
}

/** A command the server turned down, kept until the person deals with it. */
export interface Problem {
  mutation: Mutation
  reason: Rejection
  at: string
}

export type Connection = 'idle' | 'syncing' | 'offline'

/** A booking as the person sees it, including ones still waiting to sync. */
export interface BookingView extends Booking {
  pending: boolean
}
export interface ScanView extends Scan {
  pending: boolean
}

export interface View {
  products: Entities['product'][]
  bookings: BookingView[]
  scans: ScanView[]
  issues: Entities['issue'][]
  problems: Problem[]
  crew: CrewView
  pendingCount: number
  connection: Connection
  cursor: number
}

export function emptySnapshot(clientId: string): Snapshot {
  return {
    clientId,
    cursor: 0,
    entities: Object.fromEntries(ENTITY_NAMES.map((n) => [n, {}])) as Snapshot['entities'],
    outbox: [],
    problems: [],
  }
}

export class MemoryStorage implements Storage {
  private snapshot: Snapshot | undefined
  async load() {
    return this.snapshot ? structuredClone(this.snapshot) : undefined
  }
  async save(snapshot: Snapshot) {
    this.snapshot = structuredClone(snapshot)
  }
}

export interface SyncClientOptions {
  storage: Storage
  transport: Transport
  /** Only used when storage is empty. */
  clientId?: string
  now?: () => Date
}

export class SyncClient {
  private state!: Snapshot
  private connection: Connection = 'idle'
  private running: Promise<void> | undefined
  private again = false
  private listeners = new Set<(view: View) => void>()
  private readonly storage: Storage
  private readonly transport: Transport
  private readonly now: () => Date

  constructor(private readonly options: SyncClientOptions) {
    this.storage = options.storage
    this.transport = options.transport
    this.now = options.now ?? (() => new Date())
  }

  async open(): Promise<this> {
    this.state = (await this.storage.load()) ?? emptySnapshot(this.options.clientId ?? newId())
    return this
  }

  get clientId() {
    return this.state.clientId
  }

  /**
   * Ask for something. It is validated here so obvious mistakes are caught
   * on the device, saved to the outbox before anything else happens, and
   * shown straight away as pending.
   */
  async mutate<N extends CommandName>(name: N, args: CommandArgs<N>): Promise<Mutation<N>> {
    const parsed = commandSchemas[name].safeParse(args)
    if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? 'Invalid request')
    const mutation: Mutation<N> = { id: newId(), name, args: parsed.data as CommandArgs<N>, createdAt: this.now().toISOString() }
    this.state.outbox.push(mutation)
    await this.persist()
    return mutation
  }

  /**
   * Push the outbox, then pull until up to date. Calls that arrive while a
   * sync is running are folded into one more round rather than run in
   * parallel, so the outbox is never sent twice at once.
   */
  sync(): Promise<void> {
    if (this.running) {
      this.again = true
      return this.running
    }
    this.running = (async () => {
      try {
        do {
          this.again = false
          await this.round()
        } while (this.again)
      } finally {
        this.running = undefined
      }
    })()
    return this.running
  }

  dismissProblem(mutationId: string) {
    this.state.problems = this.state.problems.filter((p) => p.mutation.id !== mutationId)
    return this.persist()
  }

  subscribe(fn: (view: View) => void): () => void {
    this.listeners.add(fn)
    fn(this.view())
    return () => this.listeners.delete(fn)
  }

  view(): View {
    const { entities, outbox } = this.state
    const bookings = new Map<string, BookingView>()
    for (const b of Object.values(entities.booking)) bookings.set(b.id, { ...b, pending: false })
    const scans = new Map<string, ScanView>()
    for (const s of Object.values(entities.scan)) scans.set(s.id, { ...s, pending: false })

    // Lay what is still waiting over what the server has said, so the person
    // sees their own requests immediately. The server may still say no.
    for (const m of outbox) {
      if (m.appliedSeq !== undefined && m.appliedSeq <= this.state.cursor) continue
      if (m.name === 'booking.create') {
        const a = m.args as CommandArgs<'booking.create'>
        if (!bookings.has(a.id)) bookings.set(a.id, { ...a, status: 'confirmed', pending: true })
      } else if (m.name === 'booking.cancel') {
        const a = m.args as CommandArgs<'booking.cancel'>
        const b = bookings.get(a.id)
        if (b) bookings.set(a.id, { ...b, status: 'cancelled', pending: true })
      } else if (m.name === 'scan.record') {
        const a = m.args as CommandArgs<'scan.record'>
        if (!scans.has(a.id)) scans.set(a.id, { ...a, pending: true })
      }
    }

    const byName = <T extends { name?: string; id: string }>(a: T, b: T) => (a.name ?? a.id).localeCompare(b.name ?? b.id)
    return {
      products: Object.values(entities.product).sort(byName),
      bookings: [...bookings.values()].sort((a, b) => a.start.localeCompare(b.start) || a.id.localeCompare(b.id)),
      scans: [...scans.values()].sort((a, b) => b.at.localeCompare(a.at)),
      issues: Object.values(entities.issue).filter((i) => !i.resolved),
      problems: [...this.state.problems],
      crew: crewView(entities, outbox, this.state.cursor),
      pendingCount: outbox.filter((m) => m.appliedSeq === undefined).length,
      connection: this.connection,
      cursor: this.state.cursor,
    }
  }

  private async round() {
    this.setConnection('syncing')
    try {
      await this.push()
      await this.pull()
      this.setConnection('idle')
    } catch (err) {
      // No signal, server down, or a response lost on the way back. The
      // outbox is untouched, and every mutation carries its own id, so
      // sending it all again later is safe.
      this.setConnection('offline')
      throw err
    }
  }

  private async push() {
    const waiting = this.state.outbox.filter((m) => m.appliedSeq === undefined)
    if (waiting.length === 0) return
    const { results } = await this.transport.push({
      clientId: this.state.clientId,
      mutations: waiting.map(({ id, name, args, createdAt }) => ({ id, name, args, createdAt })),
    })
    const byId = new Map<string, MutationResult>(results.map((r) => [r.id, r]))
    const kept: PendingMutation[] = []
    for (const m of this.state.outbox) {
      const r = byId.get(m.id)
      if (!r) kept.push(m)
      else if (r.status === 'applied') kept.push({ ...m, appliedSeq: r.seq })
      else this.state.problems.push({ mutation: strip(m), reason: r.reason, at: this.now().toISOString() })
    }
    this.state.outbox = kept
    await this.persist()
  }

  private async pull() {
    for (;;) {
      const res = await this.transport.pull(this.state.cursor)
      for (const change of res.changes) applyChange(this.state, change)
      this.state.cursor = Math.max(this.state.cursor, res.cursor)
      // Applied mutations leave the outbox once their result has arrived.
      this.state.outbox = this.state.outbox.filter((m) => m.appliedSeq === undefined || m.appliedSeq > this.state.cursor)
      await this.persist()
      if (!res.more) return
    }
  }

  private setConnection(c: Connection) {
    if (this.connection === c) return
    this.connection = c
    this.emit()
  }

  private async persist() {
    await this.storage.save(this.state)
    this.emit()
  }

  private emit() {
    if (this.listeners.size === 0) return
    const view = this.view()
    for (const fn of this.listeners) fn(view)
  }
}

function strip(m: PendingMutation): Mutation {
  return { id: m.id, name: m.name, args: m.args, createdAt: m.createdAt }
}

export function applyChange(state: Snapshot, change: Change) {
  if (!ENTITY_NAMES.includes(change.entity)) return
  // Snapshots saved before a module existed have no table for it yet.
  const table = (state.entities[change.entity] ??= {} as never) as Record<string, unknown>
  if (change.op === 'delete') delete table[change.id]
  else table[change.id] = change.data
}
