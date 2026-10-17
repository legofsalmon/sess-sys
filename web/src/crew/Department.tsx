import { CREW_DEPARTMENTS, departmentOf, sameDepartment, type View } from '@sh/shared'
import { useId } from 'react'

/**
 * A crew call's department (ADR 0046), from the same list crew profiles
 * use (ADR 0025), so a head of department's Home and the Calls filter can
 * narrow to it. When a call is made it starts on the one its role suggests
 * (the Default Effect: the likely answer, already there, and one tap to
 * change), and "No department" is always there for a call that is no one
 * department's.
 */

/** The departments to pick from: the profiles' list, then any others people or calls are in, each once. */
export function departmentsToPick(view: View): string[] {
  const out: string[] = [...CREW_DEPARTMENTS]
  const extra: string[] = []
  const add = (d: string | null | undefined) => {
    if (d?.trim() && ![...out, ...extra].some((x) => sameDepartment(x, d))) extra.push(d.trim())
  }
  for (const p of view.crew.people) if (!p.archived) add(p.department)
  for (const c of view.crew.calls) add(departmentOf(c))
  return [...out, ...extra.sort((a, b) => a.localeCompare(b))]
}

/** The departments calls are in, each once, by name: the ones Crew › Calls can be narrowed to. */
export function callDepartments(view: View): string[] {
  const out: string[] = []
  for (const c of view.crew.calls) {
    const d = departmentOf(c)
    if (d && !out.some((x) => sameDepartment(x, d))) out.push(d)
  }
  return out.sort((a, b) => a.localeCompare(b))
}

/**
 * The field. `value` undefined follows `suggested` until a choice is made,
 * so a role typed after picking doesn't undo the pick.
 */
export function DepartmentField({
  view,
  value,
  suggested,
  onChange,
  className,
}: {
  view: View
  value: string | null | undefined
  suggested?: string | null
  onChange: (department: string | null) => void
  className?: string
}) {
  const hint = useId()
  const shown = value === undefined ? (suggested ?? null) : value
  const options = departmentsToPick(view)
  // A department typed on an older call that isn't in the list still shows as itself.
  if (shown && !options.some((d) => sameDepartment(d, shown))) options.push(shown)
  const selected = options.find((d) => sameDepartment(d, shown)) ?? ''
  return (
    <label className={className}>
      Department
      {/* Named on its own, so the hint under it is its description and not part of its name. */}
      <select aria-label="Department" value={selected} onChange={(e) => onChange(e.target.value || null)} aria-describedby={value === undefined && suggested ? hint : undefined}>
        <option value="">No department</option>
        {options.map((d) => (
          <option key={d} value={d}>
            {d}
          </option>
        ))}
      </select>
      {value === undefined && suggested && (
        <small id={hint} className="hint">
          From the role. Change it if the call is another department's.
        </small>
      )}
    </label>
  )
}
