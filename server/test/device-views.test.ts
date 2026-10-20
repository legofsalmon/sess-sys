import { costsCsv } from '@sh/shared'
import { describe, expect, it } from 'vitest'
import { company, day, m, ok, phone, today } from './company.ts'

/**
 * What a device works out for itself from its copy (audit, 18 October 2026,
 * finding 26): the money view and the freelancers' costs file for the
 * accountant (ADR 0042), kit read from jobs' notes (ADR 0043), and vans
 * and their drivers (ADR 0047), each with this phone's own changes laid
 * over it while it has no signal.
 */

const whole = { start: '2000-01-01', end: '2999-12-31', label: 'All' }

/** A CSV file's rows, without the mark Excel needs to read UTF-8 or the last line's ending. */
const rows = (csv: string) => csv.replace(/^\uFEFF/, '').split('\r\n').filter(Boolean)

describe('money on a device', () => {
  it("lists a freelancer's approved timesheet in the accountant's costs file, with who they trade as, and when it's paid", async () => {
    const { app } = await company()
    await ok(app, m('timesheet.approve', { id: 'dara-then', days: [day(-3), day(-2)], dayRateCents: 32000, extras: [{ what: 'Parking', cents: 1500 }], officeNote: '' }))
    const { client, signal } = await phone(app)
    const money = client.view().money
    expect(money.costsOwed.map((c) => [c.row.offer.id, c.cents, c.paidOn])).toEqual([['dara-then', 65500, undefined]])
    const header = 'Approved on,Freelancer,Trading as,VAT number,Job,Role,Days,Day rate (EUR),Fees (EUR),Extras (EUR),Total (EUR),Paid on'
    expect(rows(costsCsv(money, whole))).toEqual([header, `${today},Dara Quinn,Quinn Audio Ltd,IE1234567T,Harbour Lights,Sound No.1,2,320.00,640.00,15.00,655.00,`])
    // Only what was approved within the period.
    expect(rows(costsCsv(money, { start: day(1), end: day(30), label: 'Later' }))).toEqual([header])
    // By the month of the last day worked.
    expect(money.months.find((mo) => mo.costs)?.key).toBe(day(-2).slice(0, 7))

    // Marked paid with no signal: shown paid at once, and in the file.
    signal.on = false
    await client.mutate('cost.paid', { id: 'dara-then', on: today })
    const paid = client.view().money
    expect(paid.costsOwed).toEqual([])
    expect(paid.costsPaid.map((c) => [c.row.offer.id, c.paidOn, c.pending])).toEqual([['dara-then', today, true]])
    expect(rows(costsCsv(paid, whole))[1]!.endsWith(`,655.00,${today}`)).toBe(true)
    // Taken back, it's owed again.
    await client.mutate('cost.paid', { id: 'dara-then', on: null })
    expect(client.view().money.costsOwed.map((c) => [c.row.offer.id, c.paidOn, c.pending])).toEqual([['dara-then', undefined, true]])
  })

  it("counts freelancers booked and not yet paid against a job's quote, and leaves staff out", async () => {
    const { app } = await company()
    const { client } = await phone(app)
    const money = client.view().money
    // Dara is booked on two of the gala's calls at €320 a day; Aoife is staff, Eimear only offered.
    expect(money.job('gala')).toMatchObject({ quoted: 27000, costs: 0, toCome: 64000, margin: 27000 - 64000 })
    expect(money.job('gala')?.current?.id).toBe('q1')
    // A timesheet sent and not approved is still to come, as sent; with no quote there's no margin.
    expect(money.job('past')).toMatchObject({ quoted: 0, costs: 0, toCome: 65500, margin: null })
    expect(money.months.find((mo) => mo.quoted)).toMatchObject({ key: today.slice(0, 7), quoted: 27000, confirmed: 0, invoiced: 0 })
  })

  it("builds a new quote from the job's kit and its open calls", async () => {
    const { app } = await company()
    const { client } = await phone(app)
    const { kit, crew } = client.view().money.sourceOf('gala')
    expect(kit.map((k) => [k.id, k.name, k.group, k.qty, k.phase ?? null])).toEqual(
      expect.arrayContaining([
        ['pa', 'd&b Y10P', 'Audio', 2, null],
        ['cables', 'XLR 10 m', 'Audio', 8, 'Show'],
      ])
    )
    expect(kit.find((k) => k.id === 'cables')?.days).toBe(1)
    expect(crew.map((c) => [c.id, c.role, c.needed, c.days, c.bookedCents]).sort()).toEqual([
      ['chief', 'Crew chief', 1, 2, null],
      ['now', 'Warehouse', 1, 1, 32000],
      ['sound', 'Sound No.1', 2, 1, 32000],
    ])
    expect(client.view().money.sourceOf('no-such-job')).toEqual({ kit: [], crew: [] })
  })

  it('shows prices set with no signal at once, and says each is waiting', async () => {
    const { app } = await company()
    const { client, signal } = await phone(app)
    signal.on = false
    await client.mutate('price.role', { role: ' sound  no.1', dayCents: 35000 })
    await client.mutate('price.client', { clientId: 'bw', pct: 10 })
    await client.mutate('price.product', { modelId: 'y10p', dayCents: null })
    const money = client.view().money
    expect(money.rolePrice('Sound No.1')).toBe(35000)
    expect(money.roles.find((r) => r.role === 'sound no.1')).toMatchObject({ cents: 35000, booked: 32000 })
    expect(money.roles.find((r) => r.role === 'Crew chief')).toMatchObject({ cents: undefined, booked: undefined })
    expect(money.discountOf('bw')).toBe(10)
    expect(money.discountOf(null)).toBeUndefined()
    expect(money.productPrice('y10p')).toBeUndefined()
    expect([money.pricePending('role', 'Sound No.1'), money.pricePending('client', 'bw'), money.pricePending('product', 'y10p'), money.pricePending('product', 'xlr')]).toEqual([true, true, true, false])
    // Taken off again: none set.
    await client.mutate('price.client', { clientId: 'bw', pct: null })
    await client.mutate('price.role', { role: 'Sound No.1', dayCents: null })
    expect([client.view().money.discountOf('bw'), client.view().money.rolePrice('sound no.1')]).toEqual([undefined, undefined])
  })

  it("follows a quote through accepted, invoiced and paid with no signal, and what's owed with it", async () => {
    const { app } = await company()
    const { client, signal } = await phone(app)
    signal.on = false
    await client.mutate('quote.answer', { id: 'q1', answer: 'accepted', on: today })
    let money = client.view().money
    expect(money.owed).toMatchObject([{ client: 'Brightwater Events', clientId: 'bw', cents: 27000 + 6210 }])
    expect(money.months.find((mo) => mo.quoted)).toMatchObject({ confirmed: 27000, invoiced: 0 })
    // Paid before it's invoiced is nothing: the server would turn it down.
    await client.mutate('quote.paid', { id: 'q1', on: today })
    expect(client.view().money.quote('q1')?.paidOn).toBeNull()
    await client.mutate('quote.invoiced', { id: 'q1', on: today, ref: 'SH-1042' })
    money = client.view().money
    expect(money.quote('q1')).toMatchObject({ invoicedOn: today, invoiceRef: 'SH-1042', pending: true })
    expect(money.months.find((mo) => mo.quoted)).toMatchObject({ invoiced: 27000 })
    await client.mutate('quote.paid', { id: 'q1', on: today })
    expect(client.view().money.owed).toEqual([])
    // Once paid, it can't be un-invoiced.
    await client.mutate('quote.invoiced', { id: 'q1', on: null, ref: '' })
    expect(client.view().money.quote('q1')?.invoicedOn).toBe(today)
    // Its answer taken back once invoiced is nothing either.
    await client.mutate('quote.answer', { id: 'q1', answer: 'none', on: today })
    expect(client.view().money.quote('q1')?.status).toBe('accepted')
  })

  it('takes back a quote turned down, and a turned-down quote counts for nothing', async () => {
    const { app } = await company()
    const { client, signal } = await phone(app)
    signal.on = false
    await client.mutate('quote.answer', { id: 'q1', answer: 'declined', on: today })
    expect(client.view().money.job('gala')).toMatchObject({ quoted: 0, margin: null })
    expect(client.view().money.months.find((mo) => mo.quoted)).toBeUndefined()
    await client.mutate('quote.answer', { id: 'q1', answer: 'none', on: today })
    expect(client.view().money.quote('q1')).toMatchObject({ status: 'sent', answeredOn: null })
  })
})

