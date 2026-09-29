/**
 * The kind of device a change came from, for the history (ADR 0006): "Safari
 * on iPhone", "Chrome on Windows". Worked out from what the browser says
 * about itself, and only this short description is kept, not the full
 * string, which says more than the history needs.
 *
 * A best guess: an iPad can say it is a Mac, and anything unrecognised comes
 * back as the program's own name ("curl") or nothing at all.
 */

// Most specific first: Edge, Opera and Samsung's browser all also say "Chrome", and Chrome says "Safari".
const BROWSERS: [RegExp, string][] = [
  [/\b(?:Edg|EdgA|EdgiOS)\//, 'Edge'],
  [/\b(?:OPR|OPiOS)\//, 'Opera'],
  [/\bSamsungBrowser\//, 'Samsung Internet'],
  [/\b(?:Firefox|FxiOS)\//, 'Firefox'],
  [/(?:Chrome|CriOS|Chromium)\//, 'Chrome'],
  [/\bSafari\//, 'Safari'],
]

const SYSTEMS: [RegExp, string][] = [
  [/\b(?:iPhone|iPod)\b/, 'iPhone'],
  [/\biPad\b/, 'iPad'],
  [/\bAndroid\b/, 'Android'],
  [/\bCrOS\b/, 'Chromebook'],
  [/\bWindows\b/, 'Windows'],
  [/\b(?:Macintosh|Mac OS X)\b/, 'Mac'],
  [/\b(?:Linux|X11)\b/, 'Linux'],
]

export function describeDevice(userAgent: string | undefined): string | undefined {
  const ua = userAgent?.slice(0, 500) ?? ''
  if (!ua.trim()) return undefined
  const browser = BROWSERS.find(([re]) => re.test(ua))?.[1]
  const system = SYSTEMS.find(([re]) => re.test(ua))?.[1]
  if (browser && system) return `${browser} on ${system}`
  if (browser || system) return browser ?? system
  const program = /^([A-Za-z][\w.-]{0,30})\//.exec(ua)?.[1]
  return program && program !== 'Mozilla' ? program : undefined
}
