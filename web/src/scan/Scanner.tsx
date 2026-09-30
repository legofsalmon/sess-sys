import { useEffect, useRef, useState } from 'react'
import { reader, type Read, type Reader } from './reader.ts'
import './scan.css'

/** Whether this browser can use the camera at all: only on a secure page (https, or localhost while building). */
export const canScan = () => !!navigator.mediaDevices?.getUserMedia

type State = { kind: 'starting' } | { kind: 'looking' } | { kind: 'failed'; message: string }

/** A camera's light, where the phone lets a web app switch it on. */
interface Light {
  track: MediaStreamTrack
  on: boolean
}

/** How long between looks at the camera, in milliseconds: quick enough to feel instant, easy on the battery. */
const EVERY = 120

/**
 * The phone's camera, reading labels and makers' barcodes (ADR 0016). Each
 * code is handed over once, the way a scanner types it: the same code again
 * is ignored until another has been read, so a label still in view once it's
 * been dealt with isn't read twice. Paused, it stops reading but keeps the
 * camera on, to carry on at once. The camera stops when the scanner closes
 * or the app goes into the background.
 */
export function Scanner({
  onRead,
  onClose,
  paused = false,
  onSkip,
}: {
  onRead: (read: Read) => void
  onClose: () => void
  /** Stop reading for now, such as while saying what a new label is on. */
  paused?: boolean
  /** While paused: put the last one aside and read the next. */
  onSkip?: () => void
}) {
  const video = useRef<HTMLVideoElement>(null)
  const [state, setState] = useState<State>({ kind: 'starting' })
  const [last, setLast] = useState('')
  const [light, setLight] = useState<Light | null>(null)
  const lastRead = useRef('')
  // The loop reads these as they are now, not as they were when it started.
  const now = useRef({ onRead, onClose, paused })
  now.current = { onRead, onClose, paused }

  useEffect(() => {
    let stopped = false
    let running = false
    let stream: MediaStream | undefined
    let timer = 0
    const look = async (r: Reader) => {
      const v = video.current
      if (!now.current.paused && v && v.readyState >= v.HAVE_CURRENT_DATA && v.videoWidth > 0) {
        try {
          const found = (await r.detect(v)).find((c) => c.rawValue.trim())
          if (found && !stopped && !now.current.paused && found.rawValue !== lastRead.current) {
            lastRead.current = found.rawValue
            setLast(found.rawValue)
            navigator.vibrate?.(60)
            now.current.onRead(found)
          }
        } catch {
          // A frame that can't be read, such as while the camera settles: the next one will do.
        }
      }
      if (!stopped) timer = window.setTimeout(() => void look(r), EVERY)
    }
    void (async () => {
      // The reader loads while the camera starts.
      const loading = reader()
      loading.catch(() => {})
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
        })
        if (stopped) return stop(stream)
        running = true
        const v = video.current!
        v.srcObject = stream
        await v.play().catch(() => {})
        const track = stream.getVideoTracks()[0]
        const can = track?.getCapabilities?.() as (MediaTrackCapabilities & { torch?: boolean }) | undefined
        if (track && can?.torch) setLight({ track, on: false })
      } catch (err) {
        if (!stopped) setState({ kind: 'failed', message: cameraProblem(err) })
        return
      }
      try {
        const r = await loading
        if (stopped) return
        setState({ kind: 'looking' })
        void look(r)
      } catch (err) {
        if (!stopped) setState({ kind: 'failed', message: `The label reader didn't start: ${err instanceof Error ? err.message : String(err)}` })
      }
    })()
    // Nobody is looking at the app: let the camera go. Not while it's starting, when a phone may cover the page to ask.
    const hidden = () => document.hidden && running && now.current.onClose()
    document.addEventListener('visibilitychange', hidden)
    return () => {
      stopped = true
      window.clearTimeout(timer)
      document.removeEventListener('visibilitychange', hidden)
      if (stream) stop(stream)
    }
  }, [])

  const switchLight = () => {
    if (!light) return
    const on = !light.on
    light.track
      .applyConstraints({ advanced: [{ torch: on } as MediaTrackConstraintSet] })
      .then(() => setLight({ ...light, on }))
      .catch(() => setLight(null))
  }

  const status =
    state.kind === 'starting'
      ? 'Starting the camera…'
      : paused && last
        ? `Read ${last}.`
        : last
          ? `Read ${last}. Point it at the next one.`
          : "Point the camera at a label, or a maker's barcode with the serial number."

  return (
    <div className={`scanner${paused ? ' paused' : ''}`} role="group" aria-label="Camera">
      {state.kind !== 'failed' && (
        <div className="view">
          <video ref={video} muted playsInline autoPlay aria-hidden="true" />
          <div className="aim" aria-hidden="true" />
        </div>
      )}
      {state.kind === 'failed' ? (
        <p className="alert" role="alert">
          {state.message}
        </p>
      ) : (
        <p className="scan-status" role="status">
          {status}
        </p>
      )}
      <div className="scan-actions">
        {paused && onSkip && state.kind === 'looking' && (
          <button type="button" onClick={onSkip}>
            Scan another
          </button>
        )}
        {light && (
          <button type="button" aria-pressed={light.on} onClick={switchLight}>
            Light
          </button>
        )}
        <button type="button" onClick={onClose}>
          Close camera
        </button>
      </div>
    </div>
  )
}

const stop = (stream: MediaStream) => stream.getTracks().forEach((t) => t.stop())

/** What went wrong starting the camera, and what to do about it. */
function cameraProblem(err: unknown): string {
  const name = err instanceof DOMException ? err.name : ''
  if (name === 'NotAllowedError' || name === 'SecurityError')
    return "The camera is blocked for this app. Allow it in the browser's settings for this site, then try again."
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return "There's no camera on this device to scan with."
  if (name === 'NotReadableError' || name === 'AbortError') return 'Another app is using the camera. Close it, then try again.'
  return `The camera didn't start: ${err instanceof Error ? err.message : String(err)}`
}
