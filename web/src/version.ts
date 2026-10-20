/**
 * Which build of the app this is, for error reports (ADR 0005) and the show
 * pack. Read at run time from version.json, a file the build writes beside
 * the page (vite.config.ts), rather than compiled into the code: compiled
 * in, it changed the app's biggest file on every deploy, and with it the
 * name of every file that refers to it, so every phone downloaded about
 * 1 MB again each time (audit finding 14). The file is kept with the
 * version it came with (the service worker holds it), so a phone that
 * hasn't loaded the new version yet still says the one it's running.
 */

let known = 'dev'

/** Read once as the app starts; "dev" until then, and from a build without the file (the dev server). */
export const versionRead: Promise<string> = (async () => {
  try {
    const res = await fetch('/version.json', { signal: AbortSignal.timeout(8_000) })
    if (res.ok) {
      const { version } = (await res.json()) as { version?: unknown }
      if (typeof version === 'string' && version) known = version
    }
  } catch {
    // Not there, or out of reach: "dev" says it isn't known.
  }
  return known
})()

/** The version, as far as it's known yet. */
export const appVersion = () => known
