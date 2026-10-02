import { useEffect, useRef, useState } from 'react'

/**
 * Scanning with the phone's camera in the app (ADR 0016). The camera stays
 * on until it's stopped, reading one label after another: each new code is
 * read once, and the same code isn't read again until it has been out of
 * sight for a moment, so a label held still isn't read twice. Only a code
 * wholly inside the frame on screen counts, whichever reader found it, so
 * a neighbouring label is never read early (audit finding 18). Pictures
 * never leave the phone and aren't kept: each frame is looked at and dropped.
 */

/** Reads a code off the camera's picture, if there's one inside the frame. */
type Decode = (video: HTMLVideoElement) => Promise<string | undefined>

/** Codes read by the phone's own barcode reader, where it has one; ours are QR codes, the rest are makers' barcodes on gear. */
const FORMATS = ['qr_code', 'code_128', 'code_39', 'data_matrix', 'ean_13']
/** How long a code must be out of sight before it's read again. */
const AGAIN_AFTER = 1200
/** How often the picture is looked at: often enough to feel instant, not so often it drains the battery. */
const EVERY = 120
/** How far in from each edge of the square picture the frame on screen sits (stock.css draws it the same). */
const FRAME_INSET = 0.14
const SOUND_KEY = 'sh.scan.sound'

interface Point {
  x: number
  y: number
}
interface Detector {
  detect(source: HTMLVideoElement): Promise<{ rawValue: string; cornerPoints?: Point[]; boundingBox?: DOMRectReadOnly }[]>
}
interface DetectorClass {
  new (options: { formats: string[] }): Detector
  getSupportedFormats(): Promise<string[]>
}
/** What a camera can do beyond filming, where the browser says. */
interface Capabilities {
  torch?: boolean
  zoom?: { min: number; max: number; step?: number }
}

/** The square in the middle of the picture that the screen shows, and the frame drawn inside it. */
function frameIn(width: number, height: number) {
  const side = Math.min(width, height)
  const x = (width - side) / 2
  const y = (height - side) / 2
  const inset = side * FRAME_INSET
  return { left: x + inset, top: y + inset, right: x + side - inset, bottom: y + side - inset }
}

/** Every corner of the code inside the frame: a label half in view, or beside the one meant, isn't read. */
function insideFrame(corners: Point[], frame: ReturnType<typeof frameIn>) {
  return corners.length > 0 && corners.every((p) => p.x >= frame.left && p.x <= frame.right && p.y >= frame.top && p.y <= frame.bottom)
}

/** Where the phone's reader says a code is: its corners, or else the box round it. A code it can't place is never inside. */
function cornersOf(c: { cornerPoints?: Point[]; boundingBox?: DOMRectReadOnly }): Point[] {
  if (c.cornerPoints?.length) return c.cornerPoints
  const b = c.boundingBox
  return b
    ? [
        { x: b.left, y: b.top },
        { x: b.right, y: b.top },
        { x: b.right, y: b.bottom },
        { x: b.left, y: b.bottom },
      ]
    : []
}

/**
 * The phone's own barcode reader (Android's Chrome has one), or else a
 * QR code reader in the app (iPhones, and laptops), loaded only when the
 * camera is first used and kept for use with no signal.
 */
async function decoder(): Promise<Decode> {
  const Native = (globalThis as unknown as { BarcodeDetector?: DetectorClass }).BarcodeDetector
  if (Native) {
    try {
      const formats = (await Native.getSupportedFormats()).filter((f) => FORMATS.includes(f))
      if (formats.includes('qr_code')) {
        const detector = new Native({ formats })
        return async (video) => {
          // The phone's reader looks at the whole picture; only a code inside the frame on screen counts.
          const frame = frameIn(video.videoWidth, video.videoHeight)
          return (await detector.detect(video)).find((c) => insideFrame(cornersOf(c), frame))?.rawValue
        }
      }
    } catch {
      // Falls back to the reader in the app.
    }
  }
  const { default: jsQR } = await import('jsqr')
  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!
  return async (video) => {
    // The middle of the picture, where the frame on screen is, at a size that reads quickly.
    const side = Math.min(video.videoWidth, video.videoHeight)
    if (!side) return undefined
    const size = Math.min(side, 640)
    canvas.width = canvas.height = size
    ctx.drawImage(video, (video.videoWidth - side) / 2, (video.videoHeight - side) / 2, side, side, 0, 0, size, size)
    const { data } = ctx.getImageData(0, 0, size, size)
    const found = jsQR(data, size, size, { inversionAttempts: 'dontInvert' })
    if (!found?.data) return undefined
    const { topLeftCorner, topRightCorner, bottomLeftCorner, bottomRightCorner } = found.location
    return insideFrame([topLeftCorner, topRightCorner, bottomLeftCorner, bottomRightCorner], frameIn(size, size)) ? found.data : undefined
  }
}

