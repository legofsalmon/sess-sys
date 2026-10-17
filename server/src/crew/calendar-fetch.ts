import { tidyCalendarAddress } from '@sh/shared'
import { lookup } from 'node:dns/promises'
import { request as httpRequest, type IncomingMessage } from 'node:http'
import { request as httpsRequest } from 'node:https'
import type { LookupFunction } from 'node:net'
import { isIP } from 'node:net'

/**
 * Reading a calendar from an address someone pasted (ADR 0044). The
 * address comes from outside, and the server fetches it from inside
 * Railway's network, so it's held to what a calendar address is and
 * nothing more: someone pasting the address of something private to the
 * server (its database, the cloud's own settings at 169.254.169.254, a
 * service on localhost) gets "can't read that" and nothing else.
 *
 * - https only (webcal:// is https); no name and password in it; the
 *   usual port only.
 * - The name is looked up first, and every address it gives must be on
 *   the public internet: none private, loopback, link-local, shared,
 *   multicast or kept for documentation, in IPv4 or IPv6, an IPv4 one
 *   written as IPv6 included. The connection then goes to the address
 *   checked, not to a second look-up, so the name can't be pointed
 *   somewhere else in between.
 * - A redirect is followed, three at most, and checked the same way.
 * - The whole read has a time limit and a size limit, and only GET is
 *   ever sent, with nothing of ours in it.
 *
 * Failures are said in words a freelancer can act on, never with the
 * address in them: it's a secret, and error reports leave the company.
 */

export class NotRead extends Error {
  constructor(readonly words: string) {
    super(words)
  }
}

export const READ_WORDS = {
  unreachable: "We couldn't reach a calendar at that address. Check it's the whole address, copied again from your calendar.",
  private: "That address isn't on the public internet, so it can't be read from here. Use the address your calendar gives for sharing.",
  slow: 'Your calendar took too long to answer. Try again in a few minutes.',
  big: "That calendar is too big to read here. If it holds years of events, a calendar with only what's coming up will do.",
  denied: 'Your calendar said no to reading it: its private address may have been reset. Copy the address again and share that.',
  gone: "There's no calendar at that address any more. Copy the address again from your calendar and share that.",
  redirects: 'That address sends us round in circles, so it could not be read. Copy the address again from your calendar.',
  other: "Your calendar's server couldn't give it to us just now. Try again in a few minutes.",
} as const

export interface FetchOptions {
  /** How long the whole read may take. */
  timeoutMs?: number
  /** The most it may hold. */
  maxBytes?: number
  maxRedirects?: number
  /** Stands in for the name look-up, for tests. */
  resolve?: (host: string) => Promise<string[]>
  /**
   * Local stand-ins for tests and the browser tests, as host:port: these
   * alone may be plain http and on this machine. Never set where the
   * server runs for real (OWN_CALENDAR_TEST_HOSTS).
   */
  testHosts?: readonly string[]
}

const TIMEOUT_MS = 20_000
/** Eight megabytes: a busy Google calendar with years of history is a few. */
const MAX_BYTES = 8 * 1024 * 1024
const MAX_REDIRECTS = 3

/** Read a calendar's text from its address, already tidied (tidyCalendarAddress). */
export async function fetchCalendar(address: string, options: FetchOptions = {}): Promise<string> {
  const deadline = Date.now() + (options.timeoutMs ?? TIMEOUT_MS)
  let url = address
  for (let hop = 0; ; hop++) {
    const answer = await getOnce(url, deadline, options)
    if (answer.kind === 'body') return answer.text
    if (hop >= (options.maxRedirects ?? MAX_REDIRECTS)) throw new NotRead(READ_WORDS.redirects)
    url = answer.location
  }
}

type Answer = { kind: 'body'; text: string } | { kind: 'redirect'; location: string }

