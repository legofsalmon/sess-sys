/// <reference types="node" />
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

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
        theme_color: '#ee3744',
        background_color: '#eef1f4',
        display: 'standalone',
        icons: [{ src: '/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' }],
      },
      // Freelancer links and calendar feeds come from the server, never the app shell.
      workbox: { navigateFallbackDenylist: [/^\/api\//, /^\/f\//, /^\/cal\//] },
    }),
  ],
  server: {
    proxy: { '/api': { target: 'http://localhost:3030', ws: true }, '/f': 'http://localhost:3030', '/cal': 'http://localhost:3030' },
  },
})
