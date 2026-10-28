import { COMMAND_NAMES, newId, type CommandInput, type CommandName, type Mutation, type View } from '@sh/shared'
import { describe, expect, it } from 'vitest'
import { company, day, m, ok, person, phone, today, year, checks, leaveSpanFrom } from './company.ts'

/**
 * The device and the server can't drift (audit, 18 October 2026, finding
 * 26). Offline, a device lays each change it's waiting to send over its
 * copy, so the person sees it at once (shared/src/sync/*-view.ts); the
 * server applies the same command with its own handlers. Each case here
 * makes one change on a phone with no signal, keeps what every screen
 * would show, lets it sync, and checks the screens show the same once the
 * server's answer is in: what was shown as waiting is what was saved.
 *
 * Compared: every part of the view, records in full and the records they
 * point to by id, with what only a waiting change has (the `pending`
 * flags) and the clock (made at, saved at: the server's own) left out.
 * What the device can't know before the server answers, such as a new
 * private link or a label run's numbers, is named in the case.
 */

const ISO_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/

/** What says a change is still waiting: `pending`, `headsPending` and the like. */
const WAITING = /^pending|Pending$/

/** Ids a device makes afresh each time it works something out, for lines not saved yet: kit from the notes. */
const MADE_AFRESH = [/\.plan\.lines\.\d+\.id$/]

/**
 * Everything a screen could read of the view, as plain data: records in
 * full, and inside a record the records it points to by their id, which
 * are compared where they're listed themselves. Maps become their entries,
 * functions and the waiting flags are left out, and times are the server's.
 */
function shown(view: View, ignore: readonly string[] = []): unknown {
  const skip = new Set(['cursor', 'problems', 'connection', ...ignore])
  const walk = (v: unknown, inRecord: boolean, path: string): unknown => {
    if (typeof v === 'string') return ISO_TIME.test(v) ? '<time>' : v
    if (v === null || typeof v !== 'object') return typeof v === 'function' ? undefined : v
    if (v instanceof Map) return [...v.entries()].map(([k, x]) => [k, walk(x, inRecord, `${path}.${k}`)])
    if (v instanceof Set) return [...v].map((x, i) => walk(x, inRecord, `${path}.${i}`))
    if (Array.isArray(v)) return v.map((x, i) => walk(x, inRecord, `${path}.${i}`))
    const id = (v as { id?: unknown }).id
    if (inRecord && typeof id === 'string') return `#${id}`
    const out: Record<string, unknown> = {}
    for (const key of Object.keys(v).sort()) {
      if (skip.has(key) || WAITING.test(key) || MADE_AFRESH.some((re) => re.test(`${path}.${key}`))) continue
      const x = walk((v as Record<string, unknown>)[key], inRecord || typeof id === 'string', `${path}.${key}`)
      if (x !== undefined) out[key] = x
    }
    return out
  }
  return walk(view, false, '')
}

/** The paths at which two shown views differ, with each side. */
function differences(a: unknown, b: unknown, path = ''): string[] {
  if (Object.is(a, b)) return []
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null || Array.isArray(a) !== Array.isArray(b))
    return [`${path || '.'}: shown waiting ${JSON.stringify(a)?.slice(0, 300)}, saved ${JSON.stringify(b)?.slice(0, 300)}`]
  const keys = new Set([...Object.keys(a), ...Object.keys(b)])
  return [...keys].flatMap((k) => differences((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k], `${path}.${k}`))
}

interface Case<N extends CommandName = CommandName> {
  name: N
  /** What it's checking, when one command has several. */
  as?: string
  args: CommandInput<N>
  /** Made on the server first, as the office would. */
  before?: Mutation[]
  /** Fields only the server can fill in, left out of the comparison. */
  ignore?: string[]
  /** Drift found and not put right yet: each must still be there, so whoever fixes it takes it off. */
  known?: RegExp[]
}

const c = <N extends CommandName>(name: N, args: CommandInput<N>, more: Omit<Case<N>, 'name' | 'args'> = {}): Case => ({ name, args, ...more }) as Case

/**
 * One change made with no signal, then synced: what the device showed while
 * it waited, and what it shows once the server has applied it.
 */
