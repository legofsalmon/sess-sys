/**
 * Every address starts with its area (ADR 0041): the planner, bringing jobs
 * in, clients and venues under #jobs; Admin at #admin; the crew and stock
 * lists brought in under Crew and Stock. Links already sent, bookmarks and
 * pages left open still use the old addresses, so each is put to its new
 * one as it's opened, in place in the history, before any screen reads it.
 */
const MOVED: readonly [RegExp, string][] = [
  [/^#plan(\/.*)?$/, '#jobs/plan$1'],
  [/^#import$/, '#jobs/import'],
  [/^#venues\/(.+)$/, '#jobs/venues/$1'],
  [/^#clients\/(.+)$/, '#jobs/clients/$1'],
  [/^#account\/import-people$/, '#crew/import'],
  [/^#account\/import-stock$/, '#stock/import'],
  [/^#account$/, '#admin'],
]

/** Where an old address lives now, or undefined when it hasn't moved. */
export function movedTo(hash: string): string | undefined {
  for (const [old, now] of MOVED) if (old.test(hash)) return hash.replace(old, now)
  return undefined
}

function follow() {
  const now = movedTo(location.hash)
  if (now) history.replaceState(history.state, '', `${location.pathname}${location.search}${now}`)
}

/** Called before anything else listens for a change of address, so every screen only ever sees the new one. */
export function followMovedAddresses() {
  follow()
  addEventListener('hashchange', follow)
}
