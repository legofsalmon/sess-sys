import type { PersonView, View } from '@sh/shared'
import { useEffect, useState } from 'react'
import { chooseMe } from '../crew/Leave.tsx'
import { useView } from '../view.ts'
import { saveHomeFor, type Saved } from './HomeScreen.tsx'

/**
 * The demo copy's way in (ADR 0033): before the app, a choice of whose
 * eyes to see it through, from the personas in docs/personas.md, and a bar
 * on every screen after it saying whose they are, with the way back to
 * choose again. Only on the passcode-locked demo, which holds made-up data
 * (ADR 0019): the live app has no such screen. Choosing one sets where the
 * app starts, how Home is shown and, where it matters, who "me" is; it
 * doesn't hide anything, as the app has no roles yet.
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
const listeners = new Set<(key: string) => void>()
let current = read()

function read(): string {
  try {
    return localStorage.getItem(KEY) ?? ''
  } catch {
    return ''
  }
}

function set(key: string) {
  current = key
  try {
    if (key) localStorage.setItem(KEY, key)
    else localStorage.removeItem(KEY)
  } catch {
    // Private browsing can refuse storage; the choice holds this visit.
  }
  for (const fn of listeners) fn(key)
}

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

/** Where each persona starts, and as whom. */
function start(view: View, key: string) {
  const people = view.crew.people
  const home = (s: Saved) => saveHomeFor(s)
  switch (key) {
    case 'director':
      home({ for: 'company' })
      return '#home'
    case 'office':
      home({ for: 'company' })
      return '#crew'
    case 'head': {
      // The department with the most people in it, so there's the most to see.
      const counts = new Map<string, number>()
      for (const p of people) if (!p.archived && p.department) counts.set(p.department, (counts.get(p.department) ?? 0) + 1)
      const department = [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0]
      home({ for: 'department', department })
      return '#home'
    }
    case 'warehouse': {
      home({ for: 'warehouse' })
      const hand = first(people, (p) => p.kind === 'staff' && p.skills.some((s) => /warehouse/i.test(s)))
      if (hand) chooseMe(hand.id)
      return '#home'
    }
    case 'staff': {
      home({ for: 'me' })
      // Someone who has work coming up, so there's something to see.
      const booked = new Set(view.crew.calls.flatMap((c) => c.offers.filter((o) => o.status === 'confirmed').map((o) => o.personId)))
      const me = first(people, (p) => p.kind === 'staff' && !p.approvesLeave && booked.has(p.id)) ?? first(people, (p) => p.kind === 'staff')
      if (me) chooseMe(me.id)
      return '#home'
    }
  }
  return '#home'
}

/** The freelancer whose page has the most on it: offers and bookings coming up. */
function freelancerLink(view: View): string | undefined {
  const busy = new Map<string, number>()
  for (const c of view.crew.calls) for (const o of c.offers) if (['offered', 'accepted', 'confirmed'].includes(o.status)) busy.set(o.personId, (busy.get(o.personId) ?? 0) + 1)
  const best = view.crew.people
    .filter((p) => p.kind === 'freelancer' && !p.archived && p.linkToken)
    .sort((a, b) => (busy.get(b.id) ?? 0) - (busy.get(a.id) ?? 0) || a.name.localeCompare(b.name))[0]
  return best && `/f/${best.linkToken}`
}

export function PreviewSplash() {
  const view = useView()
  const pick = (p: Persona) => {
    if (p.key === 'freelancer') {
      const link = freelancerLink(view)
      if (link) {
        set('freelancer')
        location.assign(link)
        return
      }
    }
    const to = start(view, p.key)
    set(p.key)
    location.hash = to
  }
  const noFreelancer = !freelancerLink(view)
  return (
    <div className="app preview">
      <header className="top">
        <div className="brand">
          <span className="mark">SH</span>
          <span>
            <b>Session Hire</b>
            <small>Demo with made-up data</small>
          </span>
        </div>
      </header>
      <h1 className="area-title">See it as…</h1>
      <p className="hint">Pick who you are, and the app opens where that person would start. A bar at the top takes you back here to choose someone else.</p>
      <ul className="personas">
        {PERSONAS.map((p) => (
          <li key={p.key}>
            <button type="button" onClick={() => pick(p)} disabled={p.key === 'freelancer' && noFreelancer}>
              <b>{p.name}</b>
              <small>{p.who}</small>
              <span>{p.sees}</span>
            </button>
          </li>
        ))}
      </ul>
      <p className="hint">Everyone signed in can open every tab today; the app has no roles yet. This shows where each person starts and what they look at first.</p>
    </div>
  )
}

/** On every screen once a persona is chosen: whose eyes, and the way back to choose again. */
export function PreviewBar({ persona }: { persona: Persona }) {
  return (
    <div className="preview-bar" role="note">
      <span>
        Seeing it as <b>{persona.name}</b>
      </span>
      <button
        type="button"
        onClick={() => {
          set('')
          location.hash = '#preview'
        }}
      >
        Choose someone else
      </button>
    </div>
  )
}
