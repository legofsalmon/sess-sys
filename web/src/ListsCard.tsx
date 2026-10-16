import { useAuth } from './auth.ts'

/**
 * Bringing lists in, from Admin (ADR 0041): each list is brought in where
 * it lives (jobs under Jobs, the crew list under Crew, the stock list under
 * Stock), and this card names all three so the office finds them in one
 * place at the start of a season. While sign-in is off, the warning that
 * whatever comes in is open to anyone who can reach the app.
 */
export function ListsCard({ calendar }: { calendar: boolean }) {
  const auth = useAuth()
  return (
    <section className="card lists-card" aria-labelledby="lists-title">
      <h2 id="lists-title">Bring lists in</h2>
      <p>
        From a spreadsheet saved as a .csv file, or from Google Calendar. You see every row as the app read it, fix or skip any it couldn't read,
        and bringing the same list in again changes only what's different.
      </p>
      {auth.status === 'open' && (
        <p className="warn-line">Sign-in is off, so anyone who can reach the app can read whatever you bring in. Put the real lists in once sign-in is on.</p>
      )}
      <ul className="job-list">
        {calendar && (
          <li>
            <a className="job-row" href="#jobs/import">
              <div>
                <b>Jobs from Google Calendar</b>
                <p>Under Jobs</p>
              </div>
              <div className="side" aria-hidden="true">
                ›
              </div>
            </a>
          </li>
        )}
        <li>
          <a className="job-row" href="#crew/import">
            <div>
              <b>The crew list</b>
              <p>Under Crew</p>
            </div>
            <div className="side" aria-hidden="true">
              ›
            </div>
          </a>
        </li>
        <li>
          <a className="job-row" href="#stock/import">
            <div>
              <b>The stock list</b>
              <p>Under Stock</p>
            </div>
            <div className="side" aria-hidden="true">
              ›
            </div>
          </a>
        </li>
      </ul>
    </section>
  )
}
