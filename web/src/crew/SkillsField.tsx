import { addSkills, firstPick, MOST_SKILLS, skillsInUse, suggestSkills } from '@sh/shared'
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { Icon } from '../Icon.tsx'
import { useView } from '../view.ts'

/**
 * Skills as a list of picks (ADR 0063): those chosen sit in the field as
 * chips, and typing offers the skills the crew list already uses, the most
 * used first, so the same skill keeps one spelling. Something new is added
 * as typed. Enter or a comma takes the highlighted offer, Backspace on an
 * empty field takes the last one off, and what's still typed when the form
 * is sent goes with it.
 * The suggestions follow the combobox pattern (a listbox under the field,
 * Up and Down to move, Enter to choose, Escape to close). While something is
 * typed one offer is always highlighted, the one Enter will take (firstPick):
 * the spelling in use before a new one. Each chip added or taken off is said
 * in a status line, so it isn't only seen.
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
  // Where Up or Down moved the highlight; null until they do, when it's the one Enter would take anyway.
  const [moved, setMoved] = useState<number | null>(null)
  const [said, setSaid] = useState('')
  const input = useRef<HTMLInputElement>(null)
  const list = useRef<HTMLUListElement>(null)
  const id = useId()
  const full = value.length >= MOST_SKILLS
  const typed = text.trim()
  const offered = suggestSkills(known, text, value)
  const chosen = (s: string) => value.find((v) => v.toLowerCase() === s.toLowerCase())
  // Something typed that isn't on the list yet is offered too, last, in words, so it's plain that it will be a new one.
  const isNew = !!typed && !known.some((s) => s.toLowerCase() === typed.toLowerCase()) && !chosen(typed)
  const options = [...offered.map((s) => ({ skill: s, label: s })), ...(isNew ? [{ skill: typed, label: `Add “${typed}” as a new skill` }] : [])]
  const shown = open && !full && options.length > 0
  const active = shown ? (moved ?? firstPick(offered, text, value, isNew)) : -1

  // Low on a phone's screen there's no room for the offers under the box before the tabs along the foot: they open above it instead,
  // where there's more room there (audit, 20 October 2026, finding 74).
  const anchor = useRef<HTMLDivElement>(null)
  const [up, setUp] = useState(false)
  useLayoutEffect(() => {
    const box = anchor.current?.getBoundingClientRect()
    const menu = list.current
    if (!shown || !box || !menu) return
    const tabs = document.querySelector<HTMLElement>('nav.tabs')
    const tabsTop = tabs?.getBoundingClientRect().top ?? innerHeight
    // The tabs are along the foot on a phone; on a desk they're down the side and start at the top.
    const foot = tabsTop > innerHeight / 2 ? Math.min(tabsTop, innerHeight) : innerHeight
    const head = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--top-bar')) || 0
    const below = foot - box.bottom
    const above = box.top - head
    setUp(menu.offsetHeight > below && above > below)
  }, [shown, options.length])

  // A highlight moved past the bottom of the list's scroll is brought into view, so what Enter will take can be seen.
  useEffect(() => {
    if (active >= 0) list.current?.children[active]?.scrollIntoView({ block: 'nearest' })
  }, [active])

  const add = (more: string) => {
    const next = addSkills(value, more, known)
    const added = next.slice(value.length)
    if (added.length) {
      onChange(next)
      setSaid(`Added ${added.join(', ')}. ${count(next.length)}.`)
    } else if (chosen(more.trim())) setSaid(`${chosen(more.trim())} is already on.`)
    onText('')
    setMoved(null)
  }
  const remove = (skill: string) => {
    const next = value.filter((s) => s !== skill)
    onChange(next)
    setSaid(`Removed ${skill}. ${count(next.length)}.`)
    input.current?.focus()
  }
  // A list pasted or typed with commas becomes chips as it goes, the last part left to finish. A comma typed after a part
  // takes the highlighted offer, as Enter does; one in a paste keeps each part as it was written.
  const type = (next: string) => {
    if (shown && active >= 0 && typed && (next === `${text},` || next === `${text};`)) return add(options[active]!.skill)
    const parts = next.split(/[,;]/)
    if (parts.length > 1) {
      const last = parts.pop()!
      const more = parts.join(',')
      const chose = addSkills(value, more, known)
      if (chose.length !== value.length) {
        onChange(chose)
        setSaid(`Added ${chose.slice(value.length).join(', ')}. ${count(chose.length)}.`)
      }
      next = last.trimStart()
    }
    onText(next)
    setMoved(null)
    setOpen(true)
  }
  const key = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      if (!shown) return setOpen(true)
      const last = options.length - 1
      setMoved(e.key === 'ArrowDown' ? (active >= last ? 0 : active + 1) : active <= 0 ? last : active - 1)
      return
    }
    if (e.key === 'Enter') {
      const pick = active >= 0 ? options[active] : undefined
      if (!pick && !typed) return // An empty field lets Enter send the form, as any other field does.
      e.preventDefault()
      add(pick ? pick.skill : typed)
      return
    }
    if (e.key === 'Escape' && shown) {
      e.preventDefault()
      e.stopPropagation()
      setOpen(false)
      setMoved(null)
      return
    }
    // Only a fresh press takes a chip off: Backspace held down to clear what's typed stops at the empty field.
    if (e.key === 'Backspace' && !text && value.length > 0) {
      e.preventDefault()
      if (!e.repeat) remove(value[value.length - 1]!)
    }
  }

  return (
    <div className={`skills-field${className ? ` ${className}` : ''}`}>
      <span id={`${id}-label`}>Skills</span>
      <div className="skills-anchor" ref={anchor}>
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
            aria-activedescendant={active >= 0 ? `${id}-${active}` : undefined}
            value={text}
            onChange={(e) => type(e.target.value)}
            onKeyDown={key}
            onFocus={() => {
              setOpen(true)
              // Clear of the tabs along a phone's foot, with the page's scroll padding (app.css), rather than half under them.
              anchor.current?.scrollIntoView?.({ block: 'nearest' })
            }}
            // What's still typed stays in the field, as typed, and goes with the form (withTyped): adding it here would move
            // the button under a press that has already begun.
            onBlur={() => {
              setOpen(false)
              setMoved(null)
            }}
            placeholder={value.length ? '' : 'Audio, rigger'}
            readOnly={full}
            autoComplete="off"
          />
        </div>
        {/* Out of the Tab order: a list that scrolls is a Tab stop of its own, and the field's blur then hid it, so Tab landed on nothing
            (finding 75). Up and Down move through it from the field. */}
        <ul ref={list} className={`skill-options${up ? ' up' : ''}`} id={`${id}-list`} role="listbox" aria-label="In use" hidden={!shown} tabIndex={-1}>
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
      {/* Polite, and there from the start so the first change is heard; not a status role, which the sync state already is. */}
      <span className="sr-only" aria-live="polite">
        {said}
      </span>
    </div>
  )
}

const count = (n: number) => (n === 1 ? '1 skill' : `${n} skills`)

/** The skills chosen with whatever is still typed in the field, as the form sends them, in the crew list's own spelling. */
export function withTyped(skills: string[], typed: string, people: readonly { skills: readonly string[] }[]): string[] {
  return typed.trim() ? addSkills(skills, typed, skillsInUse(people)) : skills
}
