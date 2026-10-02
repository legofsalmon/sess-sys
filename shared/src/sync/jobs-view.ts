import type { CommandArgs, Mutation } from '../commands.ts'
import { byWhen, jobSpan, type Client, type JobEntities, type Phase, type Project, type Venue } from '../jobs.ts'
import type { CallView } from './crew-view.ts'

/**
 * The Jobs tab's view of a device's data: what the server has said, with
 * this person's own waiting changes laid over it, as for bookings and crew.
 */

export interface ClientView extends Client {
  pending: boolean
}
export interface VenueView extends Venue {
  pending: boolean
}
export interface PhaseView extends Phase {
  pending: boolean
  /** Its own venue, or else the job's. */
  venue: Venue | undefined
  /** Crew calls for this phase. */
  calls: CallView[]
}
export interface JobView extends Project {
  pending: boolean
  client: Client | undefined
  venue: Venue | undefined
  /** In the order they happen. */
  phases: PhaseView[]
  /** The first to the last day of its phases; undefined while it has none. */
  span: { start: string; end: string } | undefined
  /** Every crew call that is part of the job. */
  calls: CallView[]
  /** The job's calls that aren't for one of its phases. */
  otherCalls: CallView[]
}

export interface JobsView {
  /** Jobs with no dates yet first, so they aren't forgotten, then by first day. */
  jobs: JobView[]
  clients: ClientView[]
  venues: VenueView[]
}

type Tables = { [E in keyof JobEntities]: Record<string, JobEntities[E]> }

/** Copy only the fields a change names; the rest stay as they are. */
function patch<T extends object>(target: T, changes: object): T {
  const out = { ...target }
  for (const [k, v] of Object.entries(changes)) if (k !== 'id' && v !== undefined) (out as Record<string, unknown>)[k] = v
  return out
}

export function jobsView(
  entities: Partial<Tables>,
  outbox: readonly (Mutation & { appliedSeq?: number })[],
  cursor: number,
  calls: readonly CallView[]
): JobsView {
  const clients = new Map<string, ClientView>()
  for (const c of Object.values(entities.client ?? {})) clients.set(c.id, { ...c, pending: false })
  const venues = new Map<string, VenueView>()
  for (const v of Object.values(entities.venue ?? {})) venues.set(v.id, { ...v, pending: false })
  const projects = new Map<string, Project & { pending: boolean }>()
  for (const p of Object.values(entities.project ?? {})) projects.set(p.id, { ...p, pending: false })
  const phases = new Map<string, Phase & { pending: boolean }>()
  for (const p of Object.values(entities.phase ?? {})) phases.set(p.id, { ...p, pending: false })

  for (const m of outbox) {
    if (m.appliedSeq !== undefined && m.appliedSeq <= cursor) continue
    switch (m.name) {
      case 'client.upsert': {
        const a = m.args as CommandArgs<'client.upsert'>
        clients.set(a.id, { ...a, pending: true })
        break
      }
      case 'venue.upsert': {
        const a = m.args as CommandArgs<'venue.upsert'>
        venues.set(a.id, { ...a, pending: true })
        break
      }
      case 'project.create': {
        const a = m.args as CommandArgs<'project.create'>
        if (!projects.has(a.id)) projects.set(a.id, { ...a, pending: true })
        break
      }
      case 'project.update': {
        const a = m.args as CommandArgs<'project.update'>
        const p = projects.get(a.id)
        if (p) projects.set(a.id, { ...patch(p, a), pending: true })
        break
      }
      case 'phase.add': {
        const a = m.args as CommandArgs<'phase.add'>
        // The whole shape of a synced phase, so the screens treat it as one: its Change form reads every field.
        if (!phases.has(a.id)) phases.set(a.id, { ...a, contactId: a.contactId ?? null, pending: true })
        break
      }
      case 'phase.update': {
        const a = m.args as CommandArgs<'phase.update'>
        const p = phases.get(a.id)
        // Whether to move the crew is an instruction, not a field of the phase.
        if (p) phases.set(a.id, { ...patch(p, { ...a, moveCrew: undefined }), pending: true })
        break
      }
      case 'phase.remove':
        phases.delete((m.args as CommandArgs<'phase.remove'>).id)
        break
    }
  }

  const callsByJob = new Map<string, CallView[]>()
  for (const c of calls) {
    if (!c.projectId) continue
    const list = callsByJob.get(c.projectId) ?? []
    list.push(c)
    callsByJob.set(c.projectId, list)
  }
  const phasesByJob = new Map<string, (Phase & { pending: boolean })[]>()
  for (const p of phases.values()) {
    const list = phasesByJob.get(p.projectId) ?? []
    list.push(p)
    phasesByJob.set(p.projectId, list)
  }

  const jobs: JobView[] = [...projects.values()].map((p) => {
    const venue = p.venueId ? venues.get(p.venueId) : undefined
    const own = callsByJob.get(p.id) ?? []
    const phaseViews = (phasesByJob.get(p.id) ?? []).sort(byWhen).map((ph) => ({
      ...ph,
      venue: ph.venueId ? venues.get(ph.venueId) : venue,
      calls: own.filter((c) => c.phaseId === ph.id),
    }))
    const phaseIds = new Set(phaseViews.map((ph) => ph.id))
    return {
      ...p,
      client: p.clientId ? clients.get(p.clientId) : undefined,
      venue,
      phases: phaseViews,
      span: jobSpan(phaseViews),
      calls: own,
      otherCalls: own.filter((c) => !c.phaseId || !phaseIds.has(c.phaseId)),
    }
  })
  // Every order ends on the id, so two devices holding the same data show the same order whatever order it arrived in.
  jobs.sort((a, b) => (a.span ? 1 : 0) - (b.span ? 1 : 0) || (a.span?.start ?? '').localeCompare(b.span?.start ?? '') || a.name.localeCompare(b.name) || a.id.localeCompare(b.id))

  const byName = (a: { id: string; name: string }, b: { id: string; name: string }) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id)
  return { jobs, clients: [...clients.values()].sort(byName), venues: [...venues.values()].sort(byName) }
}

/**
 * How many of the people a job's open crew calls need are booked (confirmed
 * for every day of the call), and how many more have said yes and wait on
 * the office (accepted for every day). "Booked" means confirmed everywhere
 * in the app, as the call sheet says it.
 */
export function crewFill(calls: readonly CallView[]): { needed: number; booked: number; toConfirm: number } {
  let needed = 0
  let booked = 0
  let toConfirm = 0
  for (const c of calls) {
    if (c.status !== 'open') continue
    needed += c.needed
    const confirmed = Math.min(c.needed, ...c.days.map((d) => c.offers.filter((o) => o.status === 'confirmed' && o.days.includes(d)).length))
    const holding = Math.min(c.needed, ...c.days.map((d) => c.heldByDay[d] ?? 0))
    booked += confirmed
    toConfirm += holding - confirmed
  }
  return { needed, booked, toConfirm }
}
