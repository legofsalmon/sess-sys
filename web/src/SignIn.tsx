import { useEffect, useState } from 'react'
import { enterPasscode, signInProblem, signInUrl, useAuth } from './auth.ts'
import { client } from './sync.ts'

const PROBLEMS = {
  denied: "That Google account isn't set up for Session Hire. Use your sessionhire.com account, or ask the office to add you.",
  cancelled: 'Sign-in was cancelled.',
  failed: "Sign-in didn't work. Please try again.",
}

/**
 * What a device that isn't signed in sees instead of the app: nothing of
 * the company's, just the way in. Changes made on the device before it was
 * signed out stay in its outbox and go once someone signs in.
 */
export function SignIn() {
  const auth = useAuth()
  const passcode = auth.status === 'signed-out' && auth.passcode
  const [pending, setPending] = useState(() => client.view().pendingCount)
  useEffect(() => client.subscribe((view) => setPending(view.pendingCount)), [])
  const [online, setOnline] = useState(navigator.onLine)
  useEffect(() => {
    const update = () => setOnline(navigator.onLine)
    addEventListener('online', update)
    addEventListener('offline', update)
    return () => {
      removeEventListener('online', update)
      removeEventListener('offline', update)
    }
  }, [])

  return (
    <div className="app signin">
      <header className="top">
        <div className="brand">
          <span className="mark">SH</span>
          <span>
            <b>Session Hire</b>
            <small>Staff sign-in</small>
          </span>
        </div>
      </header>
      <section className="card">
        <h1>Sign in</h1>
        {passcode ? (
          <PasscodeForm />
        ) : (
          <>
            {signInProblem && (
              <p className="alert" role="alert">
                {PROBLEMS[signInProblem]}
              </p>
            )}
            <p>Use your Session Hire Google account.</p>
            <a className="button primary" href={signInUrl(location.hash || '#jobs')}>
              Sign in with Google
            </a>
          </>
        )}
        {!online && <p className="hint">No signal right now. Sign in when you're back online.</p>}
        {pending > 0 && (
          <p className="hint">
            {pending === 1 ? '1 change' : `${pending} changes`} made on this device {pending === 1 ? 'is' : 'are'} waiting, and will sync once you're signed in.
          </p>
        )}
      </section>
    </div>
  )
}

/** A demo copy's way in: one passcode shared with whoever is shown the demo. */
function PasscodeForm() {
  const [value, setValue] = useState('')
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string>()
  return (
    <form
      className="passcode"
      onSubmit={(e) => {
        e.preventDefault()
        setBusy(true)
        setProblem(undefined)
        void enterPasscode(value).then((p) => {
          setBusy(false)
          setProblem(p)
        })
      }}
    >
      <p>This is a demo with made-up data. Enter the passcode you were given.</p>
      {problem && (
        <p className="alert" role="alert">
          {problem}
        </p>
      )}
      <label className="field">
        Passcode
        <input type="password" autoComplete="current-password" value={value} onChange={(e) => setValue(e.target.value)} required />
      </label>
      <button type="submit" className="primary" disabled={busy || !value.trim()}>
        Open the demo
      </button>
    </form>
  )
}
