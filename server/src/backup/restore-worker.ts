import { parentPort, workerData } from 'node:worker_threads'
import { pgliteDb } from '../db.ts'
import { checkBackupFile, restoreChecked } from './format.ts'

/**
 * One test restore in a worker thread of its own (checkRestores, in
 * service.ts): the file in, the report or the reason it failed back. Booting
 * a scratch database and putting every row back takes seconds of the CPU,
 * which on the main thread would hold up every device for as long.
 */

const { data, key } = workerData as { data: Uint8Array; key?: Uint8Array }
const asBuffer = (b: Uint8Array) => Buffer.from(b.buffer, b.byteOffset, b.byteLength)
try {
  // The file first: one that's damaged or too new is turned down without a database.
  const checked = checkBackupFile(asBuffer(data), key && asBuffer(key))
  const scratch = await pgliteDb()
  try {
    parentPort!.postMessage({ report: await restoreChecked(scratch, checked) })
  } finally {
    await scratch.close()
  }
} catch (err) {
  parentPort!.postMessage({ failed: err instanceof Error ? err.message : String(err) })
}
