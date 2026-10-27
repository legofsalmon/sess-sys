import { newId, type NoticesPage, type StepRecord } from '@sh/shared'
import { describe, expect, it } from 'vitest'
import { company, m, ok, phone } from './company.ts'
import { IPHONE, server, staff, WINDOWS } from './people.ts'

/**
 * A job's steps (ADR 0073): from the quote to the kit put away, each given
 * to a member of staff, on their list on Home and in their Notifications;
 * ticked by the app where the job's own records tell it, by hand elsewhere.
 */

const PERSON = { phone: null, skills: [], dayRateCents: null, notes: '' }

async function office() {
  const { app, db } = await server()
  const colly = await staff(app, db, 'Colly Hewson', WINDOWS, 'office-c0ffee')
  const aoife = await staff(app, db, 'Aoife Byrne', IPHONE, 'phone-a1b2c3')
  await colly.send('person.upsert', { id: 'colly', name: 'Colly Hewson', kind: 'staff', email: 'colly@sessionhire.com', ...PERSON })
  await colly.send('person.upsert', { id: 'aoife', name: 'Aoife Byrne', kind: 'staff', email: 'aoife@sessionhire.com', ...PERSON })
  await colly.send('person.upsert', { id: 'dara', name: 'Dara Kelly', kind: 'freelancer', email: null, ...PERSON })
  await colly.send('project.create', { id: 'j1', name: 'Electric Picnic', clientId: null, venueId: null, status: 'confirmed', notes: '' })
  await colly.send('phase.add', { id: 'build', projectId: 'j1', name: 'Build', start: '2026-10-02', end: '2026-10-04', venueId: null, notes: '' })
  return { app, colly, aoife }
}

