/// <reference types="node" />
import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'
import { color } from '../shared/src/ds/tokens.js'

/**
 * Which code this is, for error reports (ADR 0005) and the show pack, in a file of its own beside the page (version.ts),
 * never in the code: compiled in, it changed the biggest file and every file naming it on each deploy (audit finding 14).
 * Railway says which commit it builds.
 */
function versionFile(): Plugin {
  return {
    name: 'version-file',
    apply: 'build',
    generateBundle() {
      const version = process.env.RAILWAY_GIT_COMMIT_SHA?.slice(0, 12) ?? 'dev'
      this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify({ version }) })
    },
  }
}

/** The files of parts most phones never open, fetched the first time they're shown rather than with the app (finding 65). */
const ON_FIRST_USE = ['leaflet', 'Map', 'Rack3D']

export default defineConfig({
  define: {
    // Leaves Sentry's own debug logging out of the app.
    __SENTRY_DEBUG__: false,
  },
  build: {
    rollupOptions: {
      output: {
        // React and the map's library each on their own: they change only when they're upgraded, so a deploy leaves them
        // where phones already have them, rather than in the files the app's own code changes. The screens stay in one
        // file: they import each other in loops (jobs, crew, stock and Home), so split by area every file changed with any
        // one of them, and more was downloaded than before (audit finding 14).
        manualChunks: (id) =>
          /[\\/]node_modules[\\/](react|react-dom|scheduler)[\\/]/.test(id) ? 'react' : /[\\/]node_modules[\\/]leaflet[\\/]/.test(id) ? 'leaflet' : undefined,
      },
    },
  },
  plugins: [
    react(),
    versionFile(),
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
        // The version file is kept with the files it came with, so a phone says the version it's running (version.ts).
        // Sentry's code is left out: it's only fetched while error reporting is on (errors.ts), and is kept then as it's
        // fetched, below, rather than downloaded by every phone on every deploy for nothing. So are the map (ADR 0057) and
        // the rack in 3D (ADR 0076), which most phones never open: kept from the first time they're shown (lazyPart.tsx;
        // audit, 20 October 2026, finding 65). The QR code reader stays: scanning works with no signal from the first time
        // (ADR 0016), and the warehouse's iPhones need it.
        // The fonts are kept too (fonts.ts), so the type is the same with no signal.
        globPatterns: ['**/*.{js,css,html,woff2}', 'version.json'],
        globIgnores: ['**/errorsSdk-*.js', ...ON_FIRST_USE.map((name) => `**/${name}-*.{js,css}`)],
        // Freelancer links and calendar feeds come from the server, never the app shell.
        navigateFallbackDenylist: [/^\/api\//, /^\/f\//, /^\/cal\//],
        // Once Reload lets the new version in, it takes the open page straight away, so the reload lands on it.
        clientsClaim: true,
        // The map's pictures (ADR 0057), kept as they're seen, so a venue's map opened before still shows with no signal.
        // Asked for openly (Map.tsx), so each is kept at its own size; the newest 500, for a month.
        runtimeCaching: [
          // Its name changes with its content, so a copy once fetched is good for as long as it's asked for.
          {
            urlPattern: /\/assets\/errorsSdk-[^/]+\.js$/,
            handler: 'CacheFirst',
            options: { cacheName: 'error-reporting', expiration: { maxEntries: 2 }, cacheableResponse: { statuses: [200] } },
          },
          // Kept as each is first fetched, the latest few of each: one deploy's and the next's.
          {
            urlPattern: new RegExp(`/assets/(${ON_FIRST_USE.join('|')})-[^/]+\\.(js|css)$`),
            handler: 'CacheFirst',
            options: { cacheName: 'on-first-use', expiration: { maxEntries: 12 }, cacheableResponse: { statuses: [200] } },
          },
          {
            urlPattern: /^https:\/\/tile\.openstreetmap\.org\//,
            handler: 'StaleWhileRevalidate',
            options: { cacheName: 'map-pictures', expiration: { maxEntries: 500, maxAgeSeconds: 30 * 24 * 60 * 60 }, cacheableResponse: { statuses: [200] } },
          },
          // People's photos (ADR 0065), kept as they're seen so a face shows with no signal. A new photo is a new address,
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
