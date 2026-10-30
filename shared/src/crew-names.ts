/**
 * People's names (ADR 0025): a whole name as a first and a last name, as
 * Irish and other names have them.
 */

/**
 * Words that start a last name rather than end a first one, as Irish and
 * other names have them: "Seán Ó Briain", "Áine Nic Dhonnchadha", "Jan van
 * der Berg". Each as it's usually written, capitalised and in capitals, and
 * matched exactly, so the server's own split of the names already held
 * (crew/schema.ts) reads them the same way, whatever its database's locale.
 */
const PARTICLES = ['ó', 'ní', 'nic', 'mac', 'mc', 'ua', 'uí', 'mhic', 'o', 'de', 'van', 'von', 'der', 'den', 'da', 'di', 'du', 'le', 'la', 'del', 'della', 'st', 'st.']
export const NAME_PARTICLES: readonly string[] = [...new Set(PARTICLES.flatMap((w) => [w, w[0]!.toUpperCase() + w.slice(1), w.toUpperCase()]))]
const PARTICLE = new Set(NAME_PARTICLES)
/**
 * "an" and "na", which carry a last name on after a word that starts one: "Pádraig Mac an tSaoi", "Seosamh Mac na
 * Mara". Only after one, so a first name is never cut short by them alone (audit, 20 October 2026, finding 85).
 */
const ARTICLES = ['an', 'na']
export const NAME_ARTICLES: readonly string[] = [...new Set(ARTICLES.flatMap((w) => [w, w[0]!.toUpperCase() + w.slice(1), w.toUpperCase()]))]
const ARTICLE = new Set(NAME_ARTICLES)

export interface NameParts {
  firstName: string
  lastName: string
}

/**
 * A whole name as a first and a last name: the last word is the last name,
 * with any words before it that start one ("Ó", "Mac", "van", "Mac an"); one word is a
 * first name alone. Names typed before the two were asked for are split this
 * way, and the office corrects any it gets wrong.
 */
export function splitName(name: string): NameParts {
  const words = name.trim().split(/\s+/).filter(Boolean)
  if (words.length < 2) return { firstName: words[0] ?? '', lastName: '' }
  let i = words.length - 1
  for (;;) {
    if (i > 1 && PARTICLE.has(words[i - 1]!)) i--
    else if (i > 2 && ARTICLE.has(words[i - 1]!) && PARTICLE.has(words[i - 2]!)) i -= 2
    else break
  }
  return { firstName: words.slice(0, i).join(' '), lastName: words.slice(i).join(' ') }
}

/** The whole name, as lists, call sheets and messages show it: "Seán Ó Briain", or the first name alone. */
export function fullName(p: NameParts): string {
  return [p.firstName.trim(), p.lastName.trim()].filter(Boolean).join(' ')
}

/** A person's first and last name: as held, or split from the whole name for a record from before they were (or a copy that lacks them). */
export function nameParts(p: { name: string; firstName?: string; lastName?: string }): NameParts {
  return p.firstName?.trim() ? { firstName: p.firstName.trim(), lastName: p.lastName?.trim() ?? '' } : splitName(p.name)
}

/**
 * The name a change to someone's details leaves them with, on the server and
 * on a device alike. The whole name is the one sent. A first and last name
 * sent with it are kept when they make it, as the form sends them. A whole
 * name alone (an older version of the app, a calendar or crew-list bring-in),
 * or with two that no longer make it, keeps the two they have when it's the
 * name they had, and is split otherwise.
 */
export function namesAfter(a: { name: string; firstName?: string; lastName?: string }, was: { name: string; firstName?: string; lastName?: string } | undefined): NameParts & { name: string } {
  const sent = { firstName: a.firstName?.trim() ?? '', lastName: a.lastName?.trim() ?? '' }
  if (sent.firstName && fullName(sent) === a.name.trim().replace(/\s+/g, ' ')) return { name: fullName(sent), ...sent }
  const parts = was && was.name === a.name ? nameParts(was) : splitName(a.name)
  return { name: a.name, ...parts }
}
