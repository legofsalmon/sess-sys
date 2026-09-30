import { irishToday, type CalendarCheck, type CalendarChoice, type CalendarLink, type View } from '@sh/shared'
import { useEffect, useState, type FormEvent } from 'react'
import { markSignedOut } from './auth.ts'
import { when } from './format.ts'
import { client, syncSoon } from './sync.ts'

/**
 * Google Calendar (ADR 0008), as the Account tab shows it: connecting the
 * Google account that writes the jobs, choosing its calendar, how it is
 * going, and disconnecting. The connection reaches every device through the
 * sync like everything else, so all of them show the same.
 */

const base = import.meta.env.VITE_API_BASE ?? ''

type Note = { ok: boolean; text: string }

const OUTCOMES: Record<string, Note> = {
  connected: { ok: true, text: 'Connected to Google.' },
  cancelled: { ok: false, text: 'Connecting Google Calendar was cancelled.' },
  failed: { ok: false, text: "Connecting Google Calendar didn't work. Please try again." },
  missing: {
    ok: false,
    text: "Google Calendar wasn't connected, because a permission was left unticked on Google's page. Connect again and allow both: seeing the list of calendars, and changing events.",
  },
  off: { ok: false, text: 'Google Calendar needs the Google key on the server first.' },
}

/**
 * How the last try at connecting went. The server says so in the address
 * it sends the browser back to; it is read once and tidied away.
 */
const outcome = (() => {
  const params = new URLSearchParams(location.search)
  const got = params.get('calendar')
  if (!got) return undefined
  params.delete('calendar')
  const query = params.toString()
  history.replaceState(null, '', `${location.pathname}${query ? `?${query}` : ''}${location.hash}`)
  return OUTCOMES[got] ?? OUTCOMES.failed
})()

const connectUrl = () => `${base}/api/calendar/connect?client=${encodeURIComponent(client.clientId)}`

/** Ask the server to do something with the calendar, and say what went wrong in words if it didn't. */
async function ask<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response
  try {
    res = await fetch(`${base}${path}`, { cache: 'no-store', signal: AbortSignal.timeout(60_000), ...init })
  } catch {
    throw new Error("Couldn't reach the server. Try again when you have signal.")
  }
  if (res.status === 401) {
    markSignedOut()
    throw new Error('Signed out.')
  }
  if (!res.ok) {
    const { error } = (await res.json().catch(() => ({}))) as { error?: string }
    throw new Error(error ?? `The server answered ${res.status}. Try again in a minute.`)
  }
  return (await res.json()) as T
}

