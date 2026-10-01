import { describe, expect, it } from 'vitest'
import { blankRecord, parseCsv } from '../src/csv.ts'

/**
 * The CSV reader (ADR 0025) reads what a spreadsheet saves: fields in
 * quotes with commas, line breaks and doubled quotes inside them, Windows
 * line endings, and the byte-order mark Excel puts first; and it keeps a
 * blank line as a record, so a row's index is its line in the file.
 */

describe('reading a CSV file', () => {
  it('splits plain rows on commas and line feeds, keeping a blank line as an empty record so line numbers stay true', () => {
    const rows = parseCsv('a,b,c\n1,2,3\n\n4,,6\n')
    expect(rows).toEqual([['a', 'b', 'c'], ['1', '2', '3'], [''], ['4', '', '6']])
    expect(rows.map(blankRecord)).toEqual([false, false, true, false])
    expect(blankRecord([' ', '', ''])).toBe(true)
    expect(parseCsv('')).toEqual([])
    expect(parseCsv('\n\n')).toEqual([[''], ['']])
  })

  it('keeps commas, line breaks and doubled quotes inside a quoted field', () => {
    expect(parseCsv('name,notes\n"Quinn, Dara","Line one\nLine two"\n"She said ""hi""",plain\n')).toEqual([
      ['name', 'notes'],
      ['Quinn, Dara', 'Line one\nLine two'],
      ['She said "hi"', 'plain'],
    ])
    // A Windows line break inside a field comes out as one line feed, so no carriage return reaches the notes.
    expect(parseCsv('name,notes\r\n"Dara","Line one\r\nLine two"\r\n')).toEqual([
      ['name', 'notes'],
      ['Dara', 'Line one\nLine two'],
    ])
  })

  it('takes Windows line endings and a leading byte-order mark', () => {
    expect(parseCsv('﻿First Name,Last Name\r\nDara,Quinn\r\n')).toEqual([
      ['First Name', 'Last Name'],
      ['Dara', 'Quinn'],
    ])
    // The last line needn't end in a line break.
    expect(parseCsv('a,b\r\n1,2')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ])
  })
})
