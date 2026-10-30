import type { CalendarDay, CalendarLink } from '../calendar.ts'
import type { Mutation, Rejection } from '../commands.ts'
import type { NameKept } from '../erasure.ts'
import type { Entities, EntityName } from '../model.ts'
import type { LatestOnly, PullResponse, PushRequest, PushResponse } from '../protocol.ts'
import type { CountsView } from './counts-view.ts'
import type { CrewView } from './crew-view.ts'
import type { DocumentsView } from './documents-view.ts'
import type { AttachmentsView } from './attachments-view.ts'
import type { ErasuresView } from './erasure-view.ts'
import type { FaultsView } from './faults-view.ts'
import type { InspectionsView } from './inspections-view.ts'
import type { JobsView } from './jobs-view.ts'
import type { KitView } from './kit-view.ts'
import type { LabelsView } from './labels-view.ts'
import type { NotesKitView } from './notes-kit-view.ts'
import type { LateView } from './late-view.ts'
import type { LeaveView } from './leave-view.ts'
import type { OfficeView } from './office-view.ts'
import type { MovesView } from './pick-view.ts'
import type { WarehouseView } from './stock-view.ts'
import type { TimesheetsView } from './timesheets-view.ts'
import type { MoneyView } from './money-view.ts'
import type { OwnCalendarsView } from './own-calendar-view.ts'
import type { VehiclesView } from './vehicles-view.ts'
import type { StepsView } from './steps-view.ts'
import type { RacksView } from './racks-view.ts'
import type { PurchasesView } from './purchases-view.ts'
import type { Reading } from '../reading.ts'

/**
 * The shapes of the device side of sync: what a device keeps, how it reaches
 * the server and keeps its copy, and the view it shows.
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
