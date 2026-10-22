import { newId, type CommandInput, type CommandName, type MutationResult } from '@sh/shared'
import type { FastifyInstance } from 'fastify'
import { describe, expect, it } from 'vitest'
import { readHistory } from '../src/history.ts'
import { company, m, ok, phone } from './company.ts'

/**
 * Racks (ADR 0074): a product that is a rack case built up with kit, with
 * its own stock code and a layout of what goes where; each rack built of
 * it holds its kit, which then goes with the rack and isn't free on its
 * own; and the layout is a plan, said not refused when it doesn't fit.
 */

async function send<N extends CommandName>(app: FastifyInstance, name: N, args: CommandInput<N>): Promise<MutationResult> {
  const res = await app.inject({ method: 'POST', url: '/api/sync/push', payload: { clientId: 'office', mutations: [m(name, args)] } })
  return res.json().results[0]
}

const RACK = { department: 'audio', category: 'Racks', tracking: 'serialised', isCase: true, isRack: true, valueCents: null, notes: '' } as const
const AMP = { department: 'audio', category: 'Amps', tracking: 'serialised', isCase: false, valueCents: null, notes: '' } as const

describe('racks', () => {
  it('have a stock code of their own, a layout, and take their kit off what is free', async () => {
    const { app, db } = await company()
    await ok(
      app,
      m('model.create', { id: 'mon', name: 'Monitor rack', ...RACK, code: ' RK-MON ', units: 4, depthMm: 450, weightKg: 9.96 }),
      m('model.create', { id: 'amp', name: 'd&b D20', ...AMP, units: 2, depthMm: 400, weightKg: 10.6, powerW: 1200 }),
      m('model.create', { id: 'di', name: 'DI box', ...AMP, units: 1, depthMm: 100 }),
      m('rackSlot.set', { id: 's1', rackId: 'mon', modelId: 'amp', top: 1, side: 'front', qty: 1, notes: '' }),
      m('rackSlot.set', { id: 's2', rackId: 'mon', modelId: 'amp', top: 3, side: 'front', qty: 1, notes: '' }),
      m('rackSlot.set', { id: 's3', rackId: 'mon', modelId: 'xlr', top: null, side: 'front', qty: 4, notes: 'In the drawer' }),
      m('asset.add', { id: 'mon1', modelId: 'mon', number: null, serial: '', placeId: 'wh', caseId: null, notes: '', fromCount: false }),
      m('asset.add', { id: 'amp1', modelId: 'amp', number: null, serial: '', placeId: null, caseId: 'mon1', notes: '', fromCount: false }),
      m('asset.add', { id: 'amp2', modelId: 'amp', number: null, serial: '', placeId: 'wh', caseId: null, notes: '', fromCount: false }),
      m('stock.move', { modelId: 'xlr', fromPlaceId: 'wh', fromCaseId: null, toPlaceId: null, toCaseId: 'mon1', qty: 4 }),
      m('kit.add', { id: 'amps', projectId: 'gala', phaseId: null, modelId: 'amp', qty: 2, subhireQty: 0, supplier: '', notes: '' })
    )

    // A stock code is a product's own, whatever the capitals; kept trimmed.
    expect(await send(app, 'model.update', { id: 'xlr', code: 'rk-mon' })).toMatchObject({ status: 'rejected', reason: { message: 'Monitor rack already has the stock code rk-mon.' } })

    const { client } = await phone(app)
    const v = client.view()
    const rack = v.racks.of('mon')!
    expect(rack.model).toMatchObject({ code: 'RK-MON', units: 4, depthMm: 450, weightKg: 10 })
    expect(rack.slots.map((s) => s.id)).toEqual(['s1', 's2', 's3'])
    expect(rack.layout).toMatchObject({ frontUsed: 4, rearUsed: 0, weightKg: 31.2, powerW: 2400, problems: [] })
    // The built one is short an amp; the cables are in.
    expect(rack.built.map((b) => b.check)).toEqual([{ missing: [{ modelId: 'amp', qty: 1 }], extra: [], hireIn: [] }])
    // The amp in the rack goes with the rack: one free, so the gala is short one.
    expect(v.warehouse.models.find((x) => x.id === 'amp')).toMatchObject({ total: 2, racked: 1 })
    expect(v.kit.lines.find((l) => l.id === 'amps')).toMatchObject({ owned: 1, short: 1 })
    expect(v.warehouse.assets.get('amp1')?.inRack?.id).toBe('mon1')

    // A plan isn't refused for not fitting: the app says so.
    await ok(app, m('rackSlot.set', { id: 's4', rackId: 'mon', modelId: 'di', top: 4, side: 'front', qty: 1, notes: '' }))
    await client.sync()
    expect(client.view().racks.of('mon')!.layout.problems.map((p) => p.message)).toEqual(['DI box at U4 is on top of d&b D20 at U3 on the front.'])

    // What can't be meant is refused.
    expect(await send(app, 'rackSlot.set', { id: newId(), rackId: 'amp', modelId: 'di', top: 1, side: 'front', qty: 1, notes: '' })).toMatchObject({
      status: 'rejected',
      reason: { message: "d&b D20 isn't a rack, so it has no layout." },
    })
    expect(await send(app, 'rackSlot.set', { id: newId(), rackId: 'mon', modelId: 'mon', top: 1, side: 'front', qty: 1, notes: '' })).toMatchObject({ status: 'rejected' })
    expect(await send(app, 'rackSlot.set', { id: newId(), rackId: 'mon', modelId: 'di', top: 1, side: 'front', qty: 2, notes: '' })).toMatchObject({ status: 'rejected' })
    // A product in a layout stays, and a rack with one stays a rack.
    expect(await send(app, 'model.remove', { id: 'di' })).toMatchObject({ status: 'rejected', reason: { message: 'DI box is in the layout of Monitor rack. Take it out of that first.' } })
    expect(await send(app, 'model.mistake', { id: 'di' })).toMatchObject({ status: 'rejected' })
    expect(await send(app, 'model.update', { id: 'mon', isRack: false })).toMatchObject({ status: 'rejected', reason: { message: 'Monitor rack has a layout. Take everything out of it first.' } })
    expect(await send(app, 'model.update', { id: 'mon', isCase: false })).toMatchObject({ status: 'rejected' })

    await ok(app, m('rackSlot.remove', { id: 's4' }), m('model.remove', { id: 'di' }))
    const said = (await readHistory(db)).entries.filter((e) => e.command.startsWith('rackSlot') && e.outcome === 'done').map((e) => e.what)
    expect(said).toContain('Put d&b D20 at U1 on the front in the layout of Monitor rack')
    expect(said).toContain('Put 4 × XLR 10 m loose in the layout of Monitor rack')
    expect(said).toContain('Took DI box out of the layout of Monitor rack')
  })
})

