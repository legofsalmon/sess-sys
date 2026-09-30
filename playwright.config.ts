import { defineConfig } from '@playwright/test'

/**
 * End-to-end tests run the real server (PGlite in a temp folder) serving the
 * built web app. Build first: `npm run build:web`.
 * In sandboxes without Playwright's own browsers, set PW_CHROMIUM to a
 * Chromium binary.
 */
export default defineConfig({
  testDir: 'e2e',
  // One at a time: the tests share one server, and some check the next free number it gives out.
  workers: 1,
  timeout: 60_000,
  use: {
    baseURL: 'http://localhost:3099',
    launchOptions: process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {},
  },
  webServer: {
    command: 'rm -rf .e2e-data && DATA_DIR=$PWD/.e2e-data PORT=3099 npm start -w server',
    url: 'http://localhost:3099/api/health',
    reuseExistingServer: false,
    timeout: 60_000,
  },
})
