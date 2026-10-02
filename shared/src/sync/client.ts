import { CALENDAR_LINK_ID, irishToday, type CalendarDay, type CalendarLink } from '../calendar.ts'
import { commandSchemas, type CommandArgs, type CommandInput, type CommandName, type Mutation, type Rejection } from '../commands.ts'
import type { Erasure } from '../erasure.ts'
import { newId } from '../ids.ts'
import { ENTITY_NAMES, type Entities, type EntityName } from '../model.ts'
import { PUSH_LIMIT, type Change, type MutationResult, type PullResponse, type PushRequest, type PushResponse } from '../protocol.ts'
import { crewView, type CrewView } from './crew-view.ts'
import { erasuresView, forgetErased, withErasures, type ErasuresView } from './erasure-view.ts'
import { faultsView, type FaultsView } from './faults-view.ts'
import { inspectionsView, type InspectionsView } from './inspections-view.ts'
import { jobsView, type JobsView } from './jobs-view.ts'
import { kitView, type KitView } from './kit-view.ts'
import { labelsView, type LabelsView } from './labels-view.ts'
import { lateView, type LateView } from './late-view.ts'
import { leaveView, type LeaveView } from './leave-view.ts'
import { officeView, type OfficeView } from './office-view.ts'
import { movesView, type MovesView } from './pick-view.ts'
import { warehouseView, type WarehouseView } from './stock-view.ts'
import { timesheetsView, type TimesheetsView } from './timesheets-view.ts'

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
  /** Which copy of the server's data this is a copy of; see `restart`. */
  generation?: string
  /** What this device has had applied lately, kept to send again if the server's data is ever restored from a backup. */
  sent?: SentMutation[]
  /** The server holds made-up data (ADR 0019). */
  madeUp?: boolean
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

/** A command the server has applied, and when it left the outbox. */
export interface SentMutation extends Mutation {
  sentAt: string
}

/**
 * How long a device remembers what it has sent. A restore uses last night's
 * backup, so two weeks covers even a problem found days later.
 */
const REMEMBER_MS = 14 * 24 * 3_600_000
const REMEMBER_MAX = 2000

/** A command the server turned down, kept until the person deals with it. */
export interface Problem {
  mutation: Mutation
  reason: Rejection
  at: string
}

export type Connection = 'idle' | 'syncing' | 'offline'

