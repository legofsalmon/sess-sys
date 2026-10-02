import { irishToday, leaveRecordKept } from '@sh/shared'
import { getPerson } from '../crew/store.ts'
import type { Db, Queryable } from '../db.ts'
import { ERASED_WHEN_DUE_ACTION } from '../history.ts'
import { serverChange } from '../kernel.ts'
import { erasePerson, keptRecords, readErasure } from './places.ts'

/**
 * What an erasure kept goes on the day the law stops asking for it
 * (ADR 0027): a leave record three whole years after the end of its year,
 * and a kept name once no record kept needs it. Keeping either longer has
 * no legal reason, so nobody has to remember: the server looks at start
 * and once a day.
 */

/**
 * What of an erased person is due to go today: their kept name, whose day
 * has come, or leave records whose three years are up, with the day their
 * name is kept until.
 */
async function due(q: Queryable, personId: string, today: string): Promise<{ what: 'name' | 'leave'; until: string } | undefined> {
  const was = await readErasure(q, personId)
  // A name already gone took their leave with it; someone this copy of the data doesn't have has nothing here to go.
  if (!was || was.nameKeptUntil === null || !(await getPerson(q, personId))) return undefined
  if (was.nameKeptUntil <= today) return { what: 'name', until: was.nameKeptUntil }
  const { leave } = await keptRecords(q, personId)
  return leave.some((r) => !leaveRecordKept(r, today)) ? { what: 'leave', until: was.nameKeptUntil } : undefined
}

/** Found under the lock with nothing left to do: the change, and its entry in the history, are rolled back. */
class NothingDue extends Error {}

/**
 * Takes what is due for everyone erased, each as a change of its own,
 * recorded in the history as the server's. Each is looked at again under
 * the lock every change takes, so a second run, or another copy of the
 * server running at the same moment, finds nothing left and changes
 * nothing. Answers how many people had something go.
 */
export async function eraseWhatIsDue(db: Db, today = irishToday()): Promise<number> {
  const { rows } = await db.query<{ person_id: string }>(`SELECT person_id FROM erasures WHERE name_kept_until IS NOT NULL ORDER BY person_id`)
  let done = 0
  for (const { person_id: id } of rows) {
    const found = await due(db, id, today)
    if (!found) continue
    try {
      await serverChange(db, { name: ERASED_WHEN_DUE_ACTION, args: found.what === 'name' ? { id, name: true } : { id } }, async (ctx) => {
        const now = await due(ctx.tx, id, today)
        if (now?.what !== found.what || now.until !== found.until) throw new NothingDue()
        // The decision about the name stands as it was made, as for a restore: it goes today, or stays until its day.
        await erasePerson(ctx, id, { today, nameKeptUntil: found.what === 'name' ? null : found.until })
      })
      done++
    } catch (err) {
      if (!(err instanceof NothingDue)) throw err
    }
  }
  return done
}

interface Log {
  info(obj: object, msg: string): void
  warn(obj: object, msg: string): void
}

const HOUR = 60 * 60 * 1000

/**
 * Runs `eraseWhatIsDue` at start, then once each day in Ireland. It looks
 * every hour but goes to the database only on a new Irish day, so it runs
 * within the hour after midnight, whatever the clock change, without
 * waking the database at other times; one that fails is tried an hour
 * later. `changed` tells devices, and keeps the list beside the backups.
 */
export class DueErasures {
  private timer: NodeJS.Timeout | undefined
  private doneFor: string | undefined
  private running: Promise<number | undefined> = Promise.resolve(undefined)

  constructor(
    private readonly db: Db,
    private readonly options: { changed: () => void; log?: Log; report?: (err: unknown) => void }
  ) {}

  start(): Promise<number | undefined> {
    if (!this.timer) {
      this.timer = setInterval(() => void this.run(), HOUR)
      this.timer.unref()
    }
    return this.run()
  }

  stop() {
    clearInterval(this.timer)
    this.timer = undefined
  }

  /** Today's run, one at a time: how many people had something go, or undefined when today's was done already or failed. */
  run(): Promise<number | undefined> {
    this.running = this.running.then(async () => {
      const today = irishToday()
      if (this.doneFor === today) return undefined
      try {
        const n = await eraseWhatIsDue(this.db, today)
        this.doneFor = today
        if (n) {
          this.options.changed()
          this.options.log?.info({ people: n }, 'Erased what the law no longer asks to keep of people erased on request')
        }
        return n
      } catch (err) {
        // Some may have gone before it failed: devices are told of those.
        this.options.changed()
        this.options.log?.warn({ err }, 'Could not erase what was due of people erased on request; trying again in an hour')
        this.options.report?.(err)
        return undefined
      }
    })
    return this.running
  }
}
