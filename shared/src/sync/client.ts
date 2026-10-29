import { CALENDAR_LINK_ID, irishToday, type CalendarDay, type CalendarLink } from '../calendar.ts'
import { commandSchemas, type CommandArgs, type CommandInput, type CommandName, type Mutation, type Rejection } from '../commands.ts'
import { nameKept, type Erasure, type NameKept } from '../erasure.ts'
import { newId } from '../ids.ts'
import { ENTITY_NAMES, type Entities, type EntityName } from '../model.ts'
import { FEED, PUSH_SLICE, type Change, type LatestOnly, type MutationResult, type PullResponse, type PushRequest, type PushResponse } from '../protocol.ts'
import { countsView, type CountsView } from './counts-view.ts'
import { crewView, type CrewView } from './crew-view.ts'
import { documentsView, type DocumentsView } from './documents-view.ts'
import { attachmentsView, type AttachmentsView } from './attachments-view.ts'
import { erasuresView, forgetErased, keptRecordsOf, withErasures, type ErasuresView } from './erasure-view.ts'
import { faultsView, type FaultsView } from './faults-view.ts'
import { inspectionsView, type InspectionsView } from './inspections-view.ts'
import { jobsView, type JobsView } from './jobs-view.ts'
import { Derived } from './derive.ts'
import { kitView, type KitMemo, type KitView } from './kit-view.ts'
import { labelsView, type LabelsView } from './labels-view.ts'
import { notesKitView, type NotesKitView } from './notes-kit-view.ts'
import { lateView, type LateView } from './late-view.ts'
import { leaveView, type LeaveView } from './leave-view.ts'
import { officeView, type OfficeView } from './office-view.ts'
import { moveTallies, movesView, type MoveTallies, type MovesView } from './pick-view.ts'
import { warehouseView, type WarehouseView } from './stock-view.ts'
import { timesheetsView, type TimesheetsView } from './timesheets-view.ts'
import { moneyView, type MoneyView } from './money-view.ts'
import { ownCalendarsView, type OwnCalendarsView } from './own-calendar-view.ts'
import { vehiclesView, type VehiclesView } from './vehicles-view.ts'
import { stepsView, type StepsView } from './steps-view.ts'
import { racksView, type RacksView } from './racks-view.ts'
import { purchasesView, type PurchasesView } from './purchases-view.ts'
import { MONEY_ENTITY_NAMES } from '../quotes.ts'
import { READS_EVERYTHING, sameReading, type Reading } from '../reading.ts'

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
  /** With `latest`, asks for only the latest change of each record (see `LatestOnly`); a transport may leave it out. */
  pull(after: number, latest?: LatestOnly): Promise<PullResponse>
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
  /**
   * False when the server leaves money out of what it sends this device
   * (ADR 0042), for a role that can't see it; absent from copies saved
   * before, which hold everything.
   */
  money?: boolean
  /**
   * What the server leaves out of crew rates and private links for this
   * device's role (ADR 0046); absent when it sends everything, and on
   * copies saved before, which then read their copy again once.
   */
  reading?: Reading
  /**
   * How the server read the feed when this copy last pulled (`FEED`); absent
   * from copies saved before, which then read their copy again once.
   */
  feed?: number
  /**
   * How far the copy had read when it began reading the feed again from the
   * start (`FEED`, money, what its role reads), keeping what it held; gone
   * once it's read that far again. What the person sees meanwhile is as of
   * this, so a change made then says it was made against this.
   */
  held?: number
  /**
   * The copy is being read from the start with only the latest change of
   * each record (audit finding 17), and the server said to ask with this
   * for the next page (`PullResponse.latest`); gone once it's read to the end.
   */
  latest?: number
  /**
   * The copy has been read to the end at least once (audit, 20 October
   * 2026, finding 1): until then it's still arriving, and the screens say so
   * rather than "Up to date". Copies saved before this existed, holding a
   * copy already, count as read.
   */
  readToEnd?: boolean
}

