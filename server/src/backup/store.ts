import { AwsClient } from 'aws4fetch'
import { createHash } from 'node:crypto'
import { mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, join, relative, sep } from 'node:path'

/**
 * Where backup files are kept. In production that is an S3-compatible
 * bucket (a Railway bucket, Backblaze B2, Cloudflare R2 or Amazon S3 all
 * speak the same language), away from the database. A plain folder does
 * for local development and tests.
 */
export interface BackupStore {
  /** Where the backups go, for logs and the Account screen; never includes a secret. */
  where: string
  put(key: string, data: Buffer): Promise<void>
  get(key: string): Promise<Buffer>
  list(prefix: string): Promise<StoredFile[]>
  delete(key: string): Promise<void>
}

export interface StoredFile {
  key: string
  bytes: number
}

export interface S3Settings {
  /** For example https://t3.storageapi.dev (Railway) or https://s3.eu-central-003.backblazeb2.com (Backblaze). */
  endpoint: string
  bucket: string
  /** `auto` for Railway and Cloudflare; the bucket's region for others. */
  region: string
  accessKeyId: string
  secretAccessKey: string
  /** Address the bucket as endpoint/bucket rather than bucket.endpoint, which some older services need. */
  pathStyle?: boolean
}

const TIMEOUT_MS = 120_000

export function s3Store(settings: S3Settings): BackupStore {
  const aws = new AwsClient({
    accessKeyId: settings.accessKeyId,
    secretAccessKey: settings.secretAccessKey,
    service: 's3',
    region: settings.region,
  })
  const url = (key: string, query?: Record<string, string>) => s3Url(settings, key, query)
  const send = async (target: string, init: RequestInit = {}) => {
    const res = await aws.fetch(target, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) })
    if (!res.ok) {
      const detail = (await res.text().catch(() => '')).match(/<Message>([^<]*)<\/Message>/)?.[1]
      throw new Error(`The backup storage answered ${res.status}${detail ? `: ${detail}` : ''}`)
    }
    return res
  }

  return {
    where: `bucket ${settings.bucket} at ${new URL(settings.endpoint).host}`,
    async put(key, data) {
      // The storage checks the file against this checksum, so a file damaged on the way is refused rather than kept.
      const sha256 = createHash('sha256').update(data).digest('hex')
      await send(url(key), { method: 'PUT', body: new Uint8Array(data), headers: { 'content-type': 'application/gzip', 'x-amz-content-sha256': sha256 } })
    },
    async get(key) {
      return Buffer.from(await (await send(url(key))).arrayBuffer())
    },
    async list(prefix) {
      const files: StoredFile[] = []
      let token: string | undefined
      do {
        const query: Record<string, string> = { 'list-type': '2', prefix }
        if (token) query['continuation-token'] = token
        const xml = await (await send(url('', query))).text()
        for (const [, entry] of xml.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)) {
          files.push({ key: xmlText(entry!, 'Key'), bytes: Number(xmlText(entry!, 'Size')) })
        }
        token = xmlText(xml, 'IsTruncated') === 'true' ? xmlText(xml, 'NextContinuationToken') || undefined : undefined
      } while (token)
      return files
    },
    async delete(key) {
      await send(url(key), { method: 'DELETE' })
    },
  }
}

/** The address of a key in a bucket, in either addressing style. */
export function s3Url(settings: S3Settings, key: string, query?: Record<string, string>): string {
  checkKey(key, true)
  const u = new URL(settings.endpoint)
  const path = key.split('/').map(encodeURIComponent).join('/')
  if (settings.pathStyle) {
    u.pathname = `${u.pathname.replace(/\/$/, '')}/${settings.bucket}/${path}`
  } else {
    u.hostname = `${settings.bucket}.${u.hostname}`
    u.pathname = `/${path}`
  }
  for (const [k, v] of Object.entries(query ?? {})) u.searchParams.set(k, v)
  return u.toString()
}

/** A folder on disk, laid out like a bucket. */
export function dirStore(root: string): BackupStore {
  const path = (key: string) => {
    checkKey(key)
    return join(root, ...key.split('/'))
  }
  return {
    where: `folder ${root}`,
    async put(key, data) {
      await mkdir(dirname(path(key)), { recursive: true })
      await writeFile(path(key), data)
    },
    get: (key) => readFile(path(key)),
    async list(prefix) {
      const files: StoredFile[] = []
      const walk = async (dir: string) => {
        const entries = await readdir(dir, { withFileTypes: true }).catch(() => [])
        for (const e of entries) {
          const full = join(dir, e.name)
          if (e.isDirectory()) await walk(full)
          else {
            const key = relative(root, full).split(sep).join('/')
            if (key.startsWith(prefix)) files.push({ key, bytes: (await stat(full)).size })
          }
        }
      }
      await walk(root)
      return files
    },
    async delete(key) {
      await rm(path(key), { force: true })
    },
  }
}

/**
 * The store the server is configured with, if any. All four BACKUP_S3_
 * settings together switch backups on; some but not all is a mistake worth
 * stopping for, since a server that silently skips its backups looks fine
 * until the day it is needed. BACKUP_DIR (a folder) is for local use.
 */
export function storeFromEnv(env: NodeJS.ProcessEnv = process.env): BackupStore | undefined {
  const endpoint = env.BACKUP_S3_ENDPOINT?.trim()
  const bucket = env.BACKUP_S3_BUCKET?.trim()
  const accessKeyId = env.BACKUP_S3_ACCESS_KEY_ID?.trim()
  const secretAccessKey = env.BACKUP_S3_SECRET_ACCESS_KEY?.trim()
  const given = [endpoint, bucket, accessKeyId, secretAccessKey].filter(Boolean).length
  if (given === 0) return env.BACKUP_DIR ? dirStore(env.BACKUP_DIR) : undefined
  if (given < 4) {
    throw new Error(
      'Backups need all four of BACKUP_S3_ENDPOINT, BACKUP_S3_BUCKET, BACKUP_S3_ACCESS_KEY_ID and BACKUP_S3_SECRET_ACCESS_KEY (BACKUP_S3_REGION is optional). Set the missing ones, or remove them all to run without backups.'
    )
  }
  try {
    new URL(endpoint!)
  } catch {
    throw new Error(`BACKUP_S3_ENDPOINT should be a web address such as https://t3.storageapi.dev, not "${endpoint}".`)
  }
  return s3Store({
    endpoint: endpoint!,
    bucket: bucket!,
    accessKeyId: accessKeyId!,
    secretAccessKey: secretAccessKey!,
    region: env.BACKUP_S3_REGION?.trim() || 'auto',
    pathStyle: env.BACKUP_S3_PATH_STYLE === 'true',
  })
}

function checkKey(key: string, allowEmpty = false) {
  if ((key === '' && allowEmpty) || /^[\w-]+(?:[./][\w-]+)*$/.test(key)) return
  throw new Error(`Not a backup file name: ${key}`)
}

function xmlText(xml: string, tag: string): string {
  const raw = xml.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`))?.[1] ?? ''
  return raw
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
}
