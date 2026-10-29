import { spawnSync } from 'node:child_process'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ownColours } from '../src/own-colours.ts'

/**
 * The shared design system, as Session Hire takes it: its colours only, but
 * for the red accent and the bad tone, which stay Session Hire's own.
 *
 * shared/src/ds/ holds only what the design system's scripts/sync.mjs
 * vendored, with the design system's own checker among it. Whether a copy is
 * behind the published system is `npm run ds:check`, which warns; whether it
 * was edited here, or is read wrongly, fails these.
 */

const ROOT = join(import.meta.dirname, '..', '..')
const DS = join(ROOT, 'shared', 'src', 'ds')
const FILES = ['ds-check.mjs', 'icons.d.ts', 'icons.js', 'tokens.css', 'tokens.d.ts', 'tokens.js']

describe('the vendored design system', () => {
  it('holds the tokens and the icons', () => {
    expect(readdirSync(DS).sort()).toEqual(FILES)
  })

  it('is unedited since it was vendored, and defines every --ds- role the app reads', () => {
    // A hand edit here is a fix the design-system repo should get, and the next `npm run ds:sync` would drop it; a misspelt role computes to nothing, silently. The design system's checker holds both.
    const run = spawnSync(process.execPath, [join(DS, 'ds-check.mjs'), 'shared/src/ds', '--reads', 'web/src', 'server/src', 'web/index.html', '--offline'], {
      cwd: ROOT,
      encoding: 'utf8',
      env: { PATH: process.env.PATH },
    })
    expect(run.stderr).toBe('')
    expect(run.status).toBe(0)
  })

  it("declares Session Hire's own colours in app.css as own-colours.ts has them", () => {
    // The red accent and the bad tone aren't shared roles; the freelancer's pages take them from own-colours.ts, the app from app.css.
    const css = readFileSync(join(ROOT, 'web', 'src', 'app.css'), 'utf8')
    const darkAt = css.indexOf(":root[data-theme='dark']")
    const autoAt = css.indexOf(":root[data-theme='auto']", css.indexOf('@media (prefers-color-scheme: dark)'))
    const declared = (block: string) =>
      Object.fromEntries([...block.matchAll(/(--[a-z-]+):\s*(#[0-9a-f]{3,8})\b/gi)].map((m) => [m[1]!.slice(2), m[2]!.toLowerCase()]))
    const light = declared(css.slice(0, darkAt))
    // Dark when chosen, and when following a phone that's set to dark (ADR 0036): the same values in both.
    const dark = declared(css.slice(darkAt, css.indexOf('}', darkAt)))
    const auto = declared(css.slice(autoAt, css.indexOf('}', autoAt)))
    for (const [name, value] of Object.entries(ownColours.light)) expect(light[name], `light --${name}`).toBe(value)
    for (const [name, value] of Object.entries(ownColours.dark)) expect(dark[name], `dark --${name}`).toBe(value)
    expect(auto).toEqual(dark)
    // And nothing else in the colour block is a literal: every other colour is a shared role.
    expect(Object.keys(light).sort()).toEqual(Object.keys(ownColours.light).sort())
  })

  it('opens dark unless the device chose otherwise', () => {
    // The design system's default (ADR 0036); theme.ts and index.html's own line keep a device's choice of light, or "auto" to follow the phone.
    const html = readFileSync(join(ROOT, 'web', 'index.html'), 'utf8')
    expect(html).toMatch(/<html [^>]*data-theme="dark"/)
    expect(html).toContain("localStorage.getItem('sh.theme')")
  })
})
