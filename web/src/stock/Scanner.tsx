import { useEffect, useRef, useState } from 'react'

/**
 * Scanning with the phone's camera in the app (ADR 0016). The camera stays
 * on until it's stopped, reading one label after another: each new code is
 * read once, and the same code isn't read again until it has been out of
 * sight for a moment, so a label held still isn't read twice. Pictures never
 * leave the phone and aren't kept: each frame is looked at and dropped.
 */

/** Reads a code off the camera's picture, if there's one in it. */
type Decode = (video: HTMLVideoElement) => Promise<string | undefined>

/** Codes read by the phone's own barcode reader, where it has one; ours are QR codes, the rest are makers' barcodes on gear. */
const FORMATS = ['qr_code', 'code_128', 'code_39', 'data_matrix', 'ean_13']
/** How long a code must be out of sight before it's read again. */
const AGAIN_AFTER = 1200
/** How often the picture is looked at: often enough to feel instant, not so often it drains the battery. */
const EVERY = 120
const SOUND_KEY = 'sh.scan.sound'

interface Detector {
  detect(source: HTMLVideoElement): Promise<{ rawValue: string }[]>
}
interface DetectorClass {
  new (options: { formats: string[] }): Detector
  getSupportedFormats(): Promise<string[]>
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
        return async (video) => (await detector.detect(video))[0]?.rawValue
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
    return jsQR(data, size, size, { inversionAttempts: 'dontInvert' })?.data || undefined
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
        if (!navigator.mediaDevices?.getUserMedia) throw new DOMException('No camera access here.', 'NotFoundError')
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
        const caps = (track?.getCapabilities?.() ?? {}) as { torch?: boolean }
        if (track && caps.torch) setTorch({ track, on: false })
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
          setProblem(cameraProblem(err))
        }
      }
    })()
    return () => {
      alive = false
      clearTimeout(timer)
      stream?.getTracks().forEach((t) => t.stop())
      if (video.current) video.current.srcObject = null
      setTorch(undefined)
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
      {problem ? (
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
