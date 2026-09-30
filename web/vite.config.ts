/// <reference types="node" />
import react from '@vitejs/plugin-react'
import { createRequire } from 'node:module'
import { dirname } from 'node:path'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

// The label reader's WebAssembly (ADR 0016), from the same copy of zxing-wasm that barcode-detector loads, so the two always match.
const require = createRequire(import.meta.url)
const readerWasm = require.resolve('zxing-wasm/reader/zxing_reader.wasm', { paths: [dirname(require.resolve('barcode-detector'))] })

export default defineConfig({
  resolve: { alias: [{ find: /^zxing-reader\.wasm(?=\?|$)/, replacement: readerWasm }] },
  // Which code this is, for error reports (ADR 0005). Railway says when it builds.
  define: {
    __APP_VERSION__: JSON.stringify(process.env.RAILWAY_GIT_COMMIT_SHA?.slice(0, 12) ?? 'dev'),
    // Leaves Sentry's own debug logging out of the app.
    __SENTRY_DEBUG__: false,
  },
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      manifest: {
        name: 'Session Hire',
        short_name: 'Session Hire',
        theme_color: '#ee3744',
        background_color: '#eef1f4',
        display: 'standalone',
        icons: [{ src: '/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' }],
      },
      workbox: {
        // Freelancer links and calendar feeds come from the server, never the app shell.
        navigateFallbackDenylist: [/^\/api\//, /^\/f\//, /^\/cal\//],
        // The label reader is kept on the device with the rest of the app, so the camera scans with no signal (ADR 0016).
        globPatterns: ['**/*.{js,css,html,wasm}'],
        maximumFileSizeToCacheInBytes: 3 * 1024 * 1024,
      },
    }),
  ],
  server: {
    proxy: { '/api': { target: 'http://localhost:3030', ws: true }, '/f': 'http://localhost:3030', '/cal': 'http://localhost:3030' },
  },
})
