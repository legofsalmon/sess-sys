import type { Column } from '@sh/shared'
import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import { Heading, type IconName } from '../Icon.tsx'
import { STILL_ARRIVING, useCopying } from './copying.ts'

/**
 * A column chart for Home (ADR 0054), drawn in HTML so it is light on a
 * phone and each column is a button a finger, a keyboard and a screen
 * reader can all reach. Colour follows the shared grammar, not a palette of
 * its own: what's settled is plain ink, what isn't yet a lighter grey, and
 * only what's short is amber, so a healthy week is quiet. The line above
 * the chart says, in words, the column under the finger or the pointer.
 */

/**
 * Too narrow for a fortnight's columns at a finger's width: a phone shows a week of them, the other behind a tap, as Your weeks fits
 * with fewer (audit, 20 October 2026, finding 58: fourteen columns were 22 px wide on a phone).
 */
const narrow = typeof matchMedia === 'function' ? matchMedia('(max-width: 719px)') : undefined
function useNarrow(): boolean {
  return useSyncExternalStore(
    (onChange) => {
      narrow?.addEventListener('change', onChange)
      return () => narrow?.removeEventListener('change', onChange)
    },
    () => narrow?.matches ?? false
  )
}
const WEEK = 7
const WEEKS = ['First week', 'Second week', 'Third week', 'Fourth week', 'Fifth week']

/** What a part means, which picks its colour: settled ink, not-yet grey, short amber. */
export type Tone = 'settled' | 'pending' | 'short'

export interface Series {
  name: string
  tone: Tone
}

export function Chart({
  title,
  icon,
  series,
  columns,
  format = (n) => n.toLocaleString('en-IE'),
  empty,
  more,
}: {
  title: string
  icon: IconName
  series: readonly Series[]
  columns: readonly Column[]
  format?: (n: number) => string
  /** Said in place of the chart when every column is nothing. */
  empty: string
  /** A link under the chart to where it's sorted out. */
  more?: ReactNode
}) {
  const copying = useCopying()
  const totals = columns.map((c) => c.parts.reduce((s, n) => s + n, 0))
  const max = Math.max(0, ...totals)
  const [picked, setPicked] = useState(() => Math.max(0, columns.findIndex((c) => c.now)))
  const at = Math.min(picked, columns.length - 1)
  const words = (c: Column) => {
    const said = c.parts.flatMap((n, i) => (n > 0 ? [`${format(n)} ${series[i]!.name}`] : []))
    return `${c.name}: ${said.length > 0 ? said.join(', ') : 'nothing'}`
  }
  // A week at a time on a phone, the one holding the column being read; the scale stays the fortnight's, so the weeks compare.
  const paged = useNarrow() && columns.length > WEEK + 1
  const from = paged ? Math.floor(at / WEEK) * WEEK : 0
  const shown = paged ? columns.slice(from, from + WEEK) : columns
  const group = useRef<HTMLDivElement>(null)
  const refocus = useRef(false)
  useEffect(() => {
    if (!refocus.current) return
    refocus.current = false
    group.current?.querySelector<HTMLElement>('[aria-pressed="true"]')?.focus()
  })
  const move = (to: number) => {
    setPicked(Math.max(0, Math.min(columns.length - 1, to)))
    refocus.current = true
  }

  return (
    <section className="card chart">
      <Heading icon={icon}>{title}</Heading>
      {max === 0 ? (
        <p className="empty">{copying ? STILL_ARRIVING : empty}</p>
      ) : (
        <>
          <p className="chart-readout" aria-live="polite">
            {words(columns[at]!)}
          </p>
          <div className="chart-plot">
            <span className="chart-max" aria-hidden="true">
              {format(max)}
            </span>
            <div className="chart-columns" role="group" aria-label={title} ref={group} style={{ gridTemplateColumns: `repeat(${shown.length}, minmax(0, 1fr))` }}>
              {shown.map((c, k) => {
                const i = from + k
                return (
                  <button
                    key={c.key}
                    type="button"
                    className={`chart-col${c.now ? ' now' : ''}`}
                    aria-label={words(c)}
                    aria-pressed={i === at}
                    // One stop in the tab order; the arrows move along the columns.
                    tabIndex={i === at ? 0 : -1}
                    onClick={() => setPicked(i)}
                    onPointerEnter={(e) => e.pointerType === 'mouse' && setPicked(i)}
                    onKeyDown={(e) => {
                      const to = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: columns.length - 1 }[e.key]
                      if (to === undefined) return
                      e.preventDefault()
                      move(to)
                    }}
                  >
                    <span className="chart-bar">
                      <span className="chart-stack" style={{ height: `${(totals[i]! / max) * 100}%` }}>
                        {c.parts.map((n, p) => (n > 0 ? <span key={p} className={`chart-part ${series[p]!.tone}`} style={{ flexGrow: n }} /> : null))}
                      </span>
                    </span>
                    <span className="chart-tick" aria-hidden="true">
                      {c.tick}
                    </span>
                  </button>
                )
              })}
            </div>
          </div>
          {paged && (
            <div className="filters chart-weeks" role="group" aria-label="Which week">
              {WEEKS.slice(0, Math.ceil(columns.length / WEEK)).map((name, w) => (
                <button key={name} type="button" aria-pressed={from === w * WEEK} onClick={() => setPicked(w * WEEK)}>
                  {name}
                </button>
              ))}
            </div>
          )}
          {series.length > 1 && (
            <ul className="chart-key">
              {series.map((s) => (
                <li key={s.name}>
                  <span className={`chart-swatch ${s.tone}`} aria-hidden="true" />
                  {s.name}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
      {more}
    </section>
  )
}
