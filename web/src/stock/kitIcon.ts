import type { Department } from '@sh/shared'
import type { IconName } from '../Icon.tsx'

/** Words in a product's name or category that say what it is better than its department does. */
const BY_WORD: [RegExp, IconName][] = [
  [/\b(case|rack|flight|road ?case|trunk)s?\b/i, 'case'],
  [/\b(mic|mics|microphones?|radio ?mics?|di ?box(es)?)\b/i, 'microphone'],
  [/\b(headphones?|in-?ears?|iems?|comms|beltpacks?|intercom)\b/i, 'headphones'],
  [/\b(desks?|consoles?|mixers?|mixing)\b/i, 'console'],
  [/\b(projectors?)\b/i, 'projector'],
  [/\b(cameras?|camcorders?)\b/i, 'camera-kit'],
  [/\b(cables?|leads?|looms?|xlr|tails|extensions?|multicores?|snakes?)\b/i, 'cable'],
  [/\b(screens?|tvs?|led ?walls?|led ?panels?|displays?)\b/i, 'video'],
]

const BY_DEPARTMENT: Record<Department, IconName> = {
  audio: 'audio',
  lighting: 'lighting',
  video: 'video',
  staging: 'staging',
  rigging: 'rigging',
  power: 'power',
  other: 'kit',
}

/**
 * The picture for a product until it has a photo: a case is a case; then its
 * category, then its name, if either says what it is; else its department.
 */
export function kitIcon(m: { name?: string; category?: string; department?: Department; isCase?: boolean } | undefined): IconName {
  if (!m) return 'kit'
  if (m.isCase) return 'case'
  for (const text of [m.category, m.name]) {
    if (!text) continue
    for (const [re, icon] of BY_WORD) if (re.test(text)) return icon
  }
  return m.department ? BY_DEPARTMENT[m.department] : 'kit'
}

export const departmentIcon = (d: Department): IconName => BY_DEPARTMENT[d]