describe('kit from the notes on a device', () => {
  const notes = (id: string, name: string, status: 'confirmed' | 'cancelled', text: string, days?: [number, number]) => [
    m('project.create', { id, name, clientId: null, venueId: null, status, notes: text }),
    ...(days ? [m('phase.add', { id: `${id}-day`, projectId: id, name: 'Show', start: day(days[0]), end: day(days[1]), venueId: null, notes: '' })] : []),
  ]

  it('lists the jobs to work through: coming up soonest first, then those gone by, latest first, then those with no dates', async () => {
    const { app } = await company()
    await ok(
      app,
      ...notes('soon', 'Corporate Lunch', 'confirmed', '2 x d&b Y10P', [8, 8]),
      ...notes('gone', 'Summer Fair', 'confirmed', '2 x d&b Y10P', [-20, -20]),
      ...notes('older', 'Spring Fair', 'confirmed', '2 x d&b Y10P', [-40, -40]),
      ...notes('undated', 'Office Party', 'confirmed', '2 x d&b Y10P'),
      ...notes('off', 'Cancelled Gig', 'cancelled', '2 x d&b Y10P', [9, 9]),
      ...notes('plain', 'No Kit', 'confirmed', 'Bring sandwiches', [10, 10])
    )
    const { client } = await phone(app)
    const view = client.view().notesKit
    expect(view.toDo.map((n) => n.job.id)).toEqual(['soon', 'enq', 'gone', 'older', 'undated'])
    // The launch has a line to choose a product for; the rest match by name.
    expect(view.ready.map((n) => n.job.id)).toEqual(['soon', 'gone', 'older', 'undated'])
    expect(view.forJob('plain')).toBeUndefined()
    expect(view.forJob('no-such-job')).toBeUndefined()
    // The same answer asked twice.
    expect(view.forJob('soon')).toBe(view.forJob('soon'))
    expect(view.forJob('soon')).toMatchObject({ read: false, kit: [], plan: { adding: 1 } })
  })

  it('takes a job off the list once its notes are turned into kit with no signal, and remembers the names chosen', async () => {
    const { app } = await company()
    const { client, signal } = await phone(app)
    const before = client.view().notesKit.forJob('enq')!
    signal.on = false
    await client.mutate('kit.fromNotes', {
      jobs: [{ projectId: 'enq', sum: before.sum, lines: before.plan.lines.map((l) => ({ id: l.id, phaseId: l.phaseId, modelId: l.modelId, qty: l.qty, notes: l.notes })) }],
      names: [{ text: 'Mystery haze machine', modelId: null }],
    })
    const view = client.view().notesKit
    expect(view.toDo.map((n) => n.job.id)).not.toContain('enq')
    expect(view.forJob('enq')).toMatchObject({ read: true })
    expect(view.read.get('enq')).toMatchObject({ sum: before.sum, pending: true })
    expect([...view.names.values()].map((n) => [n.text, n.modelId, n.pending])).toEqual([['Mystery haze machine', null, true]])
    // And the kit is on the job, waiting.
    expect(client.view().kit.byJob.get('enq')?.map((l) => [l.modelId, l.qty]).sort()).toEqual([
      ['xlr', 10],
      ['y10p', 4],
    ])
  })
})