const post = <T,>(path: string, body?: unknown) =>
  ask<T>(`${path}?client=${encodeURIComponent(client.clientId)}`, {
    method: 'POST',
    ...(body === undefined ? {} : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
  })

/** "Checked: all 12 days are as they should be." */
function checked(r: CalendarCheck, onIt: number): string {
  if (r.problem) return r.problem
  const did = [r.written && `wrote ${r.written} ${r.written === 1 ? 'day' : 'days'}`, r.removed && `took ${r.removed} off`].filter(Boolean)
  const failed = r.failed ? ` ${r.failed === 1 ? "1 day couldn't" : `${r.failed} days couldn't`} be written; the job pages say why.` : ''
  if (did.length) return `Checked: ${did.join(' and ')}.${failed}`
  return failed ? `Checked.${failed}` : `Checked: ${onIt === 1 ? 'the 1 day is' : `all ${onIt} days are`} as they should be.`
}

export function CalendarCard({ view, available }: { view: View; available: boolean }) {
  const link = view.calendar.link
  const [note, setNote] = useState<Note | undefined>(outcome)
  const [busy, setBusy] = useState(false)
  const [picking, setPicking] = useState(false)

  const run = async (what: () => Promise<Note | undefined>) => {
    setBusy(true)
    setNote(undefined)
    try {
      setNote(await what())
    } catch (err) {
      setNote({ ok: false, text: (err as Error).message })
    } finally {
      setBusy(false)
      syncSoon()
    }
  }

  const today = irishToday()
  const onIt = Object.values(view.calendar.days).filter((d) => d.state === 'on' && d.day >= today && d.calendarId === link?.calendarId).length

  const disconnect = () => {
    const where = link?.calendarName ? ` off ${link.calendarName}` : ''
    if (!confirm(`Disconnect Google Calendar? The app takes its days${where} from today on, and hands back its access. Days before today stay.`)) return
    void run(async () => {
      await post<CalendarLink>('/api/calendar/disconnect')
      return undefined
    })
  }

  const noteLine = note && (
    <p className={note.ok ? 'hint' : 'alert'} role={note.ok ? 'status' : 'alert'}>
      {note.text}
    </p>
  )

  if (!available) {
    return (
      <section className="card" aria-label="Google Calendar">
        <h2>Google Calendar</h2>
        <p>Confirmed jobs can go on a Google calendar for everyone to see. That needs the Google key on the server, the same one as sign-in.</p>
        {noteLine}
      </section>
    )
  }

  if (!link || link.state === 'off') {
    return (
      <section className="card" aria-label="Google Calendar">
        <h2>Google Calendar</h2>
        <p>
          Put every day of every confirmed job on a Google calendar, from today on, kept up to date as jobs change. Connect the Google account
          that should write them, then choose its calendar.
        </p>
        {link?.problem && <p className="alert">{link.problem}</p>}
        {noteLine}
        <a className="button primary" href={connectUrl()}>
          Connect Google Calendar
        </a>
        <p className="hint">
          The app asks Google only to see that account's list of calendars and to change events. Crew show by name only: rates, phone
          numbers and emails stay in the app.
        </p>
      </section>
    )
  }

  if (link.state === 'stopping') {
    return (
      <section className="card" aria-label="Google Calendar">
        <h2>Google Calendar</h2>
        <p>Disconnecting: taking the app's days off {link.calendarName ?? 'the calendar'}…</p>
        {noteLine}
      </section>
    )
  }

  if (link.state === 'reconnect') {
    return (
      <section className="card attention" aria-label="Google Calendar">
        <h2>Google Calendar needs connecting again</h2>
        {link.problem && <p className="alert">{link.problem}</p>}
        {noteLine}
        <div className="actions">
          <a className="button primary" href={connectUrl()}>
            Connect again
          </a>
          <button type="button" className="link" onClick={disconnect} disabled={busy}>
            Disconnect
          </button>
        </div>
        <p className="hint">Until then nothing on {link.calendarName ?? 'the calendar'} is updated. Everything else in the app carries on.</p>
      </section>
    )
  }

  if (link.state === 'choosing' || picking) {
    const use = (choice: CalendarChoice) => {
      if (
        link.state === 'on' &&
        link.calendarName &&
        !confirm(`Move the app's days from ${link.calendarName} to ${choice.name}? Days before today stay where they are.`)
      )
        return
      void run(async () => {
        await post<CalendarLink>('/api/calendar/use', { calendarId: choice.id })
        setPicking(false)
        return { ok: true, text: `Jobs go on ${choice.name} from now on.` }
      })
    }
    return (
      <section className="card" aria-label="Google Calendar">
        <h2>Choose the calendar</h2>
        <p>
          Connected as <b>{link.account}</b>. Which of its calendars should the jobs go on?
        </p>
        {noteLine}
        <Picker current={link.calendarId} busy={busy} onUse={use} />
        <div className="actions">
          {picking && (
            <button type="button" onClick={() => setPicking(false)} disabled={busy}>
              Keep {link.calendarName}
            </button>
          )}
          <button type="button" className="link" onClick={disconnect} disabled={busy}>
            Disconnect
          </button>
        </div>
        <p className="hint">A calendar of its own, shared with the crew and the office, keeps jobs apart from people's own plans.</p>
      </section>
    )
  }

  return (
    <section className={link.problem ? 'card attention' : 'card'} aria-label="Google Calendar">
      <h2>Google Calendar</h2>
      <p>
        Confirmed jobs go on <b>{link.calendarName}</b>, written by {link.account}.
      </p>
      {link.problem && (
        <p className="alert" role="alert">
          {link.problem}
        </p>
      )}
      {noteLine}
      <div className="actions">
        <button type="button" onClick={() => void run(async () => ({ ok: true, text: checked(await post<CalendarCheck>('/api/calendar/check'), onIt) }))} disabled={busy}>
          {busy ? 'Checking…' : 'Check now'}
        </button>
        <button type="button" onClick={() => setPicking(true)} disabled={busy}>
          Change calendar
        </button>
        <button type="button" className="link" onClick={disconnect} disabled={busy}>
          Disconnect
        </button>
      </div>
      <p className="hint">
        {onIt === 0 ? 'Nothing' : onIt === 1 ? '1 day' : `${onIt} days`} on it from today.
        {link.connectedBy && link.connectedAt ? ` Connected by ${link.connectedBy} ${when(link.connectedAt)}.` : ''} Changes in the app reach
        the calendar within seconds; each night the app also puts back anything changed there by hand.
      </p>
    </section>
  )
}

type Loaded = { state: 'loading' } | { state: 'failed'; text: string } | { state: 'ready'; choices: CalendarChoice[] }

/** The calendars the connected account can change, to pick one. */
function Picker({ current, busy, onUse }: { current: string | null; busy: boolean; onUse: (choice: CalendarChoice) => void }) {
  const [loaded, setLoaded] = useState<Loaded>({ state: 'loading' })
  const [chosen, setChosen] = useState(current ?? '')
  const load = () => {
    setLoaded({ state: 'loading' })
    ask<CalendarChoice[]>('/api/calendar/calendars').then(
      (choices) => setLoaded({ state: 'ready', choices }),
      (err: Error) => setLoaded({ state: 'failed', text: err.message })
    )
  }
  useEffect(load, [])

  if (loaded.state === 'loading') return <p className="hint">Getting the account's calendars…</p>
  if (loaded.state === 'failed')
    return (
      <>
        <p className="alert">{loaded.text}</p>
        <button type="button" onClick={load}>
          Try again
        </button>
      </>
    )
  const { choices } = loaded
  if (choices.length === 0) return <p className="alert">This account can't change any calendars. Share one with it, with permission to make changes, then connect again.</p>
  const submit = (e: FormEvent) => {
    e.preventDefault()
    const choice = choices.find((c) => c.id === chosen)
    if (choice) onUse(choice)
  }
  return (
    <form className="choices" onSubmit={submit}>
      {choices.map((c) => (
        <label key={c.id} className="signal">
          <input type="radio" name="calendar" value={c.id} checked={chosen === c.id} onChange={() => setChosen(c.id)} />
          <span>
            <b>{c.name}</b>
            <small>{c.primary ? "The account's own calendar" : c.access === 'owner' ? 'Owned by this account' : 'Shared with this account'}</small>
          </span>
        </label>
      ))}
      <button type="submit" className="primary" disabled={busy || !chosen || chosen === current}>
        Use this calendar
      </button>
    </form>
  )
}
