import { dsDuration, dsTiming, makerOf, noticeLines, NOTICE_ENTITIES, NOTICE_WHY_WORDS, plural, type Notice, type NoticeLine, type NoticesPage, type View } from '@sh/shared'
import { useSyncExternalStore } from 'react'
import { currentAuth, markSignedOut, onAuth } from './auth.ts'
import { client } from './sync.ts'

/**
 * Notifications (ADR 0058): what others changed lately on what's this
 * person's own, read from the server's history, so it needs signal like
 * the History tab does. Looked for once the device's copy has been read to
 * the end, and again whenever a pull lands a change of a kind a
 * notification can be about (a job, a call, an offer, a person's own
 * records): the server's poke sets the pull off as soon as anyone changes
 * anything, so a change made in the office is here, and pops up, within a
 * second or two, while a warehouse's scans, or each page of a first copy,
 * cost no look at all (audit, 20 October 2026, finding 14). In the app
 * only: nothing is emailed, texted or pushed to anyone.
 *
 * Pop-ups are only for what arrives while the app is open: what came while
 * it was shut is counted on the bell instead, so opening the app never
 * buries the screen under a backlog.
 */

const base = import.meta.env.VITE_API_BASE ?? ''
const TOASTS_KEY = 'sh.notices.toasts'
/** More than this arriving together is one pop-up that counts them (Aggregation). */
const BUNDLE_OVER = 2

export interface NoticesState {
  status: 'loading' | 'offline' | 'ready'
  notices: Notice[]
  readUpTo: string | null
  found: boolean
}

export interface Toast {
  id: string
  title: string
  body: string
  /** Where its one action, Open, goes. */
  href?: string
  action?: string
  leaving?: boolean
}

let state: NoticesState = { status: 'loading', notices: [], readUpTo: null, found: true }
let toasts: Toast[] = []
const listeners = new Set<() => void>()
const tell = () => {
  for (const fn of listeners) fn()
}
const subscribe = (fn: () => void) => {
  listeners.add(fn)
  return () => void listeners.delete(fn)
}

export const useNotices = () => useSyncExternalStore(subscribe, () => state)
export const useToasts = () => useSyncExternalStore(subscribe, () => toasts)

/** New: reached the server after they last opened the list. */
export const isNew = (n: Pick<Notice, 'arrivedAt'>, readUpTo: string | null) => readUpTo === null || n.arrivedAt > readUpTo
/** The list's lines (audit, 20 October 2026, finding 68): one maker's bulk change is one, and a day's changes to one job are one. */
export const linesOf = (notices: readonly Notice[], view: View): NoticeLine[] => noticeLines(notices, (n) => jobOfNotice(n, view))
/** What the bell counts: the lines with something new on them. */
export const unreadCount = (s: NoticesState, view: View) => linesOf(s.notices, view).filter((l) => l.notices.some((n) => isNew(n, s.readUpTo))).length

/** The job a change touched, when it's one on this device's copy. */
export function jobOfNotice(n: Pick<Notice, 'about' | 'records'>, view: View): string | undefined {
  const place = placeOf(n, view)
  return place?.startsWith('#jobs/') ? place.slice('#jobs/'.length) : undefined
}

/** Pop-ups for changes as they come in: on unless this person turned them off, on this device. */
export function toastsOn(): boolean {
  try {
    return localStorage.getItem(TOASTS_KEY) !== 'off'
  } catch {
    return true
  }
}
export function setToastsOn(on: boolean) {
  try {
    if (on) localStorage.removeItem(TOASTS_KEY)
    else localStorage.setItem(TOASTS_KEY, 'off')
  } catch {
    // Storage refused, in private browsing: it holds for this visit only.
  }
  if (!on) for (const t of toasts) dismissToast(t.id)
  tell()
}

const signedIn = () => {
  const auth = currentAuth()
  return auth.status === 'signed-in' || auth.status === 'open'
}

let loading: Promise<void> | undefined
let again = false
/** Ids seen in the list so far: anything else that arrives later than the newest of them pops up. */
let seen: Set<string> | undefined

/** Look again. Calls while one is under way run once more after it. */
export function loadNotices(): Promise<void> {
  if (loading) {
    again = true
    return loading
  }
  loading = (async () => {
    try {
      do {
        again = false
        await loadOnce()
      } while (again)
    } finally {
      loading = undefined
    }
  })()
  return loading
}

async function loadOnce() {
  if (!signedIn()) return
  let page: NoticesPage
  try {
    const res = await fetch(`${base}/api/notices?client=${encodeURIComponent(client.clientId)}`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(10_000),
    })
    if (res.status === 401) return markSignedOut()
    if (!res.ok) throw new Error(`Server answered ${res.status}`)
    page = (await res.json()) as NoticesPage
  } catch {
    // No signal: what was found last time stays, said quietly on the list.
    state = { ...state, status: state.status === 'ready' ? 'ready' : 'offline' }
    return tell()
  }
  const before = seen
  seen = new Set(page.notices.map((n) => n.id))
  if (before) {
    const newest = state.notices[0]?.arrivedAt ?? ''
    // Only what reached the server since the last look: a job they've just been put on brings its past with it, which isn't news.
    arrived(page.notices.filter((n) => !before.has(n.id) && n.arrivedAt > newest && isNew(n, page.readUpTo)))
  }
  // A look that set off before the list was opened doesn't bring back what opening it read.
  const readUpTo = state.readUpTo !== null && (page.readUpTo === null || state.readUpTo > page.readUpTo) ? state.readUpTo : page.readUpTo
  state = { status: 'ready', notices: page.notices, readUpTo, found: page.found }
  tell()
}

