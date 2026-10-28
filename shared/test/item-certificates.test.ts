import { describe, expect, it } from 'vitest'
import { itemCertificateDetails, type Inspection, type ItemCertificate } from '../src/inspections.ts'
import { PLAIN_PRODUCT, type Asset, type Model } from '../src/stock.ts'
import { inspectionsView } from '../src/sync/inspections-view.ts'
import { warehouseView } from '../src/sync/stock-view.ts'

/**
 * Certificates on items (ADR 0094) as a device sees them: a test's
 * certificate is the one of its kind on its item, dated its day; a test
 * that passed with none is listed, never stopped; another certificate
 * that runs out is listed when it has, or soon will, unless a newer one
 * of the same title has come in; and one waiting to go shows at once.
 */

const table = <T extends { id: string }>(rows: readonly T[]): Record<string, T> => Object.fromEntries(rows.map((r) => [r.id, r]))
const model = (id: string, name: string, extra: Partial<Model> = {}): Model => ({
  ...PLAIN_PRODUCT,
  aliases: [],
  id,
  name,
  department: 'rigging',
  category: '',
  tracking: 'serialised',
  isCase: false,
  valueCents: null,
  notes: '',
  patMonths: null,
  liftingMonths: null,
  mistake: false,
  ...extra,
})
const asset = (id: string, modelId: string): Asset => ({
  id,
  modelId,
  number: `SH-${id.padStart(6, '0')}`,
  formerNumbers: [],
  serial: '',
  oldNumber: '',
  patDue: null,
  placeId: null,
  caseId: null,
  status: 'active',
  retiredReason: null,
  retiredNote: null,
  notes: '',
})
const test = (id: string, assetId: string, kind: Inspection['kind'], day: string, passed = true): Inspection => ({
  id,
  assetId,
  kind,
  passed,
  at: `${day}T12:00:00.000Z`,
  by: 'Rigging Co',
  note: '',
})
const cert = (id: string, extra: Partial<ItemCertificate>): ItemCertificate => ({
  id,
  kind: 'lifting',
  title: 'Report of thorough examination',
  day: '2026-10-20',
  expires: null,
  assetIds: [],
  link: 'https://example.com/report.pdf',
  file: null,
  addedAt: '2026-10-21T09:00:00.000Z',
  ...extra,
})

const TODAY = '2026-10-28'

function view(certs: ItemCertificate[], outbox: Parameters<typeof inspectionsView>[1] = []) {
  // Motors need a thorough examination every six months and a PAT every year.
  const models = [model('motor', 'CM Lodestar 1 t', { liftingMonths: 6, patMonths: 12 })]
  const assets = ['1', '2', '3'].map((id) => asset(id, 'motor'))
  const tests = [
    test('t1', '1', 'lifting', '2026-10-20'),
    test('t2', '2', 'lifting', '2026-10-20'),
    test('t3', '3', 'lifting', '2026-10-21'),
    test('t4', '1', 'pat', '2026-09-01'),
    test('t5', '2', 'pat', '2026-09-01', false),
  ]
  const warehouse = warehouseView({ model: table(models), asset: table(assets) }, [], 0)
  return inspectionsView({ inspection: table(tests), itemCertificate: table(certs) }, outbox, 0, warehouse, TODAY)
}

describe('certificates on items, as a device sees them', () => {
  it('finds each test’s certificate by its item, kind and day, and lists passes with none', () => {
    const v = view([cert('round', { assetIds: ['1', '2', '3'] })])
    expect(v.certificateFor({ assetId: '1', kind: 'lifting', day: '2026-10-20' })?.id).toBe('round')
    // Item 3 was examined a day later than the report's day: not its certificate.
    expect(v.certificateFor({ assetId: '3', kind: 'lifting', day: '2026-10-21' })).toBeUndefined()
    // A PAT on the same item isn't covered by the examination's report.
    expect(v.certificateFor({ assetId: '1', kind: 'pat', day: '2026-09-01' })).toBeUndefined()
    expect(v.dueOf('1').find((d) => d.kind === 'lifting')?.certificate?.id).toBe('round')
    // Passed with none: item 3's examination and item 1's PAT, the oldest test first. Item 2's PAT failed, so it isn't asked for.
    expect(v.uncertified.map((d) => `${d.asset.id} ${d.kind}`)).toEqual(['1 pat', '3 lifting'])
    expect(v.certificatesOf('1').map((c) => c.id)).toEqual(['round'])
    // Nothing is stopped for a missing certificate.
    expect(v.blocks('3')).toBeUndefined()
  })

  it('lists another certificate that ran out or soon will, until a newer one of its title comes in', () => {
    const old = cert('fr-2025', { kind: 'other', title: 'Fire-retardancy certificate', day: '2025-10-01', expires: '2026-10-01', assetIds: ['1', '2'] })
    const soon = cert('conformity', { kind: 'other', title: 'Declaration of conformity', day: '2021-11-10', expires: '2026-11-10', assetIds: ['3'] })
    const open = cert('manual', { kind: 'other', title: 'Manual', day: '2020-01-01', expires: null, assetIds: ['3'] })
    const renewed = cert('fr-2026', { kind: 'other', title: 'fire-retardancy certificate', day: '2026-10-05', expires: '2027-10-05', assetIds: ['2'] })
    const v = view([old, soon, open, renewed])
    expect(v.certificatesDue.map((d) => `${d.asset.id} ${d.certificate.id} ${d.state}`)).toEqual(['1 fr-2025 expired', '3 conformity soon'])
    expect([old, soon, open, renewed].map((c) => v.certificateState(c))).toEqual(['expired', 'soon', 'open', 'ok'])
  })

  it('shows one saved or removed on this device at once, before the server has it', () => {
    const kept = cert('round', { assetIds: ['1'] })
    const args = itemCertificateDetails.parse({ ...kept, id: 'pat', kind: 'pat', title: 'PAT certificate', day: '2026-09-01', assetIds: ['1', '1'] })
    const v = view([kept], [
      { id: 'm1', name: 'itemCertificate.save', args, createdAt: '2026-10-28T10:00:00.000Z' },
      { id: 'm2', name: 'itemCertificate.remove', args: { id: 'round' }, createdAt: '2026-10-28T10:01:00.000Z' },
    ])
    expect(v.certificatesOf('1').map((c) => `${c.id} ${c.pending}`)).toEqual(['pat true'])
    expect(v.certificatesOf('1')[0]?.assetIds).toEqual(['1'])
    expect(v.certificateFor({ assetId: '1', kind: 'pat', day: '2026-09-01' })?.id).toBe('pat')
    expect(v.certificateFor({ assetId: '1', kind: 'lifting', day: '2026-10-20' })).toBeUndefined()
  })
})
