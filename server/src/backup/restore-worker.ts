import { pgliteDb } from '../db.ts'
import { checkBackupFile, restoreChecked, type RestoreReport } from './format.ts'

/**
 * One test restore in a process of its own (checkRestores, in service.ts):
 * the file in, the report or the reason it failed back, then the process
 * ends and its memory goes with it. Booting a scratch database and putting
 * every row back takes seconds of the CPU and hundreds of MB, which in the
 * server would hold up every device for as long and stay after it.
 */

type Asked = { data: Uint8Array; key?: Uint8Array }
const asBuffer = (b: Uint8Array) => Buffer.from(b.buffer, b.byteOffset, b.byteLength)

async function check({ data, key }: Asked): Promise<{ report: RestoreReport } | { failed: string }> {
  try {
    // The file first: one that's damaged or too new is turned down without a database.
    const checked = checkBackupFile(asBuffer(data), key && asBuffer(key))
    const scratch = await pgliteDb()
    try {
      return { report: await restoreChecked(scratch, checked) }
    } finally {
      await scratch.close()
    }
  } catch (err) {
    return { failed: err instanceof Error ? err.message : String(err) }
  }
}

process.once('message', (asked: Asked) => {
  void check(asked).then((answer) => process.send!(answer, () => process.exit(0)))
})
