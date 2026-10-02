/**
 * A small CSV reader, as RFC 4180 has it: fields split by commas, a field
 * in double quotes can hold commas, line breaks and doubled quotes, lines
 * end in a line feed or a carriage return and line feed, and a spreadsheet
 * saving UTF-8 may put a byte-order mark first. Used to bring the crew list
 * in (ADR 0025), and the stock list after it, which may come split by
 * semicolons instead: Excel saves them so where a comma is the decimal mark.
 */

/**
 * The records of a CSV file, each a list of its fields as text. A blank
 * line comes back as one empty field, so a record's index is its line in
 * the file and a reader can say "row 4" and mean line 4.
 */
export function parseCsv(text: string, separator: ',' | ';' = ','): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  // Excel writes UTF-8 with a mark at the start, which isn't part of the first header.
  let i = text.charCodeAt(0) === 0xfeff ? 1 : 0
  const endRow = () => {
    row.push(field)
    field = ''
    rows.push(row)
    row = []
  }
  for (; i < text.length; i++) {
    const ch = text[i]!
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i++
        } else quoted = false
      } else if (ch === '\r') {
        // A line break inside a field is kept, as one line feed whichever way the file writes it.
        field += '\n'
        if (text[i + 1] === '\n') i++
      } else field += ch
      continue
    }
    if (ch === '"') quoted = true
    else if (ch === separator) {
      row.push(field)
      field = ''
    } else if (ch === '\n') endRow()
    else if (ch === '\r') {
      if (text[i + 1] === '\n') i++
      endRow()
    } else field += ch
  }
  if (field !== '' || row.length) endRow()
  return rows
}

/** A record with nothing in it: an empty line, or one of commas alone. */
export const blankRecord = (record: readonly string[]) => record.every((f) => f.trim() === '')
