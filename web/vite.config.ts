import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
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
      // Freelancer links are server pages, never the app shell.
      workbox: { navigateFallbackDenylist: [/^\/api\//, /^\/f\//] },
    }),
  ],
  server: {
    proxy: { '/api': { target: 'http://localhost:3030', ws: true }, '/f': 'http://localhost:3030' },
  },
})
