import { plural, todoHref, type TodoList, type View } from '@sh/shared'
import { useEffect, useState } from 'react'
import { when } from './format.ts'
import { Heading } from './Icon.tsx'
import { useClaude } from './jobs/Claude.tsx'
import { getJson, postJson, useAsked } from './jobs/rms.ts'
import { useLate } from './useLate.ts'

/**
 * Claude's to-do list for the office and directors (ADR 0097), on Home and
 * at the top of Notifications: written each weekday from 7am and whenever
 * someone asks, each thing a link to its job and a tick to say it's done.
 * Labelled as Claude's, and it contacts nobody.
 */

/** Writing a list reads the whole season, so it waits as long as an enquiry does. */
const WRITING_MS = 100_000

export function TodoCard({ view }: { view: View }) {
  const { offered } = useClaude(view)
  const loaded = useAsked(offered, 'todo', () => getJson<{ list: TodoList | null }>('/api/assistant/todo'))
  const [list, setList] = useState<TodoList | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const late = useLate(busy)
  useEffect(() => {
    if (loaded.state === 'ready') setList(loaded.data.list)
  }, [loaded])
  if (!offered) return null

  const write = async () => {
    setBusy(true)
    setError('')
    const l = await postJson<{ list: TodoList }>('/api/assistant/todo', {}, WRITING_MS)
    setBusy(false)
    if (l.state === 'ready') setList(l.data.list)
    else setError(l.state === 'gone' ? l.error : 'Claude didn’t answer in time, or there’s no signal. Try again.')
  }
  const tick = async (key: string, done: boolean) => {
    if (!list) return
    // Shown ticked straight away; put back if the server says no.
    const before = list
    setList({ ...list, items: list.items.map((i) => (i.key === key ? { ...i, doneAt: done ? new Date().toISOString() : null } : i)) })
    const l = await postJson<{ list: TodoList }>('/api/assistant/todo/done', { listId: list.id, key, done })
    if (l.state === 'ready') setList(l.data.list)
    else {
      setList(before)
      setError(l.state === 'gone' ? l.error : 'That didn’t save: there’s no signal. Try again.')
    }
  }

  const left = list ? list.items.filter((i) => !i.doneAt).length : 0
  return (
    <section className="card todo" aria-label="To do, from Claude">
      <Heading icon="done">To do</Heading>
      {loaded.state === 'loading' && !list ? (
        <p className="hint">Looking for this morning’s list…</p>
      ) : list ? (
        <>
          <p>{list.summary || (list.items.length ? plural(list.items.length, 'thing') + ' to do.' : 'Nothing pressing today.')}</p>
          {list.items.length > 0 && (
            <ul className="plain todo-list">
              {list.items.map((i) => (
                <li key={i.key} className={i.doneAt ? 'todo-item done' : 'todo-item'}>
                  <input type="checkbox" checked={!!i.doneAt} onChange={(e) => void tick(i.key, e.target.checked)} aria-label={`Done: ${i.title}`} />
                  <span>
                    <a href={todoHref(i)}>{i.title}</a>
                    {i.why && <small>{i.why}</small>}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <p className="by-claude">
            Written by Claude {when(list.madeAt)}
            {list.how === 'asked' ? ', when asked' : ''}, from what the app knows. {list.items.length > 0 && `${plural(left, 'thing')} left. `}It contacts nobody.
          </p>
        </>
      ) : (
        <p className="hint">Claude writes a list here each weekday from 7am: quotes to chase, crew to book, and dates in jobs’ notes.</p>
      )}
      <div className="actions">
        <button type="button" className="secondary" onClick={() => void write()} disabled={busy}>
          {late ? 'Writing…' : list ? 'Write it again now' : 'Write it now'}
        </button>
        <span className="hint" aria-live="polite">
          {busy && late ? 'Claude is reading the season. This can take up to a minute.' : ''}
        </span>
      </div>
      {error && (
        <p className="alert" role="alert">
          {error}
        </p>
      )}
    </section>
  )
}
