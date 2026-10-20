/// <reference types="node" />
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'
import { color } from '../shared/src/ds/tokens.js'

export default defineConfig({
  // Which code this is, for error reports (ADR 0005). Railway says when it builds.
  define: {
    __APP_VERSION__: JSON.stringify(process.env.RAILWAY_GIT_COMMIT_SHA?.slice(0, 12) ?? 'dev'),
    // Leaves Sentry's own debug logging out of the app.
    __SENTRY_DEBUG__: false,
  },
  plugins: [
    react(),
    VitePWA({
      // A new version waits until someone taps Reload (update.tsx), so the page that's open keeps its files.
      registerType: 'prompt',
      manifest: {
        name: 'Session Hire',
        short_name: 'Session Hire',
        // The brand red tints the phone's status bar; the splash behind the icon is the light theme's page.
        theme_color: '#ee3744',
        background_color: color.light.surface.ground,
        display: 'standalone',
        // PNGs beside the SVG (audit finding 26), made by scripts/make-icons.mjs: a phone installs with a real icon. They fill
        // their square with the mark well inside the middle, so Android may also crop them to its own shape ("maskable")
        // rather than shrinking them onto a white tile.
        icons: [
          { src: '/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // Freelancer links and calendar feeds come from the server, never the app shell.
        navigateFallbackDenylist: [/^\/api\//, /^\/f\//, /^\/cal\//],
        // Once Reload lets the new version in, it takes the open page straight away, so the reload lands on it.
        clientsClaim: true,
        // The map's pictures (ADR 0057), kept as they're seen, so a venue's map opened before still shows with no signal.
        // Asked for openly (Map.tsx), so each is kept at its own size; the newest 500, for a month.
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/tile\.openstreetmap\.org\//,
            handler: 'StaleWhileRevalidate',
            options: { cacheName: 'map-pictures', expiration: { maxEntries: 500, maxAgeSeconds: 30 * 24 * 60 * 60 }, cacheableResponse: { statuses: [200] } },
          },
          // People's photos (ADR 0063), kept as they're seen so a face shows with no signal. A new photo is a new address,
          // so one kept is never out of date; the newest 400, for three months.
          {
            urlPattern: ({ url, sameOrigin }) => sameOrigin && /^\/api\/people\/[^/]+\/photo$/.test(url.pathname),
            handler: 'CacheFirst',
            options: { cacheName: 'faces', expiration: { maxEntries: 400, maxAgeSeconds: 90 * 24 * 60 * 60 }, cacheableResponse: { statuses: [200] } },
          },
        ],
      },
    }),
  ],
  server: {
    proxy: { '/api': { target: 'http://localhost:3030', ws: true }, '/f': 'http://localhost:3030', '/cal': 'http://localhost:3030' },
  },
})
