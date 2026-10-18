import { ROLE_LABELS, ROLE_LINES, type Reading } from '@sh/shared'
import { useState } from 'react'
import { Confirm, Refusal, useAct } from './act.tsx'
import { signOut, useAuth } from './auth.ts'
import { FeedCard } from './FeedCard.tsx'
import { Top } from './jobs/common.tsx'
import { useAccess } from './role.ts'
import { forgetCountDraft } from './stock/Counts.tsx'
import { client, storage } from './sync.ts'
import { tabRole } from './tabs.ts'
import { setTheme, useTheme, type Theme } from './theme.ts'
import { useLate } from './useLate.ts'
import { useView } from './view.ts'
import { MENU } from './Up.tsx'

/**
 * You (#me): what's this person's own rather than the company's. Their
 * role (ADR 0034), who this device is signed in as and signing out, their own bookings' calendar
 * feed, dark or light (ADR 0036), and the device's own sync state. Reached from the Menu; the
 * company's settings stay under Admin.
 */
export function YouScreen() {
  const auth = useAuth()
  const view = useView()
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState('')
  // Signing out with changes still waiting sends them first, and asks only if some are still here.
  const [asking, setAsking] = useState(false)
  const [sending, setSending] = useState(false)
  const late = useLate(sending)
  const waiting = view.pendingCount
  const out = async () => {
    setAsking(false)
    setBusy(true)
    setProblem('')
    try {
      await signOut()
    } catch {
      setBusy(false)
      return setProblem("Couldn't reach the server to sign out. Try again when you have signal.")
    }
    // A shared or handed-back phone shouldn't keep the company's data.
    forgetCountDraft()
    await storage.wipe()
    location.replace('/')
  }

  // With signal, what's waiting is sent first, so signing out only asks when something would really be lost.
  const press = async () => {
    if (waiting > 0 && navigator.onLine && tabRole() === 'writer') {
      setSending(true)
      try {
        await client.sync()
      } catch {
        // Not sent: the question below says what would go.
      }
      setSending(false)
    }
    if (client.pendingCount > 0) setAsking(true)
    else void out()
  }
  const still = client.pendingCount

  return (
    <div className="app you">
      <Top view={view} title="You" up={{ steps: [MENU], here: 'You' }} />
      <h1>You</h1>

      {auth.status === 'open' && !auth.passcode && (
        <section className="card">
          <h2>No account yet</h2>
          <p>
            Sign-in is off on this copy, so there's nobody to show here. Once sign-in with Google is on, your name, your role and your own calendar
            feed are kept here, with signing out.
          </p>
        </section>
      )}

      {(auth.status === 'signed-in' || (auth.status === 'open' && auth.passcode)) && <RoleCard />}

      {auth.status === 'signed-in' && (
        <section className="card">
          <h2>Signed in</h2>
          <p className="who">
            <b>{auth.user.name}</b>
            <span>{auth.user.email}</span>
          </p>
          {asking ? (
            <Confirm
              question={`${still === 1 ? "1 change hasn't" : `${still} changes haven't`} synced yet. Signing out deletes ${still === 1 ? 'it' : 'them'} from this device.`}
              yes={`Sign out and delete ${still === 1 ? 'it' : 'them'}`}
              no="Stay signed in"
              onYes={() => void out()}
              onNo={() => setAsking(false)}
            />
          ) : (
            <button type="button" onClick={() => void press()} disabled={busy || sending} aria-busy={sending}>
              {late ? 'Sending changes first…' : 'Sign out'}
            </button>
          )}
          {problem && (
            <p className="alert" role="alert">
              {problem}
            </p>
          )}
          <p className="hint">Signing out also clears this device's copy of the data. It comes back when you sign in again.</p>
        </section>
      )}

      {auth.status === 'signed-in' && <FeedCard view={view} email={auth.user.email} />}

      <ThemeCard />

      <section className="card">
        <h2>This device</h2>
        <p className="hint">
          Device {client.clientId.slice(-6)} · change #{view.cursor} · {waiting === 0 ? 'nothing waiting to sync' : `${waiting} waiting to sync`}
        </p>
      </section>
    </div>
  )
}

/**
 * What this person can change (ADR 0034), and who changes that. While
 * nobody is a director, roles are off and it says so, with the way to
 * switch them on: making yourself the first director.
 */
function RoleCard() {
  const access = useAccess()
  const { reading } = useView()
  const { run, error } = useAct()
  const [asking, setAsking] = useState(false)
  if (access.rolesOff)
    return (
      <section className="card">
        <h2>Roles</h2>
        <p>
          Roles are off, so everyone signed in can change everything. They come on when someone is made a director, who then gives each member of
          staff theirs on the Crew tab.
        </p>
        {!access.personId ? (
          <p className="hint">To be the first director, put the email you sign in with on your own person on the Crew tab.</p>
        ) : asking ? (
          <Confirm
            question="Make yourself the director and switch roles on? Everyone else becomes staff crew until you give them a role on the Crew tab."
            yes="Make me the director"
            no="Not now"
            onYes={() => {
              setAsking(false)
              void run(() => client.mutate('person.role', { id: access.personId!, role: 'director' }))
            }}
            onNo={() => setAsking(false)}
          />
        ) : (
          <button type="button" onClick={() => setAsking(true)}>
            Switch roles on
          </button>
        )}
        <Refusal error={error} />
      </section>
    )
  if (!access.role) return null
  return (
    <section className="card">
      <h2>Your role</h2>
      <p>
        <b>{ROLE_LABELS[access.role]}</b>. {ROLE_LINES[access.role]}
      </p>
      <p>{readsLine(reading)}</p>
      <p className="hint">
        {access.role === 'director'
          ? 'You give everyone else their role on their person on the Crew tab.'
          : 'A director can change your role on your person on the Crew tab.'}
      </p>
    </section>
  )
}

/** What this device is sent of crew pay and links (ADR 0046), said plainly so a hidden figure isn't taken for a missing one. */
function readsLine(r: Reading): string {
  if (r.rates && r.links === 'all') return 'You see crew rates, timesheet amounts and private links.'
  const rates = r.rates ? 'You see crew rates and timesheet amounts' : "You don't see crew rates or timesheet amounts, other than your own"
  const links = r.links === 'department' ? "the private links of people in your department" : r.links === 'all' ? 'every private link' : 'no private link but your own'
  return `${rates}, and ${links}.`
}

const THEMES: readonly { theme: Theme; name: string; line: string }[] = [
  { theme: 'dark', name: 'Dark', line: 'Easier on the eyes in a dark venue or van.' },
  { theme: 'light', name: 'Light', line: 'Easier to read in daylight and the office.' },
  { theme: 'auto', name: "Match this device's setting", line: 'Dark or light as the phone or computer is set.' },
]

/** Dark or light for this device (ADR 0036): the same as the button top right, with following the device's own setting as well. */
function ThemeCard() {
  const { theme } = useTheme()
  return (
    <section className="card">
      <h2>Dark or light</h2>
      <div className="choices" role="radiogroup" aria-label="Dark or light">
        {THEMES.map((t) => (
          <label key={t.theme} className="signal">
            <input type="radio" name="theme" value={t.theme} checked={theme === t.theme} onChange={() => setTheme(t.theme)} />
            <span>
              <b>{t.name}</b>
              <small>{t.line}</small>
            </span>
          </label>
        ))}
      </div>
      <p className="hint">Kept on this device only. The button top right on every screen switches between the two.</p>
    </section>
  )
}