/** Opening the list reads it, up to the newest change in it, on every device they use. */
export async function markAllRead() {
  const newest = state.notices[0]?.arrivedAt
  if (!newest || !isNew({ arrivedAt: newest }, state.readUpTo)) return
  state = { ...state, readUpTo: newest }
  tell()
  try {
    await fetch(`${base}/api/notices/read`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ upTo: newest, client: client.clientId }),
      signal: AbortSignal.timeout(10_000),
    })
  } catch {
    // Kept here meanwhile; the next time the list is opened with signal says it again.
  }
}

/** Where a change leads: the page of the thing of theirs it changed, from this device's own copy. */
export function placeOf(n: Pick<Notice, 'about' | 'records'>, view: View): string | undefined {
  for (const r of [n.about, ...n.records]) {
    const place = recordPlace(r, view)
    if (place) return place
  }
  return undefined
}

function recordPlace({ entity, id }: { entity: string; id: string }, view: View): string | undefined {
  const job = (projectId: string | null | undefined) =>
    projectId && view.jobs.jobs.some((j) => j.id === projectId) ? `#jobs/${projectId}` : undefined
  switch (entity) {
    case 'project':
      return job(id)
    case 'phase':
      return job(view.jobs.jobs.find((j) => j.phases.some((p) => p.id === id))?.id)
    case 'crewCall':
      return job(view.crew.calls.find((c) => c.id === id)?.projectId)
    case 'offer':
      return job(view.crew.calls.find((c) => c.offers.some((o) => o.id === id))?.projectId)
    case 'person':
      return view.crew.people.some((p) => p.id === id) ? `#crew/person/${id}` : undefined
    case 'leaveRequest':
    case 'lieuEntry':
    case 'leaveAllowance':
      return '#crew/leave'
    case 'timesheet':
      return '#crew/timesheets'
    // A job's step (ADR 0073): "<job>.<step>", opened on its job, whose steps are at the top.
    case 'jobStep':
      return job(id.slice(0, id.lastIndexOf('.')))
    // A request on the purchase list (ADR 0077), on its own page.
    case 'purchaseRequest':
      return `#stock/buy/${encodeURIComponent(id)}`
    default:
      return undefined
  }
}

const onTheList = () => location.hash === '#notifications'

function arrived(news: Notice[]) {
  // Already looking at the list, or they'd rather not: the list and the bell carry it.
  if (news.length === 0 || onTheList() || !toastsOn()) return
  const view = client.view()
  if (news.length > BUNDLE_OVER) {
    const people = [...new Set(news.map(makerOf))]
    showToast({
      id: `bundle-${news[0]!.id}`,
      title: `${plural(news.length, 'change')} to what's yours`,
      body: people.length === 1 ? `By ${people[0]}` : `By ${people.slice(0, -1).join(', ')} and ${people.at(-1)}`,
      href: '#notifications',
      action: 'See them',
    })
    return
  }
  for (const n of [...news].reverse()) {
    const href = placeOf(n, view)
    showToast({ id: n.id, title: n.what, body: `${makerOf(n)} · ${NOTICE_WHY_WORDS[n.why]}`, ...(href ? { href, action: 'Open' } : {}) })
  }
}

// Each pop-up's timer: how long it has left, and when it last started counting, so a pause picks up where it stopped (WCAG 2.2.1).
const timers = new Map<string, { left: number; since: number; handle?: ReturnType<typeof setTimeout> }>()

function showToast(t: Toast) {
  if (toasts.some((x) => x.id === t.id)) return
  toasts = [...toasts, t]
  timers.set(t.id, { left: dsTiming.notice, since: Date.now() })
  resumeToast(t.id)
  tell()
}

/** The pointer or the keyboard is on it: it waits. */
export function pauseToast(id: string) {
  const t = timers.get(id)
  if (!t?.handle) return
  clearTimeout(t.handle)
  t.handle = undefined
  t.left = Math.max(0, t.left - (Date.now() - t.since))
}

export function resumeToast(id: string) {
  const t = timers.get(id)
  if (!t || t.handle) return
  t.since = Date.now()
  t.handle = setTimeout(() => dismissToast(id), t.left)
}

/** It sinks back to its edge, then goes. */
export function dismissToast(id: string) {
  const t = timers.get(id)
  if (t?.handle) clearTimeout(t.handle)
  timers.delete(id)
  if (!toasts.some((x) => x.id === id && !x.leaving)) return
  toasts = toasts.map((x) => (x.id === id ? { ...x, leaving: true } : x))
  tell()
  const gone = matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : dsDuration.base
  setTimeout(() => {
    toasts = toasts.filter((x) => x.id !== id)
    tell()
  }, gone)
}

// Look once the copy is read to the end, not at each page of it; then again only when a pull lands a change in a table a
// notification can be about. The server pokes every device when anyone changes anything, and most changes are no one's news.
let lookedAt: number | undefined
client.subscribe((view) => {
  if (view.copying || view.cursor === lookedAt) return
  const pulled = client.takePulled()
  const first = lookedAt === undefined
  lookedAt = view.cursor
  if (first || NOTICE_ENTITIES.some((e) => pulled.has(e))) void loadNotices()
})
// Signed in after the app opened, or back from the sign-in page: look now rather than at the next change.
let wasIn = signedIn()
onAuth(() => {
  const isIn = signedIn()
  if (isIn && !wasIn) void loadNotices()
  wasIn = isIn
})
addEventListener('online', () => void loadNotices())