export interface View {
  problems: Problem[]
  crew: CrewView
  jobs: JobsView
  /** The warehouse catalogue (ADR 0013). */
  warehouse: WarehouseView
  /** Kit on jobs, and what's short (ADR 0014). */
  kit: KitView
  /** Numbers set aside for printing labels (ADR 0015). */
  labels: LabelsView
  /** Kit out with jobs and back, and each job's pick list (ADR 0017). */
  moves: MovesView
  /** Faults and missing kit, and the repair list (ADR 0018). */
  faults: FaultsView
  /** Inspections, and what's due (ADR 0020). */
  inspections: InspectionsView
  /** Freelancers' timesheets for their bookings (ADR 0022). */
  timesheets: TimesheetsView
  /** The office's own details, shown on every freelancer page. */
  office: OfficeView
  /** Staff leave and time in lieu: balances, requests and the approvers' queue (ADR 0024). */
  leave: LeaveView
  /** Who is running late today, or tomorrow when said the evening before (ADR 0028). */
  late: LateView
  /** People erased on request, by person, and an erasure still to send laid over them (ADR 0027). */
  erasures: ErasuresView
  /** Where jobs go on Google Calendar (ADR 0008): the connection, and each phase-day written, by `calendarDayId`. */
  calendar: { link: CalendarLink | undefined; days: Readonly<Record<string, CalendarDay>> }
  pendingCount: number
  connection: Connection
  cursor: number
  /** The server holds made-up data to try the app with (ADR 0019), as of the last sync. */
  madeUp: boolean
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
  /**
   * The view the screens were last told. A round that finds nothing leaves
   * it as it is and needn't wake them; one that moves on from it (the
   * signal back, or a new day in Ireland) does. Unset while some screen
   * holds a different one, having opened mid-round.
   */
  private told: View | undefined
  private running: Promise<void> | undefined
  private again = false
  private listeners = new Set<(view: View) => void>()
  /**
   * Goes up on every change to `state`. With the day and the connection it
   * keys the view, so `view()` costs nothing until something has changed:
   * screens, pokes and sync ticks all ask for it far more often than that.
   */
  private version = 0
  private built: { version: number; today: string; view: Omit<View, 'connection'> } | undefined
  private views: Partial<Record<Connection, View>> = {}
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
    await this.unbrick()
    return this
  }

  /**
   * A change the view can't lay over the rest would leave every screen
   * blank. `mutate` turns such a change away now, but a copy saved by a
   * build from before it did may still hold one: it's set aside as a
   * problem, with its reason, and the rest of the outbox carries on.
   */
  private async unbrick() {
    if (this.state.outbox.length === 0) return
    try {
      this.build()
      return
    } catch {
      // Something is in the way. If the view works without the outbox, the outbox holds it.
    }
    const all = this.state.outbox
    this.state.outbox = []
    try {
      this.build()
    } catch {
      this.state.outbox = all
      return
    }
    for (const m of all) {
      this.state.outbox.push(m)
      try {
        this.build()
      } catch (err) {
        this.state.outbox.pop()
        const why = err instanceof Error ? err.message : String(err)
        this.state.problems.push({
          mutation: strip(m),
          reason: { code: 'invalid', message: `This change can't be shown on this device, so it was set aside: ${why}` },
          at: this.now().toISOString(),
        })
      }
    }
    this.version++
    await this.save()
  }

  get clientId() {
    return this.state.clientId
  }

  /** Where this device's copy is up to, without building the view: a poke only needs the number. */
  get cursor() {
    return this.state.cursor
  }

  /** Changes waiting to be sent, without building the view. */
  get pendingCount() {
    return this.state.outbox.filter((m) => m.appliedSeq === undefined).length
  }

  /**
   * Ask for something. It is validated here so obvious mistakes are caught
   * on the device, saved to the outbox before anything else happens, and
   * shown straight away as pending.
   */
  async mutate<N extends CommandName>(name: N, args: CommandInput<N>): Promise<Mutation<N>> {
    const parsed = commandSchemas[name].safeParse(args)
    if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? 'Invalid request')
    const mutation: Mutation<N> = { id: newId(), name, args: parsed.data as CommandArgs<N>, createdAt: this.now().toISOString() }
    this.state.outbox.push(mutation)
    this.version++
    const takeBack = () => {
      this.state.outbox = this.state.outbox.filter((m) => m.id !== mutation.id)
      this.version++
    }
    // A change the view can't lay over the rest would leave every screen blank
    // until the device's storage was wiped, so it's taken back before it's saved.
    try {
      this.view()
    } catch (err) {
      takeBack()
      throw new Error(`This change can't be shown on this device, so it wasn't kept: ${err instanceof Error ? err.message : String(err)}`)
    }
    // A change the device can't keep (out of storage, or another tab holds the
    // data) would be lost on the next reload, so it isn't taken either: the
    // storage says why, and the person tries again once that's sorted.
    try {
      await this.storage.save(this.state)
    } catch (err) {
      takeBack()
      throw err
    }
    this.emit()
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

  async dismissProblem(mutationId: string) {
    const kept = this.state.problems.filter((p) => p.mutation.id !== mutationId)
    if (kept.length === this.state.problems.length) return
    this.state.problems = kept
    this.version++
    await this.persist()
  }

  subscribe(fn: (view: View) => void): () => void {
    this.listeners.add(fn)
    const view = this.view()
    // A screen opened mid-round (the first one always is: the app starts a
    // round before it draws) holds a different view from the rest, so the end
    // of the round tells them all, even when it found nothing.
    if (view !== this.told) this.told = undefined
    fn(view)
    return () => this.listeners.delete(fn)
  }

  /**
   * The same object until something changes: the device's copy (`version`),
   * the connection, or the day in Ireland, which moves what's overdue and
   * what's coming up. Screens can then compare by identity, and a poke or a
   * sync tick that finds nothing costs no rebuild.
   */
  view(): View {
    const today = irishToday(this.now())
    if (!this.built || this.built.version !== this.version || this.built.today !== today) {
      this.built = { version: this.version, today, view: this.build(today) }
      this.views = {}
    }
    let view = this.views[this.connection]
    if (!view) this.views[this.connection] = view = { ...this.built.view, connection: this.connection }
    return view
  }

  /** The device's data model, built from scratch. Throws if a change can't be laid over the rest. */
  private build(today = irishToday(this.now())): Omit<View, 'connection'> {
    const { entities, outbox } = this.state
    // Someone erased on this device is shown erased at once, everywhere the crew reaches (ADR 0027).
    const erasures = erasuresView(entities, outbox, this.state.cursor, today)
    const crew = withErasures(crewView(entities, outbox, this.state.cursor, today), erasures)
    const jobs = jobsView(entities, outbox, this.state.cursor, crew.calls)
    const warehouse = warehouseView(entities, outbox, this.state.cursor)
    const inspections = inspectionsView(entities, outbox, this.state.cursor, warehouse, today)
    const faults = faultsView(entities, outbox, this.state.cursor, jobs, warehouse, (id) => !!inspections.blocks(id))
    const kit = kitView(entities, outbox, this.state.cursor, jobs, warehouse, today, faults)
    return {
      problems: [...this.state.problems],
      crew,
      jobs,
      warehouse,
      kit,
      labels: labelsView(entities, outbox, this.state.cursor, warehouse),
      moves: movesView(entities, outbox, this.state.cursor, jobs, warehouse, kit, today, faults),
      faults,
      inspections,
      timesheets: timesheetsView(entities, outbox, this.state.cursor, crew, today),
      office: officeView(entities, outbox, this.state.cursor),
      leave: leaveView(entities, outbox, this.state.cursor, crew, today),
      late: lateView(entities, outbox, this.state.cursor, crew, today),
      erasures,
      // Snapshots saved before the calendar existed have no tables for it.
      calendar: { link: entities.calendarLink?.[CALENDAR_LINK_ID], days: entities.calendarDay ?? {} },
      pendingCount: outbox.filter((m) => m.appliedSeq === undefined).length,
      cursor: this.state.cursor,
      madeUp: this.state.madeUp === true,
    }
  }

  private async round() {
    // Not announced: a round that pushes and pulls nothing ends as it began,
    // and the screens hear nothing of it. Whatever a round does persist is
    // announced as it lands, and the end of the round after that.
    this.connection = 'syncing'
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
    // The server takes PUSH_LIMIT at a time, so a long day with no signal, or a replay
    // after a restore, goes up in slices, each answered and saved before the next is sent.
    for (let from = 0; from < waiting.length; from += PUSH_LIMIT) {
      const slice = waiting.slice(from, from + PUSH_LIMIT)
      const { results, stale } = await this.transport.push({
        clientId: this.state.clientId,
        mutations: slice.map(({ id, name, args, createdAt }) => ({ id, name, args, createdAt })),
        // On the same clock as each createdAt, so the server can tell how long each waited here.
        sentAt: this.now().toISOString(),
        ...(this.state.generation ? { generation: this.state.generation } : {}),
      })
      // The app started fresh after this device's copy: the pull that follows starts it afresh, dropping these.
      if (stale) return
      const byId = new Map<string, MutationResult>(results.map((r) => [r.id, r]))
      const kept: PendingMutation[] = []
      for (const m of this.state.outbox) {
        const r = byId.get(m.id)
        if (!r) kept.push(m)
        else if (r.status === 'applied') kept.push({ ...m, appliedSeq: r.seq })
        else this.state.problems.push({ mutation: strip(m), reason: r.reason, at: this.now().toISOString() })
      }
      this.state.outbox = kept
      this.version++
      await this.persist()
    }
  }

  private async pull() {
    for (;;) {
      const res = await this.transport.pull(this.state.cursor)
      const restored = res.generation !== undefined && this.state.generation !== undefined && res.generation !== this.state.generation
      const behind = res.head !== undefined && res.head < this.state.cursor
      if (restored || behind) return this.restart(res.generation, restored && res.cleared === true)
      // Nothing new, most of the time: then nothing is saved and nobody is told.
      let changed = res.changes.length > 0
      if (res.generation && res.generation !== this.state.generation) [this.state.generation, changed] = [res.generation, true]
      // Copies saved before made-up data existed have no flag, which means no.
      if ((this.state.madeUp === true) !== (res.madeUp === true)) [this.state.madeUp, changed] = [res.madeUp === true, true]
      for (const change of res.changes) {
        // An erasure arrives before the records it changes, so whose each change still held here is can be told (ADR 0027).
        if (change.entity === 'erasure' && change.op === 'put') forgetErased(this.state, change.data as Erasure, this.now().toISOString())
        applyChange(this.state, change)
      }
      if (res.cursor > this.state.cursor) [this.state.cursor, changed] = [res.cursor, true]
      // Applied mutations leave the outbox once their result has arrived.
      const done = this.state.outbox.filter((m) => m.appliedSeq !== undefined && m.appliedSeq <= this.state.cursor)
      if (done.length) {
        this.state.outbox = this.state.outbox.filter((m) => m.appliedSeq === undefined || m.appliedSeq > this.state.cursor)
        this.remember(done)
        changed = true
      }
      if (changed) {
        this.version++
        await this.persist()
      }
      if (!res.more) return
    }
  }

  private remember(done: PendingMutation[]) {
    const now = this.now()
    const sentAt = now.toISOString()
    this.state.sent = [...(this.state.sent ?? []), ...done.map((m) => ({ ...strip(m), sentAt }))]
      .filter((m) => now.getTime() - Date.parse(m.sentAt) < REMEMBER_MS)
      .slice(-REMEMBER_MAX)
  }

  /**
   * The server's data has been put back from a backup (it says it holds a
   * different copy, or it is behind this device). Its copy may be missing
   * the latest work, so this device starts its own copy afresh from the
   * server and sends again everything it has done lately, in the order it
   * did it. The server skips whatever it already has, since every command
   * carries its own id, and anything that no longer fits shows up as a
   * problem to deal with, as it would after a long time offline.
   *
   * Unless the server was cleared on purpose (someone started fresh, ADR
   * 0019): then everything this device did belongs to what was cleared, so
   * it's dropped, along with any problems left from then, rather than sent
   * again.
   */
  private async restart(generation: string | undefined, cleared = false) {
    const seen = new Set<string>()
    const replay: PendingMutation[] = []
    for (const m of cleared ? [] : [...(this.state.sent ?? []), ...this.state.outbox]) {
      if (seen.has(m.id)) continue
      seen.add(m.id)
      replay.push(strip(m))
    }
    this.state = { ...emptySnapshot(this.state.clientId), generation, outbox: replay, problems: cleared ? [] : this.state.problems }
    this.version++
    await this.persist()
    this.again = true
  }

  private setConnection(c: Connection) {
    this.connection = c
    // Told only if the view has moved on from what the screens hold: the
    // connection, or the day in Ireland, which moves what's due and what's
    // today on a screen left open overnight. The one rebuild is the emit's.
    if (this.view() !== this.told) this.emit()
  }

  private async persist() {
    await this.save()
    this.emit()
  }

  /**
   * The copy in memory is right whether or not this works. A save that fails
   * (the device out of storage, say) leaves the saved copy behind, which the
   * first pull after a reload makes up, and the storage itself tells the
   * person. A change of their own is the exception, taken back in `mutate`.
   */
  private async save() {
    try {
      await this.storage.save(this.state)
    } catch {
      // Said to the person by the storage; the copy in memory carries on.
    }
  }

  /** Tell the screens. The view is cached, so this rebuilds only when something has changed. */
  private emit() {
    const view = this.view()
    this.told = view
    for (const fn of this.listeners) fn(view)
  }
}

function strip(m: PendingMutation): Mutation {
  return { id: m.id, name: m.name, args: m.args, createdAt: m.createdAt }
}

export function applyChange(state: Snapshot, change: Change) {
  // A name a plain object treats specially would reach every object, not a table.
  if ((change.entity as string) === '__proto__' || change.id === '__proto__') return
  // A change for an entity this build doesn't know is kept under its name, not
  // dropped: a phone open during a deploy that adds one would otherwise move its
  // cursor past those rows and never see them. The views only read the tables
  // they know, and the next build reads the rest like any other table.
  // Snapshots saved before a module existed have no table for it yet.
  const table = (state.entities[change.entity] ??= {} as never) as Record<string, unknown>
  if (change.op === 'delete') delete table[change.id]
  else table[change.id] = change.data
}
