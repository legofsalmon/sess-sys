import { readdirSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { APP_VERSION, CHANGELOG } from '../src/index.ts'

/** The changelog every change to the app adds to (ADR 0071). */
describe('the changelog', () => {
  const parse = (v: string) => v.split('.').map(Number)

  it('is newest first, each version one step up from the one before it', () => {
    expect(APP_VERSION).toBe(CHANGELOG[0]!.version)
    for (let i = 0; i < CHANGELOG.length - 1; i++) {
      const [a, b] = [parse(CHANGELOG[i + 1]!.version), parse(CHANGELOG[i]!.version)]
      const next = [
        [a[0]! + 1, 0, 0],
        [a[0]!, a[1]! + 1, 0],
        [a[0]!, a[1]!, a[2]! + 1],
      ].map((v) => v.join('.'))
      expect(next, `${CHANGELOG[i]!.version} after ${CHANGELOG[i + 1]!.version}`).toContain(b.join('.'))
      expect(CHANGELOG[i]!.date >= CHANGELOG[i + 1]!.date, `${CHANGELOG[i]!.version}'s date`).toBe(true)
    }
  })

  it('says something for each, with a pull request, and decisions that exist', () => {
    const adrs = new Set(readdirSync(new URL('../../docs/adr/', import.meta.url)).map((f) => Number(f.slice(0, 4))))
    for (const r of CHANGELOG) {
      expect(r.version).toMatch(/^\d+\.\d+\.\d+$/)
      expect(r.date).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      expect(r.title.trim()).not.toBe('')
      expect(r.what.trim()).not.toBe('')
      expect(r.prs.length, r.version).toBeGreaterThan(0)
      for (const n of r.adrs ?? []) expect(adrs.has(n), `ADR ${n} in ${r.version}`).toBe(true)
    }
  })
})