async function getOnce(address: string, deadline: number, options: FetchOptions): Promise<Answer> {
  const url = checkedUrl(address, options)
  const test = isTestHost(url, options)
  const host = url.hostname.replace(/^\[|\]$/g, '')
  const addresses = isIP(host) ? [host] : await resolve(host, options)
  if (!addresses.length) throw new NotRead(READ_WORDS.unreachable)
  if (!test && addresses.some((a) => !isPublic(a))) throw new NotRead(READ_WORDS.private)
  const pinned = addresses[0]!
  const family = isIP(pinned) === 6 ? 6 : 4
  // The connection goes to the address just checked, whatever a second look-up would say.
  const pin: LookupFunction = (_name, opts, done) => {
    if ((opts as { all?: boolean }).all) (done as unknown as (e: null, a: { address: string; family: number }[]) => void)(null, [{ address: pinned, family }])
    else done(null, pinned, family)
  }
  const left = deadline - Date.now()
  if (left <= 0) throw new NotRead(READ_WORDS.slow)
  const maxBytes = options.maxBytes ?? MAX_BYTES
  return new Promise<Answer>((resolveAnswer, reject) => {
    const send = url.protocol === 'http:' ? httpRequest : httpsRequest
    const req = send(
      url,
      {
        method: 'GET',
        lookup: pin,
        headers: { accept: 'text/calendar, text/plain;q=0.5, */*;q=0.1', 'accept-encoding': 'identity', 'user-agent': 'SessionHire-Calendar/1.0 (reads busy times only)' },
        timeout: left,
      },
      (res: IncomingMessage) => {
        const status = res.statusCode ?? 0
        if ([301, 302, 303, 307, 308].includes(status)) {
          res.resume()
          const location = res.headers.location
          if (!location) return reject(new NotRead(READ_WORDS.other))
          let next: string
          try {
            next = new URL(location, url).href
          } catch {
            return reject(new NotRead(READ_WORDS.unreachable))
          }
          return resolveAnswer({ kind: 'redirect', location: next })
        }
        if (status !== 200) {
          res.resume()
          return reject(new NotRead(status === 401 || status === 403 ? READ_WORDS.denied : status === 404 || status === 410 ? READ_WORDS.gone : READ_WORDS.other))
        }
        const length = Number(res.headers['content-length'] ?? 0)
        if (length > maxBytes) {
          res.destroy()
          return reject(new NotRead(READ_WORDS.big))
        }
        const chunks: Buffer[] = []
        let size = 0
        res.on('data', (chunk: Buffer) => {
          size += chunk.length
          if (size > maxBytes) {
            res.destroy()
            reject(new NotRead(READ_WORDS.big))
            return
          }
          chunks.push(chunk)
        })
        res.on('end', () => resolveAnswer({ kind: 'body', text: Buffer.concat(chunks).toString('utf8') }))
        res.on('error', () => reject(new NotRead(READ_WORDS.other)))
      }
    )
    const timer = setTimeout(() => req.destroy(new Error('slow')), left)
    req.on('timeout', () => req.destroy(new Error('slow')))
    req.on('error', (err) => reject(err.message === 'slow' ? new NotRead(READ_WORDS.slow) : new NotRead(READ_WORDS.unreachable)))
    req.on('close', () => clearTimeout(timer))
    req.end()
  })
}

/** The address as one we'll fetch, or the reason not, in words. */
function checkedUrl(address: string, options: FetchOptions): URL {
  let url: URL
  try {
    url = new URL(address)
  } catch {
    throw new NotRead(READ_WORDS.unreachable)
  }
  if (isTestHost(url, options)) return url
  // Tidied as a pasted address is: https only, nothing hidden in it.
  const tidy = tidyCalendarAddress(url.href)
  if ('reason' in tidy) throw new NotRead(tidy.reason)
  const checked = new URL(tidy.address)
  if (checked.port && checked.port !== '443') throw new NotRead(READ_WORDS.private)
  return checked
}

/**
 * A pasted address tidied (tidyCalendarAddress), but a named stand-in
 * left as it is, plain http and all, for tests and the browser tests.
 */
export function tidyAddress(typed: string, options: FetchOptions = {}): { address: string } | { reason: string } {
  if (options.testHosts?.length) {
    try {
      const url = new URL(typed.trim())
      if (isTestHost(url, options)) return { address: url.href }
    } catch {
      // Not an address at all: said as any other is.
    }
  }
  return tidyCalendarAddress(typed)
}