let audio: AudioContext | undefined
/** Called from the tap that turns the camera on, since phones only let sound start from a tap. */
export function primeSound() {
  try {
    audio ??= new AudioContext()
    void audio.resume()
  } catch {
    // No sound on this device; the flash and the buzz still say it was read.
  }
}
function beep() {
  if (!audio || audio.state !== 'running') return
  const tone = audio.createOscillator()
  const volume = audio.createGain()
  tone.frequency.value = 1760
  volume.gain.setValueAtTime(0.15, audio.currentTime)
  volume.gain.exponentialRampToValueAtTime(0.001, audio.currentTime + 0.09)
  tone.connect(volume).connect(audio.destination)
  tone.start()
  tone.stop(audio.currentTime + 0.1)
}

const soundOn = () => {
  try {
    return localStorage.getItem(SOUND_KEY) !== 'off'
  } catch {
    return true
  }
}

/**
 * A page the browser gives no camera to: opened inside another app
 * (WhatsApp's or Gmail's own browser), or over plain http. Only a real
 * browser on a secure address can ask for the camera, so say so rather
 * than "no camera on this device".
 */
const noCameraHere = () => !window.isSecureContext || !navigator.mediaDevices?.getUserMedia
const ELSEWHERE = 'Open this page in Safari or Chrome to use the camera.'

/** What went wrong turning the camera on, in words that say what to do. */
function cameraProblem(err: unknown): string {
  const name = err instanceof DOMException || err instanceof Error ? err.name : ''
  if (name === 'NotAllowedError' || name === 'SecurityError')
    return "The camera is blocked for this app. Allow the camera for this site in the browser's settings, then turn it on again."
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'There is no camera on this device. A scanner that types the number works in the search instead.'
  if (name === 'NotReadableError' || name === 'AbortError') return 'Another app is using the camera. Close it, then turn the camera on again.'
  return "The camera didn't start. Turn it on again, or type the number in the search."
}

/**
 * The camera's picture with a frame to put the label in. `onRead` gets each
 * new code as it's read. Small, when there's a form under it to fill in.
 * It turns itself off while the app is out of sight, and back on when it's back.
 */