export interface Storage {
  load(): Promise<Snapshot | undefined>
  /**
   * Keep the copy. `changed` names the tables changed since the last save
   * that worked, so a storage that keeps each table apart need write only
   * those; everything else in the snapshot is small and always written.
   * Absent, or 'all', means every table.
   */
  save(snapshot: Snapshot, changed?: ReadonlySet<string> | 'all'): Promise<void>
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

/**
 * The server answered, but was in the middle of a long change and couldn't take
 * this device's changes in time (audit finding 7). Not a problem to show: the
 * connection is fine and they wait to go again, which `keepSyncing` does shortly,
 * as does the poke the server sends when the long change is done.
 */
export class ServerBusy extends Error {
  constructor() {
    super('The server is busy with a long change; sending again shortly.')
  }
}

export interface View {
  problems: Problem[]
  crew: CrewView
  jobs: JobsView
  /** The warehouse catalogue (ADR 0013). */
  warehouse: WarehouseView
  /** Kit on jobs, and what's short (ADR 0014). */
  kit: KitView
  /** Kit lists in jobs' notes, matched to the stock list, and the jobs whose notes hold kit not on them yet (ADR 0043). */
  notesKit: NotesKitView
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
  /** People's documents, and those sent from a link waiting to be checked (ADR 0029). */
  documents: DocumentsView
  /** Documents kept on venues and clients, as files or links, each on its own page (ADR 0032). */
  attachments: AttachmentsView
  /** Counts of places and cases, when each was last counted, and this week's list (ADR 0030). */
  counts: CountsView
  /** Prices, quotes, what's owed and each job's margin (ADR 0042); empty for a role the server sends no money to. */
  money: MoneyView
  /** When freelancers are busy in their own calendars, read only (ADR 0044). */
  ownCalendars: OwnCalendarsView
  /** What this device is sent of crew rates and private links (ADR 0046), as the server last said: a screen says what's hidden. */
  reading: Reading
  /** The company's vehicles, their checks, and each booked on jobs with a driver (ADR 0047). */
  vehicles: VehiclesView
  /** Each job's steps from the quote to the kit put away, who each is down to, and each person's own (ADR 0073). */
  steps: StepsView
  /** Racks: each rack product's layout, what it comes to, and each built one against it (ADR 0074). */
  racks: RacksView
  /** Kit the crew ask to be bought, with everyone's votes, and where each is at (ADR 0077). */
  purchases: PurchasesView
  /**
   * What would keep a person's name were they erased on a day (today
   * unless said): their pay records and their leave records, each with
   * the day it can go, from what this device holds, as the server decides.
   */
  keptFor(personId: string, on?: string): NameKept
  /** Where jobs go on Google Calendar (ADR 0008): the connection, and each phase-day written, by `calendarDayId`. */
  calendar: { link: CalendarLink | undefined; days: Readonly<Record<string, CalendarDay>> }
  pendingCount: number
  connection: Connection
  cursor: number
  /**
   * The copy is still arriving (audit, 20 October 2026, finding 1): a new
   * device's first read, or one reading again from the start, not yet read
   * to the end. `share` is how far through the server's changes it has
   * read, 0 to 1, once the server has said how many there are. Counts and
   * empty lists aren't to be trusted until it's gone.
   */
  copying: false | { share?: number }
  /** The server holds made-up data to try the app with (ADR 0019), as of the last sync. */
  madeUp: boolean
}

/** The parts of the view built only once a screen reads them. */
const LAZY = [
  'crew',
  'jobs',
  'warehouse',
  'kit',
  'notesKit',
  'labels',
  'moves',
  'faults',
  'inspections',
  'timesheets',
  'office',
  'leave',
  'late',
  'erasures',
  'documents',
  'attachments',
  'counts',
  'money',
  'ownCalendars',
  'vehicles',
  'steps',
  'racks',
  'purchases',
] as const satisfies readonly (keyof View)[]
type Lazy = (typeof LAZY)[number]
type MovesKit = { moves: MovesView; kit: KitView }
/** Parts kept like the view's own, that screens don't read: what each builds. */
type Inner = { movesKit: MovesKit; moveTallies: MoveTallies }

/** The same view for another state of the connection, its parts still built only when read. */
function withConnection(view: Omit<View, 'connection'>, connection: Connection): View {
  return Object.defineProperties({ connection } as View, Object.getOwnPropertyDescriptors(view))
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
  async save(snapshot: Snapshot, changed?: ReadonlySet<string> | 'all') {
    if (!this.snapshot || !changed || changed === 'all') {
      this.snapshot = structuredClone(snapshot)
      return
    }
    // The tables not changed are as they were kept.
    const { entities, ...rest } = snapshot
    const kept = { ...this.snapshot.entities } as Record<string, unknown>
    for (const name of changed) kept[name] = structuredClone((entities as Record<string, unknown>)[name])
    this.snapshot = { ...structuredClone(rest), entities: kept as Snapshot['entities'] }
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
  /** The server's latest change number, as the last pull said: how far a copy still arriving has to go. */
  private head: number | undefined
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
  /** The parts of the view kept between changes, and what each was built from (derive.ts). */
  private derived = new Derived()
  /** Each product's kit days, kept between builds of the kit (kit-view.ts). */
  private kitMemo: KitMemo = new Map()
  /** The tables the server's changes have landed in since `takePulled` was last asked. */
  private pulledInto = new Set<string>()
  /** The tables changed since the copy was last saved, so a save writes only those; all of them after anything else. */
  private dirty: Set<string> | 'all' = new Set()
  private readonly storage: Storage
  private readonly transport: Transport
  private readonly now: () => Date

  constructor(private readonly options: SyncClientOptions) {
    this.storage = options.storage
    this.transport = options.transport
    this.now = options.now ?? (() => new Date())
  }

  async open(): Promise<this> {
    const saved = await this.storage.load()
    this.state = saved ?? emptySnapshot(this.options.clientId ?? newId())
    if (!saved) this.dirty = 'all'
    // Saved before the flag: a copy that has read anything has been read to the end before, or is mid-read with `latest`.
    if (saved && saved.readToEnd === undefined && saved.cursor > 0 && saved.latest === undefined) this.state.readToEnd = true
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
      this.check()
      return
    } catch {
      // Something is in the way. If the view works without the outbox, the outbox holds it.
    }
    const all = this.state.outbox
    this.state.outbox = []
    try {
      this.check()
    } catch {
      this.state.outbox = all
      return
    }
    for (const m of all) {
      this.state.outbox.push(m)
      try {
        this.check()
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

  /** This device's own changes the server hasn't been heard to apply yet, oldest first: an item's log shows them before they sync (ADR 0026). */
  get waiting(): readonly Mutation[] {
    return this.state.outbox.filter((m) => m.appliedSeq === undefined || m.appliedSeq > this.state.cursor)
  }

  /**
   * Says why a change can't be made by whoever is using this device, or
   * nothing when it can. Set by the app from the person's role (ADR 0034);
   * the server checks the same, so this only saves a change it would turn down.
   */
  guard?: (name: CommandName, args: unknown) => string | undefined

  /**
   * The tables the server's changes have landed in since this was last asked, and from now on none: what a pull brought,
   * for whatever needs to look again only when something of a kind it cares about arrived (notices, in the web app).
   */
  takePulled(): ReadonlySet<string> {
    const pulled = this.pulledInto
    this.pulledInto = new Set()
    return pulled
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
    // A change this person's role can't make is said so here, before it's kept, as the server would (ADR 0034, ADR 0046).
    const refused = this.guard?.(name, parsed.success ? parsed.data : args)
    if (refused) throw new Error(refused)
    if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? 'Invalid request')
    // What the person was looking at, so the server can tell an edit to something changed elsewhere since (audit, 18 October 2026).
    const seen = Math.max(this.state.cursor, this.state.held ?? 0)
    const mutation: Mutation<N> = { id: newId(), name, args: parsed.data as CommandArgs<N>, createdAt: this.now().toISOString(), seen }
    this.state.outbox.push(mutation)
    this.version++
    const takeBack = () => {
      this.state.outbox = this.state.outbox.filter((m) => m.id !== mutation.id)
      this.version++
    }
    // A change the view can't lay over the rest would leave every screen blank
    // until the device's storage was wiped, so it's taken back before it's saved.
    try {
      this.check()
    } catch (err) {
      takeBack()
      throw new Error(`This change can't be shown on this device, so it wasn't kept: ${err instanceof Error ? err.message : String(err)}`)
    }
    // A change the device can't keep (out of storage, or another tab holds the
    // data) would be lost on the next reload, so it isn't taken either: the
    // storage says why, and the person tries again once that's sorted.
    try {
      await this.saveChanged()
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
   * parallel, so the outbox is never sent twice at once. That round still
   * runs when the one before it fails: a call made as the signal came back
   * is answered by a round that tries with the signal, not by the failure
   * of one sent before it, which would leave "No signal" showing until the
   * next retry, up to 30 seconds on.
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
          try {
            await this.round()
          } catch (err) {
            if (!this.again) throw err
          }
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
    if (!view) this.views[this.connection] = view = withConnection(this.built.view, this.connection)
    return view
  }

  /**
   * The device's data model, each part built only as a screen reads it and
   * kept until what it's built from changes (derive.ts, audit finding 11).
   * A part that can't lay a change over the rest throws as it's read; `check`
   * reads them all.
   */
  private build(today = irishToday(this.now())): Omit<View, 'connection'> {
    const { entities, outbox } = this.state
    const cursor = this.state.cursor
    // Only what's still to land is laid over the copy: what the server has applied and this copy has pulled is in it already.
    const waiting = outbox.filter((m) => m.appliedSeq === undefined || m.appliedSeq > cursor)
    const derived = this.derived
    const kitMemo = this.kitMemo
    const lazy = {} as { [K in Lazy]: () => View[K] }
    /** Built once for this version of the copy, from the parts kept unless what they read has changed. */
    const part = <K extends Lazy | keyof Inner>(key: K, deps: () => readonly unknown[], make: (e: typeof entities, o: readonly PendingMutation[]) => K extends Lazy ? View[K] : K extends keyof Inner ? Inner[K] : never) => {
      let got: { value: unknown } | undefined
      return () => {
        if (!got) {
          const ds = deps()
          got = { value: derived.part(key, { entities, waiting, today, deps: ds }, make as (e: typeof entities, o: readonly Mutation[]) => unknown) }
        }
        return got.value as K extends Lazy ? View[K] : K extends keyof Inner ? Inner[K] : never
      }
    }
    // Someone erased on this device is shown erased at once, everywhere the crew reaches (ADR 0027).
    lazy.erasures = part('erasures', () => [], (e, o) => erasuresView(e, o, cursor, today))
    lazy.crew = part('crew', () => [lazy.erasures()], (e, o) => withErasures(crewView(e, o, cursor, today), lazy.erasures()))
    lazy.jobs = part('jobs', () => [lazy.crew().calls], (e, o) => jobsView(e, o, cursor, lazy.crew().calls))
    lazy.warehouse = part('warehouse', () => [], (e, o) => warehouseView(e, o, cursor))
    lazy.inspections = part('inspections', () => [lazy.warehouse()], (e, o) => inspectionsView(e, o, cursor, lazy.warehouse(), today))
    lazy.faults = part('faults', () => [lazy.jobs(), lazy.warehouse(), lazy.inspections()], (e, o) => {
      const inspections = lazy.inspections()
      return faultsView(e, o, cursor, lazy.jobs(), lazy.warehouse(), (id) => !!inspections.blocks(id))
    })
    // Where the scans leave the kit, which reads no job: kept through a change to one (audit, 20 October 2026, finding 12).
    // The faults are built again with every job, so it goes by what it reads of them, the reports of kit missing from a job.
    const tallies = part('moveTallies', () => [lazy.warehouse(), missingFrom(lazy.faults())], (e, o) => moveTallies(e, o, cursor, lazy.warehouse(), lazy.faults()))
    // Kit still out after its job comes off what's free (ADR 0031), and the pick lists need the kit: so the moves first,
    // reading the kit only when a pick list is. Kept together, as each reads the other.
    const movesKit = part('movesKit', () => [lazy.jobs(), lazy.warehouse(), lazy.faults(), tallies()], (e, o) => {
      const [jobs, warehouse, faults] = [lazy.jobs(), lazy.warehouse(), lazy.faults()]
      let kit: KitView | undefined
      const moves = movesView(e, o, cursor, jobs, warehouse, () => kit!, today, faults, tallies())
      kit = kitView(e, o, cursor, jobs, warehouse, today, faults, moves.lateOut, kitMemo)
      return { moves, kit }
    })
    lazy.moves = () => movesKit().moves
    lazy.kit = () => movesKit().kit
    lazy.timesheets = part('timesheets', () => [lazy.crew()], (e, o) => timesheetsView(e, o, cursor, lazy.crew(), today))
    lazy.notesKit = part('notesKit', () => [lazy.jobs(), lazy.warehouse(), lazy.kit()], (e, o) => notesKitView(e, o, cursor, lazy.jobs(), lazy.warehouse(), lazy.kit(), today))
    lazy.labels = part('labels', () => [lazy.warehouse()], (e, o) => labelsView(e, o, cursor, lazy.warehouse()))
    lazy.office = part('office', () => [], (e, o) => officeView(e, o, cursor))
    lazy.leave = part('leave', () => [lazy.crew(), lazy.erasures()], (e, o) => leaveView(e, o, cursor, lazy.crew(), today, lazy.erasures()))
    lazy.late = part('late', () => [lazy.crew(), lazy.erasures()], (e, o) => lateView(e, o, cursor, lazy.crew(), today, lazy.erasures()))
    lazy.documents = part('documents', () => [lazy.crew(), lazy.erasures()], (e, o) => documentsView(e, o, cursor, lazy.crew(), lazy.erasures()))
    lazy.attachments = part('attachments', () => [], (e, o) => attachmentsView(e, o, cursor))
    lazy.counts = part('counts', () => [lazy.warehouse(), lazy.crew()], (e, o) => countsView(e, o, cursor, lazy.warehouse(), lazy.crew(), today))
    lazy.money = part('money', () => [lazy.jobs(), lazy.crew(), lazy.kit(), lazy.timesheets()], (e, o) =>
      moneyView(e, o, cursor, lazy.jobs(), lazy.crew(), lazy.kit(), lazy.timesheets())
    )
    lazy.ownCalendars = part('ownCalendars', () => [], (e, o) => ownCalendarsView(e, o, cursor))
    lazy.vehicles = part('vehicles', () => [lazy.jobs(), lazy.crew()], (e, o) => vehiclesView(e, o, cursor, lazy.jobs(), lazy.crew(), today))
    lazy.steps = part('steps', () => [lazy.jobs(), lazy.crew(), lazy.kit(), lazy.moves(), lazy.money(), lazy.vehicles()], (e, o) =>
      stepsView(e, o, cursor, lazy.jobs(), lazy.crew(), lazy.kit(), lazy.moves(), lazy.money(), lazy.vehicles(), today)
    )

    lazy.racks = part('racks', () => [lazy.warehouse()], (e, o) => racksView(e, o, cursor, lazy.warehouse()))
    lazy.purchases = part('purchases', () => [lazy.crew()], (e, o) => purchasesView(e, o, cursor, lazy.crew()))

    const view = {
      problems: [...this.state.problems],
      reading: this.state.reading ?? READS_EVERYTHING,
      keptFor: (personId: string, on = today) => nameKept(keptRecordsOf(entities, personId), on),
      // Snapshots saved before the calendar existed have no tables for it.
      calendar: { link: entities.calendarLink?.[CALENDAR_LINK_ID], days: entities.calendarDay ?? {} },
      pendingCount: outbox.filter((m) => m.appliedSeq === undefined).length,
      cursor,
      madeUp: this.state.madeUp === true,
      copying: this.copying(),
    } as Omit<View, 'connection'>
    for (const key of LAZY) Object.defineProperty(view, key, { enumerable: true, get: lazy[key] })
    return view
  }

  /** Build every part, so a change that can't be laid over the rest throws here rather than on a screen. */
  private check() {
    // Built afresh for the copy as it is now, which may have been changed in place; the parts it reads are still kept.
    this.built = undefined
    const view = this.view()
    for (const key of LAZY) void view[key]
  }

  private async round() {
    // Not announced: a round that pushes and pulls nothing ends as it began,
    // and the screens hear nothing of it. Whatever a round does persist is
    // announced as it lands, and the end of the round after that.
    this.connection = 'syncing'
    try {
      // A push that fails or runs out of time still lets the pull go: a phone
      // that can't get its own changes through keeps hearing everyone else's,
      // rather than nothing at all until it can (audit, 18 October 2026).
      let failed: { err: unknown } | undefined
      try {
        await this.push()
      } catch (err) {
        failed = { err }
      }
      // When both fail, the push's failure is the one said, so being signed out still stops the retries; unless the
      // push was only told the server was busy, which says nothing of the signal, so then it's the pull's.
      await this.pull().catch((err: unknown) => {
        throw failed && !(failed.err instanceof ServerBusy) ? failed.err : err
      })
      if (failed) throw failed.err
      this.setConnection('idle')
    } catch (err) {
      // No signal, server down, or a response lost on the way back. The
      // outbox is untouched, and every mutation carries its own id, so
      // sending it all again later is safe. A busy server answered, and the
      // pull came through: nothing is wrong to show, and the changes wait.
      this.setConnection(err instanceof ServerBusy ? 'idle' : 'offline')
      throw err
    }
  }

  private async push() {
    const waiting = this.state.outbox.filter((m) => m.appliedSeq === undefined)
    // A long day with no signal, or a replay after a restore, goes up PUSH_SLICE at a time,
    // each answered and saved before the next is sent.
    for (let from = 0; from < waiting.length; from += PUSH_SLICE) {
      const slice = waiting.slice(from, from + PUSH_SLICE)
      const { results, stale, busy } = await this.transport.push({
        clientId: this.state.clientId,
        mutations: slice.map(({ id, name, args, createdAt, seen }) => ({ id, name, args, createdAt, ...(seen !== undefined ? { seen } : {}) })),
        // On the same clock as each createdAt, so the server can tell how long each waited here.
        sentAt: this.now().toISOString(),
        ...(this.state.generation ? { generation: this.state.generation } : {}),
        // A slow server answers the first of them and leaves the rest, which go again, first, next time.
        partial: true,
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
      // In the middle of a long change, the server answered what it could: the rest go again shortly, in order.
      if (busy) throw new ServerBusy()
      // Answered only in part: nothing after the rest may go before them, so this round pulls, and the next one, straight
      // after, sends them. An answer to none of them, which no server gives, would only end the round.
      if (results.length < slice.length) {
        if (results.length > 0) this.again = true
        return
      }
    }
  }

  private copying(): View['copying'] {
    if (this.state.readToEnd === true && this.state.held === undefined) return false
    const { head } = this
    return head && head > 0 ? { share: Math.min(1, this.state.cursor / head) } : {}
  }

  /**
   * Whether this pull asks for only the latest change of each record, and how: from the start, a copy that holds nothing
   * asks "new", one that holds records 0, for the deletes too; the pages after, what the server answered. Never while a
   * change of this device's own is applied and not yet read back: the cursor could pass it while the record it changed
   * waits for a later page, and the change would vanish from the screen until then. The rest of that read is the feed as
   * it is, which is always right, only longer.
   *
   * Except while the copy is read again up to where it had got (`held`): every change of its own still waiting was applied
   * past that mark, so it stays laid over the copy while the latest of each record lands, and the read stays short. Read
   * as the feed is, it walked every change from the first, landing each record's oldest version first, and the screens
   * showed old records until it was done (audit, 20 October 2026, finding 22).
   */
  private latestOnly(): LatestOnly | undefined {
    if (this.state.held === undefined && this.state.outbox.some((m) => m.appliedSeq !== undefined && m.appliedSeq > this.state.cursor)) {
      delete this.state.latest
      return undefined
    }
    if (this.state.latest !== undefined) return this.state.latest
    if (this.state.cursor !== 0) return undefined
    return Object.values(this.state.entities).every((table) => Object.keys(table ?? {}).length === 0) ? 'new' : 0
  }

  private async pull() {
    for (;;) {
      const res = await this.transport.pull(this.state.cursor, this.latestOnly())
      const restored = res.generation !== undefined && this.state.generation !== undefined && res.generation !== this.state.generation
      const behind = res.head !== undefined && res.head < this.state.cursor
      if (res.head !== undefined) this.head = res.head
      if (restored || behind) return this.restart(res.generation, restored && res.cleared === true)
      // What the server sends this device's role changed (ADR 0042). Given money, the copy is read again from the start for
      // the records it was never sent; what it has stays, as reading it again only lands it as it is. Without, it lets go of
      // the money it holds.
      const money = res.money !== false
      const gainedMoney = money && this.state.money === false
      // What it reads of rates and links changed too (ADR 0046): the copy is read again from the start, which lands every
      // person, call, offer and timesheet as it's sent now, with what's hidden left out, or what's newly shown put back.
      const reread = !sameReading(res.reading, this.state.reading)
      const rescoped = money !== (this.state.money !== false) || reread
      // The server reads the feed differently now (FEED). A copy read before may have been moved past a change it was
      // never sent, so it's read again from the start, once: what it has stays, and so does everything waiting to go.
      const refeed = res.feed !== undefined && res.feed > (this.state.feed ?? 0)
      if (refeed) this.state.feed = res.feed
      if (rescoped || refeed) {
        this.state.money = money
        if (res.reading) this.state.reading = res.reading
        else delete this.state.reading
        if (!money) for (const name of MONEY_ENTITY_NAMES) this.replaceTable(name)
        // Other people's documents are left out of the feed, not cut down (ADR 0062), so reading again wouldn't take back
        // the ones it holds: it lets go of them all, and its own come back as it reads.
        if (reread && (res.reading?.documents ?? 'all') !== 'all') this.replaceTable('document')
        if ((gainedMoney || reread || refeed) && this.state.cursor > 0) {
          this.state.held = Math.max(this.state.held ?? 0, this.state.cursor)
          this.state.cursor = 0
          // It holds records now, so it reads again with the deletes.
          delete this.state.latest
          this.version++
          await this.persist()
          continue
        }
      }
      // Nothing new, most of the time: then nothing is saved and nobody is told.
      let changed = res.changes.length > 0 || rescoped || refeed
      if (res.generation && res.generation !== this.state.generation) [this.state.generation, changed] = [res.generation, true]
      // Copies saved before made-up data existed have no flag, which means no.
      if ((this.state.madeUp === true) !== (res.madeUp === true)) [this.state.madeUp, changed] = [res.madeUp === true, true]
      for (const change of res.changes) {
        // An erasure arrives before the records it changes, so whose each change still held here is can be told (ADR 0027).
        if (change.entity === 'erasure' && change.op === 'put') {
          forgetErased(this.state, change.data as Erasure, this.now().toISOString())
          // It rewrites changes waiting, under the same ids.
          this.derived.touchedAll()
        }
        applyChange(this.state, change)
        this.touched(change.entity)
        this.pulledInto.add(change.entity)
      }
      if (res.cursor > this.state.cursor) [this.state.cursor, changed] = [res.cursor, true]
      // Reading only the latest of each record, there's more to come; read to the end, or from a server that sent every change, it's done.
      const latest = res.more ? res.latest : undefined
      if (latest !== this.state.latest) {
        if (latest === undefined) delete this.state.latest
        else this.state.latest = latest
        changed = true
      }
      if (this.state.held !== undefined && this.state.cursor >= this.state.held) delete this.state.held
      // Applied mutations leave the outbox once their result has arrived.
      const done = this.state.outbox.filter((m) => m.appliedSeq !== undefined && m.appliedSeq <= this.state.cursor)
      if (done.length) {
        this.state.outbox = this.state.outbox.filter((m) => m.appliedSeq === undefined || m.appliedSeq > this.state.cursor)
        this.remember(done)
        changed = true
      }
      if (!res.more && this.state.readToEnd !== true) [this.state.readToEnd, changed] = [true, true]
      // Still arriving, the screens hear each page, so how far it has got moves even when a page lands nothing new.
      else if (res.more && this.state.readToEnd !== true) changed = true
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
    this.derived.touchedAll()
    this.dirty = 'all'
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
      await this.saveChanged()
    } catch {
      // Said to the person by the storage; the copy in memory carries on.
    }
  }

  /** Save the copy: everything but the tables, and of those only the ones changed since the last save that worked. */
  private async saveChanged() {
    const changed = this.dirty
    this.dirty = new Set()
    try {
      await this.storage.save(this.state, changed)
    } catch (err) {
      // Still to be saved, with whatever has changed since.
      const since = this.dirty as Set<string> | 'all'
      if (changed === 'all' || since === 'all') this.dirty = 'all'
      else for (const t of changed) since.add(t)
      throw err
    }
  }

  private touched(table: string) {
    this.derived.touched(table)
    if (this.dirty !== 'all') this.dirty.add(table)
  }

  private replaceTable(table: string) {
    ;(this.state.entities as Record<string, unknown>)[table] = {}
    this.touched(table)
  }

  /** Tell the screens. The view is cached, so this rebuilds only when something has changed. */
  private emit() {
    const view = this.view()
    this.told = view
    for (const fn of this.listeners) fn(view)
  }
}

/** What the moves read of the faults (pick-view.ts), as one string: the same reports give the same string. */
function missingFrom(faults: FaultsView): string {
  return faults.all
    .filter((f) => f.kind === 'missing' && f.projectId)
    .map((f) => [f.id, f.projectId, f.assetId, f.modelId, f.qty, f.at, f.pending, f.outcome].join('|'))
    .join('\n')
}

/**
 * Without `seen` too: a change sent again after the server's data is put
 * back (`restart`) was made against change numbers from the copy that was
 * lost, so it applies in the order it arrives, as from an older version.
 */
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
