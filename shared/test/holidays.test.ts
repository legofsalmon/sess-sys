import { describe, expect, it } from 'vitest'
import { isPublicHoliday, publicHolidayName, publicHolidays, publicHolidaysAmong, workingDays } from '../src/holidays.ts'

/**
 * Irish public holidays by rule (ADR 0024): the dates the rules give match
 * the published lists, including the ones that move (St Brigid's Day,
 * Easter Monday, the bank holidays), and leave never counts one.
 */

describe('Irish public holidays', () => {
  it('match the published dates for 2026', () => {
    expect(publicHolidays(2026).map((h) => h.day)).toEqual([
      '2026-01-01',
      '2026-02-02',
      '2026-03-17',
      '2026-04-06',
      '2026-05-04',
      '2026-06-01',
      '2026-08-03',
      '2026-10-26',
      '2026-12-25',
      '2026-12-26',
    ])
  })

  it('match the published dates for 2027', () => {
    expect(publicHolidays(2027).map((h) => h.day)).toEqual([
      '2027-01-01',
      '2027-02-01',
      '2027-03-17',
      '2027-03-29',
      '2027-05-03',
      '2027-06-07',
      '2027-08-02',
      '2027-10-25',
      '2027-12-25',
      '2027-12-26',
    ])
  })

  it("put St Brigid's Day on 1 February only when that is a Friday, and name each day", () => {
    // 2030: 1 February is a Friday. 2025: a Saturday, so the Monday after.
    expect(publicHolidays(2030).find((h) => h.name === "St Brigid's Day")?.day).toBe('2030-02-01')
    expect(publicHolidays(2025).find((h) => h.name === "St Brigid's Day")?.day).toBe('2025-02-03')
    expect(publicHolidayName('2026-10-26')).toBe('October bank holiday')
    expect(publicHolidayName('2026-04-06')).toBe('Easter Monday')
    expect(isPublicHoliday('2026-10-27')).toBe(false)
    expect(publicHolidaysAmong(['2026-12-24', '2026-12-25', '2026-12-26', '2026-12-27'])).toEqual({ '2026-12-25': 'Christmas Day', '2026-12-26': "St Stephen's Day" })
  })

  it('leave out weekends and public holidays from the working days', () => {
    // Friday 23 October to Tuesday 27 October 2026: the weekend and the October bank holiday go, leaving the Friday and the Tuesday.
    expect(workingDays('2026-10-23', '2026-10-27')).toEqual(['2026-10-23', '2026-10-27'])
    expect(workingDays('2026-10-05', '2026-10-09')).toHaveLength(5)
    expect(workingDays('2026-10-10', '2026-10-11')).toEqual([])
    expect(workingDays('2026-10-09', '2026-10-05')).toEqual([])
  })
})
