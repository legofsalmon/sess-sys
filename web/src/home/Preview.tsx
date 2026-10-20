import type { PersonView, View } from '@sh/shared'
import { useEffect, useState } from 'react'
import { useAuth } from '../auth.ts'
import { chooseMe } from '../crew/Leave.tsx'
import { ThemeButton } from '../ThemeButton.tsx'
import { client } from '../sync.ts'
import { useLate } from '../useLate.ts'
import { useView } from '../view.ts'
import { saveHomeFor, type Saved } from './HomeScreen.tsx'

/**
 * The demo copy's way in (ADR 0033): before the app, a choice of whose
 * eyes to see it through, from the personas in docs/personas.md, and a line
 * under the company's name on every screen after it saying whose they are,
 * the name the way back to choose again (ADR 0036). Only on the passcode-locked demo, which holds made-up data
 * (ADR 0019): the live app has no such screen. Choosing one sets where the
 * app starts, how Home is shown and, where it matters, who "me" is, and
 * since roles (ADR 0034) it is the role that person has: the server holds
 * this browser to it, and the app offers only what it covers.
 */

export interface Persona {
  key: string
  name: string
  who: string
  sees: string
}

export const PERSONAS: readonly Persona[] = [
  { key: 'director', name: 'Director', who: 'Running the company', sees: 'Home for the whole company: today, what needs someone, the week ahead.' },
  { key: 'office', name: 'Office and production', who: 'Booking jobs and crew all day', sees: 'Crew: the answers to check, crew still needed, timesheets.' },
  { key: 'head', name: 'Head of department', who: 'Audio, LX, video or rigging', sees: 'Home for one department: its people, its kit, its leave and certificates.' },
  { key: 'warehouse', name: 'Warehouse', who: 'Getting the kit out and back', sees: "Home for the warehouse: what's going out, what's still out, what's broken." },
  { key: 'staff', name: 'Staff crew', who: 'Employed technicians', sees: 'Home for me: my bookings, my leave.' },
  { key: 'freelancer', name: 'Freelancer', who: 'Their own phone, no app, no login', sees: 'Their private page: offers to answer, bookings, timesheets.' },
]

const KEY = 'sh.preview'
/** Who the persona stands in for (ADR 0046): a member of staff, or a head's department, so the server sends what they would read. */
const WHO_KEY = 'sh.preview.who'
interface Who {
  personId?: string
  department?: string
}
const listeners = new Set<(key: string) => void>()
let current = read()
let who = readWho()

function read(): string {
  try {
    return localStorage.getItem(KEY) ?? ''
  } catch {
    return ''
  }
}

function readWho(): Who {
  try {
    const w = JSON.parse(localStorage.getItem(WHO_KEY) ?? '{}') as Who
    return { ...(typeof w.personId === 'string' ? { personId: w.personId } : {}), ...(typeof w.department === 'string' ? { department: w.department } : {}) }
  } catch {
    return {}
  }
}

const api = `${import.meta.env.VITE_API_BASE ?? ''}/api/auth/preview`

/** Tell the server which role to hold this browser to, and who it stands in for; with no signal the device still holds the role (web/src/role.ts). */
function tellServer(key: string, as: Who = who): Promise<unknown> {
  const role = key && key !== 'freelancer' ? (key === 'staff' ? 'crew' : key === 'warehouse' ? 'head' : key) : null
  return fetch(api, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ role, ...(role ? as : {}) }),
    signal: AbortSignal.timeout(8_000),
  }).catch(() => undefined)
}

/**
 * Once the server holds this browser to a new persona, the copy is read
 * again before the app opens as them, so a narrower one never sees what the
 * last was sent: the pull finds that what it's sent has changed and lets go
 * of money, rates and others' documents (shared/src/sync/client.ts). With no
 * signal it opens anyway, after a few seconds, on the copy it has.
 */
const readAgain = () => Promise.race([client.sync().catch(() => undefined), new Promise((done) => setTimeout(done, 8_000))])

function set(key: string, as: Who = {}, told = false) {
  current = key
  who = as
  if (!told) void tellServer(key)
  try {
    if (key) localStorage.setItem(KEY, key)
    else localStorage.removeItem(KEY)
    localStorage.setItem(WHO_KEY, JSON.stringify(as))
  } catch {
    // Private browsing can refuse storage; the choice holds this visit.
  }
  for (const fn of listeners) fn(key)
}

/** The persona chosen, outside a screen: the change guard reads it (ADR 0034). */
export const previewKey = () => current

/** Whose eyes the demo is seen through, if chosen. */
export function usePreview(): Persona | undefined {
  const [key, setKey] = useState(current)
  useEffect(() => {
    listeners.add(setKey)
    setKey(current)
    return () => void listeners.delete(setKey)
  }, [])
  return PERSONAS.find((p) => p.key === key)
}

/** Someone in the made-up data to be: the first, by name, who fits. */
const first = (people: readonly PersonView[], fits: (p: PersonView) => boolean) =>
  people.filter((p) => !p.archived && fits(p)).sort((a, b) => a.name.localeCompare(b.name))[0]

