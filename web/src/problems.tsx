import { dayLabel, levelLabel, normaliseNumber, spanLabel, type Mutation, type View } from '@sh/shared'
import { titleInSentence } from '@sh/shared'
import { useEffect, useState, type ReactNode } from 'react'
import { reasonOf } from './act.tsx'
import { when } from './format.ts'
import { client } from './sync.ts'

/**
 * Changes that weren't done (audit finding 11). A change the server turns
 * down after a sync used to show only on the screen of its own area: an
 * offer sent from a job's page was refused on the Crew tab, and a scan
 * refused on a pick list was invisible from Stock or the job. Now every
 * screen's top bar counts them all, beside what's waiting, and one list
 * opens from it, inside the bar, saying what was asked, when, and why not,
 * in plain words, until each is dismissed. A change this device turns down
 * before keeping it isn't here: that's said where it was asked for
 * (act.tsx).
 */

/** The count for the top bar and the list for under it, wired together: the count opens and closes the list. */
export function useNotDone(view: View): { count: ReactNode; list: ReactNode } {
  const [open, setOpen] = useState(false)
  const n = view.problems.length
  // Dismissing the last one closes the list, so the next refusal doesn't pop it open unasked.
  useEffect(() => {
    if (n === 0) setOpen(false)
  }, [n])
  // The count sits in a live region that's there before any refusal arrives, which is what a screen reader needs to read the change out (audit finding 22).
  return {
    count: (
      <span className="not-done-live" aria-live="polite">
        {n > 0 && (
          <button type="button" className="not-done" aria-expanded={open} onClick={() => setOpen(!open)}>
            {n} not done
          </button>
        )}
      </span>
    ),
    list: open && n > 0 ? <NotDoneList view={view} /> : null,
  }
}

function NotDoneList({ view }: { view: View }) {
  const say = describer(view)
  // Newest first: the one that just arrived is the one to read.
  const problems = [...view.problems].reverse()
  return (
    <section className="card attention not-done-list" aria-label="Not done" aria-live="polite">
      <h2>Not done</h2>
      <p className="hint">The server turned these down, so they weren't made. Sort out what each says and ask again, or dismiss it.</p>
      {problems.map((p) => {
        const what = say(p.mutation)
        return (
          <div className="row" key={p.mutation.id}>
            <div>
              <b>{what}</b>
              <p>{reasonOf(p.reason.message)}</p>
              <p className="meta">
                Asked {when(p.mutation.createdAt)}
                {p.at.slice(0, 16) !== p.mutation.createdAt.slice(0, 16) && `, turned down ${when(p.at)}`}
              </p>
            </div>
            <button type="button" onClick={() => void client.dismissProblem(p.mutation.id)} aria-label={`Dismiss: ${what}`}>
              Dismiss
            </button>
          </div>
        )
      })}
    </section>
  )
}

const str = (v: unknown, or: string) => (typeof v === 'string' && v.trim() ? v.trim() : or)
const num = (v: unknown) => (typeof v === 'number' ? v.toLocaleString('en-IE') : 'some')

/**
 * What a change asked for, in words, from what this device knows: "Offer
 * Audio tech on Electric Picnic to Aoife Byrne". A refused change made
 * nothing, so what it would have made is read from its own arguments, and
 * what it refers to from the view; anything since gone is named in general.
 */
