import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { dbFromEnv } from '../db.ts'
import { migrateAll } from '../modules.ts'
import { newGeneration, readBackup, restoreBackup } from './format.ts'
import { checkRestores, latestKey, PREFIX } from './service.ts'
import { storeFromEnv, type BackupStore } from './store.ts'

/**
 * Backups by hand, for drills and disasters. Uses the same settings as the
 * server: DATABASE_URL for the database, BACKUP_S3_... for the storage.
 *
 *   npm run backup -w server -- list                 the backups in storage
 *   npm run backup -w server -- check latest         test-restore one into memory (touches no database)
 *   npm run backup -w server -- download latest      save one here, to keep or read
 *   npm run backup -w server -- restore latest       put one into DATABASE_URL, which must be empty
 *   npm run backup -w server -- new-generation       after putting data back any other way
 *
 * Instead of `latest`: a file's name in storage, or a backup file on this computer.
 */

const [command, from = 'latest'] = process.argv.slice(2)

async function load(store: BackupStore | undefined, source: string): Promise<{ name: string; data: Buffer }> {
  if (existsSync(source)) return { name: source, data: readFileSync(source) }
  if (!store) throw new Error(`${source} isn't a file here, and no backup storage is set up (BACKUP_S3_... or BACKUP_DIR).`)
  const key = source === 'latest' ? await latestKey(store) : source
  return { name: key, data: await store.get(key) }
}

async function main() {
  const store = storeFromEnv()
  switch (command) {
    case 'list': {
      if (!store) throw new Error('No backup storage is set up (BACKUP_S3_... or BACKUP_DIR).')
      const files = (await store.list(PREFIX)).sort((a, b) => a.key.localeCompare(b.key))
      for (const f of files) console.log(`${f.key}  ${(f.bytes / 1024).toFixed(0)} KB`)
      console.log(`${files.length} in ${store.where}`)
      return
    }
    case 'check': {
      const { name, data } = await load(store, from)
      const report = await checkRestores(data)
      console.log(`${name}: restores cleanly. Made ${report.header.createdAt}, ${report.rows} rows:`)
      for (const [table, rows] of Object.entries(report.tables)) console.log(`  ${table}: ${rows}`)
      return
    }
    case 'download': {
      const { name, data } = await load(store, from)
      readBackup(data)
      // npm runs this in the server folder; save where the command was typed.
      const file = join(process.env.INIT_CWD ?? process.cwd(), basename(name))
      writeFileSync(file, data)
      console.log(`Saved ${file} (${(data.length / 1024).toFixed(0)} KB)`)
      return
    }
    case 'restore': {
      const { name, data } = await load(store, from)
      const db = await dbFromEnv()
      try {
        const report = await restoreBackup(db, data)
        console.log(`Restored ${name} (made ${report.header.createdAt}): ${report.rows} rows.`)
      } finally {
        await db.close()
      }
      return
    }
    case 'new-generation': {
      const db = await dbFromEnv()
      try {
        await migrateAll(db)
        console.log(`New generation ${await newGeneration(db)}: every device will start its copy afresh on its next sync.`)
      } finally {
        await db.close()
      }
      return
    }
    default:
      console.log('Usage: npm run backup -w server -- list | check [latest|name|file] | download [...] | restore [...] | new-generation')
      process.exitCode = command ? 1 : 0
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err)
  process.exitCode = 1
})