describe("a job's steps", () => {
  it('are given to staff, ticked by them, and tell them in the app, in the words the history uses', async () => {
    const { app, colly, aoife } = await office()
    expect(await colly.send('jobStep.set', { projectId: 'j1', step: 'deprep', ownerId: 'aoife' })).toMatchObject({ status: 'applied' })
    expect(await colly.record<StepRecord>('jobStep', 'j1.deprep')).toEqual({ id: 'j1.deprep', projectId: 'j1', step: 'deprep', ownerId: 'aoife', doneAt: null, doneBy: null })

    // Steps are for staff, who have a list; a freelancer is refused by name.
    expect(await colly.send('jobStep.set', { projectId: 'j1', step: 'crew', ownerId: 'dara' })).toMatchObject({
      status: 'rejected',
      reason: { message: 'Dara Kelly is a freelancer. Steps are for staff, who see them on Home.' },
    })

    // Aoife ticks hers: the server knows it was her from her sign-in, whatever the device says.
    expect(await aoife.send('jobStep.set', { projectId: 'j1', step: 'deprep', done: true, by: 'colly' })).toMatchObject({ status: 'applied' })
    const ticked = await aoife.record<StepRecord>('jobStep', 'j1.deprep')
    expect(ticked).toMatchObject({ ownerId: 'aoife', doneBy: 'aoife' })
    expect(ticked.doneAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    // Aoife hears of the step given to her, as hers, while it's hers; never of her own tick.
    const hers: NoticesPage = (await app.inject({ url: '/api/notices', cookies: aoife.cookies })).json()
    const steps = hers.notices.filter((n) => n.about.entity === 'jobStep')
    expect(steps.map((n) => [n.who.name, n.what, n.why])).toContainEqual(['Colly Hewson', 'Gave “Deprepped” on Electric Picnic to Aoife Byrne', 'you'])
    expect(steps.some((n) => n.who.name === 'Aoife Byrne')).toBe(false)
    // Ticked again is the same tick, and handing it on keeps it.
    await colly.send('jobStep.set', { projectId: 'j1', step: 'deprep', ownerId: 'colly', done: true })
    expect(await colly.record<StepRecord>('jobStep', 'j1.deprep')).toMatchObject({ ownerId: 'colly', doneAt: ticked.doneAt, doneBy: 'aoife' })
    await colly.send('jobStep.set', { projectId: 'j1', step: 'deprep', done: false })
    expect(await colly.record<StepRecord>('jobStep', 'j1.deprep')).toMatchObject({ ownerId: 'colly', doneAt: null, doneBy: null })

    const said = (await colly.history()).entries.filter((e) => e.command === 'jobStep.set' && e.outcome === 'done').map((e) => e.what)
    expect(said).toEqual([
      'Took the tick off “Deprepped” on Electric Picnic',
      'Gave “Deprepped” on Electric Picnic to Colly Hewson and ticked it',
      'Ticked “Deprepped” on Electric Picnic',
      'Gave “Deprepped” on Electric Picnic to Aoife Byrne',
    ])

  })

  it("stop with the job: nothing new on a cancelled job or an errand, though a name or a tick can still come off", async () => {
    const { colly } = await office()
    await colly.send('jobStep.set', { projectId: 'j1', step: 'kit', ownerId: 'aoife' })
    await colly.send('project.update', { id: 'j1', status: 'cancelled' })
    expect(await colly.send('jobStep.set', { projectId: 'j1', step: 'crew', ownerId: 'aoife' })).toMatchObject({
      status: 'rejected',
      reason: { message: 'Electric Picnic is cancelled, so its steps are stopped.' },
    })
    expect(await colly.send('jobStep.set', { projectId: 'j1', step: 'kit', ownerId: null })).toMatchObject({ status: 'applied' })
    await colly.send('project.create', { id: 'e1', name: 'Collect the hazers', clientId: null, venueId: null, status: 'confirmed', notes: '', kind: 'errand' })
    expect(await colly.send('jobStep.set', { projectId: 'e1', step: 'prep', done: true })).toMatchObject({ status: 'rejected', reason: { message: 'Errands and meetings have no steps.' } })
  })

  it('are ticked by the app from the job itself, and each person has their own list, offline too', async () => {
    const { app } = await company()
    const { client, signal } = await phone(app)
    let gala = client.view().steps.of('gala')!
    // The gala is confirmed, so its quote went and the client said yes; crew and kit are under way.
    expect(gala.steps.map((s) => [s.key, s.state, s.auto ?? s.hint ?? s.skipped])).toEqual([
      ['quote', 'done', expect.stringMatching(/^Sent /)],
      ['confirmed', 'done', 'The job is confirmed'],
      ['crew', 'now', expect.stringMatching(/^\d+ of \d+ booked/)],
      ['kit', 'later', '2 lines of kit, 1 vehicle'],
      ['prep', 'later', '0 of 10 out'],
      ['show', 'later', 'On now'],
      ['back', 'later', 'Nothing out yet'],
      ['deprep', 'later', undefined],
    ])
    expect(gala.current?.key).toBe('crew')

    // Given out and ticked with no signal: shown at once, as the server then has it.
    signal.on = false
    await client.mutate('jobStep.set', { projectId: 'gala', step: 'crew', ownerId: 'cian' })
    await client.mutate('jobStep.set', { projectId: 'gala', step: 'deprep', ownerId: 'cian' })
    await client.mutate('jobStep.set', { projectId: 'gala', step: 'kit', done: true, by: 'aoife' })
    gala = client.view().steps.of('gala')!
    expect(gala.steps.find((s) => s.key === 'kit')).toMatchObject({ done: true, pending: true, ticked: { by: { id: 'aoife' } } })
    expect(client.view().steps.mine('cian').map((s) => [s.step.key, s.next])).toEqual([
      ['crew', true],
      ['deprep', false],
    ])
    signal.on = true
    await client.sync()
    await client.sync()
    expect(client.view().problems).toEqual([])
    expect(client.view().steps.of('gala')!.steps.find((s) => s.key === 'kit')).toMatchObject({ done: true, pending: false, ticked: { by: { id: 'aoife' } } })

    // Everything scanned out: picked. Everything back: back in, ticked by the app.
    const at = new Date().toISOString()
    await ok(
      app,
      m('move.record', { id: newId(), projectId: 'gala', direction: 'out', assetId: 'a1', modelId: 'y10p', qty: 1, at }),
      m('move.record', { id: newId(), projectId: 'gala', direction: 'out', assetId: 'a2', modelId: 'y10p', qty: 1, at }),
      m('move.record', { id: newId(), projectId: 'gala', direction: 'out', assetId: null, modelId: 'xlr', qty: 8, at })
    )
    await client.sync()
    gala = client.view().steps.of('gala')!
    expect(gala.steps.find((s) => s.key === 'prep')).toMatchObject({ done: true, auto: 'Everything went out' })
    expect(gala.steps.find((s) => s.key === 'back')).toMatchObject({ done: false, hint: '10 still out' })
    const later = new Date(Date.now() + 1000).toISOString()
    await ok(
      app,
      m('move.record', { id: newId(), projectId: 'gala', direction: 'in', assetId: 'a1', modelId: 'y10p', qty: 1, at: later }),
      m('move.record', { id: newId(), projectId: 'gala', direction: 'in', assetId: 'a2', modelId: 'y10p', qty: 1, at: later }),
      m('move.record', { id: newId(), projectId: 'gala', direction: 'in', assetId: null, modelId: 'xlr', qty: 8, at: later })
    )
    await client.sync()
    gala = client.view().steps.of('gala')!
    // Picked stays done once it's back: it went out.
    expect(gala.steps.filter((s) => s.done).map((s) => s.key)).toEqual(['quote', 'confirmed', 'kit', 'prep', 'back'])
    expect(gala.steps.find((s) => s.key === 'back')?.auto).toBe('All back')
  })

  it('come along when two jobs or two people are made one, a job keeping one of each step', async () => {
    const { app } = await company()
    await ok(
      app,
      m('project.create', { id: 'dup', name: 'Autumn Gala LX', clientId: null, venueId: null, status: 'confirmed', notes: '' }),
      m('jobStep.set', { projectId: 'gala', step: 'crew', ownerId: 'aoife' }),
      m('jobStep.set', { projectId: 'dup', step: 'crew', ownerId: 'cian', done: true }),
      m('jobStep.set', { projectId: 'dup', step: 'deprep', ownerId: 'cian' }),
      m('project.merge', { id: 'gala', from: ['dup'], name: 'Autumn Gala' }),
      m('person.upsert', { id: 'cian2', name: 'Cian M', kind: 'staff', email: 'cian.m@example.com', phone: null, skills: [], dayRateCents: null, notes: '' }),
      m('jobStep.set', { projectId: 'gala', step: 'back', ownerId: 'cian2' }),
      m('person.merge', { id: 'cian', from: ['cian2'] })
    )
    const { client } = await phone(app)
    const gala = client.view().steps.of('gala')!
    // The gala's own crew step stays Aoife's; the deprep only the other job had is the gala's now; Cian M is Cian.
    expect(gala.steps.filter((s) => s.ownerId).map((s) => [s.key, s.ownerId, !!s.ticked])).toEqual([
      ['crew', 'aoife', false],
      ['back', 'cian', false],
      ['deprep', 'cian', false],
    ])
    expect(client.view().steps.of('dup')).toBeUndefined()
  })
})