async function run(k: Case) {
  const { app } = await company()
  if (k.before?.length) await ok(app, ...k.before)
  const { client, signal } = await phone(app)
  signal.on = false
  await client.mutate(k.name, k.args as never)
  const waiting = shown(client.view(), k.ignore)
  signal.on = true
  await client.sync()
  await client.sync()
  expect(client.view().problems.map((p) => p.reason.message), 'the server turned it down').toEqual([])
  expect(client.view().pendingCount).toBe(0)
  const saved = shown(client.view(), k.ignore)
  const drift = differences(waiting, saved)
  for (const re of k.known ?? []) expect(drift.some((d) => re.test(d.split(':')[0]!)), `known drift ${re} is gone: take it off the case`).toBe(true)
  return drift.filter((d) => !(k.known ?? []).some((re) => re.test(d.split(':')[0]!)))
}

/**
 * Drift: a crew call keeps its own copy of its job's name, its phase's and
 * its venue's (name and address), which the server writes from the job when
 * the call is made and again when the job, phase or venue changes. The
 * device shows the call's words as sent, and as they were, until it syncs;
 * so does each person's Worked list, built from them.
 */
const CALL_NAMES = /^\.crew\.calls\.\d+\.(project|phase|venue)$|\.worked\.\d+\.name$/

const DELIVERY = { id: 'd1', kind: 'other' as const, what: 'Delivery', ref: null, group: '', qty: 1, days: 1, unitCents: 15000, vat: '13.5' as const }

