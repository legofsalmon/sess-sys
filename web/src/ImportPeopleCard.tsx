import { useAuth } from './auth.ts'

/**
 * The way to the crew list import (ADR 0025), on the Account tab beside the
 * Data card: what it does in two lines, and while sign-in is off, the
 * warning that whatever comes in is open to anyone who can reach the app.
 */
export function ImportPeopleCard() {
  const auth = useAuth()
  return (
    <section className="card import-people-card" aria-labelledby="import-people-title">
      <h2 id="import-people-title">Bring in a list</h2>
      <p>
        Bring the crew list in from a spreadsheet saved as a .csv file. You see every row as the app read it, fix or skip any it couldn't read, and
        rows that match someone already on the Crew tab update them rather than doubling them.
      </p>
      {auth.status === 'open' && (
        <p className="warn-line">Sign-in is off, so anyone who can reach the app can read whatever you bring in. Put the real list in once sign-in is on.</p>
      )}
      <a className="button" href="#account/import-people">
        Bring in a list
      </a>
    </section>
  )
}
