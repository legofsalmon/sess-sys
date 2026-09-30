// The label reader's WebAssembly, from the copy of zxing-wasm that barcode-detector uses (see vite.config.ts).
import readerWasm from 'zxing-reader.wasm?url'

/**
 * Reading codes from the camera (ADR 0016): Session Hire's labels, whose QR
 * code holds just the number (ADR 0015), and the barcodes makers print
 * serial numbers in, which are nearly always Code 128. The phone's own
 * reader where it has one (Chrome on Android); otherwise zxing, built into
 * the app and kept on the device with it, so scanning works with no signal
 * and nothing is fetched from anywhere else. Frames are read on the phone
 * and never leave it.
 */

export const FORMATS = ['qr_code', 'code_128'] as const

export interface Read {
  rawValue: string
  format: string
}

export interface Reader {
  detect(source: HTMLVideoElement): Promise<Read[]>
}

/** The browser's own reader, where there is one; not in TypeScript's DOM types yet. */
interface NativeDetector {
  new (options: { formats: string[] }): Reader
  getSupportedFormats(): Promise<string[]>
}

let loading: Promise<Reader> | undefined

/** The reader, made once and kept; tried again after a failure. */
export function reader(): Promise<Reader> {
  loading ??= make().catch((err: unknown) => {
    loading = undefined
    throw err
  })
  return loading
}

async function make(): Promise<Reader> {
  const Native = (globalThis as { BarcodeDetector?: NativeDetector }).BarcodeDetector
  if (Native) {
    try {
      const supported = await Native.getSupportedFormats()
      if (FORMATS.every((f) => supported.includes(f))) return new Native({ formats: [...FORMATS] })
    } catch {
      // Some phones have the reader but can't use it; the built-in one does instead.
    }
  }
  const { BarcodeDetector, prepareZXingModule } = await import('barcode-detector/ponyfill')
  // From the app's own files, never the CDN the package would otherwise fetch it from.
  await prepareZXingModule({
    overrides: { locateFile: (path: string, prefix: string) => (path.endsWith('.wasm') ? readerWasm : prefix + path) },
    fireImmediately: true,
  })
  return new BarcodeDetector({ formats: [...FORMATS] })
}