const CASES: Case[] = [
  // People and crew.
  c('person.upsert', { id: 'dara', name: 'Dara Quinn', kind: 'freelancer', email: 'dara@example.ie', phone: '+353861111111', skills: ['Audio', 'LX'], dayRateCents: 35000, notes: 'Prefers mornings', department: 'audio', level: 4, knownAs: 'D' }, { as: 'an edit' }),
  c('person.upsert', { id: 'niamh', name: 'Niamh Walsh', kind: 'freelancer', email: 'niamh@example.com', phone: null, skills: [], dayRateCents: null, notes: '' }, { as: 'someone new', ignore: ['linkToken'] }),
  c('person.level', { id: 'eimear', level: 5 }),
  c('person.role', { id: 'aoife', role: 'office' }),
  c('person.archive', { id: 'eimear', archived: true }, { before: [m('offer.cancel', { id: 'eimear-sound' })] }),
  c('person.contact', { id: 'eimear', phone: '+353869999999' }),
  c('unavailability.add', { id: newId(), personId: 'dara', start: day(12), end: day(13), note: 'Wedding' }),
  c('unavailability.remove', { id: 'away' }),
  c('call.create', { id: 'lx', projectId: 'gala', phaseId: 'show', project: 'Autumn Gala', phase: 'Show', venue: 'Northbank', role: 'LX op', start: day(5), end: day(5), callTime: '09:00', needed: 1, dayRateCents: 30000, details: 'Bring a torch', replyBy: day(2), department: 'lighting' }, { known: [CALL_NAMES] }),
  c('call.update', { id: 'sound', needed: 3, callTime: '07:30', details: 'Load in at the back' }),
  c('call.cancel', { id: 'chief' }, { before: [m('offer.cancel', { id: 'aoife-chief' })] }),
  c('call.department', { ids: ['sound', 'chief'], department: 'audio' }),
  c('offer.send', { id: 'cian-sound', callId: 'sound', personId: 'cian', override: false }),
  c('offer.respond', { id: 'eimear-sound', answer: 'accept', days: null, note: 'See you there' }, { as: 'accepted' }),
  c('offer.respond', { id: 'eimear-sound', answer: 'decline', note: 'Away' }, { as: 'declined' }),
  c('offer.respond', { id: 'eimear-sound', answer: 'counter', counterRateCents: 36000, days: null, note: '' }, { as: 'countered' }),
  c('offer.respond', { id: 'dara-sound', answer: 'pullOut', note: 'Sick' }, { as: 'pulled out' }),
  c('offer.confirm', { id: 'eimear-sound' }, { before: [m('offer.respond', { id: 'eimear-sound', answer: 'accept', days: null, note: '' })] }),
  c('offer.cancel', { id: 'eimear-sound' }),
  c('offer.seen', { id: 'eimear-sound' }, { before: [m('offer.respond', { id: 'eimear-sound', answer: 'decline', note: '' })] }),
  c('person.merge', { id: 'dara', from: ['niamh'] }, { before: [person('niamh', 'Dara Q', 'freelancer', { email: 'dq@example.com' })] }),
  c('person.mainEmail', { id: 'dara', email: 'dq@example.com' }, { before: [person('niamh', 'Dara Q', 'freelancer', { email: 'dq@example.com' }), m('person.merge', { id: 'dara', from: ['niamh'] })] }),

  // Jobs.
  c('client.upsert', { id: 'bw', name: 'Brightwater Events Ltd', contacts: [{ name: 'Orla Byrne', role: 'Producer', email: 'orla@example.com', phone: '+35315550000' }], notes: 'Pays in 30 days' }),
  c('venue.upsert', { id: 'nb', name: 'Northbank Centre', address: 'North Wall Quay, Dublin 1', notes: 'Dock at the back' }, { known: [CALL_NAMES] }),
  c('venue.pin', { id: 'nb', pin: { lat: 53.3478, lng: -6.2297 } }),
  // The server writes the defaults a device leaves out; every reader goes through kindOf and kitDaysOf, which give the same.
  c('project.create', { id: 'new', name: 'Winter Ball', clientId: 'bw', venueId: 'nb', status: 'enquiry', notes: '' }, { ignore: ['kind', 'prepDays', 'returnDays'] }),
  c('project.update', { id: 'gala', name: 'Autumn Gala 2026', status: 'quoted', notes: 'Black tie' }, { known: [CALL_NAMES] }),
  c('project.update', { id: 'gala', prepDays: 2, returnDays: 0 }, { as: 'days to get kit ready' }),
  c('phase.add', { id: 'out', projectId: 'gala', name: 'Load out', start: day(6), end: day(6), venueId: 'nb', notes: '' }),
  c('phase.update', { id: 'show', name: 'Show day', start: day(6), end: day(6), moveCrew: true }, { known: [CALL_NAMES] }),
  c('phase.remove', { id: 'launch' }),
  c('project.merge', { id: 'gala', from: ['dup'], name: 'Autumn Gala' }, {
    before: [m('project.create', { id: 'dup', name: 'Autumn Gala (2)', clientId: 'bw', venueId: null, status: 'confirmed', notes: '' }), m('phase.add', { id: 'dupday', projectId: 'dup', name: 'Prep', start: day(2), end: day(2), venueId: null, notes: '' })],
  }),

  // Stock.
  c('model.create', { id: 'sharpy', name: 'Clay Paky Sharpy', department: 'lighting', category: 'Moving heads', tracking: 'serialised', isCase: false, valueCents: 400000, notes: '' }),
  c('model.update', { id: 'xlr', name: 'XLR 10m', category: 'Cable', valueCents: 1500 }),
  c('model.remove', { id: 'unused' }, { before: [m('model.create', { id: 'unused', name: 'Old desk', department: 'audio', category: 'Desks', tracking: 'bulk', isCase: false, valueCents: null, notes: '' })] }),
  c('model.mistake', { id: 'unused' }, { before: [m('model.create', { id: 'unused', name: 'Old desk', department: 'audio', category: 'Desks', tracking: 'bulk', isCase: false, valueCents: null, notes: '' })] }),
  // Racks (ADR 0074).
  c('model.create', { id: 'monrack', name: 'Monitor rack', department: 'audio', category: 'Racks', tracking: 'serialised', isCase: true, isRack: true, code: 'RK-MON', units: 12, depthMm: 450, weightKg: 18.25, powerW: null, valueCents: null, notes: '' }, { as: 'a rack' }),
  c('model.update', { id: 'rack', isRack: true, units: 12, depthMm: 500, code: ' RK-AMP ' }, { as: 'made a rack, its kit no longer free on its own' }),
  c('model.update', { id: 'y10p', units: 2, depthMm: 300, weightKg: 12.4, powerW: 0 }, { as: 'a size' }),
  c('rackSlot.set', { id: 's1', rackId: 'rack', modelId: 'y10p', top: 3, side: 'front', qty: 1, notes: ' Top ' }, { as: 'on the rails', before: [m('model.update', { id: 'rack', isRack: true, units: 4 })] }),
  c('rackSlot.set', { id: 's2', rackId: 'rack', modelId: 'xlr', top: null, side: 'front', qty: 6, notes: '' }, { as: 'loose', before: [m('model.update', { id: 'rack', isRack: true })] }),
  c('rackSlot.set', { id: 's3', rackId: 'rack', modelId: 'y10p', top: 2, side: 'front', qty: 1, notes: '', across: 'right', label: ' Mon 1 ', group: ' Monitors ', colour: 'green' }, { as: 'labelled across', before: [m('model.update', { id: 'rack', isRack: true, units: 4 }), m('model.update', { id: 'y10p', rackMount: true, units: 1, rackWidth: 'half' })] }),
  c('rackSlot.set', { id: 's4', rackId: 'rack', modelId: 'xlr', top: null, side: 'front', qty: 4, notes: '', inSlotId: 'dr' }, { as: 'in a drawer', before: [m('model.update', { id: 'rack', isRack: true, units: 4 }), m('model.create', { id: 'drw', name: 'Drawer', department: 'audio', category: 'Rack parts', tracking: 'bulk', isCase: false, valueCents: null, notes: '', rackMount: true, units: 2, rackPart: 'drawer' }), m('rackSlot.set', { id: 'dr', rackId: 'rack', modelId: 'drw', top: 3, side: 'front', qty: 1, notes: '' })] }),
  c('rackSlot.remove', { id: 's1' }, { before: [m('model.update', { id: 'rack', isRack: true }), m('rackSlot.set', { id: 's1', rackId: 'rack', modelId: 'y10p', top: 1, side: 'rear', qty: 1, notes: '' })] }),
  // Dry hire stock (ADR 0075).
  c('model.create', { id: 'haze', name: 'MDG ATMe', department: 'lighting', category: 'Haze', tracking: 'serialised', isCase: false, dryHire: true, supplier: ' PRG ', hireDayCents: 4500, valueCents: 350000, notes: '' }, { as: 'dry hire' }),
  c('model.update', { id: 'unused', dryHire: true, supplier: 'Stage Hire Co' }, { as: 'made dry hire', before: [m('model.create', { id: 'unused', name: 'Old desk', department: 'audio', category: 'Desks', tracking: 'bulk', isCase: false, valueCents: null, notes: '' })] }),
  c('kit.add', { id: 'hazer', projectId: 'gala', phaseId: null, modelId: 'haze', qty: 2, subhireQty: 0, supplier: '', notes: '' }, { as: 'dry hire, never short', before: [m('model.create', { id: 'haze', name: 'MDG ATMe', department: 'lighting', category: 'Haze', tracking: 'serialised', isCase: false, dryHire: true, supplier: 'PRG', hireDayCents: null, valueCents: null, notes: '' })] }),
  c('model.create', { id: 'xta', name: 'XTA DP448', department: 'audio', category: 'Processing', tracking: 'serialised', isCase: false, valueCents: null, notes: '', rackMount: true, units: 1, rackWidth: 'half', depthMm: 300 }, { as: 'rack-mount' }),
  c('model.create', { id: 'fx', name: 'FX rack', department: 'audio', category: 'Racks', tracking: 'serialised', isCase: true, isRack: true, valueCents: null, notes: '', units: 8, depthMm: 500, caseWidthMm: 600, caseHeightMm: 520, caseDepthMm: 650, castors: true, powerLimitA: 16 }, { as: 'a rack case' }),
  c('model.create', { id: 'bl', name: '1U blank', department: 'audio', category: 'Rack parts', tracking: 'bulk', isCase: false, valueCents: null, notes: '', rackMount: true, units: 1, rackPart: 'blank' }, { as: 'a rack part' }),
  c('model.update', { id: 'unused', rackMount: true, units: 1, rackPart: 'vent' }, { as: 'made a rack part', before: [m('model.create', { id: 'unused', name: 'Old vent', department: 'audio', category: 'Rack parts', tracking: 'bulk', isCase: false, valueCents: null, notes: '' })] }),
  c('model.update', { id: 'unused', rackMount: true, units: 2, rackWidth: 'third' }, { as: 'made rack-mount', before: [m('model.create', { id: 'unused', name: 'Old desk', department: 'audio', category: 'Desks', tracking: 'bulk', isCase: false, valueCents: null, notes: '' })] }),
  c('place.upsert', { id: 'van-shelf', name: 'Van shelf', notes: '' }),
  c('place.remove', { id: 'bay' }),
  c('asset.add', { id: 'a3', modelId: 'y10p', number: 'SH-000004', serial: 'Y3', placeId: 'bay', caseId: null, notes: '', fromCount: false }),
  c('asset.update', { id: 'a1', serial: 'Y1-B', notes: 'New grille' }),
  c('asset.move', { id: 'a1', placeId: null, caseId: 'r1' }, { as: 'into a case' }),
  c('asset.move', { id: 'a1', placeId: 'bay', caseId: null }, { as: 'to a place' }),
  c('asset.relabel', { id: 'a1', number: 'SH-000009' }),
  c('asset.retire', { id: 'a2', reason: 'scrapped', note: 'Beyond repair' }),
  c('asset.reinstate', { id: 'a2' }, { before: [m('asset.retire', { id: 'a2', reason: 'lost', note: '' })] }),
  c('stock.set', { modelId: 'xlr', placeId: 'bay', caseId: null, qty: 5 }),
  c('stock.move', { modelId: 'xlr', fromPlaceId: 'wh', fromCaseId: null, toPlaceId: 'bay', toCaseId: null, qty: 4 }),

  // Kit on jobs, and from the notes.
  c('kit.add', { id: 'more', projectId: 'gala', phaseId: 'build', modelId: 'y10p', qty: 1, subhireQty: 0, supplier: '', notes: '' }),
  c('kit.add', { id: 'short', projectId: 'gala', phaseId: null, modelId: 'y10p', qty: 6, subhireQty: 2, supplier: ' PRG ', notes: 'Side fill' }, { as: 'short, some subhired' }),
  c('kit.update', { id: 'pa', qty: 3, phaseId: 'show', supplier: 'PRG', subhireQty: 1 }),
  c('kit.remove', { id: 'cables' }),
  c('kit.fromNotes', {
    jobs: [{ projectId: 'enq', sum: 'set below', lines: [{ id: 'n1', phaseId: null, modelId: 'y10p', qty: 4, notes: '' }, { id: 'n2', phaseId: null, modelId: 'xlr', qty: 10, notes: '' }] }],
    names: [{ text: 'Mystery haze machine', modelId: null }],
  }),

  // Labels, moves, faults and inspections.
  // The numbers are the server's to give out (ADR 0015): a device shows the run without them, and the next free number as it knew it.
  c('labels.reserve', { id: 'run2', count: 5, name: 'Cases', notes: '' }, { ignore: ['first', 'firstNumber', 'lastNumber', 'next'] }),
  c('labels.update', { id: 'run1', name: 'Speakers and subs', notes: 'Roll 2' }),
  c('labels.cancel', { id: 'run1' }),
  c('move.record', { id: newId(), projectId: 'gala', direction: 'out', assetId: 'a1', modelId: 'y10p', qty: 1, at: new Date().toISOString() }, { as: 'an item out' }),
  c('move.record', { id: newId(), projectId: 'gala', direction: 'out', assetId: null, modelId: 'xlr', qty: 6, at: new Date().toISOString() }, { as: 'counted kit out' }),
  c('fault.report', { id: 'f2', kind: 'missing', assetId: null, modelId: 'xlr', qty: 2, projectId: 'gala', usable: false, note: 'Not back from the gala', at: new Date().toISOString() }),
  c('fault.update', { id: 'f1', usable: false, note: 'Grille dented, cone torn', repair: 'Sent to d&b' }),
  c('fault.close', { id: 'f1', outcome: 'fixed', at: new Date().toISOString() }),
  c('inspection.record', { id: newId(), assetId: 'a1', kind: 'pat', passed: true, at: new Date().toISOString(), by: 'Cian', note: '' }),
  c('inspection.record', { id: newId(), assetId: 'a1', kind: 'pat', passed: false, at: new Date().toISOString(), by: 'Cian', note: 'Earth fault' }, { as: 'failed' }),
  c('count.record', {
    id: newId(),
    placeId: 'wh',
    caseId: null,
    startedAt: new Date().toISOString(),
    finishedAt: new Date().toISOString(),
    by: 'cian',
    items: [
      { assetId: 'a1', said: 'found', scanned: true },
      { assetId: 'a2', said: 'not-found', scanned: false },
    ],
    unknown: [],
    products: [{ modelId: 'xlr', recorded: 20, counted: 18, away: 0 }],
    summary: { expected: 3, found: 1, notFound: 1, elsewhere: 0, unexpected: 0, uncounted: 1, short: 2, over: 0 },
  }),

  // Timesheets.
  c('timesheet.send', { id: 'dara-then', days: [day(-3)], extras: [], note: 'Only the first day' }),
  c('timesheet.approve', { id: 'dara-then', days: [day(-3), day(-2)], dayRateCents: 32000, extras: [{ what: 'Parking', cents: 1500 }], officeNote: '' }),
  c('timesheet.reopen', { id: 'dara-then' }, { before: [m('timesheet.approve', { id: 'dara-then', days: [day(-3), day(-2)], dayRateCents: 32000, extras: [], officeNote: '' })] }),

  // The office.
  c('office.update', { name: 'Session Hire', phone: '+35315551234', email: 'office@sessionhire.com' }),
  c('reading.heads', { rates: true }),
  c('messages.prompt', { on: false }),

  // Leave and time in lieu.
  c('leave.request', { id: 'more-hol', personId: 'aoife', type: 'annual', ...leaveSpanFrom(40), note: 'Family' }),
  c('leave.cancel', { id: 'hol', by: 'aoife' }),
  c('leave.decide', { id: 'hol', approved: true, reason: '', by: 'cian' }, { as: 'approved' }),
  c('leave.decide', { id: 'hol', approved: false, reason: 'Busy week', by: 'cian' }, { as: 'turned down' }),
  c('lieu.log', { id: 'sat', personId: 'aoife', day: day(-5), days: 1, note: 'Saturday load out' }),
  c('lieu.cancel', { id: 'sat', by: 'aoife' }, { before: [m('lieu.log', { id: 'sat', personId: 'aoife', day: day(-5), days: 1, note: '' })] }),
  c('lieu.decide', { id: 'sat', approved: true, reason: '', by: 'cian' }, { before: [m('lieu.log', { id: 'sat', personId: 'aoife', day: day(-5), days: 1, note: '' })] }),
  c('leave.open', { year: year + 1, by: 'aoife' }),
  c('leave.allowance', { personId: 'aoife', year, days: 23, carriedOver: 2, note: 'Two carried over', by: 'cian' }),

  // Running late, on the day.
  c('late.say', { id: 'late1', offerId: 'dara-now', day: today, by: '30', arriveAt: null, note: 'Traffic' }),
  c('late.arrived', { id: 'late1' }, { before: [m('late.say', { id: 'late1', offerId: 'dara-now', day: today, by: '15', arriveAt: null, note: '' })] }),
  c('late.seen', { id: 'late1' }, { before: [m('late.say', { id: 'late1', offerId: 'dara-now', day: today, by: '15', arriveAt: null, note: '' })] }),

  // Documents and venues' and clients' files.
  c('document.save', { id: 'ins', personId: 'dara', kind: 'insurance', title: 'Public liability', expires: day(200) }),
  c('document.check', { id: 'ins', expires: day(250) }, { before: [m('document.save', { id: 'ins', personId: 'dara', kind: 'insurance', title: 'Public liability', expires: day(200) })] }),
  c('document.remove', { id: 'ins' }, { before: [m('document.save', { id: 'ins', personId: 'dara', kind: 'insurance', title: 'Public liability', expires: day(200) })] }),
  c('attachment.save', { id: 'spec', owner: 'client', ownerId: 'bw', kind: 'brief', title: 'Brief', link: 'https://example.com/brief' }),
  c('attachment.remove', { id: 'plan' }),

  // Money.
  c('quote.save', { id: 'q2', projectId: 'gala', lines: [{ id: 'l1', kind: 'kit', what: 'd&b Y10P', ref: 'y10p', group: 'Audio', qty: 4, days: 3, unitCents: 4500, vat: '23' }, { id: 'l2', kind: 'other', what: 'Delivery', ref: null, group: '', qty: 1, days: 1, unitCents: 15000, vat: '13.5' }], discountPct: 5, notes: 'Second go' }, { as: 'a new version' }),
  c('quote.save', { id: 'q3', projectId: 'enq', lines: [DELIVERY], discountPct: 0, notes: '' }, { as: 'a first draft' }),
  c('quote.sent', { id: 'q3', on: today }, { before: [m('quote.save', { id: 'q3', projectId: 'enq', lines: [DELIVERY], discountPct: 0, notes: '' })] }),
  c('quote.sent', { id: 'q3', on: today }, { as: 'numbered after the next number set', before: [m('quoting.update', { nextNumber: 1115, terms: 'Half up front.', bank: 'IBAN IE00 0000' }), m('quote.save', { id: 'q3', projectId: 'enq', lines: [DELIVERY], discountPct: 0, notes: '', validDays: 14, depositPct: 50 })] }),
  c('quoting.update', { nextNumber: 1115, terms: 'Half up front.', bank: 'IBAN IE00 0000' }),
  c('quote.answer', { id: 'q1', answer: 'accepted', on: today }, { as: 'accepted' }),
  c('quote.answer', { id: 'q1', answer: 'declined', on: today }, { as: 'declined' }),
  c('quote.answer', { id: 'q1', answer: 'none', on: today }, { as: 'taken back', before: [m('quote.answer', { id: 'q1', answer: 'accepted', on: today })] }),
  c('quote.invoiced', { id: 'q1', on: today, ref: 'SH-1042' }, { before: [m('quote.answer', { id: 'q1', answer: 'accepted', on: today })] }),
  c('quote.paid', { id: 'q1', on: today }, { before: [m('quote.answer', { id: 'q1', answer: 'accepted', on: today }), m('quote.invoiced', { id: 'q1', on: today, ref: 'SH-1042' })] }),
  c('price.product', { modelId: 'xlr', dayCents: 300 }),
  c('price.product', { modelId: 'y10p', dayCents: null }, { as: 'taken off' }),
  c('price.role', { role: '  Sound   No.1 ', dayCents: 35000 }),
  c('price.client', { clientId: 'bw', pct: 10 }),
  c('cost.paid', { id: 'dara-then', on: today }, { before: [m('timesheet.approve', { id: 'dara-then', days: [day(-3), day(-2)], dayRateCents: 32000, extras: [], officeNote: '' })] }),

  // Vans.
  c('vehicle.save', { id: 'van', name: 'Big Van', registration: '241-d-101', kind: 'van', seats: 2, payloadKg: 1100, notes: 'Roof rack', checks }, { as: 'an edit' }),
  c('vehicle.save', { id: 'luton', name: 'Luton', registration: '231-D-55', kind: 'luton', seats: 3, payloadKg: 1000, notes: '', checks }, { as: 'a new one' }),
  c('vehicle.offRoad', { id: 'van', out: { since: day(3), until: day(4), note: 'Clutch' } }),
  c('vehicle.archive', { id: 'van', archived: true }, { before: [m('vehicleBooking.remove', { id: 'run' })] }),
  c('vehicleBooking.add', { id: 'run2', vehicleId: 'van', projectId: 'gala', phaseId: 'show', start: day(5), end: day(5), driverId: null, notes: '', override: false }),
  c('vehicleBooking.update', { id: 'run', start: day(4), end: day(4), driverId: null, notes: 'Collect from Bay A1' }),
  c('vehicleBooking.remove', { id: 'run' }),

  // A job's steps (ADR 0073).
  c('jobStep.set', { projectId: 'gala', step: 'deprep', ownerId: 'aoife' }, { as: 'given to someone' }),
  c('jobStep.set', { projectId: 'gala', step: 'kit', done: true, by: 'cian' }, { as: 'ticked' }),
  c('jobStep.set', { projectId: 'gala', step: 'kit', done: false, ownerId: null }, { as: 'the tick and the name taken off', before: [m('jobStep.set', { projectId: 'gala', step: 'kit', ownerId: 'cian', done: true })] }),

  // The purchase list (ADR 0077).
  c('purchase.ask', { id: 'nl4t', title: '  NL4T connectors ', details: '20', link: 'thomann.de/ie/nl4t.htm', department: 'audio', by: 'aoife' }),
  c('purchase.update', { id: 'nl4t', details: '24, and 4 spare', link: '' }, { before: [m('purchase.ask', { id: 'nl4t', title: 'NL4T connectors', details: '20', link: '', department: 'Audio', by: 'aoife' })] }),
  c('purchase.status', { id: 'nl4t', status: 'ordered', notes: 'From Thomann' }, { before: [m('purchase.ask', { id: 'nl4t', title: 'NL4T connectors', details: '20', link: '', department: 'Audio', by: 'aoife' })] }),
  c('purchase.vote', { requestId: 'nl4t', vote: true, by: 'cian' }, { as: 'a vote', before: [m('purchase.ask', { id: 'nl4t', title: 'NL4T connectors', details: '20', link: '', department: 'Audio', by: 'aoife' })] }),
  c('purchase.vote', { requestId: 'nl4t', vote: false, by: 'cian' }, { as: 'a vote taken back', before: [m('purchase.ask', { id: 'nl4t', title: 'NL4T connectors', details: '20', link: '', department: 'Audio', by: 'aoife' }), m('purchase.vote', { requestId: 'nl4t', vote: true, by: 'cian' })] }),
  c('purchase.remove', { id: 'nl4t' }, { before: [m('purchase.ask', { id: 'nl4t', title: 'NL4T connectors', details: '20', link: '', department: 'Audio', by: 'aoife' }), m('purchase.vote', { requestId: 'nl4t', vote: true, by: 'aoife' })] }),
  c('purchase.bringIn', {
    requests: [
      { id: 'buy-1', title: 'Mic cable', details: '60 × 10 m', link: '', department: 'Audio', askedBy: 'dara', askedByName: 'Dara', askedOn: day(-180), status: 'ordered', notes: 'On the April order' },
      { id: 'nl4t', title: 'NL4T', details: '', link: '', department: null, askedBy: null, askedByName: 'Smokey', askedOn: day(-180), status: 'asked', notes: '' },
    ],
  }, { as: 'a list, with one already in', before: [m('purchase.ask', { id: 'nl4t', title: 'NL4T connectors', details: '20', link: '', department: 'Audio', by: 'aoife' })] }),
]

/**
 * Not run here, as a waiting copy can't show them the way the server does,
 * by design: a new private link is made on the server, so a device has no
 * secret to show (person.newLink); an erasure takes a person's details from
 * every table on the server, and a device shows them erased while it waits
 * (person.erase, ADR 0027, tested in erasure.test.ts); and stopping a
 * freelancer's own calendar is read by the server only (ownCalendar.stop).
 */
const NOT_LAID_OVER: CommandName[] = ['person.newLink', 'person.erase', 'ownCalendar.stop']

describe('a change shown while it waits, and once the server has it', () => {
  it('covers every command', async () => {
    const covered = new Set<string>([...CASES.map((k) => k.name), ...NOT_LAID_OVER])
    expect(COMMAND_NAMES.filter((n) => !covered.has(n))).toEqual([])
  })

  for (const k of CASES)
    it(`${k.name}${k.as ? `, ${k.as}` : ''}`, async () => {
      const drift = await run(k)
      expect(drift, drift.join('\n')).toEqual([])
    })
})
