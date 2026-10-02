import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

/**
 * A backup holds everything, every freelancer's private link included, so
 * with BACKUP_KEY set each file is encrypted before it goes to the storage
 * (AES-256-GCM, under that key alone) and can't be read, or restored,
 * without it. The key is made once (`openssl rand -hex 32`) and kept in
 * the server's settings and somewhere else safe: a lost key is a lost
 * backup. Without the key the files are plain text inside, as the first
 * backups were, and a server given the key can still restore those.
 *
 *     SHBK 0x01 <12-byte nonce> <ciphertext> <16-byte tag>
 */

const MAGIC = Buffer.from('SHBK')
const VERSION = 1
const NONCE = 12
const TAG = 16

/** Whether a file from the storage is one of these, rather than plain gzip. */
export function isEncrypted(data: Buffer): boolean {
  return data.length > MAGIC.length && data.subarray(0, MAGIC.length).equals(MAGIC)
}

export function encryptBackup(plain: Buffer, key: Buffer): Buffer {
  const header = Buffer.concat([MAGIC, Buffer.from([VERSION])])
  const nonce = randomBytes(NONCE)
  const cipher = createCipheriv('aes-256-gcm', key, nonce)
  cipher.setAAD(header)
  const body = Buffer.concat([cipher.update(plain), cipher.final()])
  return Buffer.concat([header, nonce, body, cipher.getAuthTag()])
}

/** The plain file, or an error saying in words why it can't be read. */
export function decryptBackup(data: Buffer, key: Buffer): Buffer {
  if (!isEncrypted(data)) throw new Error("This file isn't an encrypted backup.")
  const version = data[MAGIC.length]
  if (version !== VERSION) throw new Error(`This backup was encrypted by a newer version of the app (format ${version}). Restore it with that version or a later one.`)
  const header = data.subarray(0, MAGIC.length + 1)
  const start = header.length
  if (data.length < start + NONCE + TAG) throw new Error('This backup is damaged: it is too short to be one.')
  const nonce = data.subarray(start, start + NONCE)
  const body = data.subarray(start + NONCE, data.length - TAG)
  const tag = data.subarray(data.length - TAG)
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, nonce)
    decipher.setAAD(header)
    decipher.setAuthTag(tag)
    return Buffer.concat([decipher.update(body), decipher.final()])
  } catch {
    throw new Error("This backup can't be unlocked with BACKUP_KEY: it was made with a different key, or the file is damaged.")
  }
}

/** The key the environment sets, or undefined when backups go up plain. A key that isn't one stops the server from starting. */
export function backupKeyFromEnv(env: NodeJS.ProcessEnv = process.env): Buffer | undefined {
  const text = env.BACKUP_KEY?.trim()
  if (!text) return undefined
  // Not repeated back: whatever was pasted in by mistake could be a secret.
  if (!/^[0-9a-fA-F]{64}$/.test(text)) throw new Error('BACKUP_KEY should be 64 hex characters (32 bytes), as `openssl rand -hex 32` makes.')
  return Buffer.from(text, 'hex')
}