export function CameraScanner({ onRead, onStop, small = false }: { onRead: (code: string) => void; onStop: () => void; small?: boolean }) {
  const video = useRef<HTMLVideoElement>(null)
  const latest = useRef(onRead)
  latest.current = onRead
  const [problem, setProblem] = useState('')
  const [starting, setStarting] = useState(true)
  const [read, setRead] = useState<{ code: string; at: number }>()
  const [torch, setTorch] = useState<{ track: MediaStreamTrack; on: boolean }>()
  const [zoom, setZoom] = useState<{ track: MediaStreamTrack; min: number; max: number; step: number; at: number }>()
  const [sound, setSound] = useState(soundOn)
  const [visible, setVisible] = useState(() => document.visibilityState === 'visible')
  const [attempt, setAttempt] = useState(0)
  const soundRef = useRef(sound)
  soundRef.current = sound

  useEffect(() => {
    const seen = () => setVisible(document.visibilityState === 'visible')
    document.addEventListener('visibilitychange', seen)
    return () => document.removeEventListener('visibilitychange', seen)
  }, [])

  useEffect(() => {
    if (!visible) return
    let alive = true
    let stream: MediaStream | undefined
    let timer: ReturnType<typeof setTimeout> | undefined
    let last = { code: '', seen: 0 }
    setProblem('')
    setStarting(true)
    void (async () => {
      try {
        if (noCameraHere()) throw new DOMException(ELSEWHERE, 'NotSupportedError')
        const [decode, s] = await Promise.all([
          decoder(),
          navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } } }),
        ])
        stream = s
        if (!alive) return s.getTracks().forEach((t) => t.stop())
        const v = video.current!
        v.srcObject = s
        await v.play().catch(() => undefined)
        setStarting(false)
        const track = s.getVideoTracks()[0]
        const caps = (track?.getCapabilities?.() ?? {}) as Capabilities
        if (track && caps.torch) setTorch({ track, on: false })
        // Zoom, for small codes, where the camera can: the slider starts where the camera is.
        if (track && caps.zoom && caps.zoom.max > caps.zoom.min) {
          const now = (track.getSettings?.() as { zoom?: number }).zoom
          setZoom({ track, min: caps.zoom.min, max: caps.zoom.max, step: caps.zoom.step || 0.1, at: now ?? caps.zoom.min })
        }
        const tick = async () => {
          if (!alive) return
          if (v.readyState >= 2) {
            const code = (await decode(v).catch(() => undefined))?.trim()
            const now = performance.now()
            if (code && alive) {
              if (code !== last.code || now - last.seen > AGAIN_AFTER) {
                setRead({ code, at: now })
                navigator.vibrate?.(60)
                if (soundRef.current) beep()
                latest.current(code)
              }
              last = { code, seen: now }
            }
          }
          timer = setTimeout(tick, EVERY)
        }
        void tick()
      } catch (err) {
        if (alive) {
          setStarting(false)
          setProblem(err instanceof DOMException && err.name === 'NotSupportedError' ? ELSEWHERE : cameraProblem(err))
        }
      }
    })()
    return () => {
      alive = false
      clearTimeout(timer)
      stream?.getTracks().forEach((t) => t.stop())
      if (video.current) video.current.srcObject = null
      setTorch(undefined)
      setZoom(undefined)
    }
  }, [visible, attempt])

  const switchTorch = () => {
    if (!torch) return
    const on = !torch.on
    void torch.track.applyConstraints({ advanced: [{ torch: on } as MediaTrackConstraintSet] }).then(
      () => setTorch({ ...torch, on }),
      () => setTorch(undefined)
    )
  }
  const setZoomTo = (at: number) => {
    if (!zoom) return
    setZoom({ ...zoom, at })
    void zoom.track.applyConstraints({ advanced: [{ zoom: at } as MediaTrackConstraintSet] }).catch(() => setZoom(undefined))
  }
  const switchSound = () => {
    const on = !sound
    if (on) primeSound()
    setSound(on)
    try {
      localStorage.setItem(SOUND_KEY, on ? 'on' : 'off')
    } catch {
      // Only for this visit, then.
    }
  }

  return (
    <div className={`scanner${small ? ' small' : ''}`} aria-label="Camera">
      {problem === ELSEWHERE ? (
        <Elsewhere />
      ) : problem ? (
        <div className="alert" role="alert">
          <p>{problem}</p>
          <button type="button" onClick={() => setAttempt((n) => n + 1)}>
            Try again
          </button>
        </div>
      ) : (
        <div className="viewfinder">
          <video ref={video} muted playsInline autoPlay aria-hidden="true" />
          {/* Flashes on each read. */}
          <div className="frame" key={read?.at} data-read={read ? '' : undefined} />
          {starting && <p className="starting">Turning the camera on…</p>}
        </div>
      )}
      <p className="scan-status" role="status">
        {problem ? '' : read ? `Read ${read.code}` : 'Point the camera at a label.'}
      </p>
      {zoom && (
        <label className="zoom">
          Zoom
          <input type="range" min={zoom.min} max={zoom.max} step={zoom.step} value={zoom.at} onChange={(e) => setZoomTo(Number(e.target.value))} />
        </label>
      )}
      <div className="scan-controls">
        {torch && (
          <button type="button" aria-pressed={torch.on} onClick={switchTorch}>
            Light
          </button>
        )}
        <button type="button" aria-pressed={sound} onClick={switchSound}>
          Sound
        </button>
        <button type="button" onClick={onStop}>
          Stop camera
        </button>
      </div>
    </div>
  )
}

/** The page's address, to copy into a real browser, as the calendar feed's address is shown. */
function Elsewhere() {
  const address = location.href
  const field = useRef<HTMLInputElement>(null)
  const [copied, setCopied] = useState(false)
  const copy = () => {
    // A page on plain http has no clipboard API, and some in-app browsers refuse it; copying what's selected still works there.
    const selected = () => {
      field.current?.select()
      if (document.execCommand('copy')) setCopied(true)
    }
    if (navigator.clipboard) void navigator.clipboard.writeText(address).then(() => setCopied(true), selected)
    else selected()
  }
  return (
    <div className="alert elsewhere" role="alert">
      <p>{ELSEWHERE} Copy the address, or open it from the menu.</p>
      <input ref={field} readOnly value={address} aria-label="This page's address" onFocus={(e) => e.target.select()} />
      <button type="button" onClick={copy}>
        {copied ? 'Copied' : 'Copy address'}
      </button>
    </div>
  )
}
