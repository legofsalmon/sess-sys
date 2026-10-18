import { parentPort, workerData } from 'node:worker_threads'
import { NotACalendar, readBusy, TooMuch, type ReadLimits } from './busy.ts'

/**
 * One calendar read in a worker thread of its own (readBusyApart, in
 * busy.ts): the text in, the busy times or what kind of failure back.
 * A thread per file also keeps ical.js's time zones to that file.
 */

const { text, today, limits } = workerData as { text: string; today: string; limits?: ReadLimits }
try {
  parentPort!.postMessage({ read: readBusy(text, today, limits) })
} catch (err) {
  parentPort!.postMessage({ failed: err instanceof NotACalendar ? 'not-a-calendar' : err instanceof TooMuch ? 'too-much' : 'fault' })
}
