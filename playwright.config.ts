import { defineConfig } from '@playwright/test'

/**
 * End-to-end tests run the real server (PGlite in a temp folder) serving the
 * built web app. Build first: `npm run build:web`.
 * In sandboxes without Playwright's own browsers, set PW_CHROMIUM to a
 * Chromium binary. Two checkouts can run the suite at once on different
 * ports: set E2E_PORT, and each gets a data folder of its own. Documents'
 * files go in a folder of their own (ADR 0029), so the server has them
 * while it has no backups, as the Backups card's tests expect.
 */
const port = process.env.E2E_PORT ?? '3099'

export default defineConfig({
  testDir: 'e2e',
  // One at a time: the tests share one server, and some check the next free number it gives out.
  workers: 1,
  timeout: 60_000,
  use: {
    baseURL: `http://localhost:${port}`,
    launchOptions: process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {},
  },
  webServer: {
    command: `rm -rf .e2e-data/${port} .e2e-data/${port}-documents && mkdir -p .e2e-data && DATA_DIR=$PWD/.e2e-data/${port} DOCUMENTS_DIR=$PWD/.e2e-data/${port}-documents PORT=${port} npm start -w server`,
    url: `http://localhost:${port}/api/health`,
    reuseExistingServer: false,
    timeout: 60_000,
  },
})
