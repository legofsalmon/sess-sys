const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz'

/**
 * Time-sortable unique id: 9 chars of base-36 milliseconds followed by 12
 * chars of crypto randomness. Same scheme as Crewbox's `newId()`, and for the
 * same reason: `crypto.randomUUID` needs a secure context, which an Android
 * webview on a site's own Wi-Fi does not always give us.
 */
export function newId(): string {
  const time = Date.now().toString(36).padStart(9, '0')
  const bytes = new Uint8Array(12)
  globalThis.crypto.getRandomValues(bytes)
  let rand = ''
  for (const b of bytes) rand += ALPHABET[b % 36]
  return time + rand
}
