import { useEffect, useState } from 'react'
import { currentAuth } from './auth.ts'
import { AreaIcon } from './home/icons.tsx'

/**
 * What the app draws while it reads this phone's copy of the data, before
 * the screens can (audit, 20 October 2026, finding 11): never a word alone
 * on a blank page. The places in the bar, the one the address is in lit, and
 * the screen's shape where it will be (the design system's skeleton), so the
 * app is seen to have opened and where; past `timing.wait` a line says what
 * it's doing. Drawn before the screens' code has arrived, so it takes nothing
 * from it but the bar's pictures: the shell (Shell.tsx) replaces it whole.
 */

/** The bar's five places, as Shell.tsx draws them on a phone; Quotes, on a desk, waits for the shell, which knows the role. */
const PLACES = [
  ['#home', 'Home'],
  ['#jobs', 'Jobs'],
  ['#stock', 'Stock'],
  ['#crew', 'Crew'],
  ['#menu', 'Menu'],
] as const

/** Places reached from the Menu, which keep its tab (Shell.tsx). */
const UNDER_MENU = ['#admin', '#history', '#me', '#notifications', '#quotes']

type Shape = 'home' | 'list' | 'record' | 'menu'

function placeOf(hash: string): { tab: string; shape: Shape } {
  const [root = '', next] = hash.split('/')
  if (UNDER_MENU.includes(root) || root === '#menu') return { tab: '#menu', shape: 'menu' }
  const tab = PLACES.some(([h]) => h === root) ? root : '#home'
  if (tab === '#home') return { tab, shape: 'home' }
  // A record of its own (#jobs/<id>, #stock/item/<id>, #crew/person/<id>) has a title and cards; a page of an area, a list.
  if (root === '#jobs' && next === 'plan') return { tab, shape: 'list' }
  const record = (root === '#jobs' && !!next && !JOBS_PAGES.has(next)) || hash.split('/').length > 2
  return { tab, shape: record ? 'record' : 'list' }
}

/** Jobs' own pages, as against a job's id after #jobs/. The planner's days (#jobs/plan/week/<day>) are a page too. */
const JOBS_PAGES = new Set(['plan', 'import', 'venues', 'clients', 'money', 'tidy', 'notes-kit'])

/** How long before a wait is said in words: the design system's `timing.wait`. */
function waitMs(): number {
  try {
    // "1000ms", or "1s" once the build has made it shorter.
    const kept = getComputedStyle(document.documentElement).getPropertyValue('--ds-timing-wait').trim()
    const ms = parseFloat(kept) * (kept.endsWith('ms') ? 1 : 1000)
    return Number.isFinite(ms) && ms > 0 ? ms : 1000
  } catch {
    return 1000
  }
}

const Line = ({ wide }: { wide?: string }) => <span className="skeleton" style={wide ? { width: wide } : undefined} />
const Row = () => <span className="skeleton row" />
const Block = () => <span className="skeleton block" />

function Body({ shape }: { shape: Shape }) {
  switch (shape) {
    case 'home':
      return (
        <>
          <Row />
          <Block />
          <Block />
          <Block />
        </>
      )
    case 'list':
      return (
        <>
          <Row />
          <Line wide="40%" />
          {Array.from({ length: 7 }, (_, i) => (
            <Row key={i} />
          ))}
        </>
      )
    case 'record':
      return (
        <>
          <Line wide="60%" />
          <Row />
          <Block />
          <Block />
        </>
      )
    case 'menu':
      return (
        <>
          {Array.from({ length: 6 }, (_, i) => (
            <Row key={i} />
          ))}
        </>
      )
  }
}

export function Opening() {
  const [hash, setHash] = useState(location.hash)
  const [late, setLate] = useState(false)
  useEffect(() => {
    const on = () => setHash(location.hash)
    addEventListener('hashchange', on)
    const timer = setTimeout(() => setLate(true), waitMs())
    return () => {
      removeEventListener('hashchange', on)
      clearTimeout(timer)
    }
  }, [])
  const { tab, shape } = placeOf(hash)
  // Signed out, the shell opens on signing in, which has no bar.
  const bar = currentAuth().status !== 'signed-out'
  return (
    <>
      {bar && (
        <nav className="tabs" aria-label="Areas">
          {PLACES.map(([h, label]) => (
            <a key={h} href={h} aria-current={h === tab ? 'page' : undefined}>
              <AreaIcon area={h} />
              <span className="tab-word">{label}</span>
            </a>
          ))}
        </nav>
      )}
      <main>
        <div className="app opening" aria-busy="true">
          <div className="top" aria-hidden="true">
            <Line wide="9rem" />
          </div>
          {/* Under the bar, where the eye starts, rather than below a long shape. */}
          <p className="hint" role="status">
            {late ? "Reading this phone's copy…" : ''}
          </p>
          <div className="opening-shape" aria-hidden="true">
            <Body shape={shape} />
          </div>
        </div>
      </main>
    </>
  )
}
