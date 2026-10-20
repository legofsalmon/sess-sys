import { photoPath, type Person } from '@sh/shared'
import { useState } from 'react'
import { Icon, type IconName } from './Icon.tsx'

/*
 * The pictures at the start of a row and the top of a page (the design
 * system's imagery.md): a thing's photo or, until it has one, a quiet tile
 * with the icon for what kind of thing it is; a person's photo or, until
 * they give one, their initials. The name is always beside it, so the
 * picture is hidden from screen readers. A person's photo comes from the
 * server once they have one (ADR 0065); things have only placeholders yet,
 * and `src` is for when they have photos too.
 */

type Size = 'small' | 'large'
const cls = (base: string, size?: Size) => (size ? `${base} ${base}-${size}` : base)

/** A photo that falls back to its placeholder if it can't be loaded, never a broken image. */
function Photo({ src, fallback }: { src?: string; fallback: React.ReactNode }) {
  // Which address failed, so a new photo is tried afresh: with no signal, a photo not yet kept by the browser is the placeholder.
  const [failed, setFailed] = useState<string>()
  if (!src || failed === src) return <>{fallback}</>
  return <img src={src} alt="" loading="lazy" onError={() => setFailed(src)} />
}

const base = import.meta.env.VITE_API_BASE ?? ''

/** Where a person's photo is, once they have one (ADR 0065). */
export const photoOf = (p: Pick<Person, 'id' | 'photo'> | undefined) => (p?.photo ? `${base}${photoPath(p.id, p.photo.at)}` : undefined)

/** A thing: a product, an item, a case. */
export function Thumb({ icon, src, size }: { icon: IconName; src?: string; size?: Size }) {
  return (
    <span className={cls('thumb', size)} aria-hidden="true">
      <Photo src={src} fallback={<Icon name={icon} />} />
    </span>
  )
}

/** The first letter of the first and last words of a name that start with one, upper case: "Gráinne Power" is GP, "Robin" is R. */
export function initials(name: string): string {
  const words = name
    .replace(/\(.*?\)/g, ' ')
    .split(/\s+/)
    .map((w) => w.match(/^\p{L}/u)?.[0])
    .filter((c): c is string => !!c)
  const [first, last] = [words[0], words.length > 1 ? words[words.length - 1] : '']
  return first ? (first + last).toLocaleUpperCase() : ''
}

/** A person. No colour per person: initials sit on the neutral tile, as colour means state here. */
export function Avatar({ name, src, size }: { name: string; src?: string; size?: Size }) {
  const letters = initials(name)
  // The letters are drawn from the attribute, not written in the text, so a row's text is still just the name.
  return (
    <span className={cls('avatar', size)} data-initials={letters || undefined} aria-hidden="true">
      <Photo src={src} fallback={letters ? null : <Icon name="person" />} />
    </span>
  )
}

/** A few faces on a job, overlapping; the names are said in words beside them. */
export function Avatars({ names, max = 4 }: { names: string[]; max?: number }) {
  if (names.length === 0) return null
  const shown = names.length > max ? names.slice(0, max - 1) : names
  const more = names.length - shown.length
  return (
    <span className="avatars" aria-hidden="true">
      {shown.map((n, i) => (
        <Avatar key={i} name={n} size="small" />
      ))}
      {more > 0 && <span className="avatar avatar-small" data-initials={`+${more}`} />}
    </span>
  )
}
