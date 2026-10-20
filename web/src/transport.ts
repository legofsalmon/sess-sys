import type { Beat, LatestOnly, Poke, PullResponse, PushRequest, PushResponse, Transport } from '@sh/shared'

/** The server wants a signed-in person, and this device isn't one (any more). */
export class SignedOutError extends Error {}

/**
 * Longer than two of the server's beats (LIVE_BEAT_MS): heard from in none of it, the live connection is taken as gone,
 * however open it looks.
 */
const LIVE_SILENCE_MS = 60_000

/** HTTP for push and pull, plus a WebSocket that only says "something new". */
export class HttpTransport implements Transport {
  private ws: WebSocket | undefined
  private retry = 0
  private silence: ReturnType<typeof setTimeout> | undefined
  /** The live connection is up and the server was heard from lately, so a change anywhere reaches this device as a poke. */
  live = false

  constructor(private readonly base = '') {}

  async push(req: PushRequest): Promise<PushResponse> {
    // A push carries up to fifty changes, each a dozen trips from the server to its database, so it gets longer than a pull;
    // the server answers what it got done inside 20 seconds (PUSH_BUDGET_MS), well before this runs out.
    return this.call('/api/sync/push', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(req) }, 30_000)
  }

  async pull(after: number, latest?: LatestOnly): Promise<PullResponse> {
    return this.call(`/api/sync/pull?after=${after}${latest !== undefined ? `&latest=${latest}` : ''}`)
  }

  private async call<T>(path: string, init?: RequestInit, timeoutMs = 10_000): Promise<T> {
    const res = await fetch(this.base + path, { ...init, signal: AbortSignal.timeout(timeoutMs) })
    if (res.status === 401) throw new SignedOutError('Not signed in')
    if (!res.ok) throw new Error(`Server answered ${res.status}`)
    return res.json() as Promise<T>
  }

  /**
   * Call `onPoke` whenever the server has something newer than we do, and `onLive` as the connection comes and goes: up
   * once the server is heard on it; gone when it closes, or falls silent past two of the server's beats, when it's
   * closed here and opened again.
   */
  listen(onPoke: (cursor: number) => void, onLive?: (live: boolean) => void) {
    const setLive = (live: boolean) => {
      if (live === this.live) return
      this.live = live
      onLive?.(live)
    }
    const connect = () => {
      const url = new URL('/api/sync/live', this.base || location.href)
      url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
      const ws = new WebSocket(url)
      this.ws = ws
      /** Closed, or silent too long: polling takes over until a new connection is heard from. Once per connection. */
      const gone = () => {
        if (this.ws !== ws) return
        this.ws = undefined
        clearTimeout(this.silence)
        setLive(false)
        setTimeout(connect, Math.min(30_000, 1000 * 2 ** this.retry++))
      }
      const heard = () => {
        clearTimeout(this.silence)
        this.silence = setTimeout(() => {
          // A connection dropped along the way may take minutes to say it's closed, so a new one is opened now.
          gone()
          ws.close()
        }, LIVE_SILENCE_MS)
      }
      ws.onopen = () => {
        this.retry = 0
        heard()
      }
      ws.onmessage = (e) => {
        if (this.ws !== ws) return
        heard()
        setLive(true)
        const msg = JSON.parse(String(e.data)) as Poke | Beat
        if (msg.type === 'poke') onPoke(msg.cursor)
      }
      ws.onclose = gone
    }
    connect()
  }
}
