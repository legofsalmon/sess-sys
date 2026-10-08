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

  it('cleans each field as typed text is cleaned, keeping tabs and line breaks', () => {
    // Proves: a NUL, DEL and other control characters a cell copied from Word or a PDF can carry go, a vertical tab (Word's line
    // break) becomes a line feed inside its field rather than starting a row, and a tab and a quoted line break stay, so the
    // preview shows what will be kept and a second import of the same file compares like with like.
    expect(parseCsv('name,notes\nDara\u0000 Quinn\u007f,"Line one\u000bLine\ttwo\nLine\u0001 three"\n')).toEqual([
      ['name', 'notes'],
      ['Dara Quinn', 'Line one\nLine\ttwo\nLine three'],
    ])
  })
})
