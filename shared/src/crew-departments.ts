/**
 * Crew's departments and levels (ADR 0025, ADR 0046): the departments the
 * form offers, what a role's own words say about its department, and the
 * levels people are at.
 */

/** The departments the form offers as you type. Free text, so a new one needs no change here. */
export const CREW_DEPARTMENTS = ['Audio', 'LX', 'Video', 'Backline', 'Laser', 'Transport', 'Production', 'LED Tech', 'Rigger', 'Stage Manager', 'SFX'] as const

/** 0 is an applicant nobody has vetted; 1 is known; higher is more preferred. */
export const LEVELS = [0, 1, 2, 3, 4, 5] as const
export const APPLICANT_LEVEL = 0
export const DEFAULT_LEVEL = 1
export const levelLabel = (level: number) => `Level ${level}`
/** The level with "applicant" said for 0, where nothing else on the screen says it: the crew list, the card's select and the import's preview. */
export const levelLine = (level: number) => (level === APPLICANT_LEVEL ? `${levelLabel(level)} (applicant)` : levelLabel(level))

/** A department as typed, tidied: spaces collapsed, and a known one in its own spelling, so "audio" and "Audio" are one department. Null for nothing. */
export function tidyDepartment(typed: string): string | null {
  const s = typed.trim().replace(/\s+/g, ' ')
  if (!s) return null
  return CREW_DEPARTMENTS.find((d) => d.toLowerCase() === s.toLowerCase()) ?? s
}

/** Whether two departments as typed are the same one: "audio" and "Audio " are. Nothing is never the same as anything. */
export const sameDepartment = (a: string | null | undefined, b: string | null | undefined) => !!a?.trim() && a.trim().toLowerCase() === b?.trim().toLowerCase()

/**
 * Words in a role that say its department (ADR 0046), the first that fits:
 * "Sound No.1" is audio, "LX op" is LX, "Camera" is video. A role that says
 * nothing about one, such as a stagehand, has none until someone gives it one.
 */
export const ROLE_WORDS: readonly [RegExp, (typeof CREW_DEPARTMENTS)[number]][] = [
  [/\blaser/, 'Laser'],
  [/\bled\b/, 'LED Tech'],
  [/\b(sound|audio|monitors?|foh|a[12]|pa|rf|mics?)\b/, 'Audio'],
  [/\b(lx|light(s|ing)?|lamp|follow ?spot|dimmer)\b/, 'LX'],
  [/\b(video|camera|cam|vision|projection(ist)?|vt)\b/, 'Video'],
  [/\b(backline|guitar tech|drum tech)\b/, 'Backline'],
  [/\brigg(er|ers|ing)\b/, 'Rigger'],
  [/\b(stage manager|asm|dsm|sm)\b/, 'Stage Manager'],
  [/\b(sfx|pyro|special effects|confetti)\b/, 'SFX'],
  [/\b(driver|transport|truck|van)\b/, 'Transport'],
  [/\b(production|crew chief|producer|production manager|site manager|runner)\b/, 'Production'],
]

/**
 * The department some words name, from the same list: "Smirnoff LX" is LX,
 * "Audio Main" is Audio. For a job's name or a phase's, where a calendar's
 * title said which department a day was for. None when they name none.
 */
export const departmentInWords = (words: string): (typeof CREW_DEPARTMENTS)[number] | null =>
  ROLE_WORDS.find(([re]) => re.test(roleKey(words)))?.[1] ?? null

/** What a role is called, as compared: "Sound  No.1" and "sound no.1" are one. */
export const roleKey = (role: string) => role.trim().replace(/\s+/g, ' ').toLowerCase()

/** The department named most often, the first by name on a tie; none when nothing is named. */
export function mostNamed(departments: readonly (string | null)[]): string | null {
  const counts = new Map<string, { name: string; n: number }>()
  for (const d of departments) {
    const name = d && tidyDepartment(d)
    if (!name) continue
    const was = counts.get(name.toLowerCase())
    counts.set(name.toLowerCase(), { name: was?.name ?? name, n: (was?.n ?? 0) + 1 })
  }
  return [...counts.values()].sort((a, b) => b.n - a.n || a.name.localeCompare(b.name))[0]?.name ?? null
}

/**
 * The department of a call brought in from the calendar (ADR 0046), whose
 * role says only "Crew": the one more than half the people on it are in.
 * None when they're mixed, or nobody on it has one; the office gives those
 * one, many at a time, on Crew › Calls.
 */
export function departmentOfPeople(departments: readonly (string | null | undefined)[]): string | null {
  if (departments.length === 0) return null
  const most = mostNamed(departments.map((d) => d ?? null))
  if (!most) return null
  const n = departments.filter((d) => sameDepartment(d, most)).length
  return n * 2 > departments.length ? most : null
}
