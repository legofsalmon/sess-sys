import { useCallback, useEffect, useRef, useState } from 'react'
import { syncSoon } from './sync.ts'

/**
 * Every change made in the app goes through act() (audit finding 11): it
 * runs the change and, once the device has kept it, asks for a sync. A
 * change the device turns down before keeping it (the shared schema
 * refusing a field, a change the view can't show, a phone out of storage,
 * or another tab holding the data) is thrown with its reason in plain
 * words, for the form or button that asked to show beside itself. Nothing
 * in the app uses the browser's own dialogs, unstyled and blocking on a
 * phone: a refusal is a <Refusal> line where the action was, and a
 * question before something that can't be undone is a <Confirm>, with
 * what will happen in words.
 */

/**
 * Zod's own wording, which never reaches the screen. The shared schemas
 * say most things plainly; anything left (a field nobody types, reached
 * by a bug) is said in general words instead.
 */
const ZOD_WORDING = /^(String|Number|Array|Date) must |^Expected .*, received |^Invalid |^Required$|^Unrecognized key|^Too (big|small)/
export const NOT_SAVED = "Something typed in can't be saved as it is. Check the fields and try again."

/** Why a change couldn't be made, in plain words. */
export function reasonOf(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err)
  return !message || ZOD_WORDING.test(message) ? NOT_SAVED : message
}

export async function act<T>(fn: () => Promise<T>): Promise<T> {
  let out: T
  try {
    out = await fn()
  } catch (err) {
    throw new Error(reasonOf(err), { cause: err })
  }
  syncSoon()
  return out
}

/**
 * A form's or a button's one way to make a change and say why it wasn't
 * made: `run` tries it and answers whether it was taken; `error` holds the
 * reason until the next try; `refuse` shows a reason of the form's own,
 * from a check before anything is sent. <Refusal error={error} /> puts it
 * on screen, where the action was.
 */
export function useAct() {
  const [error, setError] = useState('')
  const run = useCallback(async (fn: () => Promise<unknown>): Promise<boolean> => {
    setError('')
    try {
      await act(fn)
      return true
    } catch (err) {
      setError(reasonOf(err))
      return false
    }
  }, [])
  const refuse = useCallback((reason: string) => setError(reason), [])
  return { run, error, refuse }
}

/** The reason a change wasn't made, where it was asked for. Nothing while there's none. */
export function Refusal({ error, className }: { error: string; className?: string }) {
  if (!error) return null
  return (
    <p className={['alert', className].filter(Boolean).join(' ')} role="alert">
      {error}
    </p>
  )
}

/**
 * A question before something that can't be undone, in place of the
 * browser's own dialog: what will happen, in words, and the two ways on
 * ("Cancel the call for 2 × Audio tech on Electric Picnic? Everyone offered
 * is told it's withdrawn." → Cancel it, Keep it). It opens where the action
 * was, so the fields round it hold still. On a keyboard the safe way out has
 * the focus as it opens, and the focus goes back to the buttons that take
 * the question's place when it closes, rather than being lost.
 */
export function Confirm({
  question,
  yes,
  no = 'Keep it',
  onYes,
  onNo,
  className,
}: {
  question: string
  yes: string
  no?: string
  onYes: () => void
  onNo: () => void
  className?: string
}) {
  const safe = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    const button = safe.current
    const home = button?.closest('.confirm')?.parentElement
    button?.focus()
    return () => {
      // The question's buttons are gone by now, and with them the focus; the first button where they were takes it.
      if (home?.isConnected && (!document.activeElement || document.activeElement === document.body)) home.querySelector<HTMLElement>('button, a[href]')?.focus()
    }
  }, [])
  return (
    <div className={['confirm', className].filter(Boolean).join(' ')} role="group" aria-label={question}>
      <p className="warn-line">{question}</p>
      <div className="actions">
        <button type="button" className="primary" onClick={onYes}>
          {yes}
        </button>
        <button type="button" onClick={onNo} ref={safe}>
          {no}
        </button>
      </div>
    </div>
  )
}
