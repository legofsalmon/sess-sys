import { MOST_SKILLS, readSkills } from './crew-import.ts'

/**
 * The skills field (ADR 0063): what the crew list already calls people,
 * offered back as they type, so "Audio" stays one skill rather than
 * "audio", "Audio " and "sound" across a hundred freelancers.
 */

/** Every skill on the crew list, each once whatever its case, the most used first; it keeps the spelling most people have. */
export function skillsInUse(people: readonly { skills: readonly string[] }[]): string[] {
  const tally = new Map<string, { count: number; spellings: Map<string, number> }>()
  for (const p of people) {
    const seen = new Set<string>()
    for (const raw of p.skills) {
      const skill = raw.trim()
      const key = skill.toLowerCase()
      if (!skill || seen.has(key)) continue
      seen.add(key)
      const t = tally.get(key) ?? {
        count: 0,
        spellings: new Map<string, number>(),
      }
      t.count++
      t.spellings.set(skill, (t.spellings.get(skill) ?? 0) + 1)
      tally.set(key, t)
    }
  }
  const spelling = (s: Map<string, number>) => [...s].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]![0]
  return [...tally.values()]
    .map((t) => ({ skill: spelling(t.spellings), count: t.count }))
    .sort((a, b) => b.count - a.count || a.skill.localeCompare(b.skill))
    .map((t) => t.skill)
}

/** What to offer for what's typed: those starting with it first, then those with a word starting with it, never one already chosen. */
export function suggestSkills(known: readonly string[], typed: string, chosen: readonly string[], most = 8): string[] {
  const have = new Set(chosen.map((s) => s.toLowerCase()))
  const q = typed.trim().toLowerCase()
  const open = known.filter((s) => !have.has(s.toLowerCase()))
  if (!q) return open.slice(0, most)
  const starts = open.filter((s) => s.toLowerCase().startsWith(q))
  const word = open.filter(
    (s) =>
      !s.toLowerCase().startsWith(q) &&
      s
        .toLowerCase()
        .split(/[\s/&+-]+/)
        .some((w) => w.startsWith(q)),
  )
  return [...starts, ...word].slice(0, most)
}

/**
 * Which offer Enter takes before Up or Down has moved, so the highlight shows what Enter will do: the one spelt as typed, else
 * the first starting with it, else the new one (its index is just past the offers). None while nothing is typed, or when
 * what's typed is already chosen, so Enter there sends the form or says it's already on.
 */
export function firstPick(offered: readonly string[], typed: string, chosen: readonly string[], hasNew: boolean): number {
  const q = typed.trim().toLowerCase()
  if (!q || chosen.some((s) => s.toLowerCase() === q)) return -1
  const exact = offered.findIndex((s) => s.toLowerCase() === q)
  if (exact >= 0) return exact
  const starts = offered.findIndex((s) => s.toLowerCase().startsWith(q))
  if (starts >= 0) return starts
  return hasNew ? offered.length : -1
}

/**
 * Adds what was typed (one skill, or several pasted with commas) to those
 * chosen: each once, in the crew list's own spelling when it already has
 * one, up to the 30 a person can hold.
 */
export function addSkills(chosen: readonly string[], typed: string, known: readonly string[] = []): string[] {
  const out = [...chosen]
  const have = new Set(out.map((s) => s.toLowerCase()))
  const spelt = new Map(known.map((s) => [s.toLowerCase(), s]))
  for (const s of readSkills(typed)) {
    const key = s.toLowerCase()
    if (have.has(key) || out.length >= MOST_SKILLS) continue
    have.add(key)
    out.push(spelt.get(key) ?? s)
  }
  return out
}
