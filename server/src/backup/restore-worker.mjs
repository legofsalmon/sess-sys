// The test restore's way into its worker thread (service.ts, checkRestores).
// Plain JavaScript for the same reason as crew/busy-worker.mjs: tsx is asked
// here, for this import alone, however the server or the tests started.
import { tsImport } from 'tsx/esm/api'

await tsImport('./restore-worker.ts', import.meta.url)