function isTestHost(url: URL, options: FetchOptions): boolean {
  if (!options.testHosts?.length) return false
  const port = url.port || (url.protocol === 'https:' ? '443' : '80')
  return options.testHosts.includes(`${url.hostname}:${port}`)
}

async function resolve(host: string, options: FetchOptions): Promise<string[]> {
  try {
    if (options.resolve) return await options.resolve(host)
    return (await lookup(host, { all: true, verbatim: true })).map((a) => a.address)
  } catch {
    throw new NotRead(READ_WORDS.unreachable)
  }
}

/** IPv4 ranges that aren't the public internet: this network, private, shared (carrier NAT), loopback, link-local, protocol, documentation, benchmarking, multicast and reserved. */
const V4_NOT_PUBLIC: [string, number][] = [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.88.99.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
]

const v4Number = (a: string) => a.split('.').reduce((n, part) => n * 256 + Number(part), 0)

function v4Public(a: string): boolean {
  const n = v4Number(a)
  return !V4_NOT_PUBLIC.some(([base, bits]) => Math.floor(n / 2 ** (32 - bits)) === Math.floor(v4Number(base) / 2 ** (32 - bits)))
}

/** An IPv6 address as eight numbers, or undefined when it can't be read. */
function v6Groups(a: string): number[] | undefined {
  let s = a.toLowerCase().split('%')[0]!
  // An IPv4 address on the end (::ffff:10.0.0.1) as two groups.
  const tail = s.match(/(\d+\.\d+\.\d+\.\d+)$/)
  if (tail) {
    const n = v4Number(tail[1]!)
    s = `${s.slice(0, -tail[1]!.length)}${Math.floor(n / 65536).toString(16)}:${(n % 65536).toString(16)}`
  }
  const [head, rest] = s.split('::')
  const left = head ? head.split(':') : []
  const right = rest !== undefined && rest ? rest.split(':') : []
  const missing = 8 - left.length - right.length
  if (rest === undefined ? left.length !== 8 : missing < 0) return undefined
  const groups = [...left, ...Array(rest === undefined ? 0 : missing).fill('0'), ...right].map((g) => parseInt(g, 16))
  return groups.length === 8 && groups.every((g) => g >= 0 && g <= 0xffff) ? groups : undefined
}

function v6Public(a: string): boolean {
  const g = v6Groups(a)
  if (!g) return false
  const [g0, g1] = [g[0]!, g[1]!]
  // Unspecified and loopback.
  if (g.slice(0, 7).every((x) => x === 0) && g[7]! <= 1) return false
  // IPv4 written as IPv6 (::ffff:a.b.c.d, and the old ::a.b.c.d), and IPv4 translated (64:ff9b::/96): whatever IPv4 address is inside.
  const v4 = `${g[6]! >> 8}.${g[6]! & 255}.${g[7]! >> 8}.${g[7]! & 255}`
  if (g.slice(0, 5).every((x) => x === 0) && (g[5] === 0xffff || g[5] === 0)) return v4Public(v4)
  if (g0 === 0x64 && g1 === 0xff9b) return v4Public(v4)
  // Unique local (fc00::/7), link-local (fe80::/10), the old site-local (fec0::/10) and multicast (ff00::/8).
  if ((g0 & 0xfe00) === 0xfc00 || (g0 & 0xffc0) === 0xfe80 || (g0 & 0xffc0) === 0xfec0 || (g0 & 0xff00) === 0xff00) return false
  // Discard (100::/64), documentation (2001:db8::/32), Teredo (2001::/32) and 6to4 (2002::/16), which carry other addresses.
  if (g0 === 0x100 && g1 === 0 && g[2] === 0 && g[3] === 0) return false
  if (g0 === 0x2001 && (g1 === 0xdb8 || g1 === 0)) return false
  if (g0 === 0x2002) return false
  // Anything else outside the public range (2000::/3) isn't handed out.
  return (g0 & 0xe000) === 0x2000
}

/** Whether an address is on the public internet, and so safe for the server to fetch from. */
export function isPublic(address: string): boolean {
  const v = isIP(address)
  if (v === 4) return v4Public(address)
  if (v === 6) return v6Public(address)
  return false
}
