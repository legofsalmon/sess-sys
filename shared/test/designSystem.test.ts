import { createHash } from 'node:crypto'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ownColours } from '../src/own-colours.ts'

/**
 * The shared design system, as Session Hire takes it: its colours only, but
 * for the red accent and the bad tone, which stay Session Hire's own.
 *
 * shared/src/ds/ holds only what the design system's scripts/sync.mjs
 * vendored. Whether a copy is behind the design system needs a checkout of
 * that private repository beside this one (`npm run ds:check`); whether it
 * was edited here, or is read wrongly, does not, so these hold that half.
 */

const ROOT = join(import.meta.dirname, '..', '..')
const DS = join(ROOT, 'shared', 'src', 'ds')
const FILES = ['tokens.css', 'tokens.d.ts', 'tokens.js']

function* sources(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (path === DS) continue
    if (statSync(path).isDirectory()) yield* sources(path)
    else if (/\.(css|tsx?|html)$/.test(name)) yield path
  }
}
const appSources = () => [...sources(join(ROOT, 'web', 'src')), ...sources(join(ROOT, 'server', 'src')), join(ROOT, 'web', 'index.html')]

describe('the vendored design system', () => {
  it('holds tokens.css, tokens.js and tokens.d.ts', () => {
    expect(readdirSync(DS).sort()).toEqual(FILES)
  })

  for (const file of FILES) {
    it(`${file} is unedited since it was vendored`, () => {
      // A hand edit here is a fix the design-system repo should get; the next `npm run ds:sync` would refuse to run over it.
      const text = readFileSync(join(DS, file), 'utf8')
      const newline = text.indexOf('\n')
      const stamp = /@letissier\/design-system \S+ · (\S+) · sha256-([0-9a-f]{16}) · /.exec(text.slice(0, newline))
      expect(stamp?.[1]).toBe(file)
      expect(createHash('sha256').update(text.slice(newline + 1)).digest('hex').slice(0, 16)).toBe(stamp?.[2])
    })
  }

  it('defines every --ds- role the app reads', () => {
    // A misspelt role computes to nothing, silently: no colour at all.
    const css = readFileSync(join(DS, 'tokens.css'), 'utf8')
    const defined = new Set([...css.matchAll(/^\s*(--ds-[a-z0-9-]+)\s*:/gm)].map((m) => m[1]))
    const unknown: string[] = []
    for (const file of appSources()) {
      for (const m of readFileSync(file, 'utf8').matchAll(/var\((--ds-[a-z0-9-]+)/g)) {
        if (!defined.has(m[1])) unknown.push(`${relative(ROOT, file)}: ${m[1]}`)
      }
    }
    expect(unknown).toEqual([])
  })

  it("declares Session Hire's own colours in app.css as own-colours.ts has them", () => {
    // The red accent and the bad tone aren't shared roles; the freelancer's pages take them from own-colours.ts, the app from app.css.
    const css = readFileSync(join(ROOT, 'web', 'src', 'app.css'), 'utf8')
    const darkAt = css.indexOf('@media (prefers-color-scheme: dark)')
    const declared = (block: string) =>
      Object.fromEntries([...block.matchAll(/(--[a-z-]+):\s*(#[0-9a-f]{3,8})\b/gi)].map((m) => [m[1]!.slice(2), m[2]!.toLowerCase()]))
    const light = declared(css.slice(0, darkAt))
    const dark = declared(css.slice(darkAt, css.indexOf('}', darkAt)))
    for (const [name, value] of Object.entries(ownColours.light)) expect(light[name], `light --${name}`).toBe(value)
    for (const [name, value] of Object.entries(ownColours.dark)) expect(dark[name], `dark --${name}`).toBe(value)
    // And nothing else in the colour block is a literal: every other colour is a shared role.
    expect(Object.keys(light).sort()).toEqual(Object.keys(ownColours.light).sort())
  })

  it('takes the page in the phone theme', () => {
    // The tokens default to dark; "auto" follows the phone's setting, as the app always has.
    expect(readFileSync(join(ROOT, 'web', 'index.html'), 'utf8')).toMatch(/<html [^>]*data-theme="auto"/)
  })
})
