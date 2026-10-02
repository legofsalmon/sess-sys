// Makes the PNG icons a phone needs to install the app (audit finding 26)
// from web/public/icon.svg: apple-touch-icon.png at 180px for "Add to Home
// Screen" on an iPhone, and icon-192.png and icon-512.png for the manifest.
// Run: node scripts/make-icons.mjs (the browser tests' Chromium draws them, so it needs no new package).
//
// Each is drawn on a square of the brand red rather than with the mark's
// rounded corners left clear: iPhones round the corners themselves, Android
// launchers crop the square to their own shape (the manifest lists the PNGs
// as maskable, the mark being well inside the middle), and clear corners
// would come out black on an iPhone.
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from '@playwright/test'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const svg = readFileSync(join(root, 'web/public/icon.svg'), 'utf8')
const red = svg.match(/fill="(#[0-9a-f]{6})"/i)?.[1] ?? '#ee3744'
const SIZES = [
  ['apple-touch-icon.png', 180],
  ['icon-192.png', 192],
  ['icon-512.png', 512],
]

const browser = await chromium.launch()
const page = await browser.newPage()
for (const [name, size] of SIZES) {
  await page.setViewportSize({ width: size, height: size })
  await page.setContent(
    `<!doctype html><html><body style="margin:0;background:${red}"><img src="data:image/svg+xml,${encodeURIComponent(svg)}" style="display:block;width:${size}px;height:${size}px"></body></html>`
  )
  await page.screenshot({ path: join(root, 'web/public', name), type: 'png' })
  console.log(`${name}: ${size}×${size}`)
}
await browser.close()
