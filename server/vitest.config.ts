import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // Each test builds its own database (PGlite, in-process), which takes a
    // second or two, and several when every test file runs at once.
    testTimeout: 30_000,
  },
})
