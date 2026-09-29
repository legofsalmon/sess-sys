import { useEffect, useState } from 'react'
import { signInProblem, signInUrl } from './auth.ts'
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
        {signInProblem && (
          <p className="alert" role="alert">
            {PROBLEMS[signInProblem]}
          </p>
        )}
        <p>Use your Session Hire Google account.</p>
        <a className="button primary" href={signInUrl(location.hash || '#stock')}>
          Sign in with Google
        </a>
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