describe('dry hire stock', () => {
  it("is never short, can't be labelled or counted as ours, and a rack says what it costs to hire in or buy", async () => {
    const { app } = await company()
    await ok(
      app,
      m('model.create', { id: 'haze', name: 'MDG ATMe', department: 'lighting', category: 'Haze', tracking: 'serialised', isCase: false, dryHire: true, supplier: 'PRG', hireDayCents: 4500, valueCents: 350000, notes: '', units: 3 }),
      m('model.create', { id: 'mon', name: 'Monitor rack', ...RACK, code: '', units: 6, depthMm: 600 }),
      m('rackSlot.set', { id: 's1', rackId: 'mon', modelId: 'haze', top: 1, side: 'front', qty: 1, notes: '' }),
      m('rackSlot.set', { id: 's2', rackId: 'mon', modelId: 'y10p', top: 4, side: 'front', qty: 1, notes: '' }),
      m('asset.add', { id: 'mon1', modelId: 'mon', number: null, serial: '', placeId: 'wh', caseId: null, notes: '', fromCount: false }),
      m('asset.move', { id: 'a1', placeId: null, caseId: 'mon1' }),
      m('kit.add', { id: 'hazers', projectId: 'gala', phaseId: null, modelId: 'haze', qty: 4, subhireQty: 0, supplier: '', notes: '' })
    )
    const refusal = 'MDG ATMe is dry hire, hired in when needed, so none of it is ours to label or count. Mark it as ours first.'
    expect(await send(app, 'asset.add', { id: newId(), modelId: 'haze', number: null, serial: '', placeId: 'wh', caseId: null, notes: '', fromCount: false })).toMatchObject({ reason: { message: refusal } })
    expect(await send(app, 'stock.set', { modelId: 'haze', placeId: 'wh', caseId: null, qty: 2 })).toMatchObject({ status: 'rejected' })
    // Our own can't become dry hire while we have some, nor a rack.
    expect(await send(app, 'model.update', { id: 'y10p', dryHire: true })).toMatchObject({ status: 'rejected', reason: { message: /^d&b Y10P has 2 items of our own/ } })
    expect(await send(app, 'model.update', { id: 'mon', dryHire: true })).toMatchObject({ status: 'rejected' })

    const { client } = await phone(app)
    const v = client.view()
    expect(v.kit.lines.find((l) => l.id === 'hazers')).toMatchObject({ own: 0, short: 0 })
    const rack = v.racks.of('mon')!
    expect(rack.layout.hire).toEqual({ count: 1, dayCents: 4500, dayMissing: 0, buyCents: 350000, buyMissing: 0 })
    // The built one has its speaker; the hazer is hired in for each job, not missing.
    expect(rack.built[0]!.check).toEqual({ missing: [], extra: [], hireIn: [{ modelId: 'haze', qty: 1 }] })
  })
})
