import { answersToCheck } from '@sh/shared'
import { useEffect, useState } from 'react'
import { today } from '../jobs/common.tsx'
import { client } from '../sync.ts'

/**
 * On the Crew tab: how many answers wait for the office (a yes to confirm,
 * a counter, a decline or a pull-out not yet noted), from this device's own
 * copy, so it's right with no signal too (audit finding 9). Nothing while
 * there's nothing waiting. Not a status, so the top bar's stays the one.
 */
export function CrewBadge() {
  const count = () => answersToCheck(client.view().crew, today()).length
  const [n, setN] = useState(count)
  useEffect(() => client.subscribe((v) => setN(answersToCheck(v.crew, today()).length)), [])
  if (n === 0) return null
  return (
    <span className="badge">
      <span aria-hidden="true">{n}</span>
      <span className="sr-only">{n === 1 ? ', 1 answer to check' : `, ${n} answers to check`}</span>
    </span>
  )
}