function describer(view: View): (m: Mutation) => string {
  const w = view.warehouse
  const people = new Map(view.crew.people.map((p) => [p.id, p.name]))
  const person = (id: unknown) => (typeof id === 'string' && people.get(id)) || 'someone'
  const calls = new Map(view.crew.calls.map((c) => [c.id, c]))
  const call = (id: unknown) => {
    const c = typeof id === 'string' ? calls.get(id) : undefined
    return c ? `${c.role} on ${c.project}` : 'a crew call'
  }
  const offers = new Map(view.crew.calls.flatMap((c) => c.offers.map((o) => [o.id, { who: o.person?.name ?? 'someone', what: `${c.role} on ${c.project}` }])))
  const offer = (id: unknown) => (typeof id === 'string' && offers.get(id)) || { who: 'someone', what: 'a crew call' }
  const job = (id: unknown) => view.jobs.jobs.find((j) => j.id === id)?.name ?? 'a job'
  const phase = (id: unknown) => {
    for (const j of view.jobs.jobs) {
      const p = j.phases.find((x) => x.id === id)
      if (p) return { name: p.name, job: j.name }
    }
    return { name: 'a phase', job: 'a job' }
  }
  // A product marked as added by mistake since is still named.
  const model = (id: unknown) => (w.models.find((m) => m.id === id) ?? (typeof id === 'string' ? w.mistakes.get(id) : undefined))?.name ?? 'a product'
  const item = (id: unknown) => {
    const a = typeof id === 'string' ? w.assets.get(id) : undefined
    return a ? `${a.number || 'an item'} (${a.model?.name ?? 'a product'})` : 'an item'
  }
  const place = (id: unknown) => w.places.find((p) => p.id === id)?.name ?? 'a place'
  const where = (placeId: unknown, caseId: unknown) => (placeId ? ` at ${place(placeId)}` : caseId ? ` in ${item(caseId)}` : '')
  const kitLine = (id: unknown) => {
    const l = view.kit.lines.find((x) => x.id === id)
    return { model: l?.model?.name ?? 'a product', job: l?.job?.name ?? 'a job' }
  }
  const faultOn = (id: unknown) => {
    const f = view.faults.all.find((x) => x.id === id)
    if (!f) return 'some kit'
    return f.assetId ? item(f.assetId) : `${f.qty.toLocaleString('en-IE')} × ${model(f.modelId)}`
  }
  const span = (a: Record<string, unknown>) => (typeof a.start === 'string' && typeof a.end === 'string' ? `, ${spanLabel({ start: a.start, end: a.end })}` : '')
  const leave = (id: unknown) => {
    const r = view.leave.requests.find((x) => x.id === id)
    return r ? `${r.person?.name ?? 'someone'}'s ${r.type === 'lieu' ? 'days in lieu' : 'annual leave'}` : "someone's leave"
  }
  const lieu = (id: unknown) => {
    const e = view.leave.entries.find((x) => x.id === id)
    return e ? `${e.person?.name ?? 'someone'}'s day in lieu for ${dayLabel(e.day)}` : "someone's day in lieu"
  }

  const late = (id: unknown) => view.late.current.find((l) => l.id === id)?.person?.name ?? 'someone'
  /** "Pádraig Kenny's IPAF card" (ADR 0029). */
  const docOf = (id: unknown) => {
    const d = view.documents.all.find((x) => x.id === id)
    return d ? `${d.person?.name ?? 'someone'}'s ${titleInSentence(d.title)}` : 'a document'
  }

  return (m: Mutation) => {
    const a = m.args as Record<string, unknown>
    switch (m.name) {
      case 'person.upsert':
        return `Save ${str(a.name, 'someone')}'s details`
      case 'person.level':
        // An erased person's level went with the rest of their details (ADR 0027).
        return `Move ${person(a.id)} to ${typeof a.level === 'number' ? levelLabel(a.level) : 'another level'}`
      case 'person.newLink':
        return `Give ${person(a.id)} a new private link`
      case 'person.archive':
        return a.archived ? `Archive ${person(a.id)}` : `Bring ${person(a.id)} back`
      case 'person.contact':
        return `Change ${person(a.id)}'s contact details`
      case 'person.erase':
        return `Erase ${person(a.id)}'s details`
      case 'unavailability.add':
        return `Mark ${person(a.personId)} away${span(a)}`
      case 'unavailability.remove': {
        const u = view.crew.unavailability.find((x) => x.id === a.id)
        return u ? `Remove ${person(u.personId)}'s days off, ${spanLabel(u)}` : 'Remove some days off'
      }
      case 'call.create':
        return `Ask for ${num(a.needed)} × ${str(a.role, 'crew')} for ${str(a.project, 'a job')}`
      case 'call.update':
        return `Change the call for ${call(a.id)}`
      case 'call.cancel':
        return `Cancel the call for ${call(a.id)}`
      case 'offer.send':
        return `Offer ${call(a.callId)} to ${person(a.personId)}`
      case 'offer.respond':
        return `Answer ${offer(a.id).who}'s offer of ${offer(a.id).what}`
      case 'offer.confirm':
        return `Confirm ${offer(a.id).who} for ${offer(a.id).what}`
      case 'offer.cancel':
        return `Withdraw the offer of ${offer(a.id).what} to ${offer(a.id).who}`
      case 'offer.seen':
        return `Note ${offer(a.id).who}'s answer on ${offer(a.id).what}`
      case 'office.update':
        return 'Set the office details'
      case 'client.upsert':
        return `Save the client ${str(a.name, 'a client')}`
      case 'venue.upsert':
        return `Save the venue ${str(a.name, 'a venue')}`
      case 'project.create':
        return `Add the job ${str(a.name, 'a job')}`
      case 'project.update':
        return `Change the job ${job(a.id)}`
      case 'phase.add':
        return `Add ${str(a.name, 'a phase')} to ${job(a.projectId)}${span(a)}`
      case 'phase.update':
        return `Change ${phase(a.id).name} on ${phase(a.id).job}`
      case 'phase.remove':
        return `Remove ${phase(a.id).name} from ${phase(a.id).job}`
      case 'model.create':
        return `Add the product ${str(a.name, 'a product')}`
      case 'model.update':
        return `Change the product ${model(a.id)}`
      case 'model.remove':
        return `Remove the product ${model(a.id)}`
      case 'model.mistake':
        return `Mark the product ${model(a.id)} as added by mistake`
      case 'place.upsert':
        return `Save the place ${str(a.name, 'a place')}`
      case 'place.remove':
        return `Remove the place ${place(a.id)}`
      case 'asset.add':
        return `Add ${(typeof a.number === 'string' && normaliseNumber(a.number)) || 'an item'} (${model(a.modelId)})${where(a.placeId, a.caseId)}`
      case 'asset.update':
        return `Change ${item(a.id)}`
      case 'asset.move':
        return a.placeId ? `Move ${item(a.id)} to ${place(a.placeId)}` : a.caseId ? `Put ${item(a.id)} in ${item(a.caseId)}` : `Clear where ${item(a.id)} is kept`
      case 'asset.relabel':
        return `Put a new label on ${item(a.id)}`
      case 'asset.retire':
        return `Retire ${item(a.id)}`
      case 'asset.reinstate':
        return `Bring back ${item(a.id)}`
      case 'stock.set':
        return `Count ${num(a.qty)} × ${model(a.modelId)}${where(a.placeId, a.caseId)}`
      case 'stock.move':
        return `Move ${num(a.qty)} × ${model(a.modelId)}${where(a.toPlaceId, a.toCaseId).replace(/^ (at|in) /, ' to ')}`
      case 'kit.add':
        return `Add ${num(a.qty)} × ${model(a.modelId)} to the kit for ${job(a.projectId)}`
      case 'kit.update':
        return `Change ${kitLine(a.id).model} on the kit for ${kitLine(a.id).job}`
      case 'kit.remove':
        return `Take ${kitLine(a.id).model} off the kit for ${kitLine(a.id).job}`
      case 'labels.reserve':
        return `Set aside ${num(a.count)} numbers for labels`
      case 'labels.update':
        return 'Change what some labels are for'
      case 'labels.cancel':
        return 'Cancel a run of labels set aside'
      case 'move.record': {
        const way = a.direction === 'in' ? 'back in from' : 'out to'
        return a.assetId ? `Scan ${item(a.assetId)} ${way} ${job(a.projectId)}` : `Count ${num(a.qty)} × ${model(a.modelId)} ${way} ${job(a.projectId)}`
      }
      case 'fault.report':
        return `Report ${a.assetId ? item(a.assetId) : `${num(a.qty)} × ${model(a.modelId)}`} ${a.kind === 'missing' ? 'missing' : 'damaged'}`
      case 'fault.update':
        return `Change the fault on ${faultOn(a.id)}`
      case 'fault.close':
        return a.outcome === 'written-off'
          ? `Write off ${faultOn(a.id)}`
          : `Mark ${faultOn(a.id)} as ${a.outcome === 'found' ? 'found' : a.outcome === 'not-faulty' ? 'not faulty' : 'fixed'}`
      case 'inspection.record':
        return `Record ${item(a.assetId)} ${a.passed ? 'passing' : 'failing'} its ${a.kind === 'lifting' ? 'thorough examination' : 'PAT'}`
      case 'timesheet.send':
        return `Send ${offer(a.id).who}'s timesheet for ${offer(a.id).what}`
      case 'timesheet.approve':
        return `Approve ${offer(a.id).who}'s timesheet for ${offer(a.id).what}`
      case 'timesheet.reopen':
        return `Reopen ${offer(a.id).who}'s timesheet for ${offer(a.id).what}`
      case 'leave.request':
        return `Ask for ${a.type === 'lieu' ? 'days in lieu' : 'annual leave'} for ${person(a.personId)}${span(a)}`
      case 'leave.cancel':
        return `Cancel ${leave(a.id)}`
      case 'leave.decide':
        return `${a.approved ? 'Approve' : 'Decline'} ${leave(a.id)}`
      case 'lieu.log':
        return `Log ${typeof a.days === 'number' && a.days !== 1 ? `${a.days} days` : 'a day'} in lieu for ${person(a.personId)}${typeof a.day === 'string' ? `, ${dayLabel(a.day)}` : ''}`
      case 'lieu.cancel':
        return `Cancel ${lieu(a.id)}`
      case 'lieu.decide':
        return `${a.approved ? 'Approve' : 'Decline'} ${lieu(a.id)}`
      case 'leave.allowance':
        // A year is written as a year: "2026", never "2,026".
        return `Set ${person(a.personId)}'s ${typeof a.year === 'number' ? `${a.year} ` : ''}allowance`
      case 'leave.open':
        return `Open ${typeof a.year === 'number' ? a.year : 'a year'} for leave`
      // Running late (ADR 0028): said here for someone who rang, marked there, or noted.
      case 'late.say':
        return `Say ${offer(a.offerId).who} is running late for ${offer(a.offerId).what}`
      case 'late.arrived':
        return `Say ${late(a.id)} is there now`
      case 'late.seen':
        return `Note that ${late(a.id)} is running late`
      // People's documents (ADR 0029). A file goes straight to the server, so only details wait here.
      case 'document.save':
        return `Save ${person(a.personId)}'s ${titleInSentence(str(a.title, 'document'))}`
      case 'document.check':
        return `Check ${docOf(a.id)}`
      case 'document.remove':
        return `Remove ${docOf(a.id)}`
      // A count (ADR 0030): turned down only when the place or case was never saved.
      case 'count.record':
        return `Record the count of ${a.placeId ? place(a.placeId) : item(a.caseId)}`
      // Kept from an older version of the app, such as the old sync test's bookings. The server's reason says it's gone, so this only says where it came from.
      default:
        return 'A change from an older version of the app'
    }
  }
}
