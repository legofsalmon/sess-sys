import { z } from 'zod'
import { CALENDAR_ENTITY_NAMES, type CalendarEntities } from './calendar.ts'
import { CREW_ENTITY_NAMES, type CrewEntities } from './crew.ts'
import { day } from './day.ts'
import { FAULT_ENTITY_NAMES, type FaultEntities } from './faults.ts'
import { INSPECTION_ENTITY_NAMES, type InspectionEntities } from './inspections.ts'
import { JOB_ENTITY_NAMES, type JobEntities } from './jobs.ts'
import { KIT_ENTITY_NAMES, type KitEntities } from './kit.ts'
import { LABEL_ENTITY_NAMES, type LabelEntities } from './labels.ts'
import { LEAVE_ENTITY_NAMES, type LeaveEntities } from './leave.ts'
import { MOVE_ENTITY_NAMES, type MoveEntities } from './moves.ts'
import { SETTING_ENTITY_NAMES, type SettingEntities } from './office.ts'
import { STOCK_ENTITY_NAMES, type StockEntities } from './stock.ts'
import { TIMESHEET_ENTITY_NAMES, type TimesheetEntities } from './timesheets.ts'

/**
 * The records the sync spike moves around. They are deliberately a thin
 * slice of the real model (see docs/architecture.md): enough stock and
 * booking to prove that two people offline cannot overbook, and scans to
 * prove that something that already happened is never refused.
 */

const id = z.string().min(1).max(64)

export const product = z.object({
  id,
  name: z.string().min(1).max(200),
  quantity: z.number().int().min(0),
})
export type Product = z.infer<typeof product>

export const booking = z.object({
  id,
  productId: id,
  project: z.string().min(1).max(200),
  qty: z.number().int().min(1),
  start: day,
  end: day,
  status: z.enum(['confirmed', 'cancelled']),
})
export type Booking = z.infer<typeof booking>

export const scan = z.object({
  id,
  productId: id,
  bookingId: id.nullable(),
  direction: z.enum(['out', 'in']),
  /** When the scan happened on the device, which may be long before it synced. */
  at: z.string(),
})
export type Scan = z.infer<typeof scan>

/**
 * Something a person has to sort out: the physical world disagreed with the
 * plan. The system never refuses a scan; it records it and raises one of these.
 */
export const issue = z.object({
  id,
  kind: z.enum(['scan-without-booking', 'scan-over-booking']),
  message: z.string(),
  scanId: id,
  resolved: z.boolean(),
})
export type Issue = z.infer<typeof issue>

export interface Entities
  extends CrewEntities,
    JobEntities,
    CalendarEntities,
    StockEntities,
    KitEntities,
    LabelEntities,
    MoveEntities,
    FaultEntities,
    InspectionEntities,
    TimesheetEntities,
    SettingEntities,
    LeaveEntities {
  product: Product
  booking: Booking
  scan: Scan
  issue: Issue
}
export type EntityName = keyof Entities
export const ENTITY_NAMES: readonly EntityName[] = [
  'product',
  'booking',
  'scan',
  'issue',
  ...CREW_ENTITY_NAMES,
  ...JOB_ENTITY_NAMES,
  ...CALENDAR_ENTITY_NAMES,
  ...STOCK_ENTITY_NAMES,
  ...KIT_ENTITY_NAMES,
  ...LABEL_ENTITY_NAMES,
  ...MOVE_ENTITY_NAMES,
  ...FAULT_ENTITY_NAMES,
  ...INSPECTION_ENTITY_NAMES,
  ...TIMESHEET_ENTITY_NAMES,
  ...SETTING_ENTITY_NAMES,
  ...LEAVE_ENTITY_NAMES,
]

/** Do two whole-day ranges share at least one day? */
export function overlaps(a: { start: string; end: string }, b: { start: string; end: string }): boolean {
  return a.start <= b.end && b.start <= a.end
}
