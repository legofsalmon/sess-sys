import { useState } from 'react'
import type { Department } from '@sh/shared'
import { arrival } from './arrival.ts'
import { narrower } from './home/standing.ts'

/**
 * A list a count on Home opened for one department (audit, 20 October
 * 2026, finding 4) starts narrowed to it, so it shows what was counted, and
 * says so with the way to the rest. Opened any other way, or a count for
 * another page of the same screen, it shows them all.
 */
export function useNarrowed(hash: string): [department: string | undefined, widen: () => void] {
  const [department, setDepartment] = useState(() => arrival(hash)?.department)
  return [department, () => setDepartment(undefined)]
}

/** Whether someone is in the department a list is narrowed to: everyone, when it isn't. */
export const inDepartment = (department: string | undefined) => (p: { department?: string | null } | undefined) =>
  !department || p?.department?.trim().toLowerCase() === department.trim().toLowerCase()

/** Whether kit is in the department a list is narrowed to, by the stock list's department for it (Home's own reading): all of it, when it isn't. */
export const inKitOf = (department: string | undefined) => {
  const kit = narrower(department).kit
  return (model: { department?: Department } | undefined) => kit(model?.department)
}

export function Narrowed({ department, onWiden }: { department: string | undefined; onWiden: () => void }) {
  if (!department) return null
  return (
    <p className="hint narrowed">
      Showing {department} only.{' '}
      <button type="button" className="link" onClick={onWiden}>
        Show all departments
      </button>
    </p>
  )
}
