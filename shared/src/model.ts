import { CALENDAR_ENTITY_NAMES, type CalendarEntities } from './calendar.ts'
import { CREW_ENTITY_NAMES, type CrewEntities } from './crew.ts'
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

/** Every record a device keeps, by the name the change feed gives it, gathered from each module. */
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
    LeaveEntities {}
export type EntityName = keyof Entities
export const ENTITY_NAMES: readonly EntityName[] = [
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
