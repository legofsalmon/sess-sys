// The worker thread's way in (busy.ts, readBusyApart). Plain JavaScript,
// because a new thread doesn't always get the tsx the server was started
// with (Node 22 runs tsx's hooks on the main thread only): tsx is asked
// here, for this import alone, however the server or the tests started.
import { tsImport } from 'tsx/esm/api'

await tsImport('./busy-worker.ts', import.meta.url)