describe('vans on a device', () => {
  it("says what's wrong with each booking: another job, off the road, a driver on two vans, a phase moved, no driver", async () => {
    const { app } = await company()
    await ok(
      app,
      m('vehicle.save', { id: 'car', name: 'Estate', registration: '191-D-7', kind: 'car', seats: 4, payloadKg: null, notes: '', checks: { test: { needed: true, expires: day(100) }, tax: { needed: true, expires: day(100) }, insurance: { needed: true, expires: day(100) }, service: { needed: false, expires: null }, tacho: { needed: false, expires: null } } }),
      // The enquiry has the van pencilled in on the day the gala holds it.
      m('vehicleBooking.add', { id: 'maybe', vehicleId: 'van', projectId: 'enq', phaseId: null, start: day(3), end: day(3), driverId: null, notes: '', override: true }),
      // Cian drives the estate on the same day as the van.
      m('vehicleBooking.add', { id: 'also', vehicleId: 'car', projectId: 'past', phaseId: null, start: day(3), end: day(3), driverId: 'cian', notes: '', override: false })
    )
    const { client, signal } = await phone(app)
    const vans = client.view().vehicles
    const run = vans.bookings.find((b) => b.id === 'run')!
    expect(run.problems.map((p) => p.tone)).not.toContain('bad')
    // Pencilled in on the enquiry is one to watch, not a clash.
    expect(run.problems).toContainEqual({ tone: 'warn', text: expect.stringMatching(/^Also on Spring Launch on .*, if it goes ahead\.$/) })
    expect(run.problems.some((p) => /Cian is also driving Estate/.test(p.text))).toBe(true)
    expect(vans.bookings.find((b) => b.id === 'maybe')?.problems).toContainEqual({ tone: 'quiet', text: 'No driver chosen yet.' })
    expect(vans.clashesWith('van', day(3), day(3), 'run').map((c) => c.booking.id)).toEqual(['maybe'])
    expect(vans.ofJob('gala').map((b) => b.id)).toEqual(['run'])

    // With no signal: the van off the road that day, and the gala's build moved off the booking's day.
    signal.on = false
    await client.mutate('vehicle.offRoad', { id: 'van', out: { since: day(2), until: day(4), note: 'Clutch' } })
    await client.mutate('phase.update', { id: 'build', start: day(10), end: day(11) })
    const off = client.view().vehicles
    expect(off.get('van')).toMatchObject({ outOfService: { since: day(2), until: day(4), note: 'Clutch' }, pending: true })
    const moved = off.bookings.find((b) => b.id === 'run')!
    expect(moved.problems.filter((p) => p.tone === 'bad').length).toBeGreaterThan(0)
    expect(moved.problems.some((p) => p.text.startsWith("Not on its phase's days"))).toBe(true)
  })

  it('shows bookings changed or taken off, and a van retired, with no signal', async () => {
    const { app } = await company()
    const { client, signal } = await phone(app)
    signal.on = false
    await client.mutate('vehicleBooking.update', { id: 'run', start: day(4), end: day(4), driverId: null, notes: 'Collect from Bay A1' })
    let vans = client.view().vehicles
    expect(vans.bookings.find((b) => b.id === 'run')).toMatchObject({ start: day(4), end: day(4), driverId: null, driver: undefined, notes: 'Collect from Bay A1', days: [day(4)], pending: true })
    // A booking this phone hasn't heard of is left as it is.
    await client.mutate('vehicleBooking.update', { id: 'nothing', notes: 'Gone' })
    await client.mutate('vehicleBooking.remove', { id: 'run' })
    vans = client.view().vehicles
    expect(vans.bookings).toEqual([])
    expect(vans.get('van')?.bookings).toEqual([])
    await client.mutate('vehicle.archive', { id: 'van', archived: true })
    vans = client.view().vehicles
    expect(vans.vehicles).toEqual([])
    expect(vans.all.map((v) => [v.id, v.archived, v.pending])).toEqual([['van', true, true]])
    // A van saved again keeps whether it's retired and off the road.
    await client.mutate('vehicle.save', { id: 'van', name: ' Big Van ', registration: '241-d-101', kind: 'van', seats: 3, payloadKg: 1200, notes: '', checks: { test: { needed: true, expires: day(200) } } })
    expect(client.view().vehicles.get('van')).toMatchObject({ name: 'Big Van', registration: '241-D-101', archived: true, outOfService: null })
  })
})
