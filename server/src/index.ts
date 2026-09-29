import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { buildApp } from './app.ts'
import { dbFromEnv } from './db.ts'

const webDist = process.env.WEB_ROOT ?? fileURLToPath(new URL('../../web/dist', import.meta.url))
const db = await dbFromEnv()
const app = await buildApp({ db, logger: true, webRoot: existsSync(webDist) ? webDist : undefined })
const port = Number(process.env.PORT ?? 3030)
await app.listen({ port, host: process.env.HOST ?? '0.0.0.0' })
app.log.info({ db: db.kind }, db.kind === 'memory' ? 'Database: in memory (nothing is kept after a restart)' : `Database: ${db.kind}`)

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, async () => {
    await app.close()
    await db.close()
    process.exit(0)
  })
}
