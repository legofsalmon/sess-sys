import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // Each test builds its own database (PGlite, in-process), which takes a
    // second or two, and several when every test file runs at once. The
    // backup, starting-fresh and erasure tests take 90 s (finding 110).
    testTimeout: 30_000,
    // In CI two files at a time on the runner's four cores, so the test restores' own processes have room
    // (audit, 20 October 2026, finding 110); locally as many as Vitest likes.
    ...(process.env.CI ? { maxWorkers: 2, minWorkers: 1 } : {}),
  },
})
