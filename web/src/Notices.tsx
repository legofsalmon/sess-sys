import { historyDays, historyTime, NOTICE_WHY_WORDS, type Notice } from '@sh/shared'
import { useEffect, useMemo, useState } from 'react'
import { useAuth } from './auth.ts'
import { Empty } from './Empty.tsx'
import { Icon } from './Icon.tsx'
import { Top } from './jobs/common.tsx'
import {
  dismissToast,
  isNew,
  loadNotices,
  markAllRead,
  pauseToast,
  placeOf,
  resumeToast,
  setToastsOn,
  toastsOn,
  unreadCount,
  useNotices,
  useToasts,
} from './notices.ts'
import { MENU } from './Up.tsx'
import { useLate } from './useLate.ts'
import { useView } from './view.ts'

/**
 * Notifications (ADR 0058): the bell in the top bar with how many are new,
 * the list it opens (#notifications, under the Menu), and the pop-ups at the
 * screen's edge as changes come in. Built from the design system's badge,
 * toast and toaster; the list is the History tab's rows, narrowed to what's
 * this person's own.
 */

/**
 * Where pop-ups arrive: one region, there from the start so a screen reader
 * hears each as it's added, at the bottom corner, above the phone's bar.
 * Each has one action (Open, or See them) and Dismiss, and waits while the
 * pointer or the keyboard is on it.
 */
export function Toaster() {
  const toasts = useToasts()
  return (
    <section className="toaster" aria-label="Notifications">
      <div role="status">
        {toasts.map((t) => (
          <div
            key={t.id}
            className="toast"
            data-leaving={t.leaving ? 'true' : undefined}
            onPointerEnter={() => pauseToast(t.id)}
            onPointerLeave={() => resumeToast(t.id)}
            onFocus={() => pauseToast(t.id)}
            onBlur={(e) => !e.currentTarget.contains(e.relatedTarget) && resumeToast(t.id)}
          >
            <div className="toast-body">
              <b>{t.title}</b>
              <small>{t.body}</small>
            </div>
            <div className="toast-actions">
              {t.href && (
                <a className="button" href={t.href} onClick={() => dismissToast(t.id)}>
                  {t.action}
                </a>
              )}
              <button type="button" className="toast-dismiss" onClick={() => dismissToast(t.id)} aria-label={`Dismiss: ${t.title}`}>
                <Icon name="close" />
              </button>
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}

/** The list: what others changed lately on what's yours, newest first, under the day it reached the server. */
export function NoticesScreen() {
  const view = useView()
  const auth = useAuth()
  const notices = useNotices()
  const late = useLate(notices.status === 'loading')
  const [popUps, setPopUps] = useState(toastsOn)
  // What was new as the list was opened stays marked while it's open, though opening it reads them.
  const [readAsOpened] = useState(notices.readUpTo)
  const [opened] = useState(() => notices.status === 'ready')
  const mark = opened ? readAsOpened : notices.readUpTo
  useEffect(() => void loadNotices(), [])
  useEffect(() => {
    if (notices.status === 'ready') void markAllRead()
  }, [notices.status, notices.notices[0]?.id])

  const byId = useMemo(() => new Map(notices.notices.map((n) => [n.id, n])), [notices.notices])
  const days = useMemo(() => historyDays(notices.notices), [notices.notices])

  return (
    <div className="app notices">
      <Top view={view} title="Menu" up={{ steps: [MENU], here: 'Notifications' }} />
      <h1>Notifications</h1>

      <section className="card">
        <p className="hint">
          What others changed in the last 30 days on what's yours: the jobs you're on or made, the offers you sent, and your own details, bookings,
          leave and timesheets. Your own changes aren't here. They stay in the app: nobody is emailed or texted.
        </p>
        <label className="signal">
          <input
            type="checkbox"
            role="switch"
            checked={popUps}
            onChange={(e) => {
              setToastsOn(e.target.checked)
              setPopUps(e.target.checked)
            }}
          />
          <span>
            <b>Pop up as they come in</b>
            <small>
              {popUps
                ? 'Each change shows at the bottom of the screen for a few seconds, on this device.'
                : 'Off on this device: they wait here, counted on the bell.'}
            </small>
          </span>
        </label>
        {notices.status === 'ready' && !notices.found && auth.status === 'signed-in' && (
          <p className="hint">Your email isn't on anyone on the Crew tab, so only the jobs you made and the offers you sent are yours here.</p>
        )}
        {notices.status === 'loading' && late && <p className="hint">Getting your notifications…</p>}
        {notices.status === 'offline' && (
          <>
            <p className="hint">Notifications need signal: they're kept on the server, not on this device.</p>
            <button type="button" onClick={() => void loadNotices()}>
              Try again
            </button>
          </>
        )}
        {notices.status === 'ready' && notices.notices.length === 0 && (
          <Empty>When someone changes a job you're on, your leave or an offer you sent, it shows here.</Empty>
        )}
      </section>

      {days.map((d) => (
        <section className="card day" key={d.day} aria-labelledby={`notices-${d.day}`}>
          <h2 id={`notices-${d.day}`}>{d.label}</h2>
          <ol className="entries">
            {d.runs
              .flatMap((r) => r.entries)
              .map((e) => byId.get(e.id))
              .filter((n): n is Notice => n !== undefined)
              .map((n) => (
                <NoticeRow key={n.id} notice={n} day={d.day} fresh={isNew(n, mark)} href={placeOf(n, view)} />
              ))}
          </ol>
        </section>
      ))}
    </div>
  )
}

function NoticeRow({ notice: n, day, fresh, href }: { notice: Notice; day: string; fresh: boolean; href?: string }) {
  return (
    <li className={fresh ? 'entry notice new' : 'entry notice'}>
      <p>
        {/* New in words as well as the dot: never colour alone. */}
        {fresh && (
          <span className="new-mark">
            <span className="dot" aria-hidden="true" />
            New<span className="sr-only">: </span>
          </span>
        )}
        {href ? <a href={href}>{n.what}</a> : n.what}
      </p>
      <span className="meta">
        {n.who.name} · {NOTICE_WHY_WORDS[n.why]} · {historyTime(n.arrivedAt, day)}
      </span>
    </li>
  )
}
