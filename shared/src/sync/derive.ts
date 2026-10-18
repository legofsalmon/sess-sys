import type { Mutation } from '../commands.ts'

/**
 * Each part of the view kept from one change to the next, and built again
 * only when what it was built from has changed (audit, 18 October 2026,
 * finding 11): with 900 jobs a change to anything rebuilt everything, the
 * kit on every job included, and a phone took a second or two over each.
 *
 * A part is built from the tables of the device's copy, the changes still
 * waiting to go, the day in Ireland, and the other parts it's handed. The
 * tables it reads are noted as it reads them; each table carries a stamp
 * that moves when a change lands in it. The changes waiting are a list the
 * part goes through, looking at each one's name and reading only those it
 * knows; a change of a kind it was seen to pass over without reading can
 * come or go without it being built again. Anything else that changes, or
 * a change of a kind it hasn't been seen to pass over, builds it again.
 */

interface Waiting {
  id: string
  name: string
}

interface Kept {
  value: unknown
  /** The stamp of each table it read, as it was when built. */
  tables: Map<string, number>
  /** It went through the tables themselves, not by name: any change builds it again. */
  every: boolean
  latest: number
  epoch: number
  today: string
  deps: readonly unknown[]
  waiting: Waiting[]
}

interface Learnt {
  /** Kinds of change this part has had in front of it. */
  seen: Set<string>
  /** Kinds it read more than the name of. */
  read: Set<string>
}

export class Derived {
  private stamps = new Map<string, number>()
  private latest = 0
  private epoch = 0
  private kept = new Map<string, Kept>()
  private learnt = new Map<string, Learnt>()

  /** A change landed in a table. */
  touched(table: string) {
    this.stamps.set(table, ++this.latest)
  }

  /** The copy changed some other way (started afresh, or the changes waiting rewritten): everything is built again. */
  touchedAll() {
    this.epoch++
    this.latest++
  }

  /**
   * The part named, kept if nothing it was built from has changed, else
   * built by `build` from the tables and the changes waiting it's handed:
   * only those, as it's what it reads of them that's noted.
   */
  part<T, E extends object>(
    name: string,
    from: { entities: E; waiting: readonly Mutation[]; today: string; deps: readonly unknown[] },
    build: (entities: E, waiting: readonly Mutation[]) => T
  ): T {
    const learnt = this.learnt.get(name) ?? { seen: new Set<string>(), read: new Set<string>() }
    this.learnt.set(name, learnt)
    const was = this.kept.get(name)
    if (was && this.fresh(was, learnt, from)) return was.value as T

    const tables = new Map<string, number>()
    const kept: Kept = { value: undefined, tables, every: false, latest: this.latest, epoch: this.epoch, today: from.today, deps: from.deps, waiting: [] }
    const stamps = this.stamps
    // Noted whenever it's read, so a function handed out that reads a table later is followed too.
    const entities = new Proxy(from.entities, {
      get(target, key, receiver) {
        if (typeof key === 'string' && !tables.has(key)) tables.set(key, stamps.get(key) ?? 0)
        return Reflect.get(target, key, receiver)
      },
      has(target, key) {
        kept.every = true
        return Reflect.has(target, key)
      },
      ownKeys(target) {
        kept.every = true
        return Reflect.ownKeys(target)
      },
      getOwnPropertyDescriptor(target, key) {
        kept.every = true
        return Reflect.getOwnPropertyDescriptor(target, key)
      },
    })
    const waiting = from.waiting.map((m) => {
      learnt.seen.add(m.name)
      kept.waiting.push({ id: m.id, name: m.name })
      return new Proxy(m, {
        get(target, key, receiver) {
          if (key !== 'name' && key !== 'appliedSeq') learnt.read.add(target.name)
          return Reflect.get(target, key, receiver)
        },
      })
    })
    kept.value = build(entities, waiting)
    this.kept.set(name, kept)
    return kept.value as T
  }

  private fresh(was: Kept, learnt: Learnt, from: { waiting: readonly Mutation[]; today: string; deps: readonly unknown[] }): boolean {
    if (was.epoch !== this.epoch || was.today !== from.today) return false
    if (was.deps.length !== from.deps.length || was.deps.some((d, i) => d !== from.deps[i])) return false
    if (was.every ? was.latest !== this.latest : [...was.tables].some(([t, s]) => (this.stamps.get(t) ?? 0) !== s)) return false
    // The changes waiting that have come or gone since: each must be of a kind this part passes over.
    const passes = (name: string) => learnt.seen.has(name) && !learnt.read.has(name)
    const before = new Map(was.waiting.map((m) => [m.id, m.name]))
    for (const m of from.waiting) {
      if (before.delete(m.id)) continue
      if (!passes(m.name)) return false
    }
    for (const name of before.values()) if (!passes(name)) return false
    return true
  }
}
