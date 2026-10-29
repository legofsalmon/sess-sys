// The worker thread's way in (import.ts, planApart). Plain JavaScript, as
// crew/busy-worker.mjs is and for the same reason: a new thread doesn't
// always get the tsx the server was started with, so it's asked for here.
import { tsImport } from 'tsx/esm/api'

await tsImport('./plan-worker.ts', import.meta.url)
