import { addSkills, MOST_SKILLS, skillsInUse, suggestSkills } from '@sh/shared'
import { useId, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { Icon } from '../Icon.tsx'
import { useView } from '../view.ts'

/**
 * Skills as a list of picks (ADR 0063): those chosen sit in the field as
 * chips, and typing offers the skills the crew list already uses, the most
 * used first, so the same skill keeps one spelling. Something new is added
 * as typed. Enter or a comma adds it, Backspace on an empty field takes the
 * last one off, and what's still typed when the form is sent goes with it.
 * The suggestions follow the combobox pattern (a listbox under the field,
 * Up and Down to move, Enter to choose, Escape to close).
 */
export function SkillsField({
  value,
  onChange,
  text,
  onText,
  className,
}: {
  value: string[]
  onChange: (skills: string[]) => void
  text: string
  onText: (typed: string) => void
  className?: string
}) {
  const people = useView().crew.people
  const known = useMemo(() => skillsInUse(people), [people])
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(-1)
  const input = useRef<HTMLInputElement>(null)
  const id = useId()
  const full = value.length >= MOST_SKILLS
  const typed = text.trim()
  const offered = suggestSkills(known, text, value)
  // Something typed that isn't on the list yet is offered too, last, in words, so it's plain that it will be a new one.
  const isNew = !!typed && !known.some((s) => s.toLowerCase() === typed.toLowerCase()) && !value.some((s) => s.toLowerCase() === typed.toLowerCase())
  const options = [...offered.map((s) => ({ skill: s, label: s })), ...(isNew ? [{ skill: typed, label: `Add “${typed}” as a new skill` }] : [])]
  const shown = open && !full && options.length > 0

  const add = (more: string) => {
    const next = addSkills(value, more, known)
    if (next.length !== value.length) onChange(next)
    onText('')
    setActive(-1)
  }
  const remove = (skill: string) => {
    onChange(value.filter((s) => s !== skill))
    input.current?.focus()
  }
  // A list pasted or typed with commas becomes chips as it goes, the last part left to finish.
  const type = (next: string) => {
    const parts = next.split(/[,;]/)
    if (parts.length > 1) {
      const last = parts.pop()!
      const chosen = addSkills(value, parts.join(','), known)
      if (chosen.length !== value.length) onChange(chosen)
      next = last.trimStart()
    }
    onText(next)
    setActive(-1)
    setOpen(true)
  }
  const key = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      if (!shown) return setOpen(true)
      const last = options.length - 1
      setActive((i) => (e.key === 'ArrowDown' ? (i >= last ? 0 : i + 1) : i <= 0 ? last : i - 1))
      return
    }
    if (e.key === 'Enter') {
      const pick = shown && active >= 0 ? options[active] : undefined
      if (!pick && !typed) return // An empty field lets Enter send the form, as any other field does.
      e.preventDefault()
      add(pick ? pick.skill : typed)
      return
    }
    if (e.key === 'Escape' && shown) {
      e.preventDefault()
      e.stopPropagation()
      setOpen(false)
      setActive(-1)
      return
    }
    if (e.key === 'Backspace' && !text && value.length > 0) {
      e.preventDefault()
      onChange(value.slice(0, -1))
    }
  }

  return (
    <div className={`skills-field${className ? ` ${className}` : ''}`}>
      <span id={`${id}-label`}>Skills</span>
      <div className="skills-anchor">
        <div className="skills-box" onClick={(e) => e.target === e.currentTarget && input.current?.focus()}>
          {value.length > 0 && (
            <ul className="skill-chips" aria-label="Chosen">
              {value.map((s) => (
                <li key={s} className="skill-chip">
                  <span>{s}</span>
                  <button type="button" onClick={() => remove(s)} aria-label={`Remove ${s}`}>
                    <Icon name="close" />
                  </button>
                </li>
              ))}
            </ul>
          )}
          <input
            ref={input}
            role="combobox"
            aria-labelledby={`${id}-label`}
            aria-describedby={`${id}-hint`}
            aria-autocomplete="list"
            aria-expanded={shown}
            aria-controls={`${id}-list`}
            aria-activedescendant={shown && active >= 0 ? `${id}-${active}` : undefined}
            value={text}
            onChange={(e) => type(e.target.value)}
            onKeyDown={key}
            onFocus={() => setOpen(true)}
            // What's still typed stays in the field, as typed, and goes with the form (withTyped): adding it here would move
            // the button under a press that has already begun.
            onBlur={() => {
              setOpen(false)
              setActive(-1)
            }}
            placeholder={value.length ? '' : 'Audio, rigger'}
            readOnly={full}
            autoComplete="off"
          />
        </div>
        <ul className="skill-options" id={`${id}-list`} role="listbox" aria-label="In use" hidden={!shown}>
          {options.map((o, i) => (
            <li
              key={`${o.skill}-${i}`}
              id={`${id}-${i}`}
              role="option"
              aria-selected={i === active}
              className={i === offered.length ? 'new' : undefined}
              // Chosen on the press, before the field loses focus, so the list stays put for the next one.
              onMouseDown={(e) => {
                e.preventDefault()
                add(o.skill)
              }}
            >
              {o.label}
            </li>
          ))}
        </ul>
      </div>
      <small id={`${id}-hint`}>{full ? `Up to ${MOST_SKILLS} skills. Remove one to add another.` : 'Pick from those in use, or type a new one. Enter or a comma adds it.'}</small>
    </div>
  )
}

/** The skills chosen with whatever is still typed in the field, as the form sends them, in the crew list's own spelling. */
export function withTyped(skills: string[], typed: string, people: readonly { skills: readonly string[] }[]): string[] {
  return typed.trim() ? addSkills(skills, typed, skillsInUse(people)) : skills
}
