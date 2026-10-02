/**
 * The way to bringing in the stock list (ADR 0026), on the Account tab
 * beside the crew list's: what it does in two lines.
 */
export function ImportStockCard() {
  return (
    <section className="card import-stock-card" aria-labelledby="import-stock-title">
      <h2 id="import-stock-title">Bring in the stock list</h2>
      <p>
        Bring the stock list in from a spreadsheet saved as a .csv file. You see every row as the app read it, with what it will add or change, and
        fix or skip any it couldn't read. Bringing the same list in again changes only what's different.
      </p>
      <a className="button" href="#account/import-stock">
        Bring in the stock list
      </a>
    </section>
  )
}
