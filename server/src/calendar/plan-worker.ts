import { parentPort, workerData } from 'node:worker_threads'
import { planImport, type AppData, type Chosen, type PlanOptions, type SourceEvent } from './import-plan.ts'

/**
 * One bring-in's plan in a worker thread of its own (planApart, in
 * import.ts): the events and what the app holds in, the plan back. A
 * season's plan is a second or more of work, which on the server's own
 * thread held up every device (audit, 20 October 2026, finding 18).
 */

const { events, app, options, chosen } = workerData as { events: SourceEvent[]; app: AppData; options: PlanOptions; chosen?: Chosen }
parentPort!.postMessage(planImport(events, app, options, chosen))
