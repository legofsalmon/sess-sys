import { deviceItemLog, itemLogWords, joinItemLog, type AssetView, type ItemLogEntry, type ItemLogPage, type View } from '@sh/shared'
import { useEffect, useMemo, useState } from 'react'
import { Empty } from '../Empty.tsx'
import { ShowAll } from '../Fold.tsx'
import { ask } from '../server.ts'
import { Pending } from '../StatusPill.tsx'
import { client } from '../sync.ts'

/**
 * An item's log (ADR 0026): everything that happened to it, newest first.
 * The phone's part comes from what it holds, so it's there with no signal;
 * with signal, the server's part fills in who did each and what only the
 * history knows, joined by what each entry is about so nothing shows twice.
 */

/** "2 Oct 2026, 14:05", in Irish time. */
const logWhen = (iso: string) =>
  new Date(iso).toLocaleString('en-IE', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Dublin' })

const NO_SIGNAL = 'With no signal, this shows the scans, faults and tests on this phone. Who did each, and when it was added, moved or relabelled, come with signal.'

type Server = { state: 'asking' } | { state: 'failed' } | { state: 'got'; entries: ItemLogEntry[]; next?: string }

export function ItemLog({ view, a }: { view: View; a: AssetView }) {
  // The browser knows it has no network before a sync has failed to say so.
  const offline = view.connection === 'offline' || navigator.onLine === false
  const [server, setServer] = useState<Server>({ state: 'asking' })
  const [older, setOlder] = useState<{ entries: ItemLogEntry[]; next?: string }>()
  // Asked for again as changes arrive, a moment after the last, so a sync of many changes asks once.
  useEffect(() => {
    if (offline) return
    let gone = false
    const timer = setTimeout(() => {
      ask<ItemLogPage>(`/api/stock/items/${encodeURIComponent(a.id)}/log`).then(
        (page) => {
          if (gone) return
          setServer({ state: 'got', entries: page.entries, next: page.next })
          // Older pages were read after the last first page: what's new pushed some of that page past them, so they go, and "Show older" reads on from this one.
          setOlder(undefined)
        },
        // What came before stands: the log isn't emptied because one asking failed.
        () => !gone && setServer((was) => (was.state === 'got' ? was : { state: 'failed' }))
      )
    }, 300)
    return () => {
      gone = true
      clearTimeout(timer)
    }
  }, [a.id, offline, view.cursor])

  const device = useMemo(() => deviceItemLog(view, a.id, client.waiting), [view, a.id])
  const entries = joinItemLog(device, server.state === 'got' ? [...server.entries, ...(older?.entries ?? [])] : undefined)
  const next = server.state === 'got' ? (older ? older.next : server.next) : undefined
  const showOlder = () =>
    void ask<ItemLogPage>(`/api/stock/items/${encodeURIComponent(a.id)}/log?before=${encodeURIComponent(next!)}`).then(
      (page) => setOlder({ entries: [...(older?.entries ?? []), ...page.entries], next: page.next }),
      () => setServer({ state: 'failed' })
    )

  return (
    <section className="card item-log" aria-label="Log">
      <h2>Log</h2>
      {offline && server.state !== 'got' ? (
        <p className="hint">{NO_SIGNAL}</p>
      ) : server.state === 'asking' ? (
        <p className="hint">Asking the server for the rest: who did each, and when it was added, moved or relabelled.</p>
      ) : server.state === 'failed' ? (
        <p className="hint">Couldn't reach the server for the rest of the log. {NO_SIGNAL}</p>
      ) : null}
      {entries.length === 0 ? (
        <Empty>Scans out and back, faults and tests show here as they happen.</Empty>
      ) : (
        <ShowAll items={entries} limit={8} what="entries">
          {(shown) => (
            <ol className="log">
              {shown.map((e) => (
                <li key={e.key}>
                  <div>
                    <span className="what">{itemLogWords(e.event)}</span>
                    <small>
                      <time dateTime={e.at}>{logWhen(e.at)}</time>
                      {(e.who || e.device) && ` · ${[e.who, e.device].filter(Boolean).join(', ')}`}
                    </small>
                  </div>
                  <Pending pending={!!e.pending} />
                </li>
              ))}
            </ol>
          )}
        </ShowAll>
      )}
      {next && !offline && (
        <button type="button" className="link" onClick={showOlder}>
          Show older
        </button>
      )}
    </section>
  )
}