/** Where each persona starts, and as whom: who they stand in for goes to the server, so it sends what they'd read (ADR 0046). */
function start(view: View, key: string): { to: string; as?: Who } {
  const people = view.crew.people
  const home = (s: Saved) => saveHomeFor(s)
  switch (key) {
    case 'director':
      home({ for: 'company' })
      return { to: '#home' }
    case 'office':
      home({ for: 'company' })
      return { to: '#crew' }
    case 'head': {
      // The department with the most people in it, so there's the most to see.
      const counts = new Map<string, number>()
      for (const p of people) if (!p.archived && p.department) counts.set(p.department, (counts.get(p.department) ?? 0) + 1)
      const department = [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0]
      home({ for: 'department', department })
      return { to: '#home', ...(department ? { as: { department } } : {}) }
    }
    case 'warehouse': {
      home({ for: 'warehouse' })
      const hand = first(people, (p) => p.kind === 'staff' && p.skills.some((s) => /warehouse/i.test(s)))
      if (hand) chooseMe(hand.id)
      return { to: '#home', ...(hand ? { as: { personId: hand.id } } : {}) }
    }
    case 'staff': {
      home({ for: 'me' })
      // Someone who has work coming up, so there's something to see.
      const booked = new Set(view.crew.calls.flatMap((c) => c.offers.filter((o) => o.status === 'confirmed').map((o) => o.personId)))
      const me = first(people, (p) => p.kind === 'staff' && !p.approvesLeave && booked.has(p.id)) ?? first(people, (p) => p.kind === 'staff')
      if (me) chooseMe(me.id)
      return { to: '#home', ...(me ? { as: { personId: me.id } } : {}) }
    }
  }
  return { to: '#home' }
}

/**
 * The page of the freelancer with the most on it, which the server finds:
 * a persona seen before may have left this browser's copy without anyone's
 * link (ADR 0046).
 */
async function freelancerLink(): Promise<string | undefined> {
  try {
    const res = await fetch(api, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ role: 'freelancer' }), signal: AbortSignal.timeout(8_000) })
    const { link } = (await res.json()) as { link?: string | null }
    return typeof link === 'string' && link.startsWith('/f/') ? link : undefined
  } catch {
    return undefined
  }
}

export function PreviewSplash() {
  const view = useView()
  const [noLink, setNoLink] = useState(false)
  // The persona being opened, while the copy is read again for them.
  const [choosing, setChoosing] = useState<string>()
  const late = useLate(!!choosing)
  const pick = (p: Persona) => {
    if (p.key === 'freelancer') {
      void freelancerLink().then((link) => {
        if (!link) return setNoLink(true)
        set('freelancer')
        location.assign(link)
      })
      return
    }
    const { to, as } = start(view, p.key)
    setChoosing(p.key)
    void tellServer(p.key, as)
      .then(readAgain)
      .finally(() => {
        set(p.key, as, true)
        location.hash = to
        setChoosing(undefined)
      })
  }
  const noFreelancer = noLink || !view.crew.people.some((p) => p.kind === 'freelancer' && !p.archived)
  return (
    <div className="app preview">
      <header className="top">
        <div className="brand">
          <span className="mark">SH</span>
          <span>
            <b>Session Hire</b>
            <small className="where">Demo with made-up data</small>
          </span>
        </div>
        <div className="state">
          <ThemeButton />
        </div>
      </header>
      <h1 className="area-title">See it as…</h1>
      <p className="hint">Pick who you are, and the app opens where that person would start. Their name, under Session Hire at the top, brings you back here to choose someone else.</p>
      <ul className="personas">
        {PERSONAS.map((p) => (
          <li key={p.key}>
            <button
              type="button"
              onClick={() => !choosing && pick(p)}
              disabled={p.key === 'freelancer' && noFreelancer}
              aria-busy={choosing === p.key || undefined}
            >
              <b>{p.name}</b>
              <small>{p.who}</small>
              <span>{late && choosing === p.key ? "Opening it as they'd see it…" : p.sees}</span>
            </button>
          </li>
        ))}
      </ul>
      <p className="hint">
        Everyone can look at the work, but changes only what their role covers: the warehouse can't change a job, and staff crew only their own leave.
        Crew rates and freelancers' private links go only to those who need them, so the others see "hidden for your role" instead.
      </p>
    </div>
  )
}

/**
 * Whose eyes the demo is seen through, for the header under the company's
 * name (ADR 0036): only on the demo copy, and once someone is chosen.
 */
export function useSeenAs(): Persona | undefined {
  const auth = useAuth()
  const persona = usePreview()
  return auth.status === 'open' && auth.passcode === true ? persona : undefined
}

/** Said again as the app opens, so a browser that chose before roles came in, or offline, is held to it too. */
export function useHoldPersona(persona: Persona | undefined) {
  const key = persona?.key
  useEffect(() => {
    if (key) void tellServer(key)
  }, [key])
}
