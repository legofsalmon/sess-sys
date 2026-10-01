import type { Poke, PullResponse, PushRequest, PushResponse, Transport } from '@sh/shared'

/** The server wants a signed-in person, and this device isn't one (any more). */
export class SignedOutError extends Error {}

/**
 * HTTP for push and pull, plus a WebSocket that only says "something new".
 * `forcedOffline` is the demo's "no signal" switch: it makes every request
 * fail the way a dead spot does, without touching the browser's network.
 */
export class HttpTransport implements Transport {
  forcedOffline = false
  private ws: WebSocket | undefined
  private retry = 0

  constructor(private readonly base = '') {}

  async push(req: PushRequest): Promise<PushResponse> {
    // A push after a day with no signal carries hundreds of changes, so it gets longer than a pull.
    return this.call('/api/sync/push', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(req) }, 30_000)
  }

  async pull(after: number): Promise<PullResponse> {
    return this.call(`/api/sync/pull?after=${after}`)
  }

  private async call<T>(path: string, init?: RequestInit, timeoutMs = 10_000): Promise<T> {
    if (this.forcedOffline) throw new Error('No signal (simulated)')
    const res = await fetch(this.base + path, { ...init, signal: AbortSignal.timeout(timeoutMs) })
    if (res.status === 401) throw new SignedOutError('Not signed in')
    if (!res.ok) throw new Error(`Server answered ${res.status}`)
    return res.json() as Promise<T>
  }

  /** Call `onPoke` whenever the server has something newer than we do. */
  listen(onPoke: (cursor: number) => void) {
    const connect = () => {
      if (this.forcedOffline) return setTimeout(connect, 2000)
      const url = new URL('/api/sync/live', this.base || location.href)
      url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
      const ws = new WebSocket(url)
      this.ws = ws
      ws.onopen = () => (this.retry = 0)
      ws.onmessage = (e) => {
        const msg = JSON.parse(String(e.data)) as Poke
        if (msg.type === 'poke' && !this.forcedOffline) onPoke(msg.cursor)
      }
      ws.onclose = () => setTimeout(connect, Math.min(30_000, 1000 * 2 ** this.retry++))
    }
    connect()
  }
}
