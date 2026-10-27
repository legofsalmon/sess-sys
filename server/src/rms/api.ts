/**
 * The Current RMS API (ADR 0078), for reading only. Its API keys allow
 * every change to the office's Current RMS, so this client can only ask:
 * it has no way to send anything but a GET, whatever it is asked to read.
 *
 * Current RMS allows 60 requests a minute. Requests here go one at a time,
 * a little over a second apart, and a "too many" answer is waited out for
 * as long as Current RMS says, so a long read never trips the limit for
 * the office using Current RMS meanwhile.
 */

export interface RmsConfig {
  /** The first part of the Current RMS address: "sessionhire" for sessionhire.current-rms.com. */
  subdomain: string
  apiKey: string
  /** Stands in for the network in tests. */
  fetch?: typeof fetch
  /** The least time between two requests; a little over a second. */
  gapMs?: number
  /** How long to wait at most when Current RMS says too many, before trying again; a minute. */
  maxWaitMs?: number
  /** The clock and the waiting, for tests. */
  sleep?: (ms: number) => Promise<void>
}

export const RMS_BASE = 'https://api.current-rms.com/api/v1'

/** Current RMS turned the request down, with a reason a person can read. */
export class RmsRefused extends Error {
  override name = 'RmsRefused'
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message)
  }
}

type Params = Record<string, string | number | readonly string[]>

const realSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

export class RmsApi {
  private last = 0
  private queue: Promise<unknown> = Promise.resolve()
  private readonly get: typeof fetch
  private readonly gapMs: number
  private readonly maxWaitMs: number
  private readonly sleep: (ms: number) => Promise<void>

  constructor(private readonly config: RmsConfig) {
    this.get = config.fetch ?? fetch
    this.gapMs = config.gapMs ?? 1_100
    this.maxWaitMs = config.maxWaitMs ?? 60_000
    this.sleep = config.sleep ?? realSleep
  }

  get subdomain() {
    return this.config.subdomain
  }

  /** Read one address, such as `/opportunities`, with its query. One at a time, in the order asked. */
  read<T>(path: string, params: Params = {}): Promise<T> {
    const answer = this.queue.then(() => this.ask<T>(path, params))
    this.queue = answer.catch(() => undefined)
    return answer
  }

  private async ask<T>(path: string, params: Params, tries = 0): Promise<T> {
    const wait = this.last + this.gapMs - Date.now()
    if (wait > 0) await this.sleep(wait)
    this.last = Date.now()
    const url = new URL(`${RMS_BASE}${path}`)
    for (const [k, v] of Object.entries(params)) {
      if (Array.isArray(v)) for (const one of v) url.searchParams.append(k, one)
      else url.searchParams.set(k, String(v))
    }
    let res: Response
    try {
      res = await this.get(url, {
        method: 'GET',
        headers: { 'X-SUBDOMAIN': this.config.subdomain, 'X-AUTH-TOKEN': this.config.apiKey, accept: 'application/json' },
        signal: AbortSignal.timeout(30_000),
      })
    } catch {
      throw new RmsRefused("Couldn't reach Current RMS. Try again in a few minutes.", 0)
    }
    if (res.status === 429 && tries < 5) {
      // X-RateLimit-Reset is when the limit lifts, in seconds since 1970 or as a date; a minute if it says neither.
      const reset = res.headers.get('x-ratelimit-reset')
      const at = reset ? (/^\d+$/.test(reset) ? Number(reset) * 1000 : Date.parse(reset)) : NaN
      const ms = Number.isFinite(at) ? at - Date.now() : this.maxWaitMs
      await this.sleep(Math.min(this.maxWaitMs, Math.max(1_000, ms)))
      return this.ask<T>(path, params, tries + 1)
    }
    if (res.status === 401) throw new RmsRefused('Current RMS turned the key down. Check the API key and the subdomain on the server.', 401)
    if (res.status === 404) throw new RmsRefused(`Current RMS has nothing at ${path}. Check the subdomain on the server.`, 404)
    if (!res.ok) throw new RmsRefused(`Current RMS answered ${res.status}.`, res.status)
    return (await res.json()) as T
  }
}
