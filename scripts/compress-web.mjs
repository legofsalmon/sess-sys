// Compresses the built app once, when it's built (audit finding 6): beside each
// text file in web/dist goes a .br and a .gz, which the server hands to a browser
// that takes them (@fastify/static's preCompressed) instead of the file itself.
// A first copy of the app on a phone is then a fraction of the megabytes it was,
// and the server never compresses the same file twice.
// Run after `vite build`: node scripts/compress-web.mjs [dir], web/dist by default.
//
// Brotli and gzip at their best, as it's done once per deploy. A file too small
// to gain, or that comes out no smaller, is left alone: the server then sends it
// as it is. Images and fonts are compressed already, so they're left out.
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, extname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { brotliCompressSync, constants, gzipSync } from 'node:zlib'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const dir = resolve(process.argv[2] ?? join(root, 'web/dist'))
const TEXT = new Set(['.html', '.js', '.mjs', '.css', '.svg', '.json', '.webmanifest', '.txt', '.xml', '.map', '.ico'])
const SMALLEST = 1024

function* files(at) {
  for (const name of readdirSync(at)) {
    const path = join(at, name)
    if (statSync(path).isDirectory()) yield* files(path)
    else yield path
  }
}

let before = 0
let after = 0
let count = 0
for (const path of [...files(dir)]) {
  if (!TEXT.has(extname(path))) continue
  const data = readFileSync(path)
  if (data.length < SMALLEST) continue
  const br = brotliCompressSync(data, { params: { [constants.BROTLI_PARAM_QUALITY]: constants.BROTLI_MAX_QUALITY, [constants.BROTLI_PARAM_SIZE_HINT]: data.length } })
  const gz = gzipSync(data, { level: 9 })
  if (br.length < data.length) writeFileSync(`${path}.br`, br)
  if (gz.length < data.length) writeFileSync(`${path}.gz`, gz)
  before += data.length
  after += Math.min(br.length, data.length)
  count++
}
console.log(`Compressed ${count} files in ${dir}: ${(before / 1024).toFixed(0)} KB, ${(after / 1024).toFixed(0)} KB as Brotli.`)
