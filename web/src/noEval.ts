import { z } from 'zod'

/**
 * Zod 4 builds its checks with new Function when it can, which the app's
 * content security policy refuses, and the browser reports each refusal.
 * This turns that off before any shared schema is made, so main.tsx
 * imports it first.
 */
z.config({ jitless: true })
